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

## Database Identification

Databases can be specified in two ways:

1. **Full URL**: `libsql://mydb-myorg.turso.io`
2. **Database name**: Requires `--org` flag to specify the organization

## Output Formats

### SQL (default)

Produces executable SQL with:

-  Tables sorted in topological order based on foreign key dependencies
-  Foreign key constraints as separate `ALTER TABLE` statements (enables order-independent execution)
-  Indexes, views, and triggers included
-  Virtual tables (FTS5, R-tree, etc.) output as comments only
-  Minimal header comment with generation timestamp

### JSON

Structured output with categorized schema objects.

## Schema Diff Command

Compare schemas between databases or files:

```bash
# Compare two live databases
turso-introspect diff libsql://db1.turso.io libsql://db2.turso.io

# Compare database against local file
turso-introspect diff libsql://production.turso.io ./local-schema.sql
```

## Development

To install dependencies:

```bash
bun install
```

To run locally:

```bash
bun run src/index.ts --help
```

To build:

```bash
bun run build
```