# @teqfw/dem-rdb

Relational persistence for `@teqfw/dem`. The host compiles plugin declarations with DEM, provides a Knex SQLite connection, creates schema explicitly and selects the resulting provider for the DEM repository contract. Runtime components use TeqFW DI.

## Initial SQLite adapter

Register `TeqFw_DemRdb_` to this package's `src/` and `TeqFw_Dem_` to DEM's `src/`. Obtain `TeqFw_DemRdb_Adapter$`, then:

```js
const db = knex({client: 'sqlite3', connection: {filename: 'app.sqlite'},
    useNullAsDefault: true, pool: {min: 1, max: 1}});
const adapter = await container.get('TeqFw_DemRdb_Adapter$');
const provider = await adapter.open({model: compilation.model, knex: db});
await provider.createSchema(); // Only for a new empty database.
const users = await provider.get({path: '/app/user'});
const {record} = await users.create({record: {name: 'Ada'}});
```

The host integrates `provider.get` at its repository-provider composition boundary, and manages connection shutdown. `createSchema` is transactional and refuses existing tables; it is not a migration or rebuild tool. Foreign keys are enabled on the single SQLite connection.

Initial capabilities: integer identity/ref, bounded integer, boolean, string, text, UUID, enum and date; primary and unique keys, indexes, relations, generated integer identities, and DEM CRUD/List. Unsupported logical types, UUID identity and 64-bit integer declarations are rejected before schema creation. Values outside JavaScript's safe integer range are rejected. The adapter currently requires SQLite and a pool maximum of one; PostgreSQL and MySQL are future work. Install a SQLite driver in the host. The `knex` dependency supplies SQL query construction and dialect access; DEM supplies model and portable validation.

Run `npm test` to execute DEM's repository conformance suite against an isolated SQLite database. This is an early implementation: deployment migrations, external transaction composition and broader type and dialect coverage are not implemented.

For DI substitution, the host maps `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemRdb_Provider$` with a DI preprocessor, and maps `TeqFw_DemRdb_Api_Configuration$` to a host component whose asynchronous `get()` returns `{model, knex}`. The provider opens lazily on first use and caches its configuration. The host initializes the schema separately through `Adapter.open` before using repositories. The default configuration raises `UNSUPPORTED` until the host supplies one.

A version-matched consumer skill is included at `skills/teqfw-dem-rdb/`. Hosts may mount it into their agent skill discovery directory.

## Development and context

The package depends on `@teqfw/dem` 0.2.x. Until that version is published to npm, install a local DEM package archive or configure an equivalent workspace before running checks. Run `npm run verify` for tests and TypeScript checks; `teqfw-platform .` and `teqfw-esm-validator . --profile base` check TeqFW conventions. Provider resolution checks table columns, declared SQLite storage types, nullability and primary keys. It does not fully audit existing unique, relation and index constraints or later schema drift; the host must ensure those constraints match the model.

The cognitive context is an independent private repository, excluded from the npm artifact. Maintainers can mount it at `ctx/`:

```sh
git clone git@github.com:flancer32/teqfw-dem-rdb-ctx.git ctx
adsm-ctx validate .
```
