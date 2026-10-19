# Retained T6 development failures

These are implementation/recovery probes, not failed encoding, geodetic or
scientific compatibility decisions. The frozen v2 contract, selected engine,
numeric encoding, dependency locks and approved architecture were retained.
Preliminary projects/reports and service volumes remain under
`data/reports/t6/`; their inputs changed during development, so they are not
the selected final A6 evidence.

| Probe | Observed failure | Resolution |
| --- | --- | --- |
| First idempotence test, `hmc-publication-t6-red1` | Native exit 1; CLI rejected `--recoverable` with exit 2 | Added durable recoverable submission. Original runner stderr is retained as `rejected-idempotence.stderr.log`. |
| Initial manual crash test invocation | `ModuleNotFoundError: tests.test_publication_recovery` | Used unittest discovery, matching the existing test layout. |
| Readiness/metadata interruption, `hmc-publication-t6-red1` | Retry failed with real GeoServer `409` while creating an existing workspace | Isolated every attempt's workspace and PostGIS index; collection removes abandoned identities. |
| Initial lazy fault test | Faulted lazy numeric tile returned 200 instead of expected 503 | Added bounded atomic cache population, generator slot, fault exercise and transient response. |
| Capture review reproduction, preliminary `green1` | SIGKILL test found no durable capture marker/job before copying completed | Registered capture intent first and added bounded capture/read deadline and resume. |
| Review follow-up | Interrupted capture fragments could accumulate outside collection | Verify redundant fragment bytes against the retained complete original before collecting. |
| T5 regression full suite and preliminary `verified1` full suite | Existing sanitized-service-error test failed: JSON description had gained `; retry same selection` | Restored the existing JSON description, kept Retry-After/no-store headers and restarted API/gateway before repeating HTTP checks. Original failing stderr is retained as `rejected-full-suite.stderr.log`. |

The selected `verified2` run was started after the review fixes and source freeze.
The T5 regression repeat uses `review-full-suite` and `review-types` process
records; successful T5 acceptance and restart reports are retained separately.
