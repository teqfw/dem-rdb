# Release Notes

## Unreleased

- Integrate model-bound DEM Runtime operations in portable persistence, with
  fail-fast checks for model mismatches and unsupported extension types.
- Prevent stale portable backends from publishing an obsolete schema after a
  structural update.
- Align schema descriptors and conformance tests with DEM Format 2 and use the
  current GitHub source for the DEM dependency.

## 0.2.0 — 2026-11-02

- Align the runtime dependency with `@teqfw/dem` 0.3.x and verify SQLite
  integration against the published compiler and repository contracts.
