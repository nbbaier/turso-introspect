# Plan 011: Design spike — a real `--diff-format migration`

> **Executor instructions**: This is a **design/spike plan** — the deliverable
> is a design document and a throwaway prototype, NOT production code. Follow
> the steps, honor the STOP conditions, and when done update the status row in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 633046f..HEAD -- src/commands/diff.ts src/lib/schema.ts`
> Drift here doesn't block a spike, but read whatever changed (especially if
> plan 003 landed) before writing the design.

## Status

- **Priority**: P3
- **Effort**: M (spike only; the eventual implementation is L and gets its own plan)
- **Risk**: LOW (no production code changes)
- **Depends on**: plans/003-diff-ignore-generated-header.md recommended first (its `stripGeneratedHeader` and equality semantics are the baseline the migration mode builds on)
- **Category**: direction
- **Planned at**: commit `633046f`, 2026-06-11

## Why this matters

The CLI already advertises `--diff-format migration` — the flag parses, the README and SPEC document it — but `src/commands/diff.ts:113-117` just warns `'"migration" format is not fully implemented yet'` and falls back to a unified diff. This is the repo's clearest stated-but-undelivered promise. A real migration mode (emit `CREATE TABLE` / `CREATE INDEX` / `DROP` statements that transform schema A into schema B) is also genuinely hard in SQLite: column-level changes require the 12-step table-rebuild dance, and text-diffing SQL strings cannot drive it. This spike decides what's honestly buildable, in what stages, and what the v1 cut line is — so the eventual implementation plan doesn't discover the hard parts mid-build.

## Current state

- `src/commands/diff.ts:113-117` — the stub:

```ts
	if (diffFormat === "migration") {
		logger.warn(
			'"migration" format is not fully implemented yet. Falling back to unified diff.',
		);
	}
```

- Crucial structural fact: `getSchemaSql` (`diff.ts:36-77`) reduces every source to a **formatted SQL string** before comparison. A migration differ needs the **structured** `Schema` objects (`src/lib/schema.ts:57-66` — tables with columns/FKs/indexes, views, triggers) instead. Database sources can provide that today via `introspectSchema`; **`.sql` file sources cannot** (that would require parsing arbitrary SQL — a major scope decision; see open questions).
- `Schema` already carries everything needed for object-level diffing: per-table `columns` (name, type, notnull, dflt_value, pk), `foreignKeys`, `indexes` (with original `sql` for origin-`c` indexes), plus `views`/`triggers` with original `sql`.
- SQLite constraints that bound the design:
  - No `ALTER TABLE ADD CONSTRAINT`; FK changes ⇒ table rebuild.
  - `ALTER TABLE ADD COLUMN` works only for columns with no PK/UNIQUE and (for NOT NULL) a non-null default.
  - Column type changes, drops before 3.35, reorders, PK changes ⇒ the documented 12-step rebuild (new table, copy, drop, rename, recreate indexes/triggers, FK check).
- Prior art worth reading during the spike: `sqlite-utils transform` (12-step automation), Drizzle Kit's SQLite push/diff, Atlas's declarative diffing, dbmate. The spike should cite what each does about rebuilds and destructive ops.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install`                    | exit 0              |
| Prototype scratch run | `bun run scratch/migration-spike.ts` | prints generated migration for the fixture pair |
| Tests untouched | `bun test` | all pass (spike must not break anything) |

## Scope

**In scope** (the only files you should create/modify):
- `plans/design/migration-diff-format.md` (create — the deliverable)
- `scratch/migration-spike.ts` (create — throwaway prototype; add `scratch/` to `.gitignore` if not ignored, or delete the file before finishing)

**Out of scope** (do NOT touch):
- ALL production source under `src/` — zero changes, including "harmless" exports.
- `README.md`/`SPEC.md` — docs change when the feature ships, not at spike time.

## Git workflow

- Branch: `advisor/011-migration-spike`
- Commit style: `docs: design spike for --diff-format migration`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Catalogue the diffable operations

In the design doc, enumerate every schema delta expressible between two `Schema` objects and classify each:

| Delta | SQLite mechanism | Class |
|---|---|---|
| table added | `CREATE TABLE` (original sql) | trivial |
| table removed | `DROP TABLE` | destructive |
| index added/removed (origin `c`) | `CREATE INDEX` / `DROP INDEX` | trivial |
| view added/removed/changed | `DROP VIEW` + `CREATE VIEW` | trivial |
| trigger added/removed/changed | `DROP TRIGGER` + `CREATE TRIGGER` | trivial |
| column added (ADD COLUMN-eligible) | `ALTER TABLE ... ADD COLUMN` | conditional |
| column added (ineligible: PK/UNIQUE/NOT NULL-no-default) | 12-step rebuild | hard |
| column removed | `ALTER TABLE ... DROP COLUMN` (≥3.35) or rebuild | conditional/destructive |
| column type/default/notnull changed | 12-step rebuild | hard |
| FK set changed | 12-step rebuild | hard |
| table renamed vs drop+create | undecidable without heuristics | hard (call it out) |

(The table above is a starting skeleton — verify each row against SQLite docs during the spike and correct anything wrong.)

### Step 2: Decide and justify the v1 cut line

Recommended starting position (argue with it in the doc if the evidence disagrees): **v1 = trivial + conditional classes only**: emit additive/replace statements; for every `hard`-class delta, emit a clearly-marked comment block (`-- MANUAL MIGRATION REQUIRED: users.email type changed TEXT -> BLOB (table rebuild needed)`); destructive ops (`DROP TABLE`, `DROP COLUMN`) emitted but commented out unless a future `--allow-destructive` flag is set. The doc must state: exit-code semantics (does a manual-required delta exit non-zero?), statement ordering (topological, drops last), and idempotency stance (none — migrations are one-shot, not `IF NOT EXISTS`).

### Step 3: Resolve the file-source question

Decide and document: in migration mode, are `.sql` file sources (a) rejected with a clear error ("migration format requires two database sources"), (b) supported by introspecting a temp database created by executing the file, or (c) supported via SQL parsing? Recommended: **(b)** — execute the file's statements into a `:memory:` libsql client and introspect it; it reuses the existing pipeline, handles any SQL SQLite accepts, and costs ~20 lines. Document the failure mode (file with invalid SQL → error with line context).

### Step 4: Prototype the happy path

In `scratch/migration-spike.ts`, hard-code two small `Schema`-shaped literals (or build two `:memory:` databases with DDL and introspect both using the real `introspectSchema`) differing by: one added table, one added index, one added ADD COLUMN-eligible column, one removed table. Implement just enough diffing (match objects by name; compare `Column` fields) to print the v1 migration output. This validates the data model carries enough information — the point of the prototype. Paste the prototype's output into the design doc as the worked example.

**Verify**: `bun run scratch/migration-spike.ts` → prints a migration containing exactly: 1 `CREATE TABLE`, 1 `CREATE INDEX`, 1 `ALTER TABLE ... ADD COLUMN`, 1 commented-out `DROP TABLE`.

### Step 5: Write the design doc

`plans/design/migration-diff-format.md` must contain: the operation catalogue (step 1), the v1 cut line with rationale (step 2), the file-source decision (step 3), the worked example (step 4), prior-art notes (one paragraph each: sqlite-utils, drizzle-kit, atlas), an implementation sketch (new `src/lib/migration.ts` with `diffSchemas(a: Schema, b: Schema): MigrationStep[]` + a renderer; `diff.ts` branches on format before flattening to SQL strings), an effort estimate for the implementation plan, and an **Open questions** section (must include: rename detection — recommend "out of scope, document as drop+create"; whether `metadata.version`/PRAGMA `user_version` should be stamped; trigger/view dependency ordering on rebuilds).

**Verify**: doc exists and contains the sections: `## Operation catalogue`, `## v1 scope`, `## File sources`, `## Worked example`, `## Prior art`, `## Implementation sketch`, `## Open questions` (`grep -c '^## ' plans/design/migration-diff-format.md` → ≥ 7).

### Step 6: Clean up

Delete `scratch/migration-spike.ts` or ensure `scratch/` is gitignored; confirm zero changes under `src/`.

**Verify**: `git status` → only `plans/design/migration-diff-format.md` (and possibly `.gitignore`) added/modified; `bun test` → all pass.

## Test plan

None — spike. The prototype's printed output (step 4 verify) is the evidence.

## Done criteria

ALL must hold:

- [ ] `plans/design/migration-diff-format.md` exists with the 7 required sections and a worked example produced by the prototype
- [ ] Recommendation is explicit enough that an implementation plan could be written from the doc alone (a reader can answer: what does v1 emit for each delta class? what happens with file sources? what exits non-zero?)
- [ ] `git status` shows no changes under `src/`
- [ ] `bun test` exits 0 (unchanged)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The prototype reveals the `Schema` type is missing data the differ needs (e.g. column-level UNIQUE constraints aren't introspected — they appear only inside `Table.sql` text and as origin-`u` indexes). Document the gap precisely in the doc's Open questions AND flag it in your report — it changes the implementation plan's scope.
- You find yourself implementing the actual feature in `src/` — that's the next plan, not this one.

## Maintenance notes

- The follow-up implementation plan should be written only after a maintainer reads the design doc and answers its open questions.
- If the verdict is "not worth building," that's a valid outcome: the doc then recommends removing the `migration` choice from `--diff-format` and the docs (a small plan replacing this feature promise with honesty).
