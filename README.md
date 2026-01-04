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

# Output to specific file
turso-introspect mydb --org myorg -o ./schemas/mydb.sql

# JSON output
turso-introspect mydb --org myorg --format json

# Write to stdout
turso-introspect mydb --org myorg --stdout
```

## Authentication

The CLI supports two authentication methods:

1. **Environment variable** (recommended for CI/CD):

   ```bash
   export TURSO_AUTH_TOKEN="your-token"
   turso-introspect mydb --org myorg
   ```

2. **Command-line flag** (takes precedence over env var):
   ```bash
   turso-introspect mydb --org myorg --token "your-token"
   ```

## Database Identification

Databases can be specified in two ways:

1. **Full URL**: `libsql://mydb-myorg.turso.io`
2. **Database name**: Requires `--org` flag to specify the organization

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
  -q, --quiet           Suppress warnings and informational output
  -v, --verbose         Show detailed progress information
  -h, --help            Show help
  --version             Show version

Subcommands:
  diff <db1> <db2>      Compare schemas between two sources
    --diff-format <f>   Output format: diff (default) or migration
    --org <name>        Organization (when using db names)
    --token <token>     Authentication token
```

## Development

```bash
bun install
bun run src/index.ts --help
bun run build
```
