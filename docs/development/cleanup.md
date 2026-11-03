# Test environment cleanup

## Failed-job cleanup in a retained live stand

When an operation fails before catalogue switching, preserve the running stand
and compare its selection identifiers with the pre-operation snapshot. Inspect
the exact job state and its unreferenced attempt; `recovery.collect` otherwise
considers all jobs. A scoped adapter must retain the complete published revision
and catalogue reference graph and limit only the candidate job query. Use the
cursor's full `execute`/`fetchone`/`fetchall` interface when adapting that query.

Before mutation, resolve the stand's worker DB credentials, GeoServer admin
credentials and `MOSAIC_PASSWORD` through its existing configuration; retain
values in memory. Validate the preview's exit status and candidate ownership,
archive its report, numerical manifests, validation and workspace names, then
apply the same scope. Record private generated GIS files separately: `.properties`
can contain credentials, and generated sample files can be unreadable to the worker.
The archive boundary should cover scientific metadata without copying private
GIS configuration. A failed preview ends the sequence before archive/apply;
use the existing checked-process wrapper or check `$LASTEXITCODE` after each native
command in PowerShell.

Completion requires no remaining candidates for that job, retired temporary
containers/workspaces, and an unchanged published selection set. The
[#85 retrospective](../validation/retrospectives/retro-wind-nodata.md) records
the completed scoped cleanup and the adapter failures that led to these checks.
This is separate from retiring an isolated test project below.

## Isolated test projects

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

For nested CLI-operation reports on Windows, keep their archive root separate
from the service report tree. Retirement adds its own project/archive prefix;
a path usable by Node can exceed PowerShell Copy-Item's limit after that copy.
The revisions CLI fixture demonstrates this layout in
[check-hmc-revisions-service.mjs](../../tools/check-hmc-revisions-service.mjs).
If copying already failed, preserve that partial archive, copy the reports
with the verified Node archive helper, then shorten only the task's report
layout and retry retirement. Removal still requires a successful receipt.

Before publishing a frozen-input archive, compare its complete input manifest
with the copied files, not just the retirement receipt. Retirement selects report
extensions; T13's initial copies retained 24 of 172 inputs. Copy any missing
source/runtime bytes from the start snapshot and verify their recorded SHA256
before removing that snapshot. The existing
[T13 verifier](../validation/archives.md) checks every frozen input independently
of the report-only retirement index.

Keep external historical evidence unchanged. Copy completed report/input snapshots
and retirement receipts into `HMC_EVIDENCE_ROOT`; commit only the compact
[validation record](../validation/evidence-storage.md). Local report directories and
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
