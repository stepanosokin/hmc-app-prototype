# Test environment cleanup

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
