# Before starting final acceptance

In a worktree, resolve its root with `git rev-parse --show-toplevel` and resolve
shared private inputs explicitly instead of counting parent-directory segments.
Define the delivery target in acceptance: implementation, an isolated stand or
an explicitly named live stand. Preserve the user's requested outcome when
writing criteria: a verified command's existence establishes capability;
correcting existing live data requires evidence of applying it to that stand.
Record an outstanding live application separately from completed implementation.
When editing Russian text on Windows, use `apply_patch` or a UTF-8 script file:
legacy PowerShell pipelines into native Node can replace Cyrillic with `?`.
The projection-controls preflight checks the resulting initial UI labels.

For viewer fixture changes, run `tools/check-viewer-fixtures-tests.ps1` before
allocating services. It reads the actual runner's conditions for Navigation and
Updates, including seed/publish/restart order, without executing runner code.
This catches missing overlap prerequisites; syntax parsing alone cannot.

For JSON/JSONL diagnostics, start with
`node tools/validation-summary.mjs <known-report-path>`. It limits output to
12 KiB and selects failures, selection identity, counts and cleanup. Read a
specific raw field only when the summary leaves a diagnostic question open;
complete reports remain in their archive. A summary is not an acceptance check.
NoData summaries retain case counts, kinds and viewport coverage. For long
child checks, use `Invoke-CheckedProcess -OutputMode Summary`: complete stdout
and stderr stay in their files, and the console shows paths, lengths and exit.

For PowerShell runner edits, run `powershell -NoProfile -File tools/check-powershell.ps1`
before allocating services. It parses runtime scripts without executing them;
the existing Windows process check includes this guard and its valid/invalid
fixtures. Parsing catches broken quotes; argument binding still needs the
focused launcher/scenario check described in [service checks](services.md).

Use the existing CI mypy check against the current read-only workspace before
allocating a Compose project for Python type errors, when a locked validation
image is already available. Otherwise let the focused runner build it first.
Resolve the invocation from the existing `typecheck` service in
[Compose](../../compose.publication.yaml) and the full-source check in
[the checks workflow](../../.github/workflows/checks.yml); use its flags and
source directories rather than assuming a project-specific mypy config exists.
The NoData runner enforces full-source mypy and its short unit suite before
freezing inputs or starting Compose. `tools/check-field-nodata-preflight-tests.ps1`
checks this order without executing the runner or allocating services.
In PowerShell, expand a bind source in double quotes, for example
`"$((Get-Location).Path):/workspace:ro"`. Read UTF-8 repository text with
`Get-Content -Encoding UTF8` to preserve Russian diagnostics in tool output.

When combining existing scenarios in a new runner, execute each added scenario
in its focused mode before starting the full chain. Carry over its prerequisite
flags, mounts and fault coordination from the existing runner. In particular,
T8's cold-tile/warm-cache policy scenario requires `T6_TEST_FAULTS=1` in the
isolated API; selecting `T8_HTTP=1` in the check container alone is insufficient.
Confirm the intended failure and recovery through the gateway in that focused
run. A successful build or typecheck does not validate these prerequisites.

For a shortened recovery scenario, reuse the seed preparation in
[run-recovery.ps1](../../publication/run-recovery.ps1), including the accepted
encoder decision and its bound evidence. Check those files on the host before
allocating Compose resources or submitting the first worker job.

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
validated inputs. Follow [ticket completion](../../AGENTS.md#ticket-completion) for
the final commit and push. Read-only mounts still see host edits, and loaded
API workers can retain earlier code. If an input changes, archive that attempt
as development evidence and retire it; rerun the affected final gate from a
fresh project. Select evidence only when every required phase used the recorded
configuration. Do not combine a passing phase from one source revision with a
passing phase from another to establish a final result.

Reuse an unaffected unit/Python suite after a viewer-only fix when its source,
fixtures, configuration, dependencies and toolchain are unchanged. Preserve the
original result (including skips), record matching input lengths/hashes and
review the intervening diff for dependencies the manifest may omit. Repeat the
affected browser gate after its inputs change. The [T25 comparison](../validation/archives.md)
records this separation; unchanged backend hashes do not establish a new browser
result or replace a required service scenario.

When reusing an unaffected platform's complete gate after a platform-specific
runner fix, preserve both frozen snapshots and record every differing path,
length and hash. Review the actual diff and establish that it is unreachable on
the reused platform; repeat the affected platform's full gate. The
[T16 record](../validation/archives.md) covers only
its desktop cleanup change. It does not authorize other mixed-input acceptance
or imply that Android executed the newer runner bytes.

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
For a large set of tracked inputs, read committed object identities once with
`git ls-tree -rz HEAD` (or staged identities with `git ls-files --stage -z`),
then compare the path/object map with the input inventory in one process.
Retain the per-input prospective-filter check before acceptance. Thousands of
individual `git rev-parse` processes add overhead without stronger verification.
For new tracked validation records, run the staged diff check before the ticket commit:
an unstaged check omits new files. Preserve raw historical input snapshots;
report their existing whitespace separately from changed source/documentation
checks, with the exact snapshot-only exclusion recorded in validation.

For Node subprocesses reading a repository-wide Git index, set an explicit output
buffer large enough for the archive (T13 used 64 MiB), or stream the output.
Compare new/changed tracked inputs to raw Git blobs; preserve external evidence
against its recorded hashes independently of Git. Compare
unchanged baseline files using their existing checkout filters. Preserve the
exact raw bytes in the validation snapshot. Existing baseline CRLF normalization
is distinct from an input changing during acceptance.


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
