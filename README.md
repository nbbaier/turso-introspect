# Turso Introspect CLI

A CLI tool to introspect the database schema of a Turso/libsql database. Point it at a remote Turso database and get a clean, executable schema file.

## Installation

```bash
# npm
npm install -g turso-introspect

# bun
bun install -g turso-introspect
```

## Quick Start

```bash
# Using database URL
turso-introspect libsql://mydb-myorg.turso.io

# Using database name (requires --org)
turso-introspect mydb --org myorg

# Using a local SQLite database file
turso-introspect ./dev.db
turso-introspect ~/databases/myapp.sqlite

# Output to specific file
turso-introspect mydb --org myorg -o ./schemas/mydb.sql

# JSON output
turso-introspect mydb --org myorg --format json

# Write to stdout
turso-introspect mydb --org myorg --stdout
```

## Authentication

The CLI supports three authentication methods (in order of precedence):

1. **Command-line flag** (highest priority):
   ```bash
   turso-introspect mydb --org myorg --token "your-token"
   ```

2. **Environment variable** (recommended for CI/CD):
   ```bash
   export TURSO_AUTH_TOKEN="your-token"
   turso-introspect mydb --org myorg
   ```

3. **Turso CLI authentication** (automatic):
   ```bash
   # If you're logged in via the Turso CLI, no token is needed
   turso auth login
   turso-introspect mydb --org myorg
   ```

### Token Types

The CLI automatically handles both token types:

- **Platform tokens** (from `turso auth login` or `turso auth token`): Used to manage Turso resources. When detected, the CLI automatically exchanges it for a database token via the Turso API.
- **Database tokens** (from `turso db tokens create <db>`): Used directly for database connections.

You can use either token type with `--token` or `TURSO_AUTH_TOKEN`. The CLI detects which type you've provided and handles it appropriately.

> **Note**: When using platform tokens, the `--org` flag is required to generate database tokens.

## Database Identification

Databases can be specified in two ways:

1. **Full URL**: `libsql://mydb-myorg.turso.io`
2. **Database name**: Requires `--org` flag to specify the organization
3. **Local SQLite file path**: `.db`/`.sqlite` file on disk

## Output Formats

### SQL (default)

Produces executable SQL with:

- Tables sorted in topological order based on foreign key dependencies
- Foreign key constraints as separate `ALTER TABLE` statements (enables order-independent execution)
- Indexes, views, and triggers included
- Virtual tables (FTS5, R-tree, etc.) output as comments only
- Minimal header comment with generation timestamp

### JSON

Structured output with categorized schema objects.

## Table Filtering

```bash
# Only specific tables
turso-introspect mydb --org myorg --tables users,posts,comments

# Exclude specific tables
turso-introspect mydb --org myorg --exclude-tables logs,sessions
```

## Schema Diff Command

Compare schemas between databases or files:

```bash
# Compare two live databases
turso-introspect diff libsql://db1.turso.io libsql://db2.turso.io

# Compare database against local file
turso-introspect diff libsql://production.turso.io ./local-schema.sql

# Compare local SQLite database against remote
turso-introspect diff ./dev.db libsql://production.turso.io

# Output as migration SQL
turso-introspect diff db1 db2 --org myorg --diff-format migration
```

## CLI Reference

```
turso-introspect [database] [options]

Arguments:
  database              Database URL (libsql://...) or name

Options:
  --org <name>          Organization name (required when using db name)
  --token <token>       Authentication token (overrides TURSO_AUTH_TOKEN)
  -o, --output <path>   Output file path (default: {db}-schema.{sql|json})
  --stdout              Write to stdout instead of file
  --format <type>       Output format: sql (default) or json
  --tables <list>       Comma-separated list of tables to include
  --exclude-tables <l>  Comma-separated list of tables to exclude
  --include-system      Include SQLite/libsql system tables
  --normalize-defaults  Normalize common DEFAULT expressions
  --check               Validate connection without producing output
  --retries <number>    Retry failed connections N times (default: 3)
  --retry-delay <ms>    Base retry delay in milliseconds (default: 500)
  -q, --quiet           Suppress warnings and informational output
  -v, --verbose         Show detailed progress information
  -h, --help            Show help
  --version             Show version

Subcommands:
  diff <db1> <db2>      Compare schemas between two sources
    --diff-format <f>   Output format: diff (default) or migration
    --org <name>        Organization (when using db names)
    --token <token>     Authentication token
    --retries <number>  Retry failed connections N times (default: 3)
    --retry-delay <ms>  Base retry delay in milliseconds (default: 500)
```

## Development

```bash
bun install
bun run src/index.ts --help
bun run build        # Build with tsdown
bun run dev          # Watch mode
```
