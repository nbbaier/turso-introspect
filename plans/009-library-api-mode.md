# Plan 009: Expose a programmatic library API alongside the CLI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- package.json tsdown.config.ts src/` If `tsdown.config.ts` or `package.json` changed since this plan was written, compare against the "Current state" excerpts before proceeding; on a structural mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (purely additive; CLI behavior unchanged)
- **Depends on**: plans/002-packaging-and-ci.md (declaration emission needs `typescript` in devDependencies); recommended after 003/004 so the exported behavior is the fixed behavior
- **Category**: direction
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

The package is CLI-only today: anyone wanting schema introspection in a build script, CI check, or migration tool must shell out and parse stdout. The codebase is already cleanly layered for library use — `src/lib/` has no CLI coupling (no `process.exit`, no commander imports; logging stays in `src/commands/`). This plan publishes that layer: an `exports` map, a `src/api.ts` entry, and type declarations. It turns the tool from a point solution into a building block (the maintainer's own IMPROVEMENT-IDEAS.md ranks this "Very High" impact), and it's the natural substrate for a future `--format typescript` (plan 010) and migration tooling (plan 011).

**Stability note for the maintainer/reviewer**: shipping this commits the `Schema`/`Table`/`Column` interfaces to semi-public status. The package is 0.x, so semver allows breakage, but the README section (step 5) should say the API is experimental until 1.0.

## Current state

- `package.json` (excerpt): `"type": "module"`, `"bin": { "turso-introspect": "./dist/index.js" }`, `"files": ["dist"]`, no `exports`, no `main`, no `types` field.
- `tsdown.config.ts` (entire file):

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { index: "src/index.ts" },
	format: "esm",
	platform: "node",
	outDir: "dist",
	clean: true,
	banner: "#!/usr/bin/env node",
	outputOptions: {
		entryFileNames: "[name].js",
	},
});
```

  Note the `banner` adds a shebang to **every** entry; the library entry must not get one (it's harmless to Node's ESM parser, but ugly and confusing) — hence the two-config split in step 2.

- Public-surface candidates and where they live:
  - `src/lib/schema.ts` — `introspectSchema(client, dbName, options)`, interfaces `Schema`, `Table`, `Column`, `ForeignKey`, `Index`, `View`, `Trigger`, `IntrospectOptions`.
  - `src/lib/formatter.ts` — `formatSql(schema, options)`, `formatJson(schema)`.
  - `src/lib/db.ts` — `createDbClient(config)`, `resolveDatabaseUrl(database, org)`, interface `ConnectionConfig`.
  - `src/lib/errors.ts` — `CliError` (consumers need it for `instanceof` checks).
  - NOT exported: `Logger` (CLI concern), `withRetry` (internal), command functions in `src/commands/` (they write files/print).
- Convention: local imports use `.js` extensions (note: `src/lib/formatter.ts:1` currently imports `"./schema"` without the extension — fix that line while touching the area; it's a 1-token change).
- tsdown supports `dts: true` for declaration emission (requires `typescript` installed — plan 002).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install`                    | exit 0              |
| Build     | `bun run build`                  | exit 0; `dist/index.js`, `dist/api.js`, `dist/api.d.ts` exist |
| Tests     | `bun test`                       | all pass            |
| Typecheck | `bun run typecheck`              | exit 0              |
| Lint      | `bunx biome check src`           | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `src/api.ts` (create)
- `tsdown.config.ts`
- `package.json` (`exports`, `main`, `types` fields only)
- `src/lib/formatter.ts` (line 1 import extension only)
- `src/api.test.ts` (create)
- `README.md` (new "Programmatic API" section)

**Out of scope** (do NOT touch):
- Function signatures or behavior of anything in `src/lib/` — this plan re-exports; it does not redesign. If a signature feels wrong for library use, note it in the report.
- The CLI entry `src/index.ts` and `bin` mapping.
- Publishing/version bump.

## Git workflow

- Branch: `advisor/009-library-api`
- Commit style: `feat: expose programmatic API via package exports`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `src/api.ts`

```ts
export {
	createDbClient,
	resolveDatabaseUrl,
	type ConnectionConfig,
} from "./lib/db.js";
export { CliError } from "./lib/errors.js";
export { formatJson, formatSql } from "./lib/formatter.js";
export {
	introspectSchema,
	type Column,
	type ForeignKey,
	type Index,
	type IntrospectOptions,
	type Schema,
	type Table,
	type Trigger,
	type View,
} from "./lib/schema.js";
```

Also fix `src/lib/formatter.ts:1`: `import type { Schema, Table } from "./schema";` → `from "./schema.js";`.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Split the tsdown config into CLI and library builds

Replace `tsdown.config.ts` contents with an array config:

```ts
import { defineConfig } from "tsdown";

export default defineConfig([
	{
		entry: { index: "src/index.ts" },
		format: "esm",
		platform: "node",
		outDir: "dist",
		clean: true,
		banner: "#!/usr/bin/env node",
		outputOptions: { entryFileNames: "[name].js" },
	},
	{
		entry: { api: "src/api.ts" },
		format: "esm",
		platform: "node",
		outDir: "dist",
		clean: false, // first config already cleaned
		dts: true,
		outputOptions: { entryFileNames: "[name].js" },
	},
]);
```

**Verify**: `bun run build` → exit 0; `ls dist/` shows `index.js`, `api.js`, `api.d.ts`; `head -1 dist/index.js` → `#!/usr/bin/env node`; `head -1 dist/api.js` → NOT a shebang.

### Step 3: Wire `package.json` entry points

Add (keeping `bin` and `files` as they are):

```json
	"main": "./dist/api.js",
	"types": "./dist/api.d.ts",
	"exports": {
		".": {
			"types": "./dist/api.d.ts",
			"import": "./dist/api.js"
		},
		"./package.json": "./package.json"
	},
```

**Verify**: `node -e "import('./dist/api.js').then(m => { if (typeof m.formatSql !== 'function' || typeof m.introspectSchema !== 'function') process.exit(1); console.log(Object.keys(m).join(',')) })"` → prints the export names, exit 0.

### Step 4: API smoke test

Create `src/api.test.ts`: import `{ introspectSchema, formatSql, createDbClient }` from `"./api.js"`; using `createClient({ url: ":memory:" })` from `@libsql/client` (pattern from `src/lib/schema.test.ts`), create one table, run `introspectSchema`, assert `formatSql` output contains the CREATE TABLE. This pins the public surface — if someone removes an export, this file fails to typecheck/run.

**Verify**: `bun test src/api.test.ts` → passes.

### Step 5: Document it

Add a `## Programmatic API` section to README (after "Schema Diff Command") with: install snippet, a ~10-line usage example (createDbClient → introspectSchema → formatSql), the note "API is experimental until 1.0; the CLI is the stable interface", and a pointer that `Schema` types are exported.

**Verify**: `grep -n "Programmatic API" README.md` → match.

## Test plan

- New: `src/api.test.ts` (step 4) — public-surface smoke test.
- Existing suite must stay green: `bun test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run build` produces `dist/index.js` (with shebang), `dist/api.js` (no shebang), `dist/api.d.ts`
- [ ] The node import one-liner in step 3 exits 0
- [ ] `bun test` exits 0 including `src/api.test.ts`
- [ ] `bun run typecheck` and `bunx biome check src` exit 0
- [ ] `package.json` has `exports`, `main`, `types`; `bin` unchanged
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `dts: true` fails (tsdown declaration build errors) — likely a tsconfig interaction (`allowImportingTsExtensions`, `noEmit`); report the error rather than flipping tsconfig flags, which are out of scope.
- The tsdown version installed doesn't accept an array config or the `dts` option — report tsdown's actual config surface; do not upgrade tsdown majors (that's a separate decision).
- Plan 002 hasn't landed (`typescript` not in devDependencies).

## Maintenance notes

- Every future export added to `src/api.ts` is a public-API commitment; reviewers should treat changes to that file like changes to a published interface.
- Plan 010 (`--format typescript`) should export its formatter through `api.ts` too.
- Deferred: a `./cli` exports subpath, CommonJS build, and renaming `CliError` (odd name for a library error) — all 1.0 considerations.
