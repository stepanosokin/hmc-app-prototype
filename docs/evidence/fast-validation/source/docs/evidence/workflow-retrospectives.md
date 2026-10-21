# Retrospective basis

These changes follow the [#16 review](t4/review.md),
[compatibility failures and final checks](t4/validation.md), and the
subsequent verified push/closure. They address missing CI coverage, delayed
discovery of hash/import-order failures, replaced configuration, repeated command
binding mistakes and the read-only connector. The existing runner and runtime
probe already cover process failure; CI wires them into routine checks rather
than introducing a second test framework.

The [#17 failed probes](t5/failed-probes.md) and
[validation](t5/validation.md) exposed a Windows process-launcher gap,
occupied-port/startup races and stale gateway workers. T5 already guards project
isolation, port availability and real service readiness. The Windows CI check
now exercises its shared launcher without Docker or private data; the retained
T5 hashes remain historical. The [review](t5/review.md) found no missing
coding standard; its two duplication findings were resolved in the code.

The [#18 failures](t6/failed-probes.md) and
[review](t6/review.md) exposed capture crash windows, unbounded source
hashing, uncollectable capture fragments and a changed public 503 body. Existing
capture and HTTP checks cover those behaviors; the workflow now brings them
forward and freezes inputs before final evidence. The subsequent
[retirement inventory](retirement/2026-10-19.json) records removal of
12 superseded stacks. Their retained networks exhausted Docker's address pool
during cleanup validation. Retirement now has a standing completion rule and its
existing real-resource check is wired into CI. The changes reuse behavioral
checks and keep project-specific guidance in this repository.

The [#19 review](t7/review.md) found reader starvation and mixed-source
backfill ordering defects; its existing upgrade and continuous-reader cases now
cover those behaviors. The [development evidence](t7/failed-probes.md)
also records a missing private input and a run rejected after input changes.
The session repeated T7 after running the focused public-error check late, so
prerequisites and that check belong before expensive final acceptance. T7's
artifact index was initially absent from the existing CI evidence checker; it
is now included in that same check. A disposable corrupted T7 report escaped the
old checker and is rejected by the updated one; the original archives pass.
Historical reports remain unchanged.

The [TLS planning session](tls-planning.md) exposed a documentation probe
that printed success after nonterminating PowerShell path errors, plus an issue
body serialized as an object. The documentation checker now fails on missing
targets or unreadable inputs and runs in the existing Windows CI job. The
specification pointer and plain-string issue-body recipe above address the
navigation and serialization failures without changing third-party skills.

The [T9 retrospective](retro-t9.md) links the failed probes and reviews
behind the budget-review, fixture timing and launcher guidance above. Existing
CI already covers mypy, process exits and evidence integrity; the changes improve
when those checks and the combined T9 gate are used. Historical evidence stays
bound to its recorded inputs.

The [T10 retrospective](retro-t10.md) ties the failed acceptance runs,
proven usage-migration deadlock, missing-array/chunk failures and late Git byte
check to the guidance above. Existing HTTP regressions, CI and evidence tooling
remain the checks; the workflow brings diagnostics and byte checks forward.

The [T11 retrospective](retro-t11.md) records a combined-runner fixture
failure, desktop negotiation/time-state defects and credential-bearing QGIS
diagnostics. Existing T11/T8 scenarios now supply the focused checks; their
runner, helper and archived evidence remain the implementation sources of truth.

The [T12 retrospective](retro-t12.md) connects full-history observer and
cache failures to focused-run prerequisites, and distinguishes a connector 403
from rejection of the fallback helper by approval review. Existing T12 scenarios
and CI remain the behavioral and mechanical checks.

The [T22 retrospective](retro-t22.md) records browser assertion/visual
differences, report overwrite risk and the missing T22 branch in the existing
evidence checker. The runner now defaults to ignored reports, and CI verifies
the accepted archive plus negative integrity cases. Visual approval remains
a separate human decision; the third-party skills stay unchanged.

The [T23a retrospective](retro-t23a.md) records late full-page timing,
quota-fixture interference, missing basemap inventory and archive-validator
coverage. Existing CI now checks native semantic rejection and input capture;
the accepted T23a archive remains bound to its historical source bytes.

The [T23 retrospective](retro-t23.md) connects discontinuous rotation,
physical touch-coordinate failures, browser discovery, retention admission and
verbose publication output to the focused checks above. CI now covers the new
archive indexes and replays the existing measurement-budget validator. Historical
evidence and the explicit Safari deferral remain unchanged.

The [T24 retrospective](retro-t24.md) records the missing landscape
matrix, closed-details measurement trap and focused/full report distinction.
The existing CI archive tests now reject incomplete layout evidence; browser
sources and accepted T22/T24 archives remain unchanged.
