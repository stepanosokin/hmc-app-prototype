# T7 development and review failures

- The first focused test ran against the pre-implementation image and failed
  with `ModuleNotFoundError: publication.retention`. The same boundary passed
  after implementation. This is the retained red/green step, not a scientific
  compatibility result (`development-red.log`, `development-boundaries.log`).
- `hmc-publication-t7-dev1` exercised the actual sample successfully, including
  HTTP expiry and restart, but source/configuration inputs changed while the
  run was active. Its gate records `failed: Validation inputs changed during
  the run`; it is rejected as final evidence. Both input inventories and its
  acceptance log are retained under `rejected-development-*`. It was archived
  and retired; phases from it are not combined with final phases.
- The separate Spec review found starvation in the try-only reader lock and
  incorrect mixed legacy/incremental backfill order. Both were fixed before
  the final run; see `review.md`. The strengthened final fixture includes
  continuous gateway traffic and real pre-T7 worker publication before upgrade.

The private input was initially absent. The user restored it before the selected
actual-sample validations; its approved SHA256 is recorded with those runs.
No new CRS, datum relationship, encoding, dependency lock or numerical-engine
choice was introduced. Existing failed scientific compatibility probes remain
unchanged under T4. Local retention evidence makes no desktop QGIS, browser GPU
implementation, geodetic-accuracy, agreed-host capacity or production-sizing
claim.
