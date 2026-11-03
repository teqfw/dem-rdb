---
name: teqfw-dem-rdb
description: Integrate the TeqFW DEM relational adapter into a host application.
---

# DEM relational adapter

Read the package README for current supported types, engine, connection constraints and setup. The host compiles declarations with DEM, supplies the effective model and a Knex SQLite, PostgreSQL or MariaDB connection, and explicitly creates a new schema. Map `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemRdb_Provider$` through host DI preprocessing. Map `TeqFw_DemRdb_Api_Configuration$` to the host's configuration component whose `get()` returns `{model, knex}`. Register both DEM and DEM-RDB namespace roots before DI resolution.

DEM schema descriptors use Format 2. Legacy Format 1 schema descriptors are
intentionally rejected without a compatibility mode; host maps remain Format 1.

The host owns the connection, lifecycle, migrations, backup and configuration. Do not infer schema migrations, weaken constraints or assume an unsupported database engine or type is available. Use DEM's repository contract for application operations. Verify host integration with real SQLite, PostgreSQL and MariaDB storage and DEM conformance tests.


Core logical values now use reversible dialect-specific codecs. Native types may
be supplemented by exact text/binary representation and shared DEM selection
evaluation. Read the README's driver settings, physical bounds and migration
requirements. Use `test:compare` with a configured IDB checkout to compare full
logical transcripts against real IndexedDB, SQLite, PostgreSQL and MariaDB.


Map the optional `TeqFw_Dem_Api_RepositoryBatch$` token to the same configured
Provider for atomic ordered CRUD/list command batches. Results publish after one
commit; any command failure rolls back. Use explicit dependent keys. Inspect
getSchemaHistory through the adapter backend and replace stale providers after
structural upgrades. All-core comparisons and keyless ordering follow DEM, including
byte ordering, numeric vector lexicographic order and canonical JSON representation
order. Async callbacks and schema commands are outside atomic data batches.

Native remains the default projection. Select projection:'portable' explicitly for
software logical keys, exact persistent identity allocation, reversible scalar text
and additive versioned schema evolution. Name scopes its distinct physical layout;
projection switching requires host migration. MariaDB updates require quiescence
and may need repair after interruption. Consult README before applying either mode.
