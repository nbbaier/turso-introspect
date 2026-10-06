# turso-introspect

Bun/TypeScript CLI and library that introspects Turso/libsql (and local SQLite) schemas: emits executable SQL, JSON, or TypeScript interfaces, and diffs two schema sources. User-facing usage lives in `README.md`; the original product spec in `docs/SPEC.md`.

## Commands

Run `bun install` first in any fresh checkout or worktree. Bun skips the root `prepare` script, so install the lefthook pre-commit hook once per clone with `bunx lefthook install` (worktrees share it). Use the repo's own `tsc`/`biome` via scripts, not `bunx tsc`.

- `bun run ci`: the full gate, identical to GitHub CI (check, typecheck, test, build). Green `bun run ci` is the done criterion.
- `bun run fix`: apply Biome fixes; the pre-commit hook does this for staged files.
- `bun run src/index.ts --help`: run the CLI from source.
- `scripts/pr-verify.sh <pr> [--keep] [--allow-fork]`: verify a PR when reviewing: merges it into fresh `main` in a throwaway worktree (as CI does), installs from the frozen lockfile, and runs `bun run ci`. It runs the PR's code locally, so read the diff first.

Other scripts are in `package.json`.

## Layout

```
src/
├── index.ts            # CLI entry: commander definitions, exit codes
├── api.ts              # Library entry (package "main"): re-exports from lib/
├── commands/
│   ├── introspect.ts   # introspect command: validate args, write output
│   └── diff.ts         # diff command: db/file vs db/file, unified diff
└── lib/
    ├── db.ts           # URL resolution, auth token resolution, client creation
    ├── schema.ts       # sqlite_master + PRAGMA queries, table filtering, types
    ├── formatter.ts    # SQL/JSON output, topological table sort
    ├── formatter-ts.ts # TypeScript interface output
    ├── retry.ts        # withRetry for transient remote errors
    ├── logger.ts       # chalk wrapper; all logs go to stderr
    ├── errors.ts       # CliError with exit codes (1 connection, 2 args, 3 not found)
    └── utils.ts        # quoteIdent
```

`tsdown.config.ts` builds two entries: `dist/index.js` (CLI, with shebang) and `dist/api.js` + `.d.ts` (library).

## Tests

`bun test`, files colocated as `*.test.ts`. Tests build real libsql databases (`:memory:` or a temp `file:` path) rather than mocking the client; `src/cli.test.ts` spawns the CLI against a temp DB file. Nothing exercises a live Turso database: changes to remote auth (platform-token exchange, Turso CLI settings) or remote-only fallbacks need a human run with `-v` against a real database, so say so in the PR.

## Gotchas

- **Auth token priority**: `--token` > `TURSO_AUTH_TOKEN` > Turso CLI settings (`~/Library/Application Support/turso/settings.json` on macOS, `~/.config/turso/settings.json` on Linux). A platform token (JWT `alg` RS256) is exchanged for a database token via `POST https://api.turso.tech/v1/organizations/{org}/databases/{db}/auth/tokens`; a database token (HS256) is used directly.
- **Index origins**: only `origin = 'c'` indexes are emitted as separate `CREATE INDEX`; `u`/`pk` are part of `CREATE TABLE`.
- **Foreign keys**: SQLite cannot add FK constraints after creation, so table order comes from the topological sort; cycles must degrade gracefully.
- **Filtered by default** (unless `--include-system`): `sqlite_*`, `_litestream_*`, `_cf_*`. Virtual tables (FTS5, R-tree) are emitted as comments.
- **`--diff-format migration`** is a stub that falls back to unified diff (design spike: issue #20).
- **Style**: tabs, double quotes, `.js` extensions on relative imports, `node:` prefix for builtins. libsql rows are loosely typed: cast fields (`String(row.name)`, `Number(row.cid)`).
- **Editing `package.json`**: it is tab-indented; prefer `npm pkg set` over string replacement.

## References

- libsql client: https://github.com/tursodatabase/libsql-client-ts
- Turso platform API: https://docs.turso.tech/api-reference

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI; external PRs are not a triage surface. Repo changes close their issue via PR merge (`Closes #N`); leave the issue open. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
