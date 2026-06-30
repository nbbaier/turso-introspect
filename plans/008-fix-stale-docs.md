# Plan 008: Correct actively-wrong claims in README, SPEC, and IMPROVEMENT-IDEAS

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- README.md SPEC.md IMPROVEMENT-IDEAS.md` If these files changed since this plan was written, re-locate each quoted passage before editing; if a passage no longer exists, skip that edit and note it in your report.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

Three documents make claims the code contradicts. Worst: both README and SPEC say foreign keys are emitted as "separate `ALTER TABLE` statements (enables order-independent execution)" — this is not implemented, and **cannot** be: SQLite has no `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY` (the repo's own `CLAUDE.md` says so). A user relying on that promise would mis-design their migration flow. The SPEC also documents a JSON shape with a top-level `indexes` array (actual output nests indexes inside each table) and a "warns on problematic defaults" feature that doesn't exist. Wrong docs are worse than missing docs.

## Current state

What the code actually does (ground truth for the edits):

- FK handling: `src/lib/formatter.ts:75-111` sorts tables topologically by FK dependencies and emits original `CREATE TABLE` statements verbatim. No `ALTER TABLE` anywhere (`grep -rn "ALTER TABLE" src/` → no matches).
- JSON shape: `src/lib/formatter.ts:3-5` serializes the `Schema` interface (`src/lib/schema.ts:57-66`): `{ metadata, tables, views, triggers }` — each table contains its own `indexes` array; there is no top-level `indexes` key.
- No default-value warning exists (`grep -rn "default" src/lib/*.ts` shows only `normalizeDefaultExpressions`).
- Two IMPROVEMENT-IDEAS items are already shipped: local SQLite file support (`src/lib/db.ts:39-78`) and retry with exponential backoff (`src/lib/retry.ts`).

Passages to fix:

1. `README.md:86` (bullet under "Output Formats → SQL"): `- Foreign key constraints as separate \`ALTER TABLE\` statements (enables order-independent execution)`
2. `SPEC.md:75`: identical bullet.
3. `SPEC.md:280-281` (last paragraph): "Foreign keys are output as separate ALTER TABLE statements to ensure the SQL can be executed in any order without dependency issues."
4. `SPEC.md:84-96`: JSON example shows `"indexes": [...]` as a top-level key.
5. `SPEC.md:151-155` ("Default Value Handling"): bullet "Warns if a default looks potentially problematic" — not implemented.
6. `SPEC.md:268`: "**CLI framework**: TBD (commander, yargs, or citty)" — it's commander.
7. `IMPROVEMENT-IDEAS.md` — ideas #1 (local SQLite) and #4 (retry/backoff) are implemented but listed as proposals.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Verify no ALTER claim remains | `grep -rn "ALTER TABLE" README.md SPEC.md` | no matches |
| Lint (markdown untouched by biome — sanity only) | `bunx biome check src` | exit 0 (unchanged) |

## Scope

**In scope** (the only files you should modify):
- `README.md`
- `SPEC.md`
- `IMPROVEMENT-IDEAS.md`

**Out of scope** (do NOT touch):
- `CLAUDE.md` — accurate as written.
- Any `src/` file — docs conform to code, not the reverse.
- README "Table Filtering" semantics paragraph — plan 004 owns that section's update.

## Git workflow

- Branch: `advisor/008-fix-stale-docs`
- Commit style: `docs: align README/SPEC with actual behavior`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the ALTER TABLE claims (items 1–3)

Replace the bullet in both `README.md:86` and `SPEC.md:75` with:

```
- Tables emitted in dependency order (topological sort by foreign key references), so the file executes top-to-bottom
```

Replace the `SPEC.md:280-281` closing paragraph with: "Tables are emitted in topological order based on foreign key references, so the generated SQL executes top-to-bottom without dependency errors. (SQLite does not support adding foreign key constraints via `ALTER TABLE`.)"

**Verify**: `grep -rn "ALTER TABLE" README.md SPEC.md` → no matches.

### Step 2: Fix the JSON example (item 4)

In `SPEC.md:84-96`, remove the `"indexes": [...]` line from the example so it reads `{ "metadata": {...}, "tables": [...], "views": [...], "triggers": [...] }`, and add a one-line note: "Indexes are nested within each table object."

**Verify**: `grep -n '"indexes"' SPEC.md` → no matches.

### Step 3: Remove the unimplemented warning claim (item 5) and fix the framework note (item 6)

In `SPEC.md:151-155`, delete the bullet "Warns if a default looks potentially problematic" (keep the other two bullets). In `SPEC.md:268`, change to `- **CLI framework**: commander`.

**Verify**: `grep -n "potentially problematic" SPEC.md` → no matches; `grep -n "TBD" SPEC.md` → no matches.

### Step 4: Mark shipped ideas in IMPROVEMENT-IDEAS.md (item 7)

Add a `> **Status: shipped** — implemented in \`src/lib/db.ts\`` blockquote directly under the `## 1. Add Local SQLite File Introspection Support` heading, and `> **Status: shipped** — implemented in \`src/lib/retry.ts\`` under `## 4. Implement Connection Retry with Exponential Backoff`. Update the summary table rows for #1 and #4 with a "(shipped)" suffix in the Improvement column. Do not delete the sections (they document the rationale).

**Verify**: `grep -c "Status: shipped" IMPROVEMENT-IDEAS.md` → `2`.

## Test plan

No code tests — verification is the grep gates per step.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "ALTER TABLE" README.md SPEC.md` → no matches
- [ ] `grep -n '"indexes"' SPEC.md` → no matches
- [ ] `grep -n "potentially problematic\|TBD" SPEC.md` → no matches
- [ ] `grep -c "Status: shipped" IMPROVEMENT-IDEAS.md` → 2
- [ ] `git status` shows only the three in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A quoted passage can't be found at or near the cited line (drift) — skip and report rather than rewriting surrounding prose.
- You notice the *code* contradicts a doc claim not listed here — report it as a new finding; don't expand the edit set.

## Maintenance notes

- SPEC.md is drifting toward "historical design doc" status; if drift recurs, consider folding the still-true parts into README and archiving SPEC. Deferred — maintainer's call.
- Reviewer: check the replacement bullets read naturally in both files' list style (README uses `- `, SPEC uses `-  ` double-space).
