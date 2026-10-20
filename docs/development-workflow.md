# Development workflow

## Specification updates

The current bilingual contract is tracked in
`.scratch/hmc-meteo/spec.md` and `spec.ru.md`; the local mirror of canonical
GitHub specification #12 is `implementation-spec.md` in that directory.
Update both language copies and the canonical issue together. Preserve historical
planning snapshots and acceptance IDs; a newly created implementation ticket
keeps its criteria unchecked until implementation is verified.

Run `powershell -NoProfile -File tools/check-documentation.ps1` for the current
specification and workflow links. For multiple paths, call the script inside
PowerShell: `& ./tools/check-documentation.ps1 -Path @('README.md','AGENTS.md')`.
The check resolves local inline Markdown links relative to each file, including
root README links; it does not validate remote URLs or section fragments.
It also runs in the existing Windows CI job.

For ad hoc PowerShell validation, set `$ErrorActionPreference = 'Stop'` before
checking inputs and inspect native exit codes before reporting success. Resolve
file paths before deriving their directory. A trailing success message or exit
zero does not establish that earlier nonterminating errors were absent.

## Validation

The [checks workflow](../.github/workflows/checks.yml) builds the existing
hash-locked publication image and runs mypy, numeric boundary tests, interpreter
startup/shutdown probes and archived-evidence integrity checks. Its Windows job
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
actual-sample [T5 runner](publication.md#reproduce-t5). Use the
[legacy T4 runner](publication.md#reproduce) only for its archived one-time
workflow. CI has no organization GRIB and does not establish actual-sample,
real-service, desktop QGIS or operational gates.
Use the T5 runner's existing project/port preflight and service readiness wait;
they reject reused volumes and occupied ports before ingestion. T5 reports are
isolated by project; T4 reports remain shared, so run T4 experiments sequentially.
The runner checks native exit codes, observes publication during real failures
and preserves service volumes until evidence archival; retirement below is then mandatory.

For access-policy or organization-key changes, run the actual-sample
[T8 access runner](../publication/run-access.ps1) in a fresh project. It includes
the T5 publication/restart regression and full suite, protected numeric/GIS
requests, rotation/revocation before proven warm-cache hits, real edge/backend
isolation, authorization-store failure and existing-volume access provisioning.
Its `-Development` mode is a focused probe, not the final acceptance gate.

For request-budget or usage-accounting changes, use the actual-sample
[T9 budgets runner](../publication/run-budgets.ps1). Its full mode includes
T5 publication/restart, T8 access/cache isolation and the full suite; select
this combined gate instead of repeating the separate T5 and T8 chains.
First finish all new T9 scenarios in `-Development` and resolve review findings.
Run the additional T6 gate below when recovery or tile-cache inputs change.
The operator contract is [budgets.md](budgets.md).

For ingestion/recovery or tile-cache changes, also run the isolated actual-sample
[T6 recovery runner](publication.md#recover-interrupted-deliveries-t6--18):
`powershell -NoProfile -File publication/run-recovery.ps1 -Project <fresh-project> -Port <free-port>`.
It includes killed workers, real GIS failures, managed-source recovery, staging
collection, cold/warm numeric tiles and retained readers after service restart.
Its fault markers are enabled only in the explicitly isolated T6 API stack.

For retention or retained-revision migration changes, also run the actual-sample
[T7 retention runner](../publication/run-retention.ps1) in a fresh project. It
checks mixed legacy/incremental upgrade, collection during gateway read traffic,
seven-/30-day cleanup, warm-cache expiry and expiry after restart. The CI
retention-boundary tests supplement this gate; they do not establish real-service
retention behavior. Select T5/T6 regressions using the change categories above.

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

Use that same launcher for a nested PowerShell runner under
`$ErrorActionPreference = 'Stop'`: redirect the child's streams with
`Invoke-CheckedProcess`, rather than wrapping `powershell ... *> file`.
T9's wrapper treated a successful Docker build's stderr as a terminating
PowerShell error. The existing Windows process check already covers successful
stderr and nonzero exits; this is a launcher selection issue, not a missing check.

After changing API or gateway code, restart each affected long-lived service
before HTTP validation. A source bind mount changes files but does not reload
Gunicorn workers; #17's ETag check initially exercised an old gateway process.

### Before starting final acceptance

Use the existing CI mypy check against the current read-only workspace before
allocating a Compose project for Python type errors, when a locked validation
image is already available. Otherwise let the focused runner build it first.
In PowerShell, expand a bind source in double quotes, for example
`"$((Get-Location).Path):/workspace:ro"`. Read UTF-8 repository text with
`Get-Content -Encoding UTF8` to preserve Russian diagnostics in tool output.

For actual-sample acceptance, verify that the configured private sample exists
and matches `SAMPLE_SHA256` in `decoder/inspect_forecast.py` before allocating
the test project or pulling its service images. For T7, also verify that the runner's frozen
historical Git commit is available locally. Resolve missing prerequisites before
starting long acceptance runs.

Use unittest discovery for this repository's test files, for example
`python -m unittest discover -s tests -p test_publication_recovery.py -k capture_crash -v`.
The tests directory is not a Python package. When changing public error handling,
run the existing `test_publication_http.py` case matching
`-k sanitized_service_failure` against the isolated published service before
starting the full acceptance run. Enable `T6_HTTP=1` for the capture example and
`T4_HTTP=1` for the HTTP test in the check container; verify the selected tests
execute rather than skip. Preserve established response bodies unless
the ticket explicitly changes their contract; add retry headers independently.

Finish focused implementation checks and review fixes before the final Compose
run. Freeze the uncommitted bind-mounted inputs for the whole run. Record the
starting commit and exact source/configuration hashes, compare them with the
final input inventory, and verify that the eventual committed files match the
validated inputs. Follow [ticket completion](../AGENTS.md#ticket-completion) for
the final commit and push. Read-only mounts still see host edits, and loaded
API workers can retain earlier code. If an input changes, archive that attempt
as development evidence and retire it; rerun the affected final gate from a
fresh project. Select evidence only when every required phase used the recorded
configuration. Do not combine a passing phase from one source revision with a
passing phase from another to establish a final result.

Before freezing changed inputs, compare their working-file bytes with Git's
prospective filtered contents. Include newly added input files. For each path:

```powershell
$ErrorActionPreference = 'Stop'
$validationInput = 'tools/check_evidence.py'
$workingObject = & git hash-object --no-filters -- $validationInput
if ($LASTEXITCODE -ne 0) { throw 'Cannot hash working input' }
$storedObject = & git hash-object "--path=$validationInput" -- $validationInput
if ($LASTEXITCODE -ne 0) { throw 'Cannot hash prospective Git input' }
if ($workingObject -ne $storedObject) { throw 'Resolve Git filters before acceptance' }
```

Resolve a difference before the run by choosing the intended line endings or
file-specific attributes. Preserve existing byte-addressed evidence rules.
After staging, compare the actual index blobs with the selected input hashes;
repeat against HEAD after commit. `git add --renormalize -- <exact-path>` applies
an intentional attribute change to an already staged file. A clean working tree
alone does not establish byte identity.

Capture a long Compose run's full console output in its project report directory
so retirement archives it. Inspect bounded tails and per-phase logs for progress,
then check the final native exit code; repeated pull-progress frames add no
validation evidence.

Capture service logs before retirement on a failed run. The T9 runner's existing
failure handler records them while preserving the original failure; use that
ordering when changing another runner. Save request IDs and available database
error/lock details with the failed phase. Retirement archives report files, not
uncaptured container logs, so diagnostics requested after deletion are lost.
Keep credentials and full container environment dumps outside reports.

An unexplained failed acceptance gate remains a failed attempt after a successful
repeat. Reproduce its reader/worker overlap in a focused run and distinguish
the gateway's admission/accounting failure from an upstream service failure.
Use status/body provenance as a clue, then confirm the cause from service logs.

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

## Test environment cleanup

At the end of every validation attempt, including a failed probe, archive evidence
and retire that attempt's Docker resources before the task handoff. The validation
runners preserve state while evidence is collected; that is a temporary phase.
Run `tools/retire-publication-project.ps1 -Project <exact-project-name>` automatically
after collecting the required successful/failed probes. For multiple projects,
invoke it from PowerShell with an explicit array of names. Cleanup has standing
user authorization. A user-requested live demo is the only retention exception.

The helper copies report files identified by the containers' report-directory
labels into `data/archives/publication/<project>/<archive-id>`, records the exact
container/image/network/volume inventory, and verifies every archived file's
length and SHA256 before deletion. It then removes the project's containers,
attached anonymous volumes, named volumes and networks, and checks that all three
resource inventories are empty. It records a retirement receipt only on success.
An archive or Docker error blocks completion; diagnose and retry instead of
reporting cleanup as complete. An explicit project with only orphaned networks
or volumes can be retired through the same command. When no container remains,
the helper discovers the conventional T4/T5/T6 report path; use
`-ReportDirectory data/reports/<relative-path>` for a custom report location.
Run `powershell -NoProfile -File tools/check-publication-retirement.ps1` after
changing the helper. This exercises real disposable resources, failed archival,
named/anonymous-volume removal and preservation of unrelated resources.
CI invokes the same check with `-Image hmc-publication:checks`; it requires no
private source sample. Reuse this check for cleanup regressions.

Keep committed historical evidence unchanged. Local report directories and
source mounts remain available; shared images/build cache are reusable Docker
cache, outside project retirement. Use exact project labels and repository
ownership checks; global prune commands are outside this cleanup scope. Include
the verified retired-project count, archive location and any explicitly retained
live project in the final handoff. Validate cleanup-helper changes against real
disposable Docker resources; publication behavior remains covered by T5/T6.

For Docker inventory, start with `docker compose ls --all --format json` and
`docker ps --all --format '{{.Names}}|{{.State}}|{{.Ports}}'`. List volume/network
names with an exact project-label filter. For deeper inspection, select only
the needed fields before returning output; full container JSON contains large
label sets and environment values. After network address-pool exhaustion,
finish archival/retirement of completed attempts before allocating another
test project.

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

For cached numerical readers, exercise loss of an expected array and an expected
chunk after warming the sampler. Consolidated Zarr metadata can survive missing
files and return fill values as apparent success. Use the verified manifest's
file inventory to distinguish unavailable published storage from legitimate
sparse fill or native nodata. Reuse the public point/EDR fault-and-recovery case
in [test_publication_numerical.py](../tests/test_publication_numerical.py).

Before changing shared configuration, read its current contents. Existing
`.gitattributes` rules preserve historical evidence bytes; append compatible
rules rather than replacing them. `tools/check_evidence.py` verifies the T3
artifact index, T4's archived selection/contract hashes and T5-T10 report/input
artifact index. These are historical records: compare each against its recorded
inputs, rather than against future
dependency locks or a new contract revision. New evidence must bind its exact
inputs, configuration, browser fixture and process results before selection.

## Issue tracking

Maintain acceptance checkboxes throughout implementation: mark a criterion only
after its required behavior and validation are supported by evidence. Attach or
link the relevant evidence in the ticket. Leave blocked/unvalidated criteria
unchecked and explain what remains. Read back the updated body before handoff;
after satisfying the [ticket completion conditions](../AGENTS.md#ticket-completion),
close the ticket using standing user authorization and verify the closed state
and completed checklist together. Checklist maintenance is also already authorized.

Use the GitHub connector for issue reads. In this session it allowed reads but
returned `403 Resource not accessible by integration` on writes. When an
authorized issue update encounters that limitation, use the existing
repository-scoped `.scratch/hmc-meteo/github-tracker.mjs` helper. Read it first;
it supports issue/label REST operations and obtains credentials without printing
them. Supply operations and output paths in the ignored scratch directory, then
read back the issue state. If the helper is absent or authentication fails,
report the specific blocker. Keep credentials out of commands, logs and reports.

When constructing an issue body in PowerShell, read it as a plain string with
`[System.IO.File]::ReadAllText(<absolute-path>)` before `ConvertTo-Json`.
`Get-Content` can carry PowerShell metadata into the serialized value and turn
the required JSON string into an object, causing a GitHub 422. Verify that the
serialized `body` is a string before submitting. Keep tracker responses in
ignored files and inspect only the fields needed for readback; do not send a
large document through tool output merely to serialize it again.
The repository tracker helper rejects a non-string issue body before credential
lookup or network access.

Documentation-only checks allocate no Compose project and require no runtime
acceptance run. Record that no test resources were created; the retirement
procedure applies whenever a check actually allocates Docker resources.

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

The [#18 failures](evidence/t6/failed-probes.md) and
[review](evidence/t6/review.md) exposed capture crash windows, unbounded source
hashing, uncollectable capture fragments and a changed public 503 body. Existing
capture and HTTP checks cover those behaviors; the workflow now brings them
forward and freezes inputs before final evidence. The subsequent
[retirement inventory](evidence/retirement/2026-10-19.json) records removal of
12 superseded stacks. Their retained networks exhausted Docker's address pool
during cleanup validation. Retirement now has a standing completion rule and its
existing real-resource check is wired into CI. The changes reuse behavioral
checks and keep project-specific guidance in this repository.

The [#19 review](evidence/t7/review.md) found reader starvation and mixed-source
backfill ordering defects; its existing upgrade and continuous-reader cases now
cover those behaviors. The [development evidence](evidence/t7/failed-probes.md)
also records a missing private input and a run rejected after input changes.
The session repeated T7 after running the focused public-error check late, so
prerequisites and that check belong before expensive final acceptance. T7's
artifact index was initially absent from the existing CI evidence checker; it
is now included in that same check. A disposable corrupted T7 report escaped the
old checker and is rejected by the updated one; the original archives pass.
Historical reports remain unchanged.

The [TLS planning session](evidence/tls-planning.md) exposed a documentation probe
that printed success after nonterminating PowerShell path errors, plus an issue
body serialized as an object. The documentation checker now fails on missing
targets or unreadable inputs and runs in the existing Windows CI job. The
specification pointer and plain-string issue-body recipe above address the
navigation and serialization failures without changing third-party skills.

The [T9 retrospective](evidence/retro-t9.md) links the failed probes and reviews
behind the budget-review, fixture timing and launcher guidance above. Existing
CI already covers mypy, process exits and evidence integrity; the changes improve
when those checks and the combined T9 gate are used. Historical evidence stays
bound to its recorded inputs.

The [T10 retrospective](evidence/retro-t10.md) ties the failed acceptance runs,
proven usage-migration deadlock, missing-array/chunk failures and late Git byte
check to the guidance above. Existing HTTP regressions, CI and evidence tooling
remain the checks; the workflow brings diagnostics and byte checks forward.
