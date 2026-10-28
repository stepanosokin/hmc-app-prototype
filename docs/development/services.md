# Service checks

For `hmc-app.mjs refresh-grib` failures, begin with the displayed operation
directory: `operation.json`, then `reload-grib.json` and the numbered worker log.
A failed batch can contain already published files; report both outcomes before
retrying. `status` finishing does not establish that background cleanup finished.
Distinguish an idle collector waiting for grace from an active writer lock;
an unfinished legacy job also does not prove a running worker. Inspect the
project's containers/jobs/locks through its actual configuration without logging secrets.
Changes to refresh/cleanup coordination need an interleaving check: collection
starting between two file loads, in addition to sequential clear/load and active-writer
tests. Verify the intended wait/reject behavior and preserved completed files.

For catalogue identity checks, use `/api/v1/catalogue?view=compact`, the map's
normal catalogue. Test expanded catalogue performance separately when its
contract changes. Correlate a gateway timeout with the API request ID and
duration before changing timeouts or attributing it to service failure.

For the production T13 viewer, use the [viewer instructions](../../viewer/README.md)
and `tools/run-weather-viewer.ps1`. Run its Node tests and TypeScript check before
allocating Compose; the `weather-viewer` CI job runs these existing commands.
Run `tools/check-archives.ps1` separately against the external historical archive;
its tracked T13 checker is `tools/archive-checks/t13.mjs`.
Use the verifier's `--current` option only when validating that archive's exact
runtime revision; future source changes keep their own input inventories.
For the accepted T14 run/time archive, use `python tools/check_evidence.py --t14`
in the same locked validation container. Its existing CI evidence-test step
also exercises synthetic missing-matrix/race/input/cleanup cases; byte hashes
alone do not establish complete acceptance.
Run the workflow's full-source mypy command during Development as well: a
service runner's narrower typecheck can miss diagnostic tools checked by CI.

Keep T5 in a fresh, separate project from the T13 browser fixture. T5 expects
the initial +1 h catalogue; T13 seeds +1/+3 h to exercise missing +2 h. A runner's
`-Final` flag does not establish fixture compatibility. Select the combined gate
by its initial catalogue and mutation history before provisioning services.

For the approved T23a native display profile, use
`tools/run-native-display.ps1 -Project <fresh-hmc-publication-t23a-name> -WithEdge`.
It checks actual-source native blocks, independent raw-GRIB/PROJ comparisons,
real desktop GPU readback, both display projections, synthetic masks and
pole/dateline/horizon/cut cases. Keep physical Android/iOS acceptance separate
from desktop viewport emulation. Timeout probes use a distinct organization:
the existing conservative reservation must not occupy public browser slots.
The optional historical command is `tools/check_evidence.py --native-display`;
it verifies the selected Chrome/Edge reports, frozen inputs and contract,
numerical/resource bounds, required T12/T6 service regressions and retirement
receipts. The default evidence command preserves historical T3–T12/T22 checks.

The existing archive-test CI step runs synthetic `NativeEvidence` cases in
[test_evidence.py](../../tools/test_evidence.py): complete archives pass; incomplete
matrices, missing retirement, input drift and budget overruns fail even with
recomputed artifact hashes. Extend these public checker tests when evidence
requirements change. The Windows CI
[input-capture check](../../tools/check-native-display-inputs.ps1) exercises only
the native runner's file selection, without Compose or Git-filter dependence.

For T23, `python -B tools/check_evidence.py --t23` verifies all three frozen
continuation/diagnosis/implementation indexes, including failed attempts.
The optional archive command also replays `tools/native-display/budgets.mjs` against the three selected
Chrome/Edge/physical Android reports. This preserves bytes and measured budgets;
it does not rerun physical acceptance or establish deferred Safari support.

The [checks workflow](../../.github/workflows/checks.yml) builds the existing
hash-locked publication image and runs mypy, numeric boundary tests, interpreter
startup/shutdown probes and synthetic archive-checker tests. Historical archive
integrity is checked separately using `HMC_EVIDENCE_ROOT`. Its Windows job
checks the actual publication process launcher with successful and failing child
processes, spaced paths/arguments and captured stdout/stderr. The Ubuntu job also
runs the existing retirement check against disposable Docker resources using
the same locked validation image and `pwsh`; the
[runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#powershell-tools)
documents the host tooling. Run
`powershell -NoProfile -File tools/check-publication-process.ps1` when changing
that launcher. Use the workflow's commands for checks that do not need private
sample data. Inspect native process exit
codes: ticket #16 produced unittest `OK` followed by exit 139. The existing
`publication.runtime` probe covers both relevant import orders; preserve it when
changing native dependencies.

For publication behavior, worker, gateway or GeoServer changes, also use the
actual-sample [T5 runner](../publication.md#reproduce-t5). Use the
[legacy T4 runner](../publication.md#reproduce) only for its archived one-time
workflow. CI has no organization GRIB and does not establish actual-sample,
real-service, desktop QGIS or operational gates.
Use the T5 runner's existing project/port preflight and service readiness wait;
they reject reused volumes and occupied ports before ingestion. T5 reports are
isolated by project; T4 reports remain shared, so run T4 experiments sequentially.
The runner checks native exit codes, observes publication during real failures
and preserves service volumes until evidence archival; retirement below is then mandatory.

For access-policy or organization-key changes, run the actual-sample
[T8 access runner](../../publication/run-access.ps1) in a fresh project. It includes
the T5 publication/restart regression and full suite, protected numeric/GIS
requests, rotation/revocation before proven warm-cache hits, real edge/backend
isolation, authorization-store failure and existing-volume access provisioning.
Its `-Development` mode is a focused probe, not the final acceptance gate.

For request-budget or usage-accounting changes, use the actual-sample
[T9 budgets runner](../../publication/run-budgets.ps1). Its full mode includes
T5 publication/restart, T8 access/cache isolation and the full suite; select
this combined gate instead of repeating the separate T5 and T8 chains.
First finish all new T9 scenarios in `-Development` and resolve review findings.
Run the additional T6 gate below when recovery or tile-cache inputs change.
The operator contract is [budgets.md](../budgets.md).

See [desktop QGIS validation](qgis.md) for the T11 gate.


For the integrated M3 gate, use the two-phase
[T12 runner](../integrated-publication.md#воспроизведение). It combines T5, T9,
the complete T8 access gate and T11 desktop/WMS in one fresh project; do not
repeat the separate T5/T8/T9 chains. First exercise new scenarios in Development.
When a combined scenario depends on catalogue history or shared-cache pressure,
reproduce that prerequisite in a focused run before the final gate. A short seed
alone does not establish parity with the post-T5 state. Use the
[T12 development failures](../validation/archives.md) to distinguish observer
timing and cache prerequisites from service failures.
When expanding collection metadata, measure the serialized listing at post-T5
history size against the gateway response budget, including nested copies in
`source`. Verify that the individual collection still exposes the full metadata.
Keep its two-tile cache budget and API fault flags unchanged across phases.
Prepare verifies the tracked M1 comparison fixture and explicit adapter selection;
Complete binds desktop, HTTP and restart evidence to the same frozen inputs.
Development passes do not establish M3. Add T6/T7 when their change categories
above also apply; browser/GPU acceptance remains separate.
Collections populates numeric tile metadata in the same bounded cache as bytes;
re-establish the exact metadata/byte warm state immediately before generation
faults. A polling interval cannot guarantee observing a fast intermediate
revision. Record successful retained responses while the worker is still alive,
then verify new published revisions separately; keep T5's incremental visibility
check as its own gate.


For ingestion/recovery or tile-cache changes, also run the isolated actual-sample
[T6 recovery runner](../publication.md#recover-interrupted-deliveries-t6--18):
`powershell -NoProfile -File publication/run-recovery.ps1 -Project <fresh-project> -Port <free-port>`.
It includes killed workers, real GIS failures, managed-source recovery, staging
collection, cold/warm numeric tiles and retained readers after service restart.
Its fault markers are enabled only in the explicitly isolated T6 API stack.

For full-stack backup/restore (T18), use
`powershell -NoProfile -File publication/run-stack-restore.ps1 -Project hmc-publication-t18-<fresh-name>`.
It includes the complete T6 gate (and its full suite), then T8 policy probes,
offline backup, restore into separate volumes, pinned public readers, revocation,
usage/retention and queued-delivery replay. Do not repeat a separate T6 chain.
Use `-Development` for focused iteration before freezing final inputs.
The runner retires both projects, including failures. Closed backup bundles stay
outside portable reports; see [operator recovery](../stack-recovery.md).
Local Docker success does not establish the agreed organization Linux host gate.

For retention or retained-revision migration changes, also run the actual-sample
[T7 retention runner](../../publication/run-retention.ps1) in a fresh project. It
checks mixed legacy/incremental upgrade, collection during gateway read traffic,
seven-/30-day cleanup, warm-cache expiry and expiry after restart. The CI
retention-boundary tests supplement this gate; they do not establish real-service
retention behavior. Select T5/T6 regressions using the change categories above.

For a new retention lifecycle, use T7 `-Development` before freezing the full
gate. It runs one-off cleanup followed by the ordinary lifecycle: standalone
success does not establish shared-fixture compatibility. Keep recoverable
delivery identities distinct when a scenario deliberately removes the earlier
publication, and establish the next scenario's initial catalogue and managed
assets. The runner's resource-free
[selection guard](../../tools/check-retention-preflight.ps1) checks discovery
and both selectors before Docker; its negative fixtures run in Windows/CI.

For CLI input evidence, include `hmc-app.mjs` and its `.mjs` dependencies in
`Get-T7CliInventory`. The backend inventory in `verify_recovery --inputs`
does not capture these suffixes. Verify every declared copied input against
its original hash; a complete report archive alone is not that comparison.

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

For a direct PowerShell script invocation, use its exceptions/success status.
`$LASTEXITCODE` belongs to native child processes and can remain empty or stale
after `& ./check.ps1`. Use `Invoke-CheckedProcess` with `powershell -File` when
a recorded native exit code is required.

For a PowerShell script's array parameter, invoke it in the current PowerShell
with an actual array, for example:

```powershell
& ./tools/check-documentation.ps1 -Path @('docs/qgis.md', 'docs/development/qgis.md')
$containerNames = @('hmc-app-live-api-1', 'hmc-app-live-gateway-1')
$containers = docker inspect $containerNames | ConvertFrom-Json
```

A comma-separated string passed through native `powershell -File` is one path.
Assign a JSON array directly as above before checking its Count; in Windows
PowerShell 5.1, wrapping that pipeline in `@(...)` can retain the parsed array
as a single nested item. Verify the native exit code and expected ownership/count
before a service mutation. The [WMS retrospective](../validation/retrospectives/retro-wms-compat.md)
records both command-binding failures.

Use that same launcher for a nested PowerShell runner under
`$ErrorActionPreference = 'Stop'`: redirect the child's streams with
`Invoke-CheckedProcess`, rather than wrapping `powershell ... *> file`.
T9's wrapper treated a successful Docker build's stderr as a terminating
PowerShell error. The existing Windows process check already covers successful
stderr and nonzero exits; this is a launcher selection issue, not a missing check.

After changing API or gateway code, restart each affected long-lived service
before HTTP validation. A source bind mount changes files but does not reload
Gunicorn workers; #17's ETag check initially exercised an old gateway process.

When a user live stack shares runner images, pass a distinct `-Image` to the
integrated, recovery and viewer runners. Record the live image and mounts before
testing. For rollback snapshots, archive only the required runtime paths from
Git; a whole-repository archive also copies historical evidence.

## Review of recovery, retention and budgets

For operator commands, follow both pinned demo clocks and the ordinary policy
clock (`clock=None`) through job creation. Exercise accepted UTC representations
at that boundary and resolve the completed job's selection through the public
contract. Finish these focused cases before freezing expensive acceptance.
For NoData changes, distinguish source missingness, value rejection and portrayal
transparency across statistics, point/series, native blocks/tiles and GIS Identify.

For publication withdrawal reviews, trace provenance from submission to batch
reuse: the source directory belongs to the captured delivery, not the later
worker environment. Follow a historical replacement through catalogue ordering,
superseded budgets and later registration; removing roots must not revive prior
expiry decisions. The #52 regressions in `tests/test_grib_sync.py` and
`tests/test_publication_retention.py` exercise these boundaries.

For an uncertain COMMIT, establish completion of the original transaction before
using a negative reference query to authorize file deletion. Include the new
directory's parent in durability checks. For unavailable viewer states, review
map clicks, point-series creation, links and time controls together; use
[browser checks](browser.md) for the early narrow-screen visual gate.

For diagnostics/fault exercises, establish distinct first/latest published
selections in Development. Save the retained URL, cold-tile URL and checksum
before enabling faults; warm each required metadata/byte entry immediately
before the marker. Observe the named stage counter's delta and explicitly
request the queued job's resulting selection to prove log correlation.
After restart, `/health` is a prerequisite: wait boundedly for the original
data URL/checksum and retain intermediate statuses/request IDs. Ordinary fault
probes still assert their first response. The [T17 retrospective](../validation/archives.md)
records the fixture and readiness failures behind these checks.

For recovery reviews, trace capture before queue processing as well as every
worker stage: durable intent before managed writes, byte/time bounds during
hashing and copying, and collection of abandoned fragments. T6's existing
`capture_crash` case exercises the public worker/retirement boundary; extend that
seam when adding capture paths and cover crashes before submission completes.

For retention reviews, trace whether queued deletion can drain active readers
while later traffic arrives. A fixed grace interval alone does not establish
bounded retention if unrelated readers can continually overtake collection.
Review migration across legacy and incremental records together, including late
adoption; publication order and the explicit policy clock have separate roles.
Use the existing gateway upgrade/read-pressure cases to validate those judgments.

For request-budget reviews, trace admission, queued API start, timeout and actual
backend completion together. A disconnected HTTP client or expired timer alone
does not establish that backend work stopped. Check that expired queued work
cannot start later, active work keeps its slot and known cache/product metadata
survives an output-limit rejection. Reuse T9's slow-reader, queued-request and
concurrent cold-tile scenarios for these judgements.

Include repeated schema provisioning in that trace while gateway readers are
active. `IF NOT EXISTS` can still acquire table locks. In T10, CREATE INDEX's
ShareLock followed by ALTER's AccessExclusiveLock deadlocked with a reader's
SELECT/INSERT transaction. Review lock acquisition and upgrades across the
whole transaction, including the existing-schema path. Reuse the T5 live-reader
regression and T9 legacy-usage upgrade test; an upgrade check without concurrent
traffic does not establish reader availability.

Quota tests establish fresh traffic immediately before changing a sliding-window
limit; lifetime usage is a separate accounting observation. Measure each timeout
reservation from its own request, including retries. Concurrent tests observe
the valid result pair independently of which organization wins the generator.
Check the actual service's mount permissions before choosing fault coordination;
the API's assets mount is read-only. Finish these fixtures in the focused run
before starting long, frozen acceptance chains in parallel.

For retained-reader load fixtures, count simultaneous public requests against
the effective policy before the full gate. If the scenario requires a temporary
isolated concurrency profile, preserve all other fields and restore the exact
original row or its absence in finally, with readback. Require a successful
reader response before collection; admission rejection does not prove overlap.
