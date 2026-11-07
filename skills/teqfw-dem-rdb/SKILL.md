---
name: teqfw-dem-rdb
description: Integrate the TeqFW DEM relational adapter into a host application.
---

# DEM relational adapter

Read the package README for current APIs and engine capability bounds. The host composes application descriptors with the selected `@teqfw/dem` infrastructure descriptor, compiles one Effective DEM for each storage scope, loads CFG and registers the CFG, DEM and DEM-RDB namespace roots. DEM-RDB Config reads default and named Knex options from the shared CFG snapshot. Initialize a DI-managed Connection with `connection.init(config.get(name))`; DEM-RDB exclusively creates and destroys the Knex client.

Open the adapter with `{model: compilation.model, connection}`. Call `initialize({scope, compilation})` for first setup and reopening. It creates ordinary tables and confirmed DEM history for an empty database, reuses a matching confirmed scope, and rejects an incompatible or incomplete layout without migrating it. For explicit table creation without history, call `createSchema()`; existing tables cause a visible conflict.

The adapter uses one relational projection: table names join DEM path segments with `_`, and SQL columns use the declared attribute names. It adds no private row metadata and does not hash physical identifiers. Overlong or colliding identifiers fail explicitly. Extension types and values the selected engine cannot represent faithfully are unsupported.

Route DEM RepositoryProvider requests to the selected DEM-RDB Provider through DI preprocessing. Route that Provider's Configuration and Connection dependencies by effective provenance. Its host Configuration supplies the compiled model and optional model-bound `runtime`; it contains no Knex client or physical Connection selector. The Provider opens lazily and borrows its selected Connection. Backend closure never disconnects a shared Connection.

Use Format 2 DEM descriptors and Format 1 host maps. Verify the integration with real SQLite. PostgreSQL and MariaDB need their separately configured integration environments; SQLite results do not establish their conformance.
