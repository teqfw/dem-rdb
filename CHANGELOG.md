# Release Notes

## Unreleased

## 2.2.1 — 2026-11-28

- Require `@teqfw/di` `^2.12.1`.
- Stop checking JavaScript files from dependencies during typecheck and remove deprecated compiler path configuration.
- Use validator-compatible JSDoc array types.

## 2.2.0 — 2026-11-25

- Use native PostgreSQL identity columns for increasing generated integer IDs, including after deletion and explicit seeds. Existing layouts require host-directed migration.
- Restrict identity and ref to integer profiles while retaining ordinary UUID attributes.
- Add structured, allowlisted PostgreSQL enum compatibility diagnostics while preserving `UNSUPPORTED` rejection behavior.
- Require the published `@teqfw/dem` `^2.2.0` package.

## 2.1.0 — 2026-11-23

- Add DEM `restrict` and `cascade` relation actions, derive SQL foreign-key policies from the compiled model, and validate them on reopen.
- Add the `teqfw.dem_rdb.vector` extension for SQLite and PostgreSQL, with explicit PostgreSQL float32 conversion and reopen validation.
- Enforce Core enum values with named SQL checks and validate the constraints on reopen.
- Reject unsupported MariaDB self-referential update cascades and strengthen SQLite, PostgreSQL, and MariaDB integration coverage.
- Require the published `@teqfw/dem` `^2.1.0` package.

## 2.0.0 — Release candidate

- Require DEM ^2.0.0 and Format 2 schemas.
- Use DEM-derived tables, DI-managed connections and initial model history; host migration is required for prior layouts.

## 0.2.0 — 2026-11-02

- Align the runtime dependency with `@teqfw/dem` 0.3.x and verify SQLite
  integration against the published compiler and repository contracts.
