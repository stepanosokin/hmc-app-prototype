# T3 / M1 numerical adapter comparison — 2026-10-19

Ticket: [#15](https://github.com/stepanosokin/hmc-app-prototype/issues/15). Accepted bilingual v0.2 and parent #12 remain unchanged. This record covers the user-approved local numerical HTTP comparison; GeoServer/QGIS publication compatibility remains a separate real-service gate, as explicitly approved in the same reply.

## Decision and limits

Select the **narrow HTTP adapter over the shared manifest-backed Zarr sampler** for the prototype's domain point and bounded EDR position profile. Both candidates passed the numerical/policy checks and agreed local performance limits. The narrow path needs less framework-specific integration for this small surface, and its observed latency, throughput and worker RSS support that choice. These short workstation trials do not establish a universal speed ranking, production capacity or SLA.

GeoServer retains temporal WMS/ImageMosaic portrayal and QGIS delivery. An all-GeoServer numerical path was considered in [the comparison](../../adapter-comparison.md): the checked Coverages path reuses WCS and does not demonstrate the required Zarr-sampler/EDR contract. It was not assigned a fabricated performance result. Martin/vector publication, numerical raster downloads, time-series and cube remain deferred. Both comparison candidates exist only in isolated trial tooling; this does not deploy two production API engines.

## Agreement, environment and reproducibility

The repository owner explicitly approved this workstation's Docker environment, the proposed resource/latency envelope and the real gateway HTTP seam **before measurements**. [The agreement](../../../trials/agreement.json) references that reply and records its receipt time separately from any user-authored timestamp. The [original pending template](../../../trials/agreement.pending.json) remains pending and still fails the preflight.

Host: Docker Desktop 4.54.0, engine 29.1.2, Linux/amd64, WSL2 6.6.87.2-microsoft-standard-WSL2, AMD Ryzen AI 9 HX 370 (12 cores / 24 logical processors), 33,160,323,072 bytes available to Docker, overlayfs. Actual data are on an isolated Docker named volume, not served from the Windows source bind mount. [Host snapshot](host.json) and [resolved Compose configuration](compose-config.json) freeze the execution settings.

Each candidate: **2 CPUs / 2 GiB / one Gunicorn sync worker and thread**, PID limit 64. Both use the same image and Python 3.12.12 base digest, original T2 hash lock and additional pygeoapi 0.24.0 / Gunicorn 23.0.0 hash lock. Native BLAS/OpenMP threads are fixed to one; Zarr asynchronous concurrency and executor workers to four. The common gateway has one worker/eight threads, 1 CPU/512 MiB; load generator 2 CPUs/1 GiB and four request threads. Backend and raw-asset ports are not published to the host; the trial network is internal. Reader mounts and container root filesystems are read-only. Only fixture/test control and report volumes are writable.

Agreed limits: point p95/p99 ≤250/500 ms, metadata p95/p99 ≤100/250 ms, at least 10 successful requests/s at concurrency four, and zero errors in the valid-request workload. Domain and EDR point percentiles are checked **separately**. Expected 4xx/503 behavior is tested separately and never counted as successful throughput.

Run from the repository root in PowerShell:

```powershell
./trials/run.ps1
docker compose -f compose.adapters.yaml run --rm typecheck
# Demonstrate that an unapproved proposal still cannot authorize measurements:
docker compose -f compose.adapters.yaml run --rm preflight /app/trials/agreement.pending.json
# Stop the isolated comparison services after inspection (retain evidence/data):
docker compose -f compose.adapters.yaml down
```

The runner builds the locked image, verifies the agreement, prepares/rechecks real data, exercises real stopped-backend failures and validates the HTTP seam. It then alternates candidate order across three repetitions, recreating candidate and gateway for each and stopping the other candidate. Every measured request is checked for numerical/selection meaning, not just HTTP 200. The correctness record is bound to source/lock/baseline/catalogue hashes; a mismatch prevents timing. Actual cgroup CPU/RAM limits are checked before measurement.

Each repetition sends first metadata/domain/EDR operations separately, 50 warm-up requests, then **1,000 requests: 400 domain points / 400 EDR positions / 200 metadata**, seed 15, all 24 sample times and fixed baseline cells. [The exact request corpus](request-corpus.json) fixes paths, parameters, expectations and request order. Cold here means first operations after **process restart**; startup integrity verification and OS page cache are separate. Metadata precedes domain, which precedes EDR; prior operations are recorded. No OS-cache-cold claim is made, and no shared host caches were dropped. First-operation samples are checked against the operation's p99 bound but are too few to infer cold-start percentiles. Compose recreation-to-health duration includes polling/container overhead and is not point latency.

## Correctness and compatibility

The actual input remains `ICON_EU_T_G_2026101500.grib2`, SHA256 `dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`, 26,658,586 bytes. The real test manifest revision is `40340e8fe7243219983b8fbcf3290ae22f50c1e14c377a39a097cba31e66dab4`, matching corrected T2. Temperature/mask chunks are 256×256, explicit Zarr format 2; full dtype/codec/chunk metadata and lock hashes are in each repetition report. No quantization or COG/overview sampling is substituted.

Both candidates call the **same `ManifestSampler.sample`**. The pygeoapi path invokes its actual released EDR request parser/provider and metadata generator, with project integration for exact selection and run/revision extensions. The narrow path implements the same bounded response meanings directly. All 24 hours × six independent archived ecCodes reference cells agree exactly, including provenance, source, native cell, units and selection. The synthetic supplement introduces two nodata cells and is explicitly labelled; the actual sample has none. A second synthetic availability revision reuses real immutable assets and advertises only 12 times; it is never described as a producer correction or published revision.

Eight real HTTP contracts cover domain/EDR equality, scoped metadata, masks and footprint/tie behavior, malformed/unavailable selections without fallback, bounded EDR query types and CRS, failed refresh preserving old readers, auth/quota/revocation before cache hits and secret-free usage records, and catalogue withdrawal/invalid-update cache histories. The real gateway returns 503 when either backend is stopped: [narrow](unavailable-narrow.json), [pygeoapi](unavailable-pygeoapi.json). Caches use the backend's accepted generation; storage is bound to the generation used by the actual upstream response, avoiding a probe/forward update race.

The numerical trial advertises the native sphere `urn:hmc:crs:icon-sphere-6371229`, longitude then latitude, with its explicit definition. EPSG:4326 requests are rejected rather than mislabelling the data or implying an unproven datum transform. Run/revision are project query extensions; no Instances or deployed OGC conformance is claimed. This native-coordinate trial does not discharge the later external-CRS/QGIS compatibility gate.

The final full suite **passed all 17 tests**: eight HTTP contracts and nine existing decoder/storage contracts. The latter re-decode the actual source, compare all 21,712,536 cells through Zarr/Xarray/COG readers, verify masks, identity and geometry, and reject corruption/truncation. Pinned mypy checking passed for all 17 source files. [T1/A1 evidence](../t1/validation.md), [T2/A2 evidence and retained CRS failures](../t2/validation.md), [premeasurement correctness](correctness.json) and [full validation](full-validation.json) accompany this record. Toolchain compatibility here is local and operation-specific, not certification of the future GIS deployment.

## Measurements

The six final per-request reports are [narrow 1](narrow-1.json), [2](narrow-2.json), [3](narrow-3.json), [pygeoapi 1](pygeoapi-1.json), [2](pygeoapi-2.json), [3](pygeoapi-3.json). They record the exact image, source/data fingerprint, input/lock/corpus hashes, first/warm phases, every measured request, errors, body bytes and before/after telemetry. [Summary](summary.json) evaluates all repetitions and operations against the agreement.

| Candidate / rep | Domain p50 / p95 / p99 ms | EDR p50 / p95 / p99 ms | Metadata p50 / p95 / p99 ms | Successful req/s | Errors |
| --- | --- | --- | --- | ---: | ---: |
| narrow / 1 | 19.45 / 27.08 / 32.75 | 20.98 / 28.96 / 36.83 | 19.44 / 25.61 / 27.34 | 188.32 | 0 |
| narrow / 2 | 19.70 / 27.04 / 35.98 | 21.03 / 30.49 / 40.05 | 19.54 / 25.31 / 34.96 | 185.16 | 0 |
| narrow / 3 | 19.54 / 27.62 / 36.84 | 20.89 / 30.38 / 40.23 | 19.59 / 26.05 / 30.51 | 186.14 | 0 |
| pygeoapi / 1 | 20.45 / 27.11 / 30.35 | 23.18 / 29.28 / 34.99 | 21.18 / 25.83 / 29.94 | 179.22 | 0 |
| pygeoapi / 2 | 20.85 / 27.60 / 37.68 | 23.79 / 29.93 / 36.98 | 21.43 / 25.12 / 32.60 | 175.61 | 0 |
| pygeoapi / 3 | 20.44 / 27.42 / 42.74 | 23.44 / 30.80 / 38.11 | 20.90 / 25.54 / 29.77 | 177.23 | 0 |

| Candidate / rep | Candidate CPU seconds | Worker RSS MiB | Logical worker read bytes | Worker block read/write bytes | Numerical visibility ms |
| --- | ---: | ---: | ---: | --- | ---: |
| narrow / 1 | 6.28 | 85.75 | 60251371 | 0 / 0 | 169.33 |
| narrow / 2 | 6.37 | 84.77 | 60251371 | 0 / 0 | 170.62 |
| narrow / 3 | 6.33 | 85.78 | 60251372 | 0 / 0 | 171.54 |
| pygeoapi / 1 | 6.50 | 117.08 | 60251373 | 0 / 0 | 173.46 |
| pygeoapi / 2 | 6.64 | 118.05 | 60251374 | 0 / 0 | 176.93 |
| pygeoapi / 3 | 6.59 | 118.61 | 60251374 | 0 / 0 | 170.27 |

Each repetition has 1,179,941 response body bytes for narrow and 1,209,141 for pygeoapi. All 6,000 warm requests succeeded with zero errors. The final image is `sha256:3a9f8e03ff9fe401cd7cf932f3b19b7c8bc842eef722d77d41fabcc15d92c815`; source commit `400aeec`.

Percentiles use nearest rank over semantically correct successful responses. They are per-operation/per-repetition, with 400 point samples or 200 metadata samples, not a long-running capacity test. Successful throughput is the total valid mixed-workload count divided by wall duration; per-operation observed rates in that mix are also recorded. Body-byte counts exclude HTTP headers/TCP/TLS; no TLS is used on the isolated internal network. Framework encodings can have different whitespace/metadata while preserving the agreed meaning.

CPU comes from cgroup usage deltas during the warm phase; 100% means one logical core and the candidate is limited to two. Worker RSS is `/proc/self/status`; cgroup current/peak memory is separately reported and includes different accounting/shared-page charges, so it need not exceed process RSS. Gateway resources are separate. `io.stat` is empty on this Docker/WSL2 host and is explicitly **unavailable**, not interpreted as zero. Worker `/proc/self/io` supplies logical read/write characters, syscall counts and block read/write bytes; cached reads can have nonzero logical bytes and zero block bytes. Those counters include worker handling/metrics probes and are not total host disk traffic or chunks read. No I/O-based performance claim is made.

Numerical catalogue visibility is measured by registering the synthetic availability revision through the isolated shared control volume, then requesting it through the gateway, while preserving old-reader availability and checking failed refresh. It includes manifest/asset verification. This is **not end-to-end GeoServer publication freshness**: `geoserver_publication_ms` remains null. The real Zarr/COG/GIS visibility transaction, retained-reader grace, external CRS, desktop QGIS and final organization access system remain M2/M3/M5 gates, as agreed by the user. They cannot be inferred from this report and must not be silently marked passed.

## Integration and maintenance trade-off

| Work | Narrow HTTP (selected) | pygeoapi trial |
| --- | --- | --- |
| Scientific identity and reads | Shared manifest resolver/sampler, immutable selections and provenance | Identical shared resolver/sampler; no scientific advantage from changing framework |
| Domain route | Direct shared selection/sample | Same direct project domain route; pygeoapi does not supply it |
| EDR position | Project CoverageJSON/profile validation and serialization | Custom provider plus request-context binding; stock framework does not forward the project run/revision extensions |
| Discovery and source CRS | Project metadata, scoped links, availability and native-coordinate profile | Framework metadata must still be scoped, fix native CRS handling and remove unsupported/default links/queries |
| Ongoing obligations | Own advertised discovery, OpenAPI, exceptions, encodings, external CRS and conformance tests in M3 | Own project extensions and plugin compatibility, plus upgrade/test the broader framework and its dependencies |
| Why choose it here | Small approved query surface, fewer framework-specific seams, both measured correctness and local limits pass | Relevant if broader standards/query support later removes more custom work; no measured benefit justifying mandatory use for the current surface |

Both trial paths deliberately use the same installed image/dependencies. Worker RSS differences reflect loaded code; these trials do not establish a smaller narrow production image or a maintenance-hours estimate. Selection rests on passing the agreed functional/resource envelope plus the concrete integration inventory, with the observed local timings as supporting evidence. Reopen the choice if M3 external profile/CRS compatibility fails or broader workloads justify another engine. Do not substitute vector benchmarks or claim a capacity multiplier from the sample.

## Retained failures and acceptance

[Failure/review history](failures.json) records the initial red HTTP tests, missing pygeoapi provider method/metadata fields, diagnostic native-thread exhaustion, interrupted fingerprint run, unavailable cgroup I/O and cache review failures. No failed compatibility result is relabelled as success; no storage/architecture substitution was made. [Earlier run summaries and checksums](prior-attempts.json) and [their raw archived reports](prior-attempts.zip) are retained separately and excluded from the final selection table. One earlier pygeoapi repetition delivered 76.05 successful requests/s while still meeting the agreed limits; all attempts are retained, reinforcing the absence of a production capacity claim. Reruns were triggered by fingerprint, telemetry and reviewed cache/gate changes, not by choosing favourable measurements.

The local T3 numerical comparison/selection scope is **complete**, with the [machine-readable decision](selection.json), final reports and passing validation. This supplies the numerical-adapter part of M1/A12; it does not finalize M3, close parent #12 or change the completed wayfinder map. GeoServer temporal WMS and deferred Martin are retained. Later publication/GIS/conformance obligations remain explicit. The isolated comparison containers/network were stopped after validation; fixtures and evidence were retained.
