# Development workflow

## Choose validation by the change

Run checks locally by default; GitHub Actions is an optional manual fallback,
not a required step for ticket completion. Use Windows PowerShell and Docker
Desktop with Linux containers:

```powershell
powershell -NoProfile -File tools/check-local.ps1
# Focused feedback:
powershell -NoProfile -File tools/check-local.ps1 -Scope Viewer
powershell -NoProfile -File tools/check-local.ps1 -Scope Windows
powershell -NoProfile -File tools/check-local.ps1 -Scope Runtime
```

Install Node.js 26.10.0 and Docker before running. The runner mirrors the three
jobs in `.github/workflows/checks.yml`, stops on failure and retains a transcript
under `data/reports/local-checks/`. Archive that transcript with ticket evidence.
Docker build caches and installed dependencies are retained. Runtime containers
use `--rm`; the retirement check manages its own disposable fixtures and receipts.
After any failed attempt verify cleanup under the procedure below. Viewer and
Windows scopes allocate no Docker resources. These checks do not replace the
change-specific actual-sample, browser, QGIS or physical-device gates below.

Start with the affected row. Development checks give feedback while editing;
final acceptance establishes ticket completion after review fixes. Combine rows
when a change crosses boundaries. Ticket-specific acceptance criteria still apply.

| Change | During development | Final acceptance |
| --- | --- | --- |
| Documentation only | Documentation link check on changed files | Link check; verify recorded hashes when completing existing evidence |
| Mockup CSS / layout | Affected scenario and viewport, selected screenshots | Complete mockup matrix in Chrome and Edge; visually inspect smallest portrait/landscape, both fonts and basemaps |
| Mockup interactions | Affected base, mobile-controls or landscape scenario | Complete browser matrix and relevant visual inspection |
| Mockup projection geometry | Projection scenario and independent PROJ comparison | Complete browser matrix and independent PROJ; preserve numerical tolerances |
| Publication / worker / GeoServer | Focused scenario in the existing runner | Actual-sample T5; select combined gate below when applicable |
| Access policy / keys | T8 Development | Complete T8, including T5 |
| Request budgets / accounting | T9 Development | Complete T9, including T5 and T8 regression; full T8 if access policy changed |
| Recovery / tile cache | T6 focused scenario | T6 plus applicable publication/access gates |
| Retention / migration | T7 focused scenario | T7 plus applicable T5/T6 regressions |
| QGIS / scoped WMS | T11 Development and pinned desktop client | Two-phase T11 and desktop checks; full T8 if access policy changed |
| Integrated M3 | T12 Development with full-history prerequisites | T12 combines T5/T9/full T8/T11; add T6/T7 only for their change categories |
| Real browser GPU / native display | Focused native-display/interaction probe | Required actual-source, GPU and device matrix from the ticket; mockup checks do not establish this |
| Process launcher only | Windows process check and read-only Compose command | Same checks; startup-order/publication behavior changes also require T5 |
| Retirement helper | Existing real disposable-resource check | Same check, including failed archival and unrelated-resource preservation |
| Evidence checker | Its synthetic positive/negative tests and affected archive | Entire archive-checker test file and affected historical archive checks |

Use the smallest existing combined service gate covering the change. Record the
included regressions rather than rerunning separate chains already included.
Keep locked dependencies and reusable images/build caches; allocate fresh isolated
service projects only for checks that need services. The mockup needs only a
local browser: no Docker, server, network or build.

## Iteration and reruns

1. Select the scenario and viewport before editing; use
   `node tools/check-weather-prototype.mjs --plan --scenario=landscape --viewport=640x360`
   to inspect the scope without creating test resources.
2. During implementation and after a failed check, run the affected scenario.
   Capture the failure and actual value; resolve unexplained failures before
   final acceptance. Keep each attempt in a fresh report directory.
3. Complete review and its fixes, then freeze inputs and run the required complete
   acceptance matrix once. A focused pass remains Development evidence.
4. If a validated runtime input, runner or configuration changes afterwards,
   rerun the affected complete gate on the new frozen inputs. Documentation-only
   completion edits need link/hash checks. Reuse unrelated historical evidence
   with its recorded input identities; do not combine incompatible phases.
5. Archive each attempt and clean up only resources it created, including failed
   attempts. Browser checks retire their own browser/profile. Docker checks use
   the project retirement procedure. Resource-free checks record that no test
   resources were created. Preserve the user's windows, source data and caches.
6. After acceptance, evidence and cleanup, make one ticket commit, push once,
   verify remote HEAD, then close/read back the completed ticket under
   [ticket completion](../AGENTS.md#ticket-completion).

Measure runner `timing_ms` (preparation, browser startup, checks, cleanup and
total) when comparing focused/full checks. Report the browser/host, changed
fixture and cache scope. These measure validation overhead, not application
rendering performance or a production guarantee.

## Validation

### Browser prototypes

Read [browser checks](development/browser.md) for mockups, visual approval,
native interaction diagnostics and physical-device ownership. Commands for
scenario/viewport/screenshot selection are in the
[mockup opening instructions](prototypes/weather-map.README.md#выборочные-проверки).

### Service checks

Read [service checks](development/services.md) for Compose gates, process runners,
recovery, retention and budget review. For desktop work, read
[QGIS checks](development/qgis.md).

### Before starting final acceptance

Read [acceptance preparation](development/acceptance.md) before expensive or
byte-bound acceptance: prerequisites, frozen inputs, Git filters and failure logs.

## Specification updates

For specification changes and documentation checks, read
[specification updates](development/specification.md).

## Test environment cleanup

For each check, archive its evidence and verify cleanup of resources it actually
allocated. Read [the cleanup procedure](development/cleanup.md) when allocating
Docker resources or changing the retirement helper. Documentation/CLI unit checks
allocate no Docker project and require no Compose retirement.

## Scientific contracts and evidence

For encoding, CRS, numerical sampling or evidence changes, read
[scientific contracts and evidence](development/scientific.md).

## Issue tracking

For issue reads, mutations, permission failures and final state verification,
read [issue tracking](development/tracking.md).

## Retrospective basis

Historical reasons and failure records are retained in
[workflow retrospectives](evidence/workflow-retrospectives.md). Consult the
relevant record when diagnosing that failure class.
