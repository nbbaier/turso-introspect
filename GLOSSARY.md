# turso-introspect

Reading the schema of a Turso/libsql or SQLite database and rendering it as SQL, JSON, or TypeScript, or comparing two schemas.

## Database sources

**Database name**:
The short name a Turso database has inside an organization (`mydb`). Only meaningful together with an organization; it is turned into a database URL.
_Avoid_: db id, slug

**Database URL**:
The full address of a database (`libsql://mydb-myorg.turso.io`, `https://…`, `file:…`). Identifies the database on its own, with no organization needed.
_Avoid_: connection string, endpoint

**Local database path**:
A filesystem path to a SQLite file (`./app.db`, `~/data/app.sqlite`). Read directly, with no token.
_Avoid_: local URL

**Schema file**:
A previously generated SQL schema on disk, used as one side of a diff instead of a live database.
_Avoid_: dump, snapshot

## Tokens

**Platform token**:
A Turso account credential that acts on the organization (e.g. the Turso CLI's login token). It cannot query a database directly; it is exchanged for a database token.
_Avoid_: API key, auth token (ambiguous)

**Database token**:
A credential scoped to one database, used to connect and run queries.
_Avoid_: auth token (ambiguous), JWT

## Schema objects

**Index origin**:
How an index came to exist: `c` (created by an explicit `CREATE INDEX`), `u` (implied by a `UNIQUE` constraint), or `pk` (implied by a `PRIMARY KEY`). Only `c` indexes are standalone schema objects; `u` and `pk` indexes belong to their table's definition.

**Explicit index**:
An index with origin `c`.
_Avoid_: user index, custom index

**System table**:
A table owned by SQLite, libsql, or the hosting platform rather than the application: names starting `sqlite_`, `_litestream_`, or `_cf_`. Left out of output unless explicitly requested, as are views with those prefixes and triggers defined on system tables.
_Avoid_: internal table, hidden table
