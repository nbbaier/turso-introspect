# Plan 004: Make table filters treat views and triggers correctly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- src/lib/schema.ts README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md
- **Category**: bug
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

The `--tables` / `--exclude-tables` filters are applied to **every** schema object by its own name, but views and triggers aren't tables:

1. `--tables users` silently drops **all** views and **all** triggers — including triggers defined ON `users` — because their names aren't in the allow-list.
2. `--exclude-tables logs` keeps a trigger defined ON `logs` (its own name isn't `logs`), so the generated SQL contains `CREATE TRIGGER ... ON logs` for a table that was never created — the output fails to execute, defeating the tool's core promise of "executable schema files".

The fix: triggers follow the filter verdict of the table they're attached to (SQLite gives us that table in `sqlite_master.tbl_name`, which the code already fetches and ignores); views are not subject to the `--tables` allow-list (they're not tables) but can still be excluded explicitly by name. `CREATE VIEW` referencing a missing table succeeds in SQLite (views are resolved at query time), so emitting views alongside a table allow-list keeps the output executable.

## Current state

- `src/lib/schema.ts:143-145` — the master query already selects `tbl_name` but the code never reads it:

```ts
	const masterResult = await client.execute(
		"SELECT type, name, sql, tbl_name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
	);
```

- `src/lib/schema.ts:154-175` — the per-object loop applies `shouldSkip(name, options)` uniformly before branching on type:

```ts
	for (const row of masterResult.rows) {
		const name = String(row.name);
		const type = String(row.type);
		const sql = String(row.sql);

		if (type === "index") {
			continue;
		}

		if (shouldSkip(name, options)) {
			continue;
		}

		if (type === "view") {
			views.push({ name, sql });
			continue;
		}

		if (type === "trigger") {
			triggers.push({ name, sql });
			continue;
		}
```

- `src/lib/schema.ts:212-235` — current `shouldSkip`:

```ts
function shouldSkip(name: string, options: IntrospectOptions): boolean {
	if (
		!options.includeSystem &&
		(name.startsWith("sqlite_") ||
			name.startsWith("_litestream_") ||
			name.startsWith("_cf_"))
	) {
		return true;
	}

	if (options.excludeTables?.includes(name)) {
		return true;
	}

	if (
		options.tables &&
		options.tables.length > 0 &&
		!options.tables.includes(name)
	) {
		return true;
	}

	return false;
}
```

- Tests live in `src/lib/schema.test.ts` (created by plan 001) using `createClient({ url: ":memory:" })` fixtures. Plan 001 deliberately avoided asserting view/trigger filtering behavior; this plan adds those assertions.
- Repo conventions: tabs, double quotes, `.js` import extensions, `String(row.x)` casts for libsql rows.

## Target semantics (the spec for this change)

| Object  | system prefixes (`sqlite_`, `_litestream_`, `_cf_`) | `--tables` (allow-list) | `--exclude-tables` |
|---------|-----------------------------------------------------|--------------------------|--------------------|
| table   | skip by own name unless `--include-system`          | skip if name not listed  | skip if name listed |
| trigger | skip if **its table** (`tbl_name`) has a system prefix, unless `--include-system` | skip if `tbl_name` not listed | skip if `tbl_name` listed |
| view    | skip by own name unless `--include-system`          | **never skipped by allow-list** | skip if own name listed |

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install`                    | exit 0              |
| Tests     | `bun test`                       | all pass            |
| Lint      | `bunx biome check src`           | exit 0              |
| Typecheck | `bun run typecheck`              | exit 0 (only if plan 002 landed; otherwise skip) |

## Scope

**In scope** (the only files you should modify):
- `src/lib/schema.ts`
- `src/lib/schema.test.ts` (extend)
- `README.md` — only the "Table Filtering" section (add 2–3 sentences documenting the semantics table above)

**Out of scope** (do NOT touch):
- `src/commands/introspect.ts` — its flag parsing/validation is fine.
- `src/lib/formatter.ts`.
- Filtering views by *dependency analysis* (parsing view SQL to find referenced tables) — explicitly deferred; the semantics table is the whole scope.

## Git workflow

- Branch: `advisor/004-filter-views-triggers`
- Commit style: `fix: apply table filters to triggers via their parent table, keep views`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rework `shouldSkip` to be type-aware

Replace `shouldSkip` with a signature carrying the object type and parent table:

```ts
function shouldSkip(
	name: string,
	type: "table" | "view" | "trigger",
	tblName: string,
	options: IntrospectOptions,
): boolean {
	// For triggers, filter decisions are based on the table they belong to.
	const filterName = type === "trigger" ? tblName : name;

	if (!options.includeSystem && isSystemName(filterName)) {
		return true;
	}

	if (options.excludeTables?.includes(filterName)) {
		return true;
	}

	if (
		type !== "view" &&
		options.tables &&
		options.tables.length > 0 &&
		!options.tables.includes(filterName)
	) {
		return true;
	}

	return false;
}

function isSystemName(name: string): boolean {
	return (
		name.startsWith("sqlite_") ||
		name.startsWith("_litestream_") ||
		name.startsWith("_cf_")
	);
}
```

### Step 2: Pass type and tbl_name at the call site

In the loop (`schema.ts:154-175`), read `const tblName = String(row.tbl_name);` next to `name`/`type`/`sql`, and change the guard to run **after** the type is known to be one of the three handled kinds. Concretely: keep the `type === "index"` early-continue, then:

```ts
		if (type !== "table" && type !== "view" && type !== "trigger") {
			continue;
		}

		if (shouldSkip(name, type, tblName, options)) {
			continue;
		}
```

(The explicit type narrowing also satisfies the `"table" | "view" | "trigger"` parameter type.)

**Verify**: `bun test` → all pre-existing tests still pass (plan 001's table-filtering tests assert behavior this change preserves).

### Step 3: Add tests for the new semantics

Extend `src/lib/schema.test.ts` with a fixture containing: tables `users`, `logs`; trigger `users_touch` ON `users`; trigger `logs_touch` ON `logs`; view `user_names AS SELECT ... FROM users`. Assert:

- `{ tables: ["users"] }` → tables = `[users]`; triggers = `[users_touch]` (trigger follows its table; `logs_touch` dropped); views = `[user_names]` (views survive an allow-list).
- `{ excludeTables: ["logs"] }` → tables = `[users]`; triggers = `[users_touch]` only; views = `[user_names]`.
- `{ excludeTables: ["user_names"] }` → view `user_names` dropped (explicit name exclusion still works on views); both tables and both triggers present.
- Default options → everything present (regression guard).

**Verify**: `bun test` → all pass, including ≥ 4 new assertions.

### Step 4: Document the semantics

In `README.md`'s "Table Filtering" section (around line 95), append a short paragraph: triggers are included/excluded based on the table they are defined on; views are always included unless explicitly excluded by name with `--exclude-tables`; system-prefixed objects require `--include-system`.

**Verify**: `grep -n "triggers are included" README.md` → match found.

## Test plan

See step 3. The structural pattern is the existing fixtures in `src/lib/schema.test.ts` from plan 001 (per-test `:memory:` client + `batch` DDL).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test` exits 0 with the new filtering tests passing
- [ ] `grep -n "tbl_name" src/lib/schema.ts` shows it being read (not just selected)
- [ ] `bunx biome check src` exits 0
- [ ] README "Table Filtering" section documents trigger/view semantics
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `schema.ts` no longer matches the excerpts (e.g. plan 007's performance rewrite already landed — in that case this plan's steps need re-mapping onto the new structure; report rather than adapting solo).
- A plan-001 test fails after step 2 in a way that isn't explained by the intended semantics change.
- You find `tbl_name` is missing/empty for triggers in real query results (would invalidate the whole approach).

## Maintenance notes

- **Ordering with plan 007:** this plan must land *before* plan 007 (perf rewrite of `introspectSchema`); 007's plan assumes the type-aware `shouldSkip` exists.
- Reviewer should scrutinize the view semantics decision: views referencing excluded tables are still emitted (valid SQLite, resolved at query time). If users complain, dependency-aware view filtering is the follow-up — deferred deliberately.
