# T6 / A6 publication recovery validation

Issue: [#18](https://github.com/stepanosokin/hmc-app-prototype/issues/18).
Status: **passed; #18's approved T6 slice is complete and ready to close**.

Selected final project: `hmc-publication-t6-verified2`, gateway
`http://127.0.0.1:8106`, explicit demo clock `2026-10-19T07:00:00Z`.
Source code was frozen at `9674df0`; exact input hashes, local image identity,
native process exits and the final report index are retained alongside this file.
Host: Windows / Docker Desktop Linux backend 29.1.2, x86_64, 24 configured CPUs,
33,160,323,072 configured memory bytes. These are correctness/recovery exercises,
not capacity or latency measurements.

## Acceptance evidence

| #18 requirement | Evidence |
| --- | --- |
| Local/read-only source delivery, producer signal or stability fallback | The runner uses a separate read-only input mount, passes a producer checksum for the detached-source case, and exercises the stability fallback for actual and malformed deliveries. The operator procedure explicitly says stable size is not proof of completeness. |
| Quarantine and preserved originals | `t6-quarantine.json`: partial, truncated and unsupported fixtures fail without catalogue additions; original managed bytes equal delivered bytes, diagnostics expose the failed stage/class and retries are disabled. |
| Checksum/pipeline idempotence and bounded recovery | `t6-idempotence.json`, `t6-failures.json`: duplicate submissions return one durable job, repeated processing adds no revision, real derivative/index failures retry, automatic retries stop at three attempts, and repaired jobs can be explicitly retried. Bounds and storage/cache budgets are documented in the operator procedure. |
| Interrupt decoding, normalization, derivatives, indexing and publication | `t6-crashes.json`: SIGKILL native exit -9 at nine worker stages, followed by successful restart/retry. No uncommitted selection is discoverable; guessing staged tile-metadata/revision URLs returns 404. A kill after commit does not duplicate the revision. |
| Keep prior publication, diagnostics and safely collect staging | `t6-crashes.json`, `t6-partial-job.json`: exact old native point, tile hash and WMS hash stay unchanged; a published hour remains usable when the next hour fails; dry-run/apply collection removes unreferenced assets and preserves the published graph. |
| Durable capture and recovery without producer retrieval | `t6-capture.json`: SIGKILL during copy and after original completion, durable job identity, resubmission/operator retry, redundant fragment collection and byte-for-byte original retention. `t6-restart.json`: another job publishes after its isolated source file is removed. |
| Numeric generation/readiness/metadata/cache recovery | `t6-crashes.json`, `t6-lazy.json`: tile, readiness and metadata interruptions retry; lazy generation/cache population return 503 with Retry-After 2, preserve old warm tiles and recover deterministically on the same URL. |
| Real Compose and immutable old readers after restart | `t6-restart.json`: actual PostgreSQL, API, gateway and GeoServer restart; old point/tile/WMS values/hashes remain identical, including regeneration from a cold API cache. |

## Validation commands

The selected run passed all 7 targeted recovery tests in 298.397 seconds, both
600-second-bounded source-capture recovery cases and all nine worker crash cases.
Every runner process exited 0, including real service restart, source removal,
legacy publication, typechecking (36 files), full suite (23 total: 14 executed,
9 intentional skips) and archived evidence checks. The full suite took 40.170
seconds. The final T6 archive is additionally checked after archiving; its
artifact index binds the final report bytes. The input snapshot predates only
the evidence-checker's T6-index extension and final documentation/archive.

```powershell
powershell -NoProfile -File publication/run-recovery.ps1 -Project hmc-publication-t6-verified2 -Port 8106
powershell -NoProfile -File publication/run-revisions.ps1 -Project hmc-publication-t5-t6-regression1 -Port 8105
powershell -NoProfile -File tools/check-publication-process.ps1
```

The T5 regression's targeted acceptance and real-service restart passed: all 24
actual times, late batches, missing times, overlapping runs, +1 K corrections,
old-revision readers and real tile/index failures. It retained 28 unique batches
and 28 revision manifests. Its initial full suite exposed a changed generic 503
JSON description; the established text was restored, affected services restarted,
and `review-full-suite` passed (23 total, 14 executed, 9 intentional skips), as did
`review-types` (36 source files). The original failed probe remains archived.

The full suite skips T5/T6 acceptance unless their dedicated environment is
enabled; both run separately against their isolated real services. The archived
T4 failure test also needs historical job IDs; its recovery responsibility is
exercised by the T6 real failures above. The Windows launcher check passed native
exits 0/7, spaced paths/arguments and captured stdout/stderr.

## Scope and limitations

The actual source remains the approved 26,658,586-byte sample, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Malformed inputs are explicitly synthetic supplements. Engine selection reuses
the exact approved T4 v2 decision and its bound browser/GeoServer probes; this
work makes no new encoding, CRS or dependency decision.

Local A6 recovery does not establish desktop QGIS compatibility, new GPU/browser
performance, retention/expiry (#19), organization-host compatibility, production
sizing or capacity. No such new gate is claimed for this slice. Parent #12 and
the completed wayfinder map were unchanged. Issue #18 was read back as open;
closure has not been authorized.
