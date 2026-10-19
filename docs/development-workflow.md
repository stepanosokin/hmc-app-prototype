# Development workflow

## Validation

The [checks workflow](../.github/workflows/checks.yml) builds the existing
hash-locked publication image and runs mypy, numeric boundary tests, interpreter
startup/shutdown probes and archived-evidence integrity checks. Use its commands
for the checks that do not need private sample data. Inspect native process exit
codes: ticket #16 produced unittest `OK` followed by exit 139. The existing
`publication.runtime` probe covers both relevant import orders; preserve it when
changing native dependencies.

For publication, worker, gateway or GeoServer changes, also use the actual-sample
[publication runner](publication.md#reproduce). CI has no organization GRIB and
does not establish actual-sample, real-service, desktop QGIS or operational gates.
Use a fresh Compose project and free port for an independent run; report files
are shared, so run these experiments sequentially. The runner checks native exit
codes, observes publication during real failures and preserves service volumes.

PowerShell wrappers with declared parameters can interpret short native options
as their own parameters. Use long Compose options and pass embedded Python
`-c` commands through the wrapper's explicit argument array, as the publication
runner does. Keep background helpers hidden and capture their process exit codes.

## Scientific contracts and evidence

Before selecting an encoding or coordinate operation, resolve the ticket's
agreement gates. For this project, native spherical coordinates, WGS84 geodetic
coordinates and projected display coordinates have distinct meanings. Read the
versioned contract and operative CRS definitions before altering any of them;
record height handling and the forward/inverse direction. The approved v2 datum
relationship is a prototype hypothesis. T2's COG precision bound is separate
from display resampling/encoding budgets and geodetic placement accuracy.

Keep an independent numerical reference and retain failed compatibility probes.
Successful tests on a candidate configuration establish only that configuration.
Reuse verified immutable samplers while checking catalogue eligibility on each
request; compare numerical/GIS identity and placement through the gateway.

Before changing shared configuration, read its current contents. Existing
`.gitattributes` rules preserve historical evidence bytes; append compatible
rules rather than replacing them. `tools/check_evidence.py` verifies the T3
artifact index and T4's archived selection/contract hashes. These are historical
records: compare each against its recorded inputs, rather than against future
dependency locks or a new contract revision. New evidence must bind its exact
inputs, configuration, browser fixture and process results before selection.

## Issue tracking

Use the GitHub connector for issue reads. In this session it allowed reads but
returned `403 Resource not accessible by integration` on writes. When an
authorized issue update encounters that limitation, use the existing
repository-scoped `.scratch/hmc-meteo/github-tracker.mjs` helper. Read it first;
it supports issue/label REST operations and obtains credentials without printing
them. Supply operations and output paths in the ignored scratch directory, then
read back the issue state. If the helper is absent or authentication fails,
report the specific blocker. Keep credentials out of commands, logs and reports.

## Retrospective basis

These changes follow the [#16 review](evidence/t4/review.md),
[compatibility failures and final checks](evidence/t4/validation.md), and the
subsequent verified push/closure. They address missing CI coverage, delayed
discovery of hash/import-order failures, replaced configuration, repeated command
binding mistakes and the read-only connector. The existing runner and runtime
probe already cover process failure; CI wires them into routine checks rather
than introducing a second test framework.
