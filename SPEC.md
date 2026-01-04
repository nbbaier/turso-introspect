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
```

## Authentication

The CLI supports two authentication methods:

1. **Environment variable** (recommended for CI/CD):

   ```bash
   export TURSO_AUTH_TOKEN="your-token"
   turso-introspect mydb --org myorg
   ```

2. **Command-line flag**:
   ```bash
   turso-introspect mydb --org myorg --token "your-token"
   ```

The `--token` flag takes precedence over the environment variable.

## Database Identification

Databases can be specified in two ways:

1. **Full URL**: `libsql://mydb-myorg.turso.io`
2. **Database name**: Requires `--org` flag to specify the organization

```bash
# Full URL - no org needed
turso-introspect libsql://mydb-myorg.turso.io

# Database name - org required
turso-introspect mydb --org myorg
```

## Output Formats

### SQL (default)

Produces executable SQL with:

-  Tables sorted in topological order based on foreign key dependencies
-  Foreign key constraints as separate `ALTER TABLE` statements (enables order-independent execution)
-  Indexes, views, and triggers included
-  Virtual tables (FTS5, R-tree, etc.) output as comments only
-  Minimal header comment with generation timestamp

### JSON

Structured output with categorized schema objects:

```json
{
  "metadata": {
    "database": "mydb",
    "timestamp": "2024-01-15T10:30:00Z",
    "version": "1.0.0"
  },
  "tables": [...],
  "indexes": [...],
  "views": [...],
  "triggers": [...]
}
```

## Output Destination

Default behavior:

-  Outputs to `{database-name}-schema.sql` (or `.json`) in current directory
-  Use `-o/--output` to specify exact path
-  Use `--stdout` to write to stdout instead of file

```bash
# Default: creates mydb-schema.sql
turso-introspect mydb --org myorg

# Custom output path
turso-introspect mydb --org myorg -o ./schemas/production.sql

# Stdout (for piping)
turso-introspect mydb --org myorg --stdout > schema.sql
```

## Schema Scope

### Included by Default

-  Tables (with columns, primary keys, constraints)
-  Indexes (excluding auto-created internal indexes)
-  Views
-  Triggers

### Excluded by Default

-  SQLite internal tables (`sqlite_sequence`, `sqlite_stat1`, etc.)
-  libsql system tables (`_litestream_*`)
-  Virtual tables (output as comments)

Use `--include-system` to include system tables.

## Table Filtering

Filter which tables to introspect:

```bash
# Only specific tables
turso-introspect mydb --org myorg --tables users,posts,comments

# Exclude specific tables
turso-introspect mydb --org myorg --exclude-tables logs,sessions

# Combine both
turso-introspect mydb --org myorg --tables users,posts --exclude-tables user_temp
```

## Default Value Handling

SQLite columns can have complex DEFAULT expressions. The CLI:

-  Preserves default values exactly as stored
-  Warns if a default looks potentially problematic
-  Use `--normalize-defaults` to normalize common patterns (e.g., various `CURRENT_TIMESTAMP` forms)

## Schema Diff Command

Compare schemas between databases or files:

```bash
# Compare two live databases
turso-introspect diff libsql://db1.turso.io libsql://db2.turso.io

# Compare database against local file
turso-introspect diff libsql://production.turso.io ./local-schema.sql

# Output as migration SQL
turso-introspect diff db1 db2 --org myorg --diff-format migration

# Output as unified diff (default)
turso-introspect diff db1 db2 --org myorg --diff-format diff
```

## Connection Handling

-  Retries failed connections 3 times with exponential backoff
-  Use `--check` flag to validate connectivity and permissions without producing output

```bash
# Verify connection only
turso-introspect mydb --org myorg --check
```

## Verbosity

Control output verbosity:

```bash
# Quiet - suppress warnings and info
turso-introspect mydb --org myorg -q

# Normal (default) - show warnings
turso-introspect mydb --org myorg

# Verbose - detailed progress info
turso-introspect mydb --org myorg -v
```

## Empty Database Handling

If the database has no user tables:

-  Outputs an empty schema file (SQL comment header only, or empty JSON structure)
-  Prints warning to stderr

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

## Environment Variables

| Variable           | Description                        |
| ------------------ | ---------------------------------- |
| `TURSO_AUTH_TOKEN` | Authentication token for Turso API |

## Exit Codes

| Code | Meaning                            |
| ---- | ---------------------------------- |
| 0    | Success                            |
| 1    | Connection or authentication error |
| 2    | Invalid arguments                  |
| 3    | Database not found                 |

## Technical Implementation

-  **Runtime**: Bun (TypeScript)
-  **Database client**: `@libsql/client`
-  **CLI framework**: TBD (commander, yargs, or citty)
-  **Distribution**: npm package with `bun build --compile` for optional standalone binary

## Schema Introspection Details

The tool queries SQLite system tables to extract schema:

-  `sqlite_master` - Table definitions, views, triggers, indexes
-  `pragma_table_info()` - Column details
-  `pragma_foreign_key_list()` - Foreign key relationships
-  `pragma_index_list()` / `pragma_index_info()` - Index details

Foreign keys are output as separate ALTER TABLE statements to ensure the SQL can be executed in any order without dependency issues.
