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

The adapter supports SQLite, PostgreSQL and MariaDB through Knex. It implements DEM repository CRUD/list operations and ordered atomic batches. Core logical values use native SQL types where the engine can preserve their meaning. Unsupported types, values, disabled relation enforcement, malformed existing tables and physical limits fail explicitly. Extension types, including `idb.CryptoKey`, are unsupported by this relational adapter. SQLite requires a single connection and enabled foreign keys. MariaDB requires InnoDB, 16 KiB pages, strict SQL mode and enabled foreign-key checks. PostgreSQL target schemas must exist and be first in the configured search path. The host installs the database driver.

Core vectors use portable JSON-serialized text by default; this does not require
pgvector. To select PostgreSQL-native `vector(N)` for a dense float Core vector,
the host can pass a per-attribute `nativeVectors` map when opening the adapter:

```js
const backend = await adapter.open({
    model: compilation.model,
    connection,
    nativeVectors: {'/app/item': {embedding: true}},
});
```

The keys are effective entity paths and attribute names. The Provider receives
the same map in the object returned by its host Configuration. Provision a
compatible PostgreSQL `vector` extension before opening the adapter. Native
storage accepts normalized components only when they are exactly representable
as finite float32 values; values that would lose precision are rejected. The
declared dimension is enforced; reopening a history-managed scope verifies the
physical column type and dimension. All backends sharing a scope must use
compatible selections. The host performs representation and data migrations
explicitly; initialization does not convert existing columns.

The host can opt a relation into physical cascading actions without changing the
DEM Format 2 descriptor. Pass `foreignKeyActions` to `adapter.open` or in the
Provider's host Configuration:

```js
const foreignKeyActions = {
    '/app/child': {
        parent: {onDelete: 'CASCADE', onUpdate: 'CASCADE'},
    },
};
const backend = await adapter.open({model: compilation.model, connection, foreignKeyActions});
```

The keys are effective entity paths and relation names. Each event may be
omitted or set to `CASCADE`; omitted events use the engine's non-cascading
default (`NO ACTION` or `RESTRICT`). Initialization creates the selected actions
for new tables and checks existing history-managed layouts before access. It does
not alter existing constraints; hosts must migrate them explicitly. SQLite and
PostgreSQL cascade scenarios are covered by integration tests. MariaDB
integration requires a separately configured database.

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
