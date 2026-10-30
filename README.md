# @teqfw/dem-rdb

Relational persistence for `@teqfw/dem`. The host compiles plugin declarations with DEM, provides a Knex SQLite, PostgreSQL or MariaDB connection, creates schema explicitly and selects the resulting provider for the DEM repository contract. Runtime components use TeqFW DI.

## Initial relational adapter

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

The host integrates `provider.get` at its repository-provider composition boundary, and manages connection shutdown. `createSchema` refuses existing tables; it is transactional for SQLite and PostgreSQL. MariaDB DDL has different cleanup behavior described below. It is not a migration or rebuild tool. Foreign keys are enabled on the single SQLite connection.

Initial capabilities: integer identity/ref, bounded integer, boolean, string, text, UUID, enum and date; primary and unique keys, indexes, relations, generated integer identities, and DEM CRUD/List. Unsupported logical types, UUID identity and 64-bit integer declarations are rejected before schema creation. Values outside JavaScript's safe integer range are rejected. SQLite requires a pool maximum of one. PostgreSQL uses the `pg` client, UTF8 encoding, `C` text collation and signed 32-bit physical integers; identifiers exceeding the supported backend limits are rejected. The host installs the database driver. MariaDB 10.11 is supported through `mysql2`; Oracle MySQL has not been verified. The `knex` dependency supplies SQL query construction and dialect access; DEM supplies model and portable validation.

Run `npm test` to execute DEM's repository conformance suite against an isolated SQLite database. This is an early implementation: deployment migrations, external transaction composition and broader type and dialect coverage are not implemented.

For DI substitution, the host maps `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemRdb_Provider$` with a DI preprocessor, and maps `TeqFw_DemRdb_Api_Configuration$` to a host component whose asynchronous `get()` returns `{model, knex}`. The provider opens lazily on first use and caches its configuration. The host initializes the schema separately through `Adapter.open` before using repositories. The default configuration raises `UNSUPPORTED` until the host supplies one.

A version-matched consumer skill is included at `skills/teqfw-dem-rdb/`. Hosts may mount it into their agent skill discovery directory.

## Development and context

The package depends on `@teqfw/dem` 0.2.x. Until that version is published to npm, install a local DEM package archive or configure an equivalent workspace before running checks. Run `npm run verify` for tests and TypeScript checks; `teqfw-platform .` and `teqfw-esm-validator . --profile base` check TeqFW conventions. Provider resolution checks table columns, physical storage types, nullability, primary and unique keys, and foreign keys. It does not audit non-unique indexes or later schema drift; the host must ensure the schema remains consistent.

The cognitive context is an independent private repository, excluded from the npm artifact. Maintainers can mount it at `ctx/`:

```sh
git clone git@github.com:flancer32/teqfw-dem-rdb-ctx.git ctx
adsm-ctx validate .
```

For PostgreSQL use `knex({client: 'pg', connection, searchPath: ['application_schema']})`; the target schema must already exist and must be first in the search path. Host callers install `pg`. PostgreSQL generated integer identities are allocated inside the write transaction under a transaction-scoped advisory lock; explicit values and concurrent adapter writes participate in the same lock. The supported physical identity range is 1–2147483647. PostgreSQL physical table, unique-key and index names use deterministic SHA-256-derived identifiers; attribute names exceeding PostgreSQL’s 63-byte identifier limit are rejected before effects. PostgreSQL and SQLite use logical normalization supplied by DEM.

The opt-in PostgreSQL suite uses `TEQFW_DB__PG_HOST`, `TEQFW_DB__PG_USER`, `TEQFW_DB__PG_PASSWORD`, and `TEQFW_DB__PG_DATABASE`, and runs with `npm run test:postgresql`. It creates isolated temporary test schemas and removes them; the supplied database role needs schema creation privileges.

For MariaDB use Knex's `mysql2` client and install `mysql2` in the host. The adapter requires InnoDB with 16 KiB pages, strict SQL mode and enabled foreign-key checks. Text is stored as UTF-8 bytes in `VARBINARY(512)` to preserve exact case, trailing spaces and Unicode ordering; strings exceeding 512 UTF-8 bytes and indexes wider than 3072 bytes reject as `UNSUPPORTED` before writes. Numeric storage uses signed 32-bit integers. The MariaDB client supports generated identities via native `AUTO_INCREMENT`.

MariaDB DDL commits implicitly, so schema creation cannot be transactional. On failure the adapter attempts to remove only tables and foreign keys created by that attempt; an interrupted process or failed cleanup can leave partial schema requiring operator cleanup. Do not run schema creation concurrently for the same target.

The opt-in MariaDB suite uses `TEQFW_DB__MYSQL_HOST`, `TEQFW_DB__MYSQL_USER`, `TEQFW_DB__MYSQL_PASSWORD`, and `TEQFW_DB__MYSQL_DATABASE`; run `npm run test:mariadb`. It checks that its deterministic test tables do not exist before creating them and removes only its own tables and foreign keys. Use an isolated test database and credentials with table create, alter, and drop rights.
