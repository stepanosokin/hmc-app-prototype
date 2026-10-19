# Development workflow

## Validation

The [checks workflow](../.github/workflows/checks.yml) builds the existing
hash-locked publication image and runs mypy, numeric boundary tests, interpreter
startup/shutdown probes and archived-evidence integrity checks. Its Windows job
checks the actual publication process launcher with successful and failing child
processes, spaced paths/arguments and captured stdout/stderr. Run
`powershell -NoProfile -File tools/check-publication-process.ps1` when changing
that launcher. Use the workflow's commands for checks that do not need private
sample data. Inspect native process exit
codes: ticket #16 produced unittest `OK` followed by exit 139. The existing
`publication.runtime` probe covers both relevant import orders; preserve it when
changing native dependencies.

For publication behavior, worker, gateway or GeoServer changes, also use the
actual-sample [T5 runner](publication.md#reproduce-t5). Use the
[legacy T4 runner](publication.md#reproduce) only for its archived one-time
workflow. CI has no organization GRIB and does not establish actual-sample,
real-service, desktop QGIS or operational gates.
Use the T5 runner's existing project/port preflight and service readiness wait;
they reject reused volumes and occupied ports before ingestion. T5 reports are
isolated by project; T4 reports remain shared, so run T4 experiments sequentially.
The runner checks native exit codes, observes publication during real failures
and preserves service volumes.

PowerShell wrappers with declared parameters can interpret short native options
as their own parameters. Use long Compose options and pass embedded Python
`-c` commands through the wrapper's explicit argument array, as the publication
runner does. Use `publication/process.ps1` for synchronous hidden checks: it waits
for process completion, captures both streams and records the native exit code.
Polling a `Start-Process` object previously yielded a null ExitCode; a printed
success message does not establish a successful native exit. For launcher-only
refactors, run its Windows check and a read-only Compose command through it.
Changes to startup ordering or service/publication behavior require the full T5
runner.

After changing API or gateway code, restart each affected long-lived service
before HTTP validation. A source bind mount changes files but does not reload
Gunicorn workers; #17's ETag check initially exercised an old gateway process.

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
artifact index, T4's archived selection/contract hashes and T5's report/input
artifact index. These are historical records: compare each against its recorded
inputs, rather than against future
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

The [#17 failed probes](evidence/t5/failed-probes.md) and
[validation](evidence/t5/validation.md) exposed a Windows process-launcher gap,
occupied-port/startup races and stale gateway workers. T5 already guards project
isolation, port availability and real service readiness. The Windows CI check
now exercises its shared launcher without Docker or private data; the retained
T5 hashes remain historical. The [review](evidence/t5/review.md) found no missing
coding standard; its two duplication findings were resolved in the code.
