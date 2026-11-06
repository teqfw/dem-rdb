---
name: teqfw-dem-rdb
description: Integrate the TeqFW DEM relational adapter into a host application.
---

# DEM relational adapter

Read the package README for current APIs, engine requirements and capability
bounds. The host selects and compiles the Effective DEM, loads CFG, and registers
the CFG, DEM and DEM-RDB namespace roots. DEM-RDB Config reads default and named
Knex options from the shared CFG snapshot. Initialize a DI-managed Connection
with `connection.init(config.get(name))`; DEM-RDB exclusively creates and destroys
the Knex client. Use `Adapter.open({model, connection, projection: 'portable'})`
and explicitly call `createSchema()` before repository use.

Route RepositoryProvider and RepositoryBatch requests to the same selected host
Provider wrapper through DI preprocessing. Route that Provider's Configuration
and Connection dependencies by effective provenance. Its host Configuration
returns `{model, projection: 'portable'}` and may include `name`,
`enforceRelations`, and a model-bound `runtime`; it contains no Knex client or
physical Connection selector. The Provider opens lazily and borrows its selected
Connection. Backend closure never disconnects a shared Connection. A Runtime is
optional for Core-only models. Extension models require a compatible Runtime,
and the adapter currently rejects extension types, including `idb.CryptoKey`, as
unsupported.

Portable supports Core CRUD, List and atomic ordered batches. Its stable `name`
selects a storage family; normal `createSchema()` creates a new scope or validates
an existing scope against the same canonical model. Structural changes require
the explicit `createSchema({publish: true})` operation, retain model snapshots and
invalidate stale backends and their repositories. Reopen against the published
model. Native is the default when
`projection` is omitted and has a separate capability and storage boundary; changing
projection requires host data migration. Consult the README for constraints and
engine-specific schema behavior.

Use Format 2 DEM schema descriptors; host maps use Format 1. Verify integration
with real SQLite. PostgreSQL and MariaDB are optional integration environments and
require their own configured tests; SQLite results do not establish their conformance.
