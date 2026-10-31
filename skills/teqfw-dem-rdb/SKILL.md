---
name: teqfw-dem-rdb
description: Integrate the TeqFW DEM relational adapter into a host application.
---

# DEM relational adapter

Read the package README for current supported types, engine, connection constraints and setup. The host compiles declarations with DEM, supplies the effective model and a Knex SQLite, PostgreSQL or MariaDB connection, and explicitly creates a new schema. Map `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemRdb_Provider$` through host DI preprocessing. Map `TeqFw_DemRdb_Api_Configuration$` to the host's configuration component whose `get()` returns `{model, knex}`. Register both DEM and DEM-RDB namespace roots before DI resolution.

The host owns the connection, lifecycle, migrations, backup and configuration. Do not infer schema migrations, weaken constraints or assume an unsupported database engine or type is available. Use DEM's repository contract for application operations. Verify host integration with real SQLite, PostgreSQL and MariaDB storage and DEM conformance tests.


Core logical values now use reversible dialect-specific codecs. Native types may
be supplemented by exact text/binary representation and shared DEM selection
evaluation. Read the README's driver settings, physical bounds and migration
requirements. Use `test:compare` with a configured IDB checkout to compare full
logical transcripts against real IndexedDB, SQLite, PostgreSQL and MariaDB.
