# Plan 007: Replace per-table PRAGMA round trips with set-based pragma queries

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- src/lib/schema.ts` This plan REQUIRES plan 004's changes to `schema.ts` (type-aware `shouldSkip`). If `schema.ts` differs from the post-004 shape described below in any *other* way, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (relies on pragma table-valued functions being available server-side; mitigated by a retained fallback path)
- **Depends on**: plans/001-test-baseline.md, plans/004-fix-view-trigger-filtering.md
- **Category**: perf
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

`introspectSchema` issues roughly **3 sequential network round trips per table**: `PRAGMA table_info` + `PRAGMA foreign_key_list` (parallel pair), then `PRAGMA index_list`, then one `PRAGMA index_info` per index — and tables are processed strictly one after another in a `for` loop. Against a remote Turso database at 50–100 ms RTT, a 100-table schema costs hundreds of round trips and tens of seconds. SQLite exposes the same data as **pragma table-valued functions** (`pragma_table_info(...)` usable in `SELECT ... JOIN`), which collapses the whole walk into **4 fixed queries regardless of table count**. The repo's git history shows three prior "optimize schema introspection" PRs — this is the change they were circling.

## Current state

(Line numbers are from commit `633046f`; plan 004 shifts them slightly but doesn't restructure the query flow.)

- `src/lib/schema.ts:154-196` — sequential per-table loop:

```ts
	for (const row of masterResult.rows) {
		...
		if (type === "table") {
			const [columnsRes, fkRes] = await Promise.all([
				client.execute(`PRAGMA table_info(${quoteIdent(name)})`),
				client.execute(`PRAGMA foreign_key_list(${quoteIdent(name)})`),
			]);

			const columns = columnsRes.rows.map(mapColumn);
			const foreignKeys = fkRes.rows.map(mapForeignKey);
			const indexes = await getIndexes(client, name, indexSqlMap);
			...
```

- `src/lib/schema.ts:100-131` — `getIndexes` does `PRAGMA index_list(table)` then one `PRAGMA index_info(idx)` per index.
- Mapping helpers `mapColumn` (`schema.ts:76-85`) and `mapForeignKey` (`schema.ts:87-98`) take a generic row record — they can be reused unchanged for the set-based rows as long as column aliases match.
- The master query (`schema.ts:143-145`) already fetches all object names/SQL in one round trip — it stays.
- The retry Proxy in `src/lib/db.ts:193-211` wraps `execute`/`batch` — set-based queries go through it unchanged.
- Tests: `src/lib/schema.test.ts` (plans 001 + 004) assert column/FK/index structure against in-memory fixtures — these are the characterization net for this rewrite and **must pass unchanged**.

Key facts about pragma table-valued functions:
- Available in SQLite ≥ 3.16 as `pragma_table_info('t')` etc.; usable in joins: `SELECT m.name, p.* FROM sqlite_master m JOIN pragma_table_info(m.name) p`.
- The tool already runs classic `PRAGMA` statements against remote Turso successfully, so pragma machinery exists server-side; the TVF form is the same machinery, but remote support is the MED-risk item — hence the retained fallback.
- `notnull` must be quoted as `"notnull"` in SQL — `NOTNULL` is an operator keyword in SQLite.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install`                    | exit 0              |
| Tests     | `bun test`                       | all pass            |
| Lint      | `bunx biome check src`           | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0 (if plan 002 landed) |

## Scope

**In scope** (the only files you should modify):
- `src/lib/schema.ts`
- `src/lib/schema.test.ts` (extend with the fallback test only)

**Out of scope** (do NOT touch):
- `src/lib/db.ts` (retry proxy), `src/lib/formatter.ts`, command files.
- The exported `Schema`/`Table`/`Column`/`ForeignKey`/`Index` interfaces — output shape must be byte-identical.
- Removing the old per-table code path — it becomes the explicit fallback (see step 3).

## Git workflow

- Branch: `advisor/007-batch-pragma`
- Commit style: `perf: introspect all tables with set-based pragma queries`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the set-based queries

In `schema.ts`, add a function `introspectTablesBatch(client, tableNames: string[], tableSqlMap: Map<string, string>, indexSqlMap: Map<string, string>): Promise<Table[]>` that runs these four queries via `Promise.all` (no identifier interpolation anywhere — table names come back as data):

```sql
-- columns
SELECT m.name AS table_name, p.cid, p.name, p.type, p."notnull", p.dflt_value, p.pk
FROM sqlite_master m JOIN pragma_table_info(m.name) p
WHERE m.type = 'table' AND m.sql IS NOT NULL
ORDER BY m.name, p.cid;

-- foreign keys
SELECT m.name AS table_name, f.id, f.seq, f."table", f."from", f."to", f.on_update, f.on_delete, f."match"
FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
WHERE m.type = 'table' AND m.sql IS NOT NULL
ORDER BY m.name, f.id, f.seq;

-- index list
SELECT m.name AS table_name, il.name, il."unique", il.origin, il.partial
FROM sqlite_master m JOIN pragma_index_list(m.name) il
WHERE m.type = 'table' AND m.sql IS NOT NULL
ORDER BY m.name, il.name;

-- index columns
SELECT m.name AS table_name, il.name AS index_name, ii.seqno, ii.cid, ii.name
FROM sqlite_master m JOIN pragma_index_list(m.name) il JOIN pragma_index_info(il.name) ii
WHERE m.type = 'table' AND m.sql IS NOT NULL
ORDER BY m.name, il.name, ii.seqno;
```

Quote `"table"`, `"from"`, `"to"`, `"match"`, `"unique"`, `"notnull"` — all are keywords/operators. Group rows in JS by `table_name` (a `Map<string, T[]>`), reusing `mapColumn`/`mapForeignKey` on each row (their property names — `cid`, `name`, etc. — match the aliases above; `table_name` is extra and ignored by the mappers). Assemble `Index` objects exactly as `getIndexes` does today: `unique: Boolean(row.unique)`, `origin: String(row.origin)`, `partial: Boolean(row.partial)`, `columns` from the index-columns query in `seqno` order, `sql` from `indexSqlMap`. Sort each table's indexes by name (matches current `localeCompare` sort). Only build `Table` entries for names in `tableNames` (the post-filter list), using `tableSqlMap` for the `sql` field.

### Step 2: Rewire `introspectSchema`

Restructure the main loop: first pass over `masterResult.rows` collects (as today) `indexSqlMap`, plus the filtered lists of views/triggers, plus `tableNames: string[]` and `tableSqlMap` for table rows that pass `shouldSkip`. Then call `introspectTablesBatch` once. Keep the final `tables.sort(...)` and the returned object exactly as-is.

**Verify**: `bun test` → **all existing schema/formatter/CLI tests pass with zero modifications**. This is the characterization gate; if any existing assertion needs editing to pass, the rewrite changed behavior — STOP.

### Step 3: Keep the per-table path as an explicit fallback

Wrap the batch call:

```ts
	let tables: Table[];
	try {
		tables = await introspectTablesBatch(client, tableNames, tableSqlMap, indexSqlMap);
	} catch (error: unknown) {
		// Pragma table-valued functions may be unavailable on some servers.
		tables = await introspectTablesSequential(client, tableNames, tableSqlMap, indexSqlMap);
	}
```

`introspectTablesSequential` is the existing logic (current loop body + `getIndexes`), extracted into a function — moved, not rewritten. Caveat: with the retry proxy active, a TVF syntax error will be retried ~4 times (~3.5 s) before falling back; acceptable for a one-time-per-run cost — note it in the PR description.

**Verify**: `bun run typecheck` (if available) → exit 0; `bunx biome check src` → exit 0.

### Step 4: Test the fallback path

In `src/lib/schema.test.ts`, add one test that wraps a real client in a Proxy whose `execute` rejects any SQL containing `pragma_table_info` (forwarding everything else), then asserts `introspectSchema` still returns the full correct fixture schema via the fallback.

**Verify**: `bun test` → all pass, including the new fallback test.

## Test plan

- Existing fixtures from plans 001/004 are the primary (characterization) tests — they must pass **unchanged**.
- New: the fallback-path test (step 4).
- Optional sanity check, not a gate: against a local file DB with many tables, the batch path should issue 5 total `execute` calls (1 master + 4 batch) — assert via a counting Proxy if cheap to add.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test` exits 0; no pre-existing test file was modified except the documented additions to `schema.test.ts`
- [ ] `grep -c "PRAGMA table_info" src/lib/schema.ts` → 1 (only inside the sequential fallback)
- [ ] `grep -n "pragma_table_info" src/lib/schema.ts` → present in the batch query
- [ ] `bunx biome check src` exits 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 004 has not landed (drift check shows `shouldSkip` still has the 2-arg signature) — execute 004 first or report.
- The TVF queries fail against the **local in-memory test client** (would mean the libsql embedded build omits pragma TVFs — the whole approach is then wrong, not just remote-risky).
- Existing tests fail and the fix would require changing their assertions.
- Output ordering differs (e.g. index or column order) between batch and sequential paths in tests — report the exact difference; do not "fix" by re-sorting in only one path.

## Maintenance notes

- **Remote verification before release**: tests only prove the local/embedded path. Before publishing, a human should run the CLI once against a real Turso database with `-v` and confirm no fallback was triggered (worth adding a `logger.verbose("falling back to per-table introspection")` in the catch — recommended, one line).
- If Turso turns out not to support pragma TVFs over hrana, the fallback silently absorbs it — watch for "still slow" reports; that would be the tell.
- The sequential fallback duplicates query logic by design (it IS the old code). When confidence in the batch path is established (a few releases), delete the fallback and `getIndexes`.
