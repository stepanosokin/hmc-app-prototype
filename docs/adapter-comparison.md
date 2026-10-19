# T3 / M1 numerical-adapter comparison

Ticket: [#15 — Compare numerical adapters and select one — M1 gate](https://github.com/stepanosokin/hmc-app-prototype/issues/15).

Status on 2026-10-19: **local envelope and HTTP seam approved; real equivalent trials implemented**. Results and the bounded numerical selection are recorded in [T3 evidence](evidence/t3/validation.md). The accepted bilingual v0.2 specification, parent #12 and completed wayfinder map are unchanged. Full GeoServer/QGIS/publication compatibility remains a separate real-service gate; M3 cannot be finalized from numerical trials alone.

## External prerequisite

The ticket requires identification of the measurement host and agreement on resource and latency thresholds **before measurement/selection**. The user explicitly authorized this workstation's Docker environment, approved the proposed envelope and approved the gateway HTTP seam before the executed trials. [The agreement](../trials/agreement.json) records that reply; the earlier [pending template](../trials/agreement.pending.json) remains unapproved.

Detected environment: Windows workstation, Docker Desktop 4.54.0, engine 29.1.2, Linux/amd64, WSL2 kernel 6.6.87.2-microsoft-standard-WSL2; Docker reports 24 logical CPUs and 33,160,323,072 bytes available RAM. This is not the agreed organization-controlled Linux deployment host. Resource inventory is not a capacity measurement.

Agreed local prototype envelope: identical 2 CPU / 2 GiB limits for each candidate, one worker each; point p95 ≤250 ms and p99 ≤500 ms; metadata p95 ≤100 ms and p99 ≤250 ms; at least 10 successful requests/s at concurrency 4; zero errors for the valid-request workload. Expected rejection requests are measured separately. First requests after process restart are reported separately and checked against the corresponding p99 bound; the three repetitions cannot establish a cold-start latency distribution. This is not a production SLA.

The preflight checks presence and numerical consistency of an actual agreement; it cannot authenticate the approval reference and does not prove correctness or performance. The measurement runner additionally requires a passing HTTP correctness record matching the current Python sources, dependency locks, baseline and manifest index/catalogue; it checks actual cgroup CPU/RAM limits against the agreement before timing requests.

```sh
docker compose -f compose.adapters.yaml build preflight
# Uses the explicitly approved agreement; the pending template still exits 1:
docker compose -f compose.adapters.yaml run --rm preflight
docker compose -f compose.adapters.yaml run --rm typecheck
# PowerShell, from the repository root; performs all setup and repetitions:
./trials/run.ps1
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

A real pygeoapi 0.24.0 EDR provider and a narrow Flask/Gunicorn HTTP adapter both call the existing `ManifestSampler.sample`. That boundary reads the Zarr numerical core directly; the Xarray reader's agreement is checked by the T2 round-trip suite. No different array reader or approximation is substituted between candidates. Each candidate reuses one verified sampler per immutable manifest with identical cache policy and startup integrity verification.

The approved observable seam is HTTP through the isolated real trial gateway. [HTTP contracts](../trials/test_http.py) compare both candidates against the archived ecCodes A1 baseline and each other at six cells for all 24 real valid times. They exercise native-cell boundaries, wrapped longitude, outside coverage, unsupported field, wrong run/revision, unavailable/malformed time, invalid coordinates, and the explicitly synthetic nodata supplement; the real sample has no nodata. The runner also stops each real backend to verify gateway 503 behavior. Test manifests retain their `validated-test` state throughout.

The two paths preserve exact run/revision/time/field, native-cell coordinate, units K, method, value/null reason and source/batch provenance. CoverageJSON retains selection identity. The trial explicitly uses `urn:hmc:crs:icon-sphere-6371229` (`+proj=longlat +R=6371229 +no_defs`), longitude then latitude in native degrees. It rejects a request for EPSG:4326 instead of implying that the source sphere has been transformed to WGS84. This bounded native-coordinate profile is **not proof of the eventual external EDR CRS or QGIS compatibility**. Run/revision are required query extensions; only position is advertised, with no Instances/cube/time-series or deployed-conformance claim. Full OpenAPI, landing/conformance resources and interoperable external CRS handling remain M3 obligations for the selected adapter.

Metadata availability and selection semantics agree; framework metadata/serialization can differ, and actual body bytes are measured. Both paths use one gateway implementation/configuration: fixture keys, revocation, organization minute budgets before cache lookup, bounded responses/timeouts, and usage records for success/cache hits/rejections. Tests exercise invalid/revoked keys and quota rejections after priming the cache. Backends/raw assets have no host-published ports. Benchmarks bypass the response cache on both paths. Trial policy is not evidence of a durable production organization access system; real publication/GeoServer/access-policy gates still require the later real services.

## Reproducible measurement protocol after agreement and correctness

1. Freeze the agreed host identity, OS/kernel/CPU/storage and Docker versions; container image IDs, CPU/RAM/PID limits, workers/threads, gateway settings and clocks. Use a separate Compose project/internal network and isolated test volumes, with read-only source and reader mounts. Keep the source and existing T1/T2 assets intact.
2. Save source/manifest/asset hashes, all chunk shapes/codecs, package locks and request corpus SHA256. Attach the [T1 A1 evidence](evidence/t1/validation.md) and [T2 A2 evidence](evidence/t2/validation.md), including retained CRS failures and the final corrected revision. Recheck the actual source and assets in the exact trial image before trusting prior results under the extended toolchain.
3. Use the same fixed seeded locations, all 24 exact hours, explicit run/revision and output format. Frozen mix: 80% point (evenly domain/EDR), 20% metadata, 1,000 requests/repetition, seed 15. Run errors/policy requests in a separate labelled corpus so expected 4xx responses cannot inflate successful throughput or hide failures. Series/cube experiments, if any, remain future workloads outside ranking.
4. Run each candidate separately in alternating order, at least three repetitions at the agreed concurrency levels. Separate startup/integrity verification, process-cold first request and warmed steady state. Restarting a container does **not** clear the host page cache; label OS-cache-cold only when a documented host procedure actually establishes it. Do not drop shared workstation caches without separate authorization. Record warm-up requests and cache state for each repetition.
5. Save every request's operation, status, elapsed time and response bytes; compute p50/p95/p99 per operation/cache phase/repetition with a declared percentile estimator. Report sample counts, wall duration, successful throughput and error count/rate; never compute success percentiles over failures. Capture cgroup CPU time, RSS/peak memory and block I/O deltas for gateway and candidate separately; identify page-cache/bind-mount effects and unavailable metrics instead of reporting zero.
6. Measure numerical catalogue visibility through the gateway with an explicit new revision, retained old reader and failed refresh; the trial implements that component measurement. Full publication-to-visible freshness additionally requires the actual Zarr/COG/GeoServer gate and remains **unmeasured** here. The user explicitly accepted keeping that real-service gate separate from this numerical comparison; M3 cannot be finalized without it.
7. Compare results against the agreed thresholds and record custom code/configuration, dependency/image footprint, run/revision routing, reload/restart behavior, OGC discovery/errors/encoding/profile obligations and ongoing maintenance. If either candidate fails correctness, retain evidence and review the affected decision; speed cannot compensate. Select exactly one based on the completed evidence and state the tie-breaking rationale. Do not deploy both trial candidates as the product.

## Acceptance/closure ledger

| #15 criterion | Current evidence/status |
| --- | --- |
| Agreed host/resource/latency thresholds | Explicit user reply recorded in `trials/agreement.json` before measurements. |
| Equivalent real adapters/shared sampler, masks/selection/errors/policy | Real pygeoapi and narrow HTTP paths, eight gateway contracts, independent A1 reference values and actual/synthetic fixtures. |
| Fixed budgets/versions/hashes/chunks/mix/workers, repeated cold/warm runs | Locked image, actual cgroup budget verification, frozen corpus, alternating repetitions and distinct first/warm phases; OS page cache uncontrolled and labelled. |
| Percentiles/throughput/errors/CPU/RSS/I/O/bytes/freshness/custom work | Per-request reports, per-operation gates, worker/cgroup telemetry and measured numerical catalogue visibility; full GeoServer freshness explicitly remains a separate gate. |
| One evidence-based selection, GeoServer retained, Martin deferred | Narrow HTTP selected for the bounded numerical profile; GeoServer WMS and Martin deferral retained. |
| Compatible toolchain and T1/T2 evidence in M1 exit | Locked dependencies and original A1/A2 evidence attached to the local [T3 numerical exit record](evidence/t3/validation.md); external GIS/profile gates remain open. |

The final T3 evidence supplies the local numerical comparison/selection part of M1/A12. It does not finalize M3 or imply successful publication/QGIS conformance. The user explicitly accepted keeping that real-service gate separate from this HTTP comparison. Parent #12 and unrelated milestones remain unchanged.

## Preparation history

2026-10-19, Docker environment identified above. `docker compose -f compose.adapters.yaml build preflight` passed with hash-required wheels and `pip check`. The full original decoder/storage suite passed **9 tests**, including actual-sample decoding and 24-field Zarr/COG round trips, synthetic-mask preservation, exact selection and damaged-source/asset rejection, in the extended toolchain. Test data were read-only under `/input`; generated fixtures used isolated `/tmp` inside the container, with networking disabled. Tests use their existing explicit `2026-10-19T00:00:00Z` clock. The reported test-run duration is not an adapter performance result.

The preparation-only commit `1a29b26` used image `sha256:7fec8cad3ca208c5a9d646ba6674b37b1e43aba6a0e2b7fc63efeb17a195cb37` and correctly rejected the then-pending agreement. HTTP tests were added only after the subsequent explicit seam approval. Preparation did not itself count as A12 or an M1 exit. Final measured image identities, validation and retained failures are in the [T3 evidence](evidence/t3/validation.md).
