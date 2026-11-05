---
name: teqfw-dem-rdb
description: Integrate the TeqFW DEM relational adapter into a host application.
---

# DEM relational adapter

Read the package README for current APIs, engine requirements and capability
bounds. The host selects and compiles the Effective DEM, chooses the database,
registers the DEM and DEM-RDB namespace roots, and supplies a Knex connection.
Use `Adapter.open({model, knex, projection: 'portable'})` and explicitly call
`createSchema()` before repository use. The host owns the connection and its
shutdown, schema lifecycle, migrations and backups.

Map `TeqFw_Dem_Api_RepositoryProvider$` and, when needed,
`TeqFw_Dem_Api_RepositoryBatch$` to `TeqFw_DemRdb_Provider$` through host DI
preprocessing. Map `TeqFw_DemRdb_Api_Configuration$` to a host component whose
asynchronous `get()` returns `{model, knex, projection: 'portable'}`. The same
configuration may include `name`, `enforceRelations`, and a model-bound `runtime`.
A Runtime is optional for Core-only models. Extension models require a compatible
Runtime, and the adapter currently rejects extension types, including
`idb.CryptoKey`, as unsupported.

Portable supports Core CRUD, List and atomic ordered batches. Its stable `name`
selects a storage family; unchanged schema initialization is idempotent, while
structural versions retain model snapshots and invalidate stale backends and their
repositories. Reopen against the published model. Native is the default when
`projection` is omitted and has a separate capability and storage boundary; changing
projection requires host data migration. Consult the README for constraints and
engine-specific schema behavior.

Use Format 2 DEM schema descriptors; host maps use Format 1. Verify integration
with real SQLite. PostgreSQL and MariaDB are optional integration environments and
require their own configured tests; SQLite results do not establish their conformance.
