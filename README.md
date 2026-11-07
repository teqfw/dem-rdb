# @teqfw/dem-rdb

Relational persistence for `@teqfw/dem`. The host composes and compiles the Effective DEM, loads CFG and selects a DI-managed Connection. DEM-RDB owns Knex: its Config reads connection settings and its Connection creates and destroys the client.

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

`Config.get()` reads the `TEQFW_DEM_RDB` CFG fragment and returns a cached, deeply frozen Knex configuration. Default settings use keys such as `TEQFW_DEM_RDB__CLIENT`, `__FILENAME` and `__EXTRA`; named `main` settings use `TEQFW_DEM_RDB__MAIN_CLIENT`, `__MAIN_FILENAME` and `__MAIN_EXTRA`. Named settings do not inherit defaults. `EXTRA` accepts a JSON object; explicit standard fields override matching `EXTRA.connection` values.

The Provider opens lazily, caches its backend and borrows the DI-selected Connection. Closing a backend invalidates its repositories without disconnecting a shared Connection. Route DEM RepositoryProvider requests to the selected DEM-RDB Provider through DI preprocessing. The host initializes the schema before resolving application consumers.

Run `npm run verify` for the package tests and TypeScript checks. The integration suite uses real isolated SQLite storage for table creation, repository behavior, constraints and initial history. The optional PostgreSQL and MariaDB suites require separately configured disposable databases; SQLite results do not establish their conformance.

The cognitive context is an independent private repository excluded from the npm artifact. Maintainers can mount it at `ctx/` and validate it with `adsm-ctx validate .`.
