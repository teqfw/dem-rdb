# @teqfw/dem-rdb

Relational persistence for `@teqfw/dem`. The host composes and compiles the Effective DEM, loads CFG and selects a DI-managed Connection. DEM-RDB owns Knex: its Config reads connection settings and its Connection creates and destroys the client.

## Installation and host composition

```sh
npm install @teqfw/dem@^2.0.0 @teqfw/dem-rdb@^2.0.0 @teqfw/di@^2.11.0 sqlite3
# For PostgreSQL install pg instead; for MariaDB install mysql2 instead.
```

Version 2.x requires DEM 2.x and Format 2 schema descriptors. It changes the
0.2.x physical layout and connection composition; existing databases require an
explicit host-managed migration. The host installs the selected Knex driver.
Register `TeqFw_Cfg_`, load the selected CFG sources with `TeqFw_Cfg_Loader$`
before resolving RDB Config, and supply the `TEQFW_DEM_RDB` fragment for the
selected connection. The host owns storage initialization and connection shutdown.
See [CFG host setup](https://github.com/teqfw/cfg#quick-start) for source loading.

Register `TeqFw_Dem_RDb_` to this package's `src/`, `TeqFw_Cfg_` to CFG and `TeqFw_Dem_` to DEM. Compile the application descriptors together with the selected `@teqfw/dem` infrastructure descriptor, then initialize the selected storage scope:

```js
const config = await container.get('TeqFw_Dem_RDb_Config$');
const connection = await container.get('TeqFw_Dem_RDb_Connection$');
await connection.init(config.get());
const adapter = await container.get('TeqFw_Dem_RDb_Adapter$');
const backend = await adapter.open({model: compilation.model, connection});
const state = await backend.initialize({scope: 'main', compilation});
const users = await backend.get({path: '/app/user'});
const {record} = await users.create({record: {name: 'Ada'}});
await backend.close();
await connection.disconnect();
```

On an empty database, `initialize` creates the ordinary tables in the Effective DEM and stores the canonical model, fingerprint and confirmed initial application in `/dem/snapshot` and `/dem/application`. Reopening the same scope validates the table layout and confirmed model, then reuses its history. A different or incomplete model fails before storage changes. It never migrates tables. `createSchema()` remains available when a host needs to create tables separately; it rejects existing target tables.

Every entity uses one ordinary SQL table. Its name is the DEM path without the leading slash, with `/` replaced by `_` (`/pde/gate/account` becomes `pde_gate_account`). Column names exactly match DEM attribute names. No private row or field metadata is added. If table, column, or generated constraint identifiers exceed the selected database's limits, or two paths collapse to the same table name, the adapter rejects the model instead of hashing names.

The adapter supports SQLite, PostgreSQL and MariaDB through Knex. It implements DEM repository CRUD/list operations and ordered atomic batches. Core logical values use native SQL types where the engine can preserve their meaning. Unsupported types, values, malformed existing tables and physical limits fail explicitly. DEM-RDB supports its own vector extension on SQLite and PostgreSQL; other extension types, including `idb.CryptoKey`, are unsupported. SQLite requires a single connection and enabled foreign keys. MariaDB requires InnoDB, 16 KiB pages, strict SQL mode and enabled foreign-key checks. PostgreSQL target schemas must exist and be first in the configured search path. The host installs the database driver.

DEM-RDB publishes the logical type `teqfw.dem_rdb.vector` through
`TeqFw_Dem_RDb_Type_Vector_Provider$` and its runtime handler through
`TeqFw_Dem_RDb_Type_Vector_Handler$`. Register the definition before compiling a
model and bind the handler to the model's DEM Runtime before opening the adapter:

```js
const vectorTypes = await container.get('TeqFw_Dem_RDb_Type_Vector_Provider$');
registry.register(vectorTypes.getDefinitions());
// Compile after registering the definition.
const handler = await container.get('TeqFw_Dem_RDb_Type_Vector_Handler$');
const runtime = await repositoryRuntime.bind({model: compilation.model, registry, handlers: {'teqfw.dem_rdb.vector': handler}});
const backend = await adapter.open({model: compilation.model, connection, runtime});
```

The type is a dense array of finite numbers with required positive `dimensions`.
It has no equality or ordering property, so vectors cannot be keys, relations,
filters or sort keys; repository CRUD stores and returns the declared value.
PostgreSQL uses pgvector `vector(N)` and explicitly rounds each component to
float32 at the storage boundary, which can lose precision. Dimensions above
pgvector's 2000 component limit and values outside finite float32 capacity fail
before persistence. SQLite stores canonical JSON arrays in `TEXT`, preserving
supported JavaScript number precision on readback. MariaDB and PostgreSQL without
a visible pgvector extension reject a model that uses this type. Reopening a
history-managed scope verifies the physical column type and dimension; initialization
does not convert existing columns.

Relation actions are declared in the DEM Format 2 descriptor and control both
the logical Batch behavior and physical SQL constraint:

```js
child: {attributes: [{name: 'parent_id', type: {name: 'ref'}}], relations: {
    parent: {attributes: ['parent_id'], onDelete: 'cascade', onUpdate: 'restrict', target: {path: '../parent', attributes: ['id']}},
}}
```

`onDelete` and `onUpdate` accept `restrict` or `cascade` independently; omission
means `restrict`. SQL actions come only from the compiled DEM. Initialization
creates the selected actions for new tables and checks existing layouts before
access. It does not alter existing constraints; hosts must migrate them explicitly.

For each Core enum attribute, DEM-RDB creates a named SQL `CHECK` from the
alternatives in the DEM descriptor. On SQLite, PostgreSQL and MariaDB it also
constrains direct SQL writes. Nullable attributes allow `NULL`; non-null values
must belong to the declared set. Reopening a history-managed scope verifies
the existing constraint and rejects missing or incompatible layouts. SQLite
`PRAGMA ignore_check_constraints` and MariaDB `check_constraint_checks` must
leave checks enabled on database sessions, including sessions used for direct
SQL. The host must explicitly migrate old layouts and resolve invalid rows;
initialization does not add or repair constraints on existing tables.

`Config.get()` reads the `TEQFW_DEM_RDB` CFG fragment and returns a cached, deeply frozen Knex configuration. Default settings use keys such as `TEQFW_DEM_RDB__CLIENT`, `__FILENAME` and `__EXTRA`; named `main` settings use `TEQFW_DEM_RDB__MAIN_CLIENT`, `__MAIN_FILENAME` and `__MAIN_EXTRA`. Named settings do not inherit defaults. `EXTRA` accepts a JSON object; explicit standard fields override matching `EXTRA.connection` values.

The Provider opens lazily, caches its backend and borrows the DI-selected Connection. Its `initialize({scope, compilation})` confirms model history before `get` or `execute` can access a history-managed model. Models without DEM history keep direct repository access. Closing a backend invalidates its repositories without disconnecting a shared Connection. Route DEM RepositoryProvider requests to the selected DEM-RDB Provider through DI preprocessing. The host initializes storage before resolving application consumers.

Run `npm run verify` for package tests. Agents validate source conventions separately using the locally installed `teqfw-esm-validator` skill and CLI; this tool is not a project dependency or CI gate. `npm run typecheck` remains available as an optional command. The integration suite uses real isolated SQLite storage for table creation, repository behavior, constraints and initial history. The optional PostgreSQL and MariaDB suites require separately configured disposable databases; SQLite results do not establish their conformance.

The cognitive context is an independent private repository excluded from the npm artifact. Maintainers can mount it at `ctx/` and validate it with `adsm-ctx validate .`.
