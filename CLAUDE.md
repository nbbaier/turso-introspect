---
description: Development guide for turso-introspect CLI
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

# Turso Introspect CLI - Development Guide

A CLI tool for introspecting Turso/libsql database schemas. Generates executable SQL schema files and performs schema diffs.

## Project Overview

**What it does:**
- Introspects remote Turso/libsql databases to extract schema information
- Generates executable SQL schema files with proper dependency ordering
- Supports JSON output format for programmatic access
- Compares schemas between databases or files (diff command)
- Handles Turso authentication (platform tokens, database tokens, env vars)

**Key features:**
- Tables sorted topologically by foreign key dependencies
- Supports table filtering (include/exclude specific tables)
- Handles indexes, views, triggers, and foreign key constraints
- Virtual table detection (FTS5, R-tree)
- System table filtering (sqlite_*, _litestream_*, _cf_*)

## Tech Stack

**Runtime & Package Manager:**
- **Bun** (primary runtime) - Use `bun` for all commands
- Node.js compatible but optimized for Bun

**Dependencies:**
- `@libsql/client` - Database client for Turso/libsql
- `commander` - CLI framework and argument parsing
- `chalk` - Terminal styling (colored output)
- `diff` - Schema comparison

**Dev Tools:**
- `tsdown` - Build tool (replaces tsc, esbuild, webpack)
- `@biomejs/biome` - Linter and formatter (replaces ESLint + Prettier)
- TypeScript 5.9.3+ (peer dependency)

## Bun Commands

Default to using Bun instead of Node.js:

```bash
# Development
bun run src/index.ts --help           # Run directly during development
bun run start                         # Same as above (npm script)

# Build
bun run build                         # Build for distribution with tsdown
bun run dev                           # Watch mode with tsdown

# Install
bun install                           # Install dependencies

# Test (not yet implemented)
bun test                              # Will run tests when added
```

**Note:** Bun automatically loads `.env` files, so dotenv is not needed.

## Project Structure

```
src/
├── index.ts                 # CLI entry point, command definitions (commander)
├── commands/
│   ├── introspect.ts       # Main introspect command logic
│   └── diff.ts             # Schema diff command logic
└── lib/
    ├── db.ts               # Database connection, auth token handling
    ├── schema.ts           # Schema introspection core logic
    ├── formatter.ts        # SQL/JSON output formatting, topological sort
    ├── logger.ts           # Colored console output (chalk wrapper)
    ├── errors.ts           # Custom error types with exit codes
    └── utils.ts            # Utility functions (quoteIdent)
```

### Module Responsibilities

#### `src/index.ts`
- Entry point for CLI
- Uses Commander.js to define commands and options
- Main command: introspect (default)
- Subcommand: diff
- Error handling and process exit codes

#### `src/commands/introspect.ts`
- Validates command arguments
- Creates database client
- Calls introspection logic
- Formats and writes output (file or stdout)
- Handles --check flag for connection validation

#### `src/commands/diff.ts`
- Compares two schema sources (databases or files)
- Uses `diff` library for unified diff output
- Supports migration format (not fully implemented)

#### `src/lib/db.ts`
- Database connection management
- URL resolution (handles both full URLs and db names)
- **Authentication token handling:**
  - Priority: `--token` flag > `TURSO_AUTH_TOKEN` env > Turso CLI settings
  - Automatically detects platform tokens vs database tokens
  - Converts platform tokens to database tokens via Turso API
  - Reads Turso CLI settings from `~/Library/Application Support/turso/settings.json` (macOS) or `~/.config/turso/settings.json` (Linux)

#### `src/lib/schema.ts`
- Core introspection logic
- Queries `sqlite_master` for schema objects
- Fetches table metadata using PRAGMA statements:
  - `PRAGMA table_info()` for columns
  - `PRAGMA foreign_key_list()` for foreign keys
  - `PRAGMA index_list()` and `PRAGMA index_info()` for indexes
- Table filtering logic (include/exclude/system tables)
- TypeScript interfaces for schema objects

#### `src/lib/formatter.ts`
- Formats schema as SQL or JSON
- **Topological sort** for tables (dependency order)
  - Ensures tables are created in correct order
  - Handles circular dependencies gracefully
- SQL output includes:
  - Header comment with metadata
  - CREATE TABLE statements (original SQL from sqlite_master)
  - CREATE INDEX statements (only explicitly created indexes, origin='c')
  - Views and triggers
- JSON output: structured schema object

#### `src/lib/logger.ts`
- Wrapper around chalk for consistent styling
- Respects `--quiet` and `--verbose` flags
- Methods: `info()`, `success()`, `warn()`, `error()`, `verbose()`

#### `src/lib/errors.ts`
- Custom `CliError` class with exit codes
- Exit codes:
  - 1: Connection errors
  - 2: Invalid arguments
  - 3: Not found errors

#### `src/lib/utils.ts`
- `quoteIdent()`: SQL identifier quoting (doubles internal quotes)

## Build Configuration

### tsdown (Build Tool)

Configuration in `tsdown.config.ts`:
- Entry: `src/index.ts`
- Format: ESM
- Platform: Node.js
- Output: `dist/index.js` with shebang (`#!/usr/bin/env node`)
- Clean dist folder on each build

The CLI is distributed as a single bundled file with all dependencies included.

### TypeScript Configuration

Key settings in `tsconfig.json`:
- Target: ESNext
- Module: Preserve (for bundler mode)
- Module resolution: bundler
- Strict mode enabled
- `noUncheckedIndexedAccess: true` (important for safe array access)
- `verbatimModuleSyntax: true` (explicit import/export types)
- No emit (tsdown handles bundling)

## Code Style & Conventions

### Biome Configuration

Configured in `biome.json`:
- **Formatter:**
  - Indent style: tabs
  - Quote style: double quotes
- **Linter:** Recommended rules enabled
- **Auto imports:** Organized on save
- Git integration enabled (uses .gitignore)

**Running Biome:**
```bash
bunx @biomejs/biome check .           # Check all files
bunx @biomejs/biome check --write .   # Fix issues
bunx @biomejs/biome format --write .  # Format only
```

### TypeScript Conventions

1. **Error handling:**
   - Use try-catch with `unknown` type
   - Type guard: `error && typeof error === "object" && "message" in error`
   - Example:
   ```typescript
   catch (error: unknown) {
     if (error instanceof CliError) {
       console.error(chalk.red("Error:"), error.message);
       process.exit(error.code);
     }
     const message = error && typeof error === "object" && "message" in error
       ? String(error.message)
       : String(error);
     console.error(chalk.red("Error:"), message);
   }
   ```

2. **Database row type casting:**
   - libsql rows are loosely typed, always cast:
   ```typescript
   const tableName = String(row.name);
   const isUnique = Boolean(row.unique);
   const columnId = Number(row.cid);
   ```

3. **Optional chaining:**
   - Use for potentially undefined values: `row.sql as string | undefined`

4. **Imports:**
   - Use `.js` extensions in imports (for ESM compatibility)
   - Node builtins: `node:fs/promises`, `node:path`, `node:os`

## Database Schema Introspection

### SQLite System Tables

The CLI queries `sqlite_master` table:
```sql
SELECT type, name, sql, tbl_name
FROM sqlite_master
WHERE sql IS NOT NULL
ORDER BY name
```

**Row types:**
- `table` - Tables
- `view` - Views
- `trigger` - Triggers
- `index` - Indexes (some are auto-generated, some explicit)

### PRAGMA Statements

Used to get detailed metadata:
- `PRAGMA table_info("table_name")` - Column definitions
- `PRAGMA foreign_key_list("table_name")` - Foreign key constraints
- `PRAGMA index_list("table_name")` - All indexes on table
- `PRAGMA index_info("index_name")` - Columns in an index

### Filtering System Tables

Excluded by default (unless `--include-system`):
- Tables starting with `sqlite_`
- Tables starting with `_litestream_` (Litestream replication)
- Tables starting with `_cf_` (Cloudflare/Turso internals)

## Authentication Flow

1. Check for `--token` flag
2. Check `TURSO_AUTH_TOKEN` environment variable
3. Fall back to Turso CLI settings file
4. Detect token type:
   - **Platform token** (RS256): Call Turso API to generate database token
   - **Database token** (HS256): Use directly
5. Connect to database with token

**API endpoint for token generation:**
```
POST https://api.turso.tech/v1/organizations/{org}/databases/{db}/auth/tokens
```

## Publishing

Configured in `package.json`:
- Binary: `turso-introspect` → `./dist/index.js`
- Files included: `dist/` only
- Access: public (npm)
- `prepublishOnly` script runs build automatically

**Publishing steps:**
```bash
bun run build           # Build to dist/
npm version patch       # Bump version
npm publish             # Publish to npm
```

## Testing

**Current state:** No tests implemented yet (`npm test` exits with error)

**When adding tests:**
- Use `bun test` framework
- Import from `bun:test`:
  ```typescript
  import { test, expect, describe } from "bun:test";
  ```
- Test files: `*.test.ts` or `*.spec.ts`

## CLI Usage Examples

```bash
# Basic usage
turso-introspect libsql://mydb-myorg.turso.io

# With database name (requires --org)
turso-introspect mydb --org myorg

# Custom output file
turso-introspect mydb --org myorg -o ./schema.sql

# JSON format
turso-introspect mydb --org myorg --format json

# Filter tables
turso-introspect mydb --org myorg --tables users,posts
turso-introspect mydb --org myorg --exclude-tables logs

# Check connection only
turso-introspect mydb --org myorg --check

# Compare schemas
turso-introspect diff db1 db2 --org myorg
turso-introspect diff prod-db ./local-schema.sql --org myorg
```

## Common Development Tasks

### Adding a new command

1. Create command file in `src/commands/`
2. Define command logic (accept options, call lib functions)
3. Register command in `src/index.ts` using Commander:
   ```typescript
   program
     .command("mycommand")
     .description("...")
     .argument("<arg>", "...")
     .option("--flag", "...")
     .action(async (arg, options) => {
       await myCommand(arg, options);
     });
   ```

### Adding a new lib module

1. Create file in `src/lib/`
2. Export functions/classes
3. Use `.js` extension in imports (for ESM)
4. Add types/interfaces as needed

### Modifying schema output

Edit `src/lib/formatter.ts`:
- `formatSql()` - SQL generation
- `formatJson()` - JSON output
- `sortTablesTopologically()` - Dependency ordering

### Handling new authentication methods

Edit `src/lib/db.ts`:
- Add token source in `getAuthToken()`
- Update priority chain
- Handle token detection/conversion

## Important Notes

- **SQLite FK limitations:** Cannot use `ALTER TABLE ADD CONSTRAINT FOREIGN KEY`. Must rely on topological sort for creation order.
- **Virtual tables:** FTS5, R-tree, and other virtual tables should be output as comments (not fully executable).
- **Index origins:**
  - `c` - Created explicitly with CREATE INDEX
  - `u` - Unique constraint (part of CREATE TABLE)
  - `pk` - Primary key (part of CREATE TABLE)
  - Only output indexes with origin='c' separately
- **Token types:** Platform tokens (RS256) vs database tokens (HS256) are detected by JWT header algorithm.
- **Case sensitivity:** SQLite is case-insensitive for identifiers, but Turso might be case-sensitive in some contexts.

## API Documentation

For @libsql/client details, see: https://github.com/tursodatabase/libsql-client-ts

For Turso platform API, see: https://docs.turso.tech/api-reference
