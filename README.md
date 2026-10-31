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

Core DEM logical value types are supported: integer identity/ref, UUID identity/ref, signed/unsigned ordinary integers through 64 bits, exact decimal, boolean, string, text, UUID, enum, date, datetime, binary, JSON and dense/bit/sparse vectors. UUID identities are generated in JavaScript. Integer identity/ref values now use native 64-bit storage; ordinary wide integers use exact string driver results and are not converted through JavaScript Number. The host installs the database driver.

Knex supplies SQL schema/query construction and transactions. DEM supplies logical normalization and the shared software selection evaluator. Extended numeric, structured and datetime entities, and MariaDB long-payload entities, use shared selection evaluation when native execution would change their portable behavior; simple selections continue to use SQL. See the [DEM compatibility matrix](https://github.com/teqfw/dem/blob/main/skills/teqfw-dem/references/compatibility.md) for current cross-backend reach.

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

For PostgreSQL use `knex({client: 'pg', connection, searchPath: ['application_schema']})`; the target schema must already exist and must be first in the search path. Host callers install `pg`. PostgreSQL generated integer identities are allocated inside the write transaction under a transaction-scoped advisory lock; explicit values and concurrent adapter writes participate in the same lock. The supported physical identity range is 1–9223372036854775807. PostgreSQL physical table, unique-key and index names use deterministic SHA-256-derived identifiers; attribute names exceeding PostgreSQL’s 63-byte identifier limit are rejected before effects. PostgreSQL and SQLite use logical normalization supplied by DEM.

The opt-in PostgreSQL suite uses `TEQFW_DB__PG_HOST`, `TEQFW_DB__PG_USER`, `TEQFW_DB__PG_PASSWORD`, and `TEQFW_DB__PG_DATABASE`, and runs with `npm run test:postgresql`. It creates isolated temporary test schemas and removes them; the supplied database role needs schema creation privileges.

For MariaDB use Knex's `mysql2` client and install `mysql2` in the host. The adapter requires InnoDB with 16 KiB pages, strict SQL mode and enabled foreign-key checks. Unindexed text, structured values and binary payloads use `LONGBLOB`; indexed textual/binary values use `VARBINARY(512)` and remain bounded to 512 bytes per indexed value. This preserves case and trailing spaces without a locale collation. Indexes wider than 3072 bytes reject before schema creation. Ordinary large integers use bigint types; integer identities use unsigned bigint (1–18446744073709551615). The MariaDB client supports generated identities via native `AUTO_INCREMENT`.

MariaDB DDL commits implicitly, so schema creation cannot be transactional. On failure the adapter attempts to remove only tables and foreign keys created by that attempt; an interrupted process or failed cleanup can leave partial schema requiring operator cleanup. Do not run schema creation concurrently for the same target.

The opt-in MariaDB suite uses `TEQFW_DB__MYSQL_HOST`, `TEQFW_DB__MYSQL_USER`, `TEQFW_DB__MYSQL_PASSWORD`, and `TEQFW_DB__MYSQL_DATABASE`; run `npm run test:mariadb`. It checks that its deterministic test tables do not exist before creating them and removes only its own tables and foreign keys. Use an isolated test database and credentials with table create, alter, and drop rights.

## Exact physical value mapping

SQLite stores ordinary wide integers and decimals as exact text, binary as BLOB,
and JSON/vectors as canonical serialized text. PostgreSQL uses bigint or
numeric(20,0) for wide integers, numeric for decimal precision up to 1000, bytea
for binary, and text fallbacks for larger decimal and structured values. MariaDB
uses bigint, native decimal within its 65-digit/38-scale limits, and reversible
binary UTF8 fallbacks beyond them. Datetime remains canonical text/binary rather
than a JavaScript Date or a lower-precision native timestamp. Vector storage does
not require pgvector and preserves JavaScript float precision.

Numeric columns are projected to exact strings in SQL before the driver can convert
them to Number. MariaDB generated identities are obtained through a string cast of
LAST_INSERT_ID() on the same transaction connection. This also preserves values
when mysql2 has decimalNumbers enabled or supportBigNumbers disabled. Exact driver
settings remain useful for host-owned raw SQL outside this adapter.

SQLite and PostgreSQL integer identity/ref capacity is signed 64-bit; MariaDB uses
unsigned 64-bit. Explicit values beyond capacity reject before writes, and generated
capacity exhaustion rejects as STORAGE without an inserted record. Identity profiles
remain qualitative and do not promise a sequence or non-reuse after deletion.
PostgreSQL/MariaDB schemas created by older int32 mappings need explicit migration
or a fresh schema; no implicit column alteration is performed.

Non-well-formed UTF16 text and PostgreSQL text containing a zero character are
currently unsupported, with explicit rejection before writes. Changing physical
column types requires a new schema or an explicit host migration; this release
does not modify existing tables automatically.

## Cross-engine comparison

Set `TEQFW_DEM_IDB_ROOT` to a DEM-IDB checkout with its dependencies installed,
then run `npm run test:compare`. The runner starts its real Chrome harness,
executes the published all-type workload and compares the full logical transcript
with SQLite and each configured PostgreSQL/MariaDB test connection. Missing SQL
connection environments are reported as skipped subtests. The suite refuses to
modify existing MariaDB comparison tables and uses its own PostgreSQL schema.
The browser harness and both packages must use the same current DEM version.
