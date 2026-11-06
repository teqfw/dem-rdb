# @teqfw/dem-rdb

Relational persistence for `@teqfw/dem`. The host selects declarations and compiles an Effective DEM, configures database connections through `@teqfw/cfg`, and selects Connections and Providers through TeqFW DI. DEM-RDB constructs and destroys its Knex clients. Independent Providers can use different models and storage families while sharing one Connection; entity paths do not route between them.

Use the portable projection for universal DEM Core persistence. The native projection is also available within its separate capability and physical storage bounds.

DEM schema descriptors use Format 2. Format 1 schema descriptors are rejected by
design, with no legacy compatibility mode; this is an intentional breaking
contract. Host maps are separate and continue to use Format 1.

## Portable relational projection

Register `TeqFw_Dem_RDb_` to this package's `src/`, `TeqFw_Cfg_` to CFG and
`TeqFw_Dem_` to DEM. Load the shared CFG snapshot before selecting a named
connection. The host installs the SQLite driver; the DEM-RDB Connection creates
and owns the Knex client:

```js
const config = await container.get('TeqFw_Dem_RDb_Config$');
const connection = await container.get('TeqFw_Dem_RDb_Connection$');
await connection.init(config.get());
const adapter = await container.get('TeqFw_Dem_RDb_Adapter$');
const backend = await adapter.open({
    model: compilation.model, connection, projection: 'portable',
    name: 'application', enforceRelations: true,
    // runtime: hostRuntime, // optional for Core-only models
});
await backend.createSchema();
const {results} = await backend.execute({operations: [
    {path: '/app/user', method: 'create', params: {record: {name: 'Ada'}}},
    {path: '/app/user', method: 'list', params: {selection: {}}},
]});
const {schemas} = await backend.getSchemaHistory();
await backend.close(); // Invalidates repositories; the shared Connection remains open.
await connection.disconnect();
```

`Config.get()` reads the `TEQFW_DEM_RDB` CFG fragment and returns a cached,
deeply frozen Knex configuration. Default settings use keys such as
`TEQFW_DEM_RDB__CLIENT`, `__FILENAME` and `__EXTRA`; named `main` settings use
`TEQFW_DEM_RDB__MAIN_CLIENT`, `__MAIN_FILENAME` and `__MAIN_EXTRA`. Names ignore
case and normalize hyphens to underscores. Named settings do not inherit default
values. `EXTRA` accepts a JSON object with advanced Knex options; explicit standard
fields override matching `EXTRA.connection` values. `PORT` is converted to an
integer, `USE_NULL_AS_DEFAULT` to a boolean and `SEARCH_PATH` to a string array.

Portable mode retains an entity table and a column for each attribute. Hashed
physical identifiers avoid logical name length limits. Private UUID row keys and
software uniqueness/relation checks avoid native logical index-width bounds. Exact
persistent counters and textual identity/ref values support identities beyond native
64-bit ranges. Textual scalars use reversible JSON encoding, including NUL; ordinary
values retain native numeric/blob storage where lossless. A field-presence inventory
distinguishes absent historical fields from explicit null. Name selects an isolated
physical family; it must remain stable when reopening the same data.

Operations lock scope metadata and evaluate a logical snapshot with shared DEM
semantics. This conservatively serializes operations and can consume substantial
memory; native index throughput is not promised. Engine quotas and physical object
limits still apply. SQLite requires a single connection. MariaDB portable tables
require InnoDB and strict SQL mode.

Normal `createSchema()` creates a new scope or validates an existing scope against
the same canonical model. A different model is rejected before storage changes.
Structural changes require the explicit `createSchema({publish: true})` option;
publication records complete versioned model snapshots, adds columns/tables and retains removed physical data. Defaults and
nullable additions project on read. Newly declared constraints do not audit historical
data at schema publication. A backend already bound to an older version and its
acquired repositories reject, including when attempting to publish a schema; reopen
against the published model. Physical type changes requiring conversion reject; the host owns value migrations and backup.
SQLite/PostgreSQL publish DDL and history transactionally. MariaDB schema updates
require host quiescence: DDL commits implicitly, cleanup removes only additions from
the failed attempt where possible, and interruption/failed cleanup can need manual
repair. Do not run concurrent schema updates or promise online DDL atomicity.

The default projection remains native. Native and portable layouts are distinct;
switching requires explicit host data migration. Native createSchema still only
initializes empty storage and native getSchemaHistory rejects UNSUPPORTED.

Core-only models work without an explicit Runtime. A supplied Runtime must be
bound to the same Effective DEM and is used for normalization, Selection, Select
and Batch. Extension models require a compatible model-bound Runtime, but that
binding alone does not establish SQL support: the adapter checks its own capabilities
and currently rejects all extension types as `UNSUPPORTED`, including `idb.CryptoKey`.
A mismatched Runtime model is rejected as `INVALID_INPUT`. These checks occur before
schema changes or repository exposure.

Both projections support execute with nonempty ordered CRUD/list commands in one
data transaction; any failure rolls back. Results use existing DEM envelopes and
become observable after commit. Dependent keys must be explicit. Callback transaction
APIs and schema commands are excluded. Map both RepositoryProvider and the optional
`TeqFw_Dem_Api_RepositoryBatch$` token to `TeqFw_Dem_RDb_Provider$` in host DI. Its
configuration returns model, projection, name, enforceRelations and an optional
bound Runtime. The Provider receives its selected Connection through DI.
Portable relations are checked by default; `enforceRelations: false` selects
descriptive relations, which do not provide strict DEM relation conformance. Native
mode requires checked relations.

Run `npm run test:portable` for SQLite portable conformance, values, atomic
commands, structural history and failed publication. `npm run test:portable:postgresql` runs the portable suite against PostgreSQL and fails
when configuration is missing, the server is unavailable or any test is skipped.
CI provisions PostgreSQL and requires this separate job. The suite verifies Core
values, repositories, batches, relations, schema publication and restoration
after a connection restart. This is bounded adapter evidence, not verification of
PDE Gate integration or production durability. Gate must test its own authority
workflows on both engines and ensure one instance per database; batch atomicity
does not serialize authority operations across instances. MariaDB and native
projection verification remain separate. The comparison suite exercises selected
native and portable workloads against real browser IDB.

For PostgreSQL portable tests, set `TEQFW_DB__PG_HOST`, `__PG_PORT` (optional),
`__PG_USER`, `__PG_PASSWORD` and `__PG_DATABASE` using full `TEQFW_DB` keys in
`.env` or the process environment. CFG loads `.env` first and the environment
second. The role must be able to create schemas: each test creates a fresh random
schema, verifies it is active, and removes only that schema. Use a disposable test
database and keep credentials out of Git. `TEQFW_PORTABLE__CLIENT=pg` also selects
PostgreSQL for `npm run test:portable`; `mysql2` selects MariaDB.

For DI substitution, the host routes DEM RepositoryProvider and RepositoryBatch requests to selected Provider wrappers, then routes each Provider's generic Configuration and Connection dependencies by effective DI provenance. `TeqFw_Dem_RDb_Config$` reads named options from the shared CFG snapshot. The Provider opens lazily on first use and caches its backend. The host initializes the schema through `Adapter.open({model, connection, ...})` before resolving consumers. Config values use `TEQFW_DEM_RDB__CLIENT`, `__FILENAME`, and related keys for the default Connection; named `main` keys use `TEQFW_DEM_RDB__MAIN_CLIENT`, `__MAIN_FILENAME`, and related suffixes. Named configurations do not inherit default values.

A version-matched consumer skill is included at `skills/teqfw-dem-rdb/`. Hosts may mount it into their agent skill discovery directory.

## Native relational projection

To select the native projection explicitly:

```js
const config = await container.get('TeqFw_Dem_RDb_Config$');
const connection = await container.get('TeqFw_Dem_RDb_Connection$');
await connection.init(config.get());
const adapter = await container.get('TeqFw_Dem_RDb_Adapter$');
const provider = await adapter.open({model: compilation.model, connection, projection: 'native'});
await provider.createSchema(); // Only for a new empty database.
const users = await provider.get({path: '/app/user'});
const {record} = await users.create({record: {name: 'Ada'}});
```

The host integrates `provider.get` at its repository-provider composition boundary and calls `connection.disconnect()` after Providers close. `createSchema` refuses existing tables; it is transactional for SQLite and PostgreSQL. MariaDB DDL has different cleanup behavior described below. It is not a migration or rebuild tool. Foreign keys are enabled on the single SQLite connection.

Within the native projection, supported Core DEM logical value types include: integer identity/ref, UUID identity/ref, signed/unsigned ordinary integers through 64 bits, exact decimal, boolean, string, text, UUID, enum, date, datetime, binary, JSON and dense/bit/sparse vectors. UUID identities are generated in JavaScript. Integer identity/ref values now use native 64-bit storage; ordinary wide integers use exact string driver results and are not converted through JavaScript Number. The host installs the database driver.

Knex supplies SQL schema/query construction and transactions. DEM supplies logical normalization and the shared software selection evaluator. Extended numeric, structured and datetime entities, and MariaDB long-payload entities, use shared selection evaluation when native execution would change their portable behavior; simple selections continue to use SQL. See the [DEM compatibility matrix](https://github.com/teqfw/dem/blob/main/skills/teqfw-dem/references/compatibility.md) for current cross-backend reach.

Run `npm test` to execute SQLite integration and DEM repository conformance tests. The native projection retains the original physical layout; portable adds broader logical key support and structural evolution.

## Development and context

The current package manifest selects `@teqfw/dem` from its GitHub repository. Run `npm run verify` for tests and TypeScript checks; `teqfw-platform .` and `teqfw-esm-validator . --profile base` check TeqFW conventions. Native provider resolution checks table columns, physical storage types, nullability, primary and unique keys, and foreign keys. It does not audit non-unique indexes or later schema drift; the host must ensure the schema remains consistent.

The cognitive context is an independent private repository, excluded from the npm artifact. Maintainers can mount it at `ctx/`:

```sh
git clone git@github.com:flancer32/teqfw-dem-rdb-ctx.git ctx
adsm-ctx validate .
```

For native PostgreSQL configure `TEQFW_DEM_RDB__CLIENT=pg`, connection fields such as `__HOST` and `__DATABASE`, and `__SEARCH_PATH=application_schema`; the target schema must already exist and must be first in the search path. Host callers install `pg`. PostgreSQL generated integer identities are allocated inside the write transaction under a transaction-scoped advisory lock; explicit values and concurrent adapter writes participate in the same lock. The supported physical identity range is 1–9223372036854775807. PostgreSQL physical table, unique-key and index names use deterministic SHA-256-derived identifiers; attribute names exceeding PostgreSQL’s 63-byte identifier limit are rejected before effects. PostgreSQL and SQLite use logical normalization supplied by DEM.

The opt-in PostgreSQL suite uses `TEQFW_DB__PG_HOST`, `TEQFW_DB__PG_USER`, `TEQFW_DB__PG_PASSWORD`, and `TEQFW_DB__PG_DATABASE`, and runs with `npm run test:postgresql`. It creates isolated temporary test schemas and removes them; the supplied database role needs schema creation privileges.

For native MariaDB use Knex's `mysql2` client and install `mysql2` in the host. The adapter requires InnoDB with 16 KiB pages, strict SQL mode and enabled foreign-key checks. Unindexed text, structured values and binary payloads use `LONGBLOB`; indexed textual/binary values use `VARBINARY(512)` and remain bounded to 512 bytes per indexed value. This preserves case and trailing spaces without a locale collation. Indexes wider than 3072 bytes reject before schema creation. Ordinary large integers use bigint types; integer identities use unsigned bigint (1–18446744073709551615). The MariaDB client supports generated identities via native `AUTO_INCREMENT`.

Native MariaDB DDL commits implicitly, so schema creation cannot be transactional. On failure the adapter attempts to remove only tables and foreign keys created by that attempt; an interrupted process or failed cleanup can leave partial schema requiring operator cleanup. Do not run schema creation concurrently for the same target.

The opt-in MariaDB suite uses `TEQFW_DB__MYSQL_HOST`, `TEQFW_DB__MYSQL_USER`, `TEQFW_DB__MYSQL_PASSWORD`, and `TEQFW_DB__MYSQL_DATABASE`; run `npm run test:mariadb`. It checks that its deterministic test tables do not exist before creating them and removes only its own tables and foreign keys. Use an isolated test database and credentials with table create, alter, and drop rights.

## Native physical value mapping

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

DEM rejects lone UTF16 surrogates as invalid logical input. Native PostgreSQL text
containing NUL is unsupported; the portable projection preserves valid scalars including NUL. Changing physical
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

## One application module on SQLite and IndexedDB

DEM publishes `conformance/application/Workflow.mjs` and its Schema module. Workflow
is an ordinary DI component whose only dependencies are the DEM RepositoryProvider
and Selection factory. It triages tasks through create/read/update/delete/list,
filtering, sorting and pagination. Its logical records include integer normalization,
an enum default, nullable note and nested JSON. Application logic has no runtime
branches, physical storage references or adapter imports.

- Node Composition Root: [test/compare/application/Node.mjs](test/compare/application/Node.mjs).
- Browser Composition Root: DEM-IDB `test/browser/application/Browser.mjs`.
- Acceptance test: [test/compare/Application.test.mjs](test/compare/Application.test.mjs).

Install dependencies with the same current DEM checkout/archive in both adapters,
including the new conformance/application exports. Install SQLite's native binding
and make google-chrome available (or set CHROME_PATH). No PostgreSQL/MariaDB
configuration is needed for this scenario. From the DEM-RDB checkout:

```sh
node test/compare/application/Node.mjs
TEQFW_DEM_IDB_ROOT=../dem-idb npm run test:application
```

The first command prints the SQLite observation. The second reuses the existing
DEM-IDB HTTP/Chrome harness in application-only mode and compares both observations.
For browser-only execution, run `DEM_BROWSER_SCENARIO=application npm run test:browser`
in DEM-IDB; set DEM_COMPARE_OUTPUT to retain its JSON observation envelope.

Each root registers CFG, DEM, its adapter, Demo_ and Host_ namespaces before resolution.
Its preprocessor selects the concrete Provider and a host model configuration
component; the root loads CFG and initializes the Connection and placement before resolving Workflow. No DI test
mode or repository fake is used. The Node root owns a temporary SQLite file; the
browser root owns an isolated database. Both clean up their resources in finally.

The acceptance test compares the exact application-source SHA-256, complete effective
models, fingerprints and transcripts. It also asserts expected results, missing-row
envelopes, detached records and unchanged input data. Generated integer ids match
in these empty stores, so there is no normalization that could hide differences.
This proves the covered workflow on SQLite/Chrome IDB; it does not add synchronization,
new repository methods, migration behavior or guarantees for other browsers.
