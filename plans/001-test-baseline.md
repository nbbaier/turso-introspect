# Plan 001: Establish a working test baseline with bun test

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- package.json src/` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

The repo has zero tests and the `test` script is a stub that exits 1. Every other planned change (bug fixes in diff/filtering/logging, a performance rewrite of the introspection loop, dependency updates) currently has no safety net — an executor cannot prove it didn't break anything. This plan creates that net: unit tests for the pure logic (formatting, topological sort, retry, URL resolution, identifier quoting) and an integration test that introspects a real in-memory SQLite database via `@libsql/client`. Several follow-up plans (003, 004, 005, 006, 007) list this plan as a prerequisite because their verification gates are `bun test`.

## Current state

- `package.json:36` — `"test": "echo \"Error: no test specified\" && exit 1"`.
- No `*.test.ts` or `*.spec.ts` files exist anywhere in the repo.
- Source modules to be tested (all under `src/lib/`):
   - `utils.ts` — single function `quoteIdent(name)` that wraps in double quotes and doubles internal quotes.
   - `retry.ts` — exports `sleep`, `RetryOptions`, `RetryError`, `withRetry(fn, options)`. `withRetry` attempts `fn` up to `retries + 1` times with exponential backoff `baseDelayMs * 2 ** attempt`, then throws `RetryError` wrapping the last error.
   - `formatter.ts` — exports `formatJson(schema)` and `formatSql(schema, options)`. `formatSql` emits a 3-line comment header, tables in topological FK order (private `sortTablesTopologically`), virtual tables as comments (`isVirtualTableSql` matches `CREATE VIRTUAL TABLE`), indexes only when `origin === "c" && idx.sql`, then views, then triggers. With `options.normalizeDefaults` it uppercases `current_timestamp`/`current_date`/`current_time` after `DEFAULT`.
   - `db.ts` — exports `resolveDatabaseUrl(database, org)`: passes through `file:`, `libsql://`, `http://`, `https://` URLs; otherwise requires `org` (throws `Error("Organization name is required when using a database name (use --org)")`) and returns `libsql://${database}-${org}.turso.io`.
   - `schema.ts` — exports `introspectSchema(client, dbName, options)` returning a `Schema` (`{ metadata, tables, views, triggers }`). Filtering via private `shouldSkip`: skips `sqlite_`/`_litestream_`/`_cf_` prefixes unless `options.includeSystem`; skips names in `options.excludeTables`; when `options.tables` is a non-empty array, skips anything not listed.
- Conventions (from `CLAUDE.md`): Bun runtime; test files `*.test.ts` importing from `"bun:test"`; tabs + double quotes (biome); imports of local files use `.js` extensions.
- `@libsql/client` is a runtime dependency and supports in-memory databases via `createClient({ url: ":memory:" })`.

Relevant excerpt — `src/lib/schema.ts:212-235` (the filter you will characterize):

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
	...
```

**Known bug — do not bake it into tests:** `shouldSkip` is also applied to views and triggers by _their own names_, so `--tables users` drops all views/triggers. Plan 004 fixes this. In this plan, write filtering tests **only about tables** (databases without views/triggers in those specific test cases) so the tests survive plan 004 unchanged.

## Commands you will need

| Purpose | Command                | Expected on success |
| ------- | ---------------------- | ------------------- |
| Install | `bun install`          | exit 0              |
| Tests   | `bun test`             | all pass, exit 0    |
| Lint    | `bunx biome check src` | exit 0              |

Note: `bun run typecheck` may fail until plan 002 lands (typescript is a peerDependency); do not gate on it here. Note: `bunx biome check .` (whole repo) may flag a local-only `.claude/settings.local.json` — scope lint checks to `src`.

## Scope

**In scope** (the only files you should modify/create):

- `package.json` (the `test` script line only)
- `src/lib/utils.test.ts` (create)
- `src/lib/retry.test.ts` (create)
- `src/lib/formatter.test.ts` (create)
- `src/lib/db.test.ts` (create)
- `src/lib/schema.test.ts` (create)

**Out of scope** (do NOT touch):

- Any non-test source file. This plan adds tests only; it fixes nothing, even bugs you notice.
- `tsdown.config.ts` — tsdown only bundles `src/index.ts`; test files won't end up in `dist` regardless.
- CI configuration (plan 002).

## Git workflow

- Branch: `advisor/001-test-baseline`
- Commit style: short conventional-ish messages matching `git log` (e.g. `test: add unit and integration test baseline`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Point the test script at bun test

In `package.json`, change `"test": "echo \"Error: no test specified\" && exit 1"` to `"test": "bun test"`.

**Verify**: `bun test` → exits 1 with "no tests found" (no test files yet) — confirms the runner is wired; proceed.

### Step 2: Unit tests for `quoteIdent` and `withRetry`

Create `src/lib/utils.test.ts` covering: plain name → `"users"`; name with an embedded `"` → doubled (`a"b` → `"a""b"`); empty string → `""""`.

Create `src/lib/retry.test.ts` covering (use `baseDelayMs: 0` so tests are instant):

- resolves immediately on first success, fn called once;
- fn fails twice then succeeds with `retries: 3` → resolves, fn called 3 times;
- all attempts fail with `retries: 2` → throws `RetryError`, message contains `"after 3 attempts"`, `error.cause` is the last underlying error;
- `retries: 0` → exactly one attempt, throws `RetryError` with `"after 1 attempt"`.

Pattern:

```ts
import { describe, expect, test } from "bun:test";
import { withRetry, RetryError } from "./retry.js";
```

**Verify**: `bun test src/lib/utils.test.ts src/lib/retry.test.ts` → all pass.

### Step 3: Unit tests for the formatter

Create `src/lib/formatter.test.ts`. Build `Schema` objects literally (import the `Schema`/`Table` types from `./schema.js`). A minimal table literal needs `name`, `sql`, `columns: []`, `foreignKeys: []`, `indexes: []`. Cover:

- **Topological order**: tables `[child, parent]` where `child.foreignKeys = [{ id: 0, seq: 0, table: "parent", from: "parent_id", to: "id", on_update: "NO ACTION", on_delete: "NO ACTION", match: "NONE" }]` → in `formatSql` output, `CREATE TABLE parent` appears at a lower string index than `CREATE TABLE child`.
- **Cycle tolerance**: two tables each with an FK to the other → `formatSql` returns (no hang/throw) and both CREATE statements are present.
- **Virtual table**: a table whose `sql` starts with `CREATE VIRTUAL TABLE` → output contains `-- Virtual table (not emitted as executable SQL):` and the SQL is comment-prefixed, with no un-commented `CREATE VIRTUAL TABLE` line.
- **Index emission**: a table with indexes `[{ name: "i1", origin: "c", sql: "CREATE INDEX i1 ON t (a)", unique: false, partial: false, columns: ["a"] }, { name: "i2", origin: "pk", unique: true, partial: false, columns: ["id"] }]` → output contains `CREATE INDEX i1 ON t (a);` and does not contain `i2`-specific SQL.
- **normalizeDefaults**: table `sql` containing `DEFAULT current_timestamp` → unchanged without the option; with `{ normalizeDefaults: true }` becomes `DEFAULT CURRENT_TIMESTAMP`. Also check the parenthesized form `DEFAULT (current_timestamp)` normalizes.
- **formatJson**: `JSON.parse(formatJson(schema))` deep-equals the schema object.

**Verify**: `bun test src/lib/formatter.test.ts` → all pass.

### Step 4: Unit tests for `resolveDatabaseUrl`

Create `src/lib/db.test.ts`:

- `resolveDatabaseUrl("libsql://x.turso.io")` → returned unchanged (same for `file:`, `http://`, `https://` inputs);
- `resolveDatabaseUrl("mydb", "myorg")` → `"libsql://mydb-myorg.turso.io"`;
- `resolveDatabaseUrl("mydb")` (no org) → throws, message contains `"--org"`.

Do not test `createDbClient`/`getAuthToken` (network + filesystem side effects).

**Verify**: `bun test src/lib/db.test.ts` → all pass.

### Step 5: Integration test for `introspectSchema` against in-memory SQLite

Create `src/lib/schema.test.ts`. Setup per test (or `beforeEach`): `const client = createClient({ url: ":memory:" });` from `@libsql/client`, then `await client.batch([...DDL])`, run assertions, `client.close()`.

Fixture DDL:

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT current_timestamp);
CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT);
CREATE INDEX idx_posts_user ON posts (user_id);
CREATE VIEW post_titles AS SELECT title FROM posts;
CREATE TRIGGER posts_touch AFTER UPDATE ON posts BEGIN SELECT 1; END;
```

Assert:

- `schema.tables` has exactly `posts` and `users` (sorted by name); `sqlite_*` internals absent.
- `users` columns include `email` with `notnull === 1` and `type === "TEXT"`; `id` with `pk === 1`.
- `posts.foreignKeys` has one entry with `table === "users"`, `from === "user_id"`, `to === "id"`.
- `posts.indexes` contains `idx_posts_user` with `origin === "c"`, `columns` deep-equal `["user_id"]`, and `sql` defined (starts with `CREATE INDEX`).
- `schema.views` contains `post_titles`; `schema.triggers` contains `posts_touch`.
- Filtering (tables only — see the known-bug note in Current state; use a second fixture with **only** the two tables, no view/trigger):
   - `{ tables: ["users"] }` → only `users` returned;
   - `{ excludeTables: ["posts"] }` → only `users` returned;
   - default options on a db that also has a table named `_cf_internal` → `_cf_internal` absent; with `{ includeSystem: true }` → present.
- End-to-end smoke: `formatSql(schema)` output contains `CREATE TABLE users` before `CREATE TABLE posts` (FK dependency order).

**Verify**: `bun test src/lib/schema.test.ts` → all pass.

### Step 6: Full suite + lint

**Verify**: `bun test` → exit 0, ≥ 20 tests passing. `bunx biome check src` → exit 0 (run `bunx biome check --write src` to fix formatting if needed — tabs, double quotes).

## Test plan

This plan _is_ the test plan; see steps 2–5 for the case list. There is no existing test to pattern-match — these files become the repo's pattern.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test` exits 0 with ≥ 20 passing tests across 5 new files
- [ ] `package.json` test script is `"bun test"` (`grep '"test": "bun test"' package.json`)
- [ ] `bunx biome check src` exits 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `createClient({ url: ":memory:" })` throws or `batch` fails under `bun test`. First try the fallback: create a temp file DB (`fs.mkdtemp` + `createClient({ url: \`file:${dir}/test.db\` })`, removing the dir in `afterAll`). If that also fails, stop — the libsql native binding may not load under this Bun version.
- Any assertion about current behavior in steps 3–5 fails because the source behaves differently than this plan's "Current state" describes (the plan, not the code, may be wrong — report the discrepancy).
- You feel the need to modify any non-test source file to make a test pass.

## Maintenance notes

- Plans 003, 004, 005, 007 will extend these files; keep fixtures small and per-test so later plans can add cases without entangling state.
- Reviewer should scrutinize: that filtering tests do not assert view/trigger filtering behavior (that behavior is wrong today and changes in plan 004).
- Deferred: CLI-level (spawned process) tests arrive with plan 005; no coverage tooling configured (bun supports `--coverage` if wanted later).
