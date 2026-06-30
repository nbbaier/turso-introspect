# Plan 006: Clear the `bun audit` vulnerability report

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- package.json bun.lock` If these files changed since this plan was written, re-run `bun audit` first — the vulnerability set may already differ; on a mismatch with "Current state", treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md (tests are the regression gate for the updates)
- **Category**: security / deps
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

`bun audit` reports 4 vulnerabilities (2 high, 2 moderate). One — `ws` (uninitialized memory disclosure) — sits on the **runtime** path via `@libsql/client`, i.e. it ships to every npm user of this CLI. The other three (`defu` prototype pollution, two `picomatch` issues) are dev-only via `tsdown`, but they make every future `bun audit`/CI security gate noisy. All appear fixable within compatible ranges.

## Current state

`bun audit` at commit `633046f` reports exactly:

| Package | Vulnerable range | Path | Severity | Advisory |
|---|---|---|---|---|
| `ws` | `>=8.0.0 <8.20.1` | `@libsql/client › @libsql/hrana-client › @libsql/isomorphic-ws › ws` | moderate | GHSA-58qx-3vcg-4xpx (uninitialized memory disclosure) |
| `defu` | `<=6.1.4` | `tsdown › defu` | high | GHSA-737v-mqg7-c878 (prototype pollution) |
| `picomatch` | `>=4.0.0 <4.0.4` | `tsdown › tinyglobby › fdir › picomatch` | moderate | GHSA-3v7f-55p6-f55p |
| `picomatch` | `>=4.0.0 <4.0.4` | same path | high | GHSA-c2c7-rcm5-vvqj (ReDoS) |

Direct dependency ranges in `package.json`: `@libsql/client ^0.17.2`, `tsdown ^0.21.7`. All four vulnerable packages are **transitive** — the fix is refreshing the lockfile resolution, not changing direct dependency ranges (unless forced; see STOP conditions).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install`                    | exit 0              |
| Audit     | `bun audit`                      | "0 vulnerabilities" (goal) |
| Tests     | `bun test`                       | all pass            |
| Build     | `bun run build`                  | exit 0, `dist/index.js` written |
| Smoke     | `bun run src/index.ts --help`    | help text, exit 0   |

## Scope

**In scope** (the only files you should modify):
- `bun.lock` (via `bun update` — never hand-edit)
- `package.json` — only if an `overrides` block proves necessary (step 3) or `bun update` bumps pinned dev-tool versions (e.g. `@biomejs/biome` is pinned exactly; if `bun update` rewrites it, revert that line — see STOP conditions)

**Out of scope** (do NOT touch):
- Any `src/` file.
- Major-version bumps of direct dependencies (`tsdown` 0.21 → 0.2x is fine within `^`; a new major of `@libsql/client` or `tsdown` is NOT — that's a separate migration decision).

## Git workflow

- Branch: `advisor/006-dep-audit`
- Commit style: `chore: update transitive deps to clear bun audit findings`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Baseline

Run `bun install`, then `bun test` and `bun run build` to confirm green **before** touching anything.

**Verify**: both exit 0.

### Step 2: Update within compatible ranges

Run `bun update` (updates all dependencies to the latest versions satisfying `package.json` ranges and refreshes transitive resolutions). Then `bun audit`.

**Verify**: `bun audit` → fewer findings than the four above; ideally "0 vulnerabilities". If zero, skip to step 4.

### Step 3 (only if findings remain): Pin transitive fixes with `overrides`

For each remaining finding, add an entry to a top-level `"overrides"` block in `package.json` pinning the minimum patched version, e.g.:

```json
	"overrides": {
		"ws": "^8.20.1",
		"defu": "^6.1.5",
		"picomatch": "^4.0.4"
	}
```

Only add entries for packages still flagged. Run `bun install`, then `bun audit` again. (Check the advisory URL for the actual patched version of `defu` — `<=6.1.4` implies the fix is the next release after 6.1.4; use whatever `bun audit`'s advisory states.)

**Verify**: `bun audit` → "0 vulnerabilities".

### Step 4: Regression-check the toolchain

The risky surface is tsdown's transitive globbing/config deps changing build behavior, and `@libsql/client`'s ws bump affecting the client.

**Verify**, in order:
1. `bun test` → all pass (covers `@libsql/client` local behavior via plan 001's integration tests).
2. `bun run build` → exit 0; `head -1 dist/index.js` → `#!/usr/bin/env node`.
3. `bun run src/index.ts --help` → usage text, exit 0.
4. `bunx biome check src` → exit 0.

## Test plan

No new tests. The existing suite (plan 001) plus the build/smoke sequence in step 4 is the regression gate.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun audit` reports 0 vulnerabilities
- [ ] `bun test` exits 0
- [ ] `bun run build` exits 0
- [ ] `git diff --stat` touches only `bun.lock` (and `package.json` only if step 3 was needed)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Clearing the `ws` finding requires a new **major** of `@libsql/client` (compatible range can't reach a patched `@libsql/isomorphic-ws`) — report the version chain; the override approach (step 3) should prevent this, but if the override breaks `bun test`'s libsql integration tests, that's the same STOP.
- `bun update` rewrites the exact-pinned `"@biomejs/biome": "2.4.9"` to a newer version **and** `bunx biome check src` starts failing with new rules — revert the biome line, rerun `bun install`, and note it in your report.
- A remaining advisory has **no** patched version published — report it as an accepted risk candidate instead of forcing a downgrade or fork.

## Maintenance notes

- If step 3's `overrides` block was added: revisit it whenever `@libsql/client` or `tsdown` is upgraded — stale overrides can silently hold packages back. Note each override's reason in the PR description.
- CI (plan 002) could grow a `bun audit` step later; left out deliberately for now since advisory churn would make CI flaky.
