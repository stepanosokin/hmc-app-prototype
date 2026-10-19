# T3 / M1 numerical-adapter comparison

Ticket: [#15 — Compare numerical adapters and select one — M1 gate](https://github.com/stepanosokin/hmc-app-prototype/issues/15).

Status on 2026-10-19: **preparation only; agreement pending; no benchmark or selection**. The accepted bilingual v0.2 specification, parent #12 and completed wayfinder map are unchanged. M1 remains open and M3 cannot be finalized. The dependency build is a compatibility probe, not a completed adapter trial.

## External prerequisite

The ticket requires identification of the measurement host and agreement on resource and latency thresholds **before measurement/selection**. The user has been asked; no answer has been recorded. Proposed numbers below are recommendations awaiting agreement, never test results or accepted requirements.

Detected environment: Windows workstation, Docker Desktop 4.54.0, engine 29.1.2, Linux/amd64, WSL2 kernel 6.6.87.2-microsoft-standard-WSL2; Docker reports 24 logical CPUs and 33,160,323,072 bytes available RAM. This is not the agreed organization-controlled Linux deployment host. Resource inventory is not a capacity measurement.

Proposed local prototype envelope: identical 2 CPU / 2 GiB limits for each candidate, one worker each; point p95 ≤250 ms and p99 ≤500 ms; metadata p95 ≤100 ms and p99 ≤250 ms; at least 10 successful requests/s at concurrency 4; zero errors for the valid-request workload. Expected rejection requests are measured separately. These proposed limits require explicit user agreement and do not establish a production SLA. Confirm whether the limits also apply to cold-start requests when agreeing the envelope.

Record the eventual agreement, its chat/issue reference and host identity in a copy of [the pending template](../trials/agreement.pending.json). Keep the pending template unapproved. Never fill approval fields on the user's behalf. The preflight checks presence and numerical consistency; it cannot authenticate an approval reference and does not prove any correctness or performance gate.

```sh
docker compose -f compose.adapters.yaml build preflight
# Expected exit 1 and status=blocked until an actual agreement is supplied:
docker compose -f compose.adapters.yaml run --rm preflight
docker compose -f compose.adapters.yaml run --rm typecheck
docker compose -f compose.adapters.yaml run --rm test
```

The trial toolchain extends the existing pinned Python 3.12.12 base and T2 dependency lock with pygeoapi 0.24.0, Gunicorn 23.0.0 and all resolved additional dependencies, each with a wheel SHA256. `pip check` is mandatory in the image build. [requirements.adapters.lock](../requirements.adapters.lock) supplements [requirements.lock](../requirements.lock); neither moving documentation nor a mutable local image tag is the execution lock. Record the image ID/digest used for every eventual run. Both candidates must use that same built image to isolate adapter overhead; dependency footprint differences need a separate explicitly labelled deployment-cost assessment.

## GeoServer for all publication tasks

The user's request includes considering GeoServer throughout publication. Assess each required operation independently:

| Operation | GeoServer option | Required evidence / implication |
| --- | --- | --- |
| Temporal portrayal and QGIS | Accepted ImageMosaic temporal WMS; optional GeoWebCache for raster tiles | Retain this role. Verify immutable run/revision filtering, discovery visibility, full-resolution identify, masks, native spherical CRS and WMS axis rules through the gateway and pinned QGIS. T1/T2 alone do not prove these. |
| Numerical point and EDR position | A custom GeoServer integration would need to call the identical manifest-backed Zarr sampler and provide the required EDR/CoverageJSON semantics | No equivalent built-in path was established in the checked official documentation. This is a capability gap to investigate, not a measured performance loss. WMS identify or a numeric COG is not equivalent to the accepted Zarr float64 point contract. |
| Coverage downloads / OGC API Coverages | GeoServer's documented community module exposes configured WCS coverages | Downloads remain deferred. The checked 2.28.x documentation describes an early draft and partial functionality; it does not establish the required EDR contract. Reconsider only with a pinned release/plugin and a demonstrated compatible path. |
| Discovery / publication visibility | Reuse GeoServer GIS discovery while a shared manifest remains authoritative for exact selection | A server catalogue alone does not coordinate Zarr durability, derivative/index readiness, retention or atomic availability. Prove the later publication gate before calling this successful publication. |
| Organization policy and accounting | GeoServer security can participate behind a shared gateway | Must prove identical key/limit/accounting policy before protected cache delivery and prevent backend bypass. Installing GeoServer does not demonstrate this project contract. |
| Future vector publication | Evaluate GeoServer Features when representative vector data arrive | Outside T3; keep Martin deferred. No vector benchmark may rank numerical array serving. |

An all-GeoServer deployment might reduce servers/catalogues to maintain, but the required numerical integration still needs evidence and custom work. Do not silently replace the accepted numerical core or substitute WCS/WMS for EDR. If an equivalent GeoServer path is demonstrated, record an explicit affected-decision review before changing the approved two-candidate comparison. No GeoServer candidate is rejected on an unmeasured speed claim.

Official sources checked 2026-10-19: [GeoServer Coverages](https://docs.geoserver.org/stable/en/user/community/ogc-api/coverages/index.html) (returned 2.28.x documentation: WCS reuse, early draft, partial coverage support); [GeoServer NetCDF output](https://docs.geoserver.org/stable/en/user/extensions/netcdf-out/) (WCS output, not EDR); [pygeoapi plugins](https://docs.pygeoapi.io/en/stable/plugins.html) (returned 0.24.0, custom EDR provider seam); [pygeoapi EDR](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-edr.html). Moving URLs are capability references, not tested release artifacts. The installed pygeoapi 0.24.0 source is the provider-interface reference for the forthcoming trial. This comparison does not claim product or deployment conformance.

## Equivalent correctness gate before timing

Implement a real pygeoapi EDR provider and a narrow HTTP adapter which both call the existing `ManifestSampler.sample`. The latter already reads Zarr directly and is the accepted shared numerical boundary; do not change scientific reads just to make an adapter appear faster. Each candidate reuses one verified sampler per immutable manifest with identical cache policy and startup integrity verification.

The proposed observable seam is HTTP through an isolated trial gateway; user confirmation is pending. Compare both candidates against independent ecCodes/T2 expected values, not just against each other. Exercise all 24 real valid times, native centres and boundary ties, wrapped longitude, outside coverage, unsupported field, wrong run/revision, unavailable and malformed time, invalid coordinates and transient failure. Include the explicitly synthetic two-cell nodata supplement; the real sample has no nodata. Never relabel a validated-test manifest as a published revision.

Check the domain point and EDR position meanings: exact run/revision/time/field, native-cell coordinate, units K, method, value/null reason and source/batch provenance. CoverageJSON must retain selection identity and describe the query CRS explicitly. Do not pretend the native source sphere is already a proven WGS84 transformation. Validate the native-CRS/GIS issue before accepting that compatibility gate. For EDR, document run/revision query extensions and support position only; do not advertise Instances, cube, time-series or unimplemented conformance classes.

Check metadata semantics and availability rather than requiring byte-identical framework-generated links. Use one gateway implementation/configuration, identical key handling, quota decisions, response limits, timeout and cache policy. Test invalid/revoked keys and quota rejections, including any cache hits; backends and raw assets have no host-published ports. Trial policy is not evidence that the eventual organization access system is complete. Real publication/GeoServer/access-policy gates must run with real services, not mocked responses.

## Reproducible measurement protocol after agreement and correctness

1. Freeze the agreed host identity, OS/kernel/CPU/storage and Docker versions; container image IDs, CPU/RAM/PID limits, workers/threads, gateway settings and clocks. Use a separate Compose project/internal network and isolated test volumes, with read-only source and reader mounts. Keep the source and existing T1/T2 assets intact.
2. Save source/manifest/asset hashes, all chunk shapes/codecs, package locks and request corpus SHA256. Attach the [T1 A1 evidence](evidence/t1/validation.md) and [T2 A2 evidence](evidence/t2/validation.md), including retained CRS failures and the final corrected revision. Recheck the actual source and assets in the exact trial image before trusting prior results under the extended toolchain.
3. Use the same fixed seeded locations, all 24 exact hours, explicit run/revision and output format. Proposed mix: 80% point (evenly domain/EDR), 20% metadata. Freeze that mix and worker/load-generator counts before timing. Run errors/policy requests in a separate labelled corpus so expected 4xx responses cannot inflate successful throughput or hide failures. Series/cube experiments, if any, remain future workloads outside ranking.
4. Run each candidate separately in alternating order, at least three repetitions at the agreed concurrency levels. Separate startup/integrity verification, process-cold first request and warmed steady state. Restarting a container does **not** clear the host page cache; label OS-cache-cold only when a documented host procedure actually establishes it. Do not drop shared workstation caches without separate authorization. Record warm-up requests and cache state for each repetition.
5. Save every request's operation, status, elapsed time and response bytes; compute p50/p95/p99 per operation/cache phase/repetition with a declared percentile estimator. Report sample counts, wall duration, successful throughput and error count/rate; never compute success percentiles over failures. Capture cgroup CPU time, RSS/peak memory and block I/O deltas for gateway and candidate separately; identify page-cache/bind-mount effects and unavailable metrics instead of reporting zero.
6. Measure publication-to-visible freshness through the gateway with an explicit new run/revision and retained old reader, not a process timestamp or a generated manifest alone. Include failure injection and unchanged previous availability. This requires the actual publication/GeoServer gate; until available, freshness stays **unmeasured** and closure stays blocked where required.
7. Compare results against the agreed thresholds and record custom code/configuration, dependency/image footprint, run/revision routing, reload/restart behavior, OGC discovery/errors/encoding/profile obligations and ongoing maintenance. If either candidate fails correctness, retain evidence and review the affected decision; speed cannot compensate. Select exactly one based on the completed evidence and state the tie-breaking rationale. Do not deploy both trial candidates as the product.

## Acceptance/closure ledger

| #15 criterion | Current evidence/status |
| --- | --- |
| Agreed host/resource/latency thresholds | Host detected; proposals sent; **external agreement pending**. |
| Equivalent real adapters/shared sampler, masks/selection/errors/policy | Existing sampler/T2 evidence available; **HTTP adapters and equivalence trial not implemented or validated**. |
| Fixed budgets/versions/hashes/chunks/mix/workers, repeated cold/warm runs | Additional dependency lock/build prepared; protocol above; **execution configuration and runs pending**. |
| Percentiles/throughput/errors/CPU/RSS/I/O/bytes/freshness/custom work | Reporting requirements defined; **unmeasured**. |
| One evidence-based selection, GeoServer retained, Martin deferred | GeoServer applicability considered; **no selection**, accepted WMS and Martin deferral unchanged. |
| Compatible toolchain and T1/T2 evidence in M1 exit | Locks, earlier evidence and local extended-toolchain checks linked; **adapter compatibility and final M1 exit still required**. |

Do not close #15 based on this preparation. Required work includes agreement, both real adapter paths, gateway correctness/access checks, agreed-host operational measurements and any stated GeoServer/publication/QGIS compatibility evidence, then one supported selection and the final M1 exit record. Parent #12 and unrelated milestones remain unchanged.

## Executed preparation checks

2026-10-19, Docker environment identified above. `docker compose -f compose.adapters.yaml build preflight` passed with hash-required wheels and `pip check`. The full original decoder/storage suite passed **9 tests**, including actual-sample decoding and 24-field Zarr/COG round trips, synthetic-mask preservation, exact selection and damaged-source/asset rejection, in the extended toolchain. Test data were read-only under `/input`; generated fixtures used isolated `/tmp` inside the container, with networking disabled. Tests use their existing explicit `2026-10-19T00:00:00Z` clock. The reported test-run duration is not an adapter performance result.

The final preparation image is `sha256:7fec8cad3ca208c5a9d646ba6674b37b1e43aba6a0e2b7fc63efeb17a195cb37`; the full original suite ran in its predecessor `sha256:656cff1569f824d80977acbaa70277a39b2bbd4ab7fb976c205e28cea1ee0b3c`, with identical locks and decoder/test files. Only agreement validation changed subsequently. Final type checking passed for all eight source files. The final preflight returned exit 1 / `blocked` / no selection for the pending template, as required. No HTTP test files were added while the proposed seam awaits confirmation. This is a preparation record, not A12, a publication result, or an M1 exit.
