# Before starting final acceptance

Use the existing CI mypy check against the current read-only workspace before
allocating a Compose project for Python type errors, when a locked validation
image is already available. Otherwise let the focused runner build it first.
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

When reusing an unaffected platform's complete gate after a platform-specific
runner fix, preserve both frozen snapshots and record every differing path,
length and hash. Review the actual diff and establish that it is unreachable on
the reused platform; repeat the affected platform's full gate. The
[T16 record](../evidence/t16/checks/validation-input-difference.json) covers only
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
For a large archive, read committed object identities once with
`git ls-tree -rz HEAD` (or staged identities with `git ls-files --stage -z`),
then compare the path/object map with the artifact index in one process.
Retain the per-input prospective-filter check before acceptance. Thousands of
individual `git rev-parse` processes add overhead without stronger verification.
For newly added evidence, run the staged diff check before the ticket commit:
an unstaged check omits new files. Preserve raw historical input snapshots;
report their existing whitespace separately from changed source/documentation
checks, with the exact snapshot-only exclusion recorded in validation.

For Node subprocesses reading a repository-wide Git index, set an explicit output
buffer large enough for the archive (T13 used 64 MiB), or stream the output.
Compare new/changed inputs and byte-addressed evidence to raw Git blobs; compare
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
