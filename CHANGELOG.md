# Release Notes

## Unreleased

- Replace native and portable layouts with one DEM-derived relational projection
  and add initial confirmed model history for empty SQLite storage scopes.
- Let DEM-RDB resolve and own its Knex client through its DI-managed Connection.
- Align schema descriptors and conformance tests with DEM Format 2 and use the
  current GitHub source for the DEM dependency.

## 0.2.0 — 2026-11-02

- Align the runtime dependency with `@teqfw/dem` 0.3.x and verify SQLite
  integration against the published compiler and repository contracts.
