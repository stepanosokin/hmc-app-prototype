# T5 — incremental publication and retained revisions

Issue: [#17](https://github.com/stepanosokin/hmc-app-prototype/issues/17).
Local validation date: 2026-10-19. Scope: T5 / M2, server portion of A5.

## Reproduction and inputs

`publication/run-revisions.ps1 -Project hmc-publication-t5-verified4 -Port 8101 -SkipBuild`
used independent persistent PostgreSQL, immutable-asset and GeoServer volumes,
random local secrets and the explicit submission clock `2026-10-19T05:00:00Z`.
The publication image was built immediately before these attempts, from the
existing SHA256 wheel locks and digest-pinned Linux/amd64 containers. Runtime
publication/test sources are read-only bind mounts, as recorded by input hashes.
Docker Desktop 29.1.2, x86_64, 24 CPUs, 33,160,323,072 configured memory bytes;
this Windows workstation is not the agreed operational Linux host.

Actual source: `ICON_EU_T_G_2026101500.grib2`, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
All 24 actual times were checked against the independent retained T1 ecCodes
representative values through the gateway. T2's Zarr/COG checks remain in the
locked full suite. The frozen v2 native-sphere/WGS84 operation and selected
project-bilinear/f32 engine were unchanged; the copied T4 decision binds its
original successful browser, engine and GeoServer probes by hash. This is reuse
of that measured configuration, not a new GPU/client compatibility claim.

## Acceptance evidence

The T5 gateway scenario passed in **122.192 seconds**. The process returned **0**.
Its observations and exact identities are in `t5-acceptance.json`.

- One validated actual time was usable with completeness explicitly unknown.
  Omitting 02 while adding 03 produced exactly the advertised 01/03 time domain;
  point/WMS rejected absent 02 and guessed numeric selection URLs returned 404.
- Late 02 produced another revision; repeated identical delivery reused its
  batch and revision. Default all-time ingestion added remaining actual times
  incrementally while the gateway observed usable intermediate revisions.
- Explicit synthetic overlapping run and +1 K correction supplements remained
  labelled in catalogue and provenance. Corrected point and full-resolution
  GeoServer identify agreed with **299.2274169921875 K**. The pinned original
  remained **298.2274169921875 K** during and after publication.
- Numeric representative responses matched durable eager SHA256s and ETags.
  Old-revision bytes remained equal; a correction changed bytes; reused batches
  had equal bytes under new revision URLs. Non-representative lazy generation
  remained deterministic. Rendered identity separately includes style/options;
  numeric identity has no palette/shader dependency.
- Real missing durable tile metadata and a nonexistent PostGIS mosaic schema
  rejected new publication. A job publishing 04 then failing readiness for 05
  kept 04 usable and reused the previously published 05, without exposing its
  failed replacement. Other retained revisions remained unchanged.

After real database/API/GeoServer restart, retained point and numeric bytes
remained equal and every revision's gateway capabilities advertised its exact
manifest time set. Rechecks of all **28 unique T5 batches** against actual
GeoServer confirmed positive/negative granule counts **[1, 0]**, a single exact
batch time/layer, visible maps and full-resolution native-cell identify within
the separate **0.0001 K COG bound**. The graph evidence contains **28 revisions**;
their manifests are **611–7,781 bytes**, listing reused immutable batch
references rather than copied run assets. See `t5-restart-and-manifests.json`.

The runner additionally published a legacy T4 selection to exercise the original
gateway/point/numeric/WMS and real post-publication backend-outage tests.
Historical T4 rows, evidence and the original accepted Compose project were not
modified. Native interpreter probes checked both relevant import orders and
returned zero. Type checking also passed after the two review-stage extractions.
The full suite returned **0**: **16 tests, 14 passed, 2 explicitly skipped**, in
40.955 seconds. T5's stateful acceptance test was already run separately and is
skipped in the final non-mutating pass; the archived T4 job-ID-specific assertion
is skipped because this independent project does not supply T4's old job cases.
T5 exercises the real metadata/index failure behavior itself. The original
23 archived evidence references passed before archiving the new T5 evidence.
After archiving, the extended integrity check verified **38 references**,
including all 15 T5 report/input artifacts, with native exit **0**. Historical
input snapshots are checked against their recorded bytes, never a future
dependency lock or later source revision.
`process-results.jsonl` and the full-suite log record native process outcomes.

## Limits and disposition

This completes #17's approved incremental server-publication slice. It does not
complete the parent issue, M2/M3, all of A5, delayed browser decode/upload or
navigation races (#25–#26), authenticated desktop QGIS, retention/retry
policy, producer datum confirmation or operational capacity. No encoding,
resampling, CRS or dependency agreement was changed. The failed probes are
retained in `failed-probes.md`; the two-axis review is in `review.md`.

No parent issue, wayfinder map, milestone or issue state was changed. #17 is ready
to close when its owner accepts the retained server-slice evidence.
