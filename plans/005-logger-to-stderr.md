# Plan 005: Route all status logging to stderr so `--stdout` output is pipe-safe

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- src/lib/logger.ts src/commands/introspect.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md
- **Category**: bug
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

`turso-introspect mydb --org x --stdout -v` corrupts its own output: the schema goes to stdout, but `logger.verbose` ("Found N tables, …") and `logger.info`/`logger.success` also use `console.log` (stdout). Anyone piping `--stdout` output into a file or `sqlite3` gets log lines mixed into their SQL. The standard CLI convention is: machine output on stdout, human status on stderr. The code already half-knows this — `introspect.ts` guards one `logger.info` call with `if (!options.stdout)` — but the guard doesn't cover verbose logging. Routing all Logger methods to stderr fixes the corruption and lets the awkward guard go away.

## Current state

- `src/lib/logger.ts:11-33` — `info`, `success`, and `verbose` use `console.log` (stdout); `warn` and `error` already use `console.error` (stderr):

```ts
	info(message: string): void {
		if (!this.options.quiet) {
			console.log(chalk.blue(message));
		}
	}

	success(message: string): void {
		if (!this.options.quiet) {
			console.log(chalk.green(message));
		}
	}
	...
	verbose(message: string): void {
		if (this.options.verbose && !this.options.quiet) {
			console.log(chalk.gray(message));
		}
	}
```

- `src/commands/introspect.ts:119-121` — the partial workaround:

```ts
		if (!options.stdout) {
			logger.info(`Introspecting ${database}...`);
		}
```

- `src/commands/introspect.ts:139-141` — the unguarded verbose call that corrupts `--stdout -v`:

```ts
		logger.verbose(
			`Found ${schema.tables.length} tables, ${schema.views.length} views, ${schema.triggers.length} triggers`,
		);
```

- The actual machine output paths that must STAY on stdout: `console.log(output)` at `introspect.ts:153` and `console.log(patch)` in `diff.ts:133` (after plan 003: `console.log(Diff.createTwoFilesPatch(...))`). Do not touch these.
- Plan 001 established the test pattern; CLI-level tests can spawn the tool with `Bun.spawn`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install`                    | exit 0              |
| Tests     | `bun test`                       | all pass            |
| Lint      | `bunx biome check src`           | exit 0              |
| Manual smoke | `bun run src/index.ts <db-file> --stdout -v 1>/tmp/out.sql 2>/tmp/err.txt` | `/tmp/out.sql` is pure SQL; status lines in `/tmp/err.txt` |

## Scope

**In scope** (the only files you should modify/create):
- `src/lib/logger.ts`
- `src/commands/introspect.ts` (remove the `!options.stdout` guard only)
- `src/cli.test.ts` (create — CLI-level test)

**Out of scope** (do NOT touch):
- `src/lib/errors.ts` — `handleError` already writes to stderr.
- `src/commands/diff.ts` — its patch output on stdout is correct; its logger calls become stderr automatically via the Logger change.
- Adding flags like `--no-color` or log levels.

## Git workflow

- Branch: `advisor/005-logger-stderr`
- Commit style: `fix: write status logging to stderr, keep stdout for output`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Switch Logger to stderr

In `src/lib/logger.ts`, change the three `console.log(...)` calls (`info`, `success`, `verbose`) to `console.error(...)`. `warn` and `error` are already correct.

**Verify**: `grep -c "console.log" src/lib/logger.ts` → `0`.

### Step 2: Remove the now-redundant stdout guard

In `src/commands/introspect.ts`, replace:

```ts
		if (!options.stdout) {
			logger.info(`Introspecting ${database}...`);
		}
```

with:

```ts
		logger.info(`Introspecting ${database}...`);
```

(The message now goes to stderr, so it's safe in `--stdout` mode; `--quiet` still suppresses it.)

**Verify**: `bun test` → existing tests pass.

### Step 3: CLI-level regression test

Create `src/cli.test.ts`. In `beforeAll`, build a fixture SQLite file: `fs.mkdtemp` a dir, `createClient({ url: \`file:${dir}/fixture.db\` })`, execute `CREATE TABLE t (id INTEGER PRIMARY KEY)`, close. In `afterAll`, remove the dir.

Test: spawn the CLI and assert stream separation —

```ts
const proc = Bun.spawn(
	["bun", "run", "src/index.ts", dbPath, "--stdout", "-v"],
	{ stdout: "pipe", stderr: "pipe" },
);
const [stdout, stderr] = await Promise.all([
	new Response(proc.stdout).text(),
	new Response(proc.stderr).text(),
]);
await proc.exited;
```

Assert: exit code 0; `stdout` contains `CREATE TABLE t` and does **not** contain `Found ` or `Introspecting`; `stderr` contains `Found 1 tables`. Add a second case with `-q --stdout`: stderr is empty (or whitespace), stdout still contains the schema.

Note: spawn with `cwd` set to the repo root so `src/index.ts` resolves; the fixture path must be absolute.

**Verify**: `bun test src/cli.test.ts` → all pass.

## Test plan

See step 3 — two spawn-based cases (verbose stream separation, quiet mode). This is the repo's first CLI-level test; later plans can extend the same file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "console.log" src/lib/logger.ts` returns 0
- [ ] `grep -n "options.stdout" src/commands/introspect.ts` shows only the output-writing branch (line ~152), not a logging guard
- [ ] `bun test` exits 0 including `src/cli.test.ts`
- [ ] `bunx biome check src` exits 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `Bun.spawn` of the CLI fails for environmental reasons (no `bun` on PATH inside the test) after one fix attempt — report; don't replace the test with a mock.
- You find other `console.log` call sites in `src/` that print *status* (not output) — list them in your report; only the ones named in this plan are in scope.

## Maintenance notes

- Anyone adding a new Logger method must use `console.error`; consider a private `write()` helper if a third stream-related bug appears (not now — two call patterns don't justify it).
- Reviewer should confirm "Schemas are identical." (diff success path) moving to stderr is acceptable: scripts checking that string on stdout would break — none are known, and exit code 0 is the contract.
