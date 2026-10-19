# Hydrometcenter meteorology prototype — implementation specification

Synthesized 2026-10-19 from the accepted bilingual specification v0.2 and completed wayfinder map. This issue defines implementation work; it does not record successful decoding, compatibility, deployment, conformance or performance tests.

Source of truth:

- [Accepted specification v0.2 — English](https://github.com/stepanosokin/hmc-app-prototype/blob/25ae9044c6d9d0c3804285d0b8b05541c5b944ec/.scratch/hmc-meteo/spec.md)
- [Согласованная спецификация v0.2 — русский](https://github.com/stepanosokin/hmc-app-prototype/blob/25ae9044c6d9d0c3804285d0b8b05541c5b944ec/.scratch/hmc-meteo/spec.ru.md)
- [Completed wayfinder map](https://github.com/stepanosokin/hmc-app-prototype/issues/1) and [explicit handoff acceptance](https://github.com/stepanosokin/hmc-app-prototype/issues/7#issuecomment-6263046933)
- [Domain glossary](https://github.com/stepanosokin/hmc-app-prototype/blob/25ae9044c6d9d0c3804285d0b8b05541c5b944ec/GLOSSARY.md)

Both language copies and the map remain authoritative for accepted decisions. This implementation synthesis preserves their scope and gates; any incompatibility requires recorded evidence and reopening the affected decision. Closed planning tickets do not mean implementation gates have passed.

## Problem Statement

The organization has frequently updated meteorological data but needs a self-hosted way to publish consistent forecasts to a public web map and authenticated external QGIS/API consumers. A rendered image alone cannot establish numerical correctness, and forecasts arriving in parts or being corrected must not silently mix model runs, valid times or publication revisions. Operators also need bounded storage, recoverable publication and organization-level access accounting.

The supplied GRIB2 sample has only a preliminary header inventory. Its 24 messages, surface-temperature identity, units, masks, coordinate orientation and CCSDS decoding still need validation. Wider file sizes, update frequency and an estimated audience below 100 concurrent users are planning context, with no measured capacity or server sizing established.

## Solution

Deliver a Docker Compose prototype on one organization-controlled Linux server. Decode the supplied sample, normalize a lossless Zarr numerical core, derive selected numeric COG map products, publish temporal WMS through GeoServer, and provide a Russian MapLibre viewer plus documented domain and OGC numerical APIs. Browser, QGIS and numerical clients must resolve the same explicit published selection and consistent values.

Publish validated forecast times incrementally while preserving the last usable revision on failure. Keep users on their selected run/revision until they explicitly accept updates. Provide revocable organization keys, limits and usage records for external API/GIS access, while the public map contains no organization secret. Retain managed runs for seven days by reference time, configurable toward 30 days, with a historical sample demonstration mode and locally served runtime assets.

## User Stories

1. As a public map visitor, I want to open the map without an organization key, so that I can view published weather data.
2. As a Russian-speaking visitor, I want Russian labels and UTC timestamps, so that I can interpret the interface consistently.
3. As a visitor, I want only implemented modules, models and fields in the catalogue, so that I can choose products that actually exist.
4. As a visitor, I want the newest usable model run and its first available valid time selected initially, so that I can start with available data.
5. As a visitor, I want to select older retained model runs, so that I can inspect their forecasts explicitly.
6. As a visitor, I want reference time, valid time, source, data age and completeness shown separately, so that I can understand the forecast's meaning and freshness.
7. As a visitor, I want to navigate valid times while retaining my run and publication revision, so that my comparison remains consistent.
8. As a visitor, I want unavailable times marked and their selection to clear the overlay and point value, so that a gap is never presented as another forecast.
9. As a visitor, I want another run to start at its first available time, so that the selection remains valid and understandable.
10. As a visitor, I want notifications about new runs or revisions with explicit switching or refresh, so that incoming data do not change my current view unexpectedly.
11. As a visitor, I want a stable legend for the actual published field, so that I can interpret its colours and units.
12. As a visitor, I want a map click to show the selected native-cell value, units, sampling method and provenance, so that I can understand the underlying numerical result.
13. As a visitor, I want loading, missing time, outside coverage, native nodata and service failure distinguished, so that I know why a value is absent.
14. As a visitor, I want changing run or time to clear old point values and reject late responses, so that stale results cannot describe my new selection.
15. As a visitor, I want previously published data to remain usable when an update fails, so that a failed ingestion does not remove working forecasts.
16. As a mobile-browser visitor, I want collapsible controls that preserve run/time context, so that I can inspect the same data on a small screen.
17. As a QGIS consumer, I want a WMS connection scoped to my run/revision, so that discovery, display and identify use one published selection.
18. As a QGIS consumer, I want an organization key supplied in a header, so that I can authenticate without exposing it in public pages or URLs.
19. As a QGIS consumer, I want capabilities, available times, legends and full-resolution identify in the supported client, so that I can inspect the published field.
20. As a QGIS consumer, I want EPSG:4326 and EPSG:3857 to work with their correct axis rules, so that data appear in the correct location.
21. As an API consumer, I want catalogue and availability metadata, so that I can discover real models, runs, revisions and supported dimensions.
22. As an API consumer, I want domain point and EDR position requests to resolve the same selection, so that numerical results agree across interfaces.
23. As an API consumer, I want exact time selection and explicit absence, so that missing data never become a nearby time, another run or an edge-cell substitute.
24. As an API consumer, I want documented errors, OpenAPI and runnable examples, so that I can distinguish input, access, expiry, quota and transient failures.
25. As an organization administrator, I want independently revocable and rotatable keys, so that I can manage access without disrupting other organizations.
26. As an operator, I want organization limits enforced before protected cache delivery, so that cached responses cannot bypass access policy.
27. As an operator, I want usage records for cache hits and rejected requests as well as successful backend work, so that I can account for API/GIS activity.
28. As an operator, I want separate public-demo budgets and bounded render/request costs, so that public and protected workloads remain controlled.
29. As a data operator, I want the actual sample decoded and its surface identity verified, so that the application never mislabels surface temperature as 2 m air temperature.
30. As a data operator, I want preserved units, masks, coordinates and provenance through Zarr and COG conversion, so that published values remain scientifically meaningful.
31. As a data operator, I want incomplete or unsupported source files quarantined with diagnostics, so that partial delivery cannot become a publication.
32. As a data operator, I want checksum/pipeline-based idempotence and durable jobs, so that retries and restarts do not duplicate or corrupt data.
33. As a data operator, I want validated times published incrementally with unknown completeness represented honestly, so that a usable partial run need not wait for an unknown final inventory.
34. As a data operator, I want corrections to create new immutable batches and revisions, so that readers of older revisions remain consistent during their allowed lifetime.
35. As a data operator, I want a visibility gate spanning numerical assets, map products and GIS discovery, so that users never encounter half-published revisions.
36. As an operator, I want retention keyed to model-run reference time and cleanup dry-run reports, so that I can manage seven-/30-day policies safely.
37. As an operator, I want source mounts excluded from cleanup and managed assets deleted only after bounded reader grace, so that organization sources and active reads are protected.
38. As an operator, I want expired selections to require reselection and the historical demo to remain usable, so that retention behavior is explicit and repeatable.
39. As an operator, I want persistent volumes, health checks, structured logs, backlog and disk/cache reporting, so that I can diagnose failures and recover service.
40. As an operator, I want runtime basemaps, fonts and styles served locally with attribution, so that service does not depend on public runtime providers.
41. As an implementer, I want reproducible equivalent numerical-adapter measurements before choosing one, so that the API engine is selected on evidence.
42. As a project owner, I want reproducible correctness and load reports on declared hosts and workloads, so that I can assess readiness without an invented SLA.
43. As a future module implementer, I want common catalogue, product, query and access interfaces, so that later subject areas can integrate without inheriting unsuitable meteorology storage or temporal assumptions.

## Implementation Decisions

### Accepted architecture and domain boundaries

- Preserve the accepted Zarr numerical core, selected derived COGs, GeoServer/ImageMosaic temporal WMS, PostgreSQL/PostGIS metadata and MapLibre/TypeScript viewer. Select exactly one numerical adapter through M1. Martin and vector layers remain deferred.
- Separate edge, web, API, worker, GIS and database responsibilities in Compose. API and worker share domain logic and identifiers and may use one image with different commands. Persist jobs in PostgreSQL; separate application and mosaic schemas/roles. No service per subject-area module, distributed queue, Kubernetes or public cloud store is required.
- Represent model, model run, reference time, valid time, field, published layer and publication revision according to the glossary. Field identity preserves provider/model, parameter/table identifiers, surface/level or layer bounds, grid, member where applicable, valid time/interval and source revision. Preserve statistical processing semantics for future interval products.
- Domain catalogue, source adapters, publication profiles, a manifest-backed selection/sampling boundary and access policy are the extension interfaces. Future imagery, observations, hydrology and long-term forecasts can introduce other formats and temporal semantics; their full contracts are deferred.

### Ingestion, storage and publication

- Use local or read-only mounted sources initially. Prefer a producer manifest or atomic-delivery signal; otherwise document stability delay plus structural validation/retry, without treating stable size as proof of completeness. Quarantine partial/truncated/unsupported files. Preserve original bytes when source retrievability is not guaranteed.
- Record source checksum, pipeline version, provenance and decoder/definition versions. Process bounded compatible batches, with bounded job concurrency, retries, disk and cache budgets.
- Begin compatibility validation with explicit Zarr format 2, lossless encoding and pinned writers/readers/codecs. Keep immutable batches by compatible field/time/grid/level group, and small immutable run manifests reusing unchanged batches. Corrections replace batches in a new publication revision; do not copy an entire growing run for each update. Compaction remains a later measured optimization.
- Ingest all 24 sample messages and publish every successfully validated time of its sole field. Generate lossless numeric COGs, masks and overviews from Zarr. Preserve native-grid numerical identity; use GeoServer for map reprojection and native resolution for point values. Any dtype conversion needs a recorded variable-specific tolerance: the initial sample-temperature bound is maximum absolute error 0.0001 K. Failure blocks publication. Check cell centres, scanning direction, longitude normalization and half-cell georeferencing.
- Preserve the lifecycle discovered → staged → decoded → normalized → derivatives_ready → validated → published, with per-field/time progress and diagnostic retry. One validated map-ready time can make a partial run usable; completeness remains unknown without an expected producer inventory.
- Publish only after required Zarr batches, COG products and GIS selections are durable, validated and queryable. Prove revision-filtered granule selection and discovery visibility; a database transaction alone cannot synchronize an independently updated GeoServer index. Keep staging and administrative routes private. Failed derivative/index updates preserve the last usable revision; restart recovery is idempotent.
- Pin run/revision for readers. Published referenced assets are immutable. Scope capabilities, maps, identify, tiles and numerical reads to the selected manifest. Cache identity includes run/revision, field, level, time, grid/member, style/resampling and tile coordinates.

### External contracts

| Interface | Required behavior |
| --- | --- |
| `/api/v1/modules`, `/api/v1/models`, model/run/revision listings | Domain catalogue and actual availability/dimensions |
| `/api/v1/point` | Explicit layer/run/revision/valid_time/lon/lat; shared manifest resolver and numerical sampling |
| `/ogc/collections` and collection metadata | Approved products and query/portrayal links |
| `/ogc/collections/{collectionId}/position` | EDR position with coords, datetime, parameter-name and documented run/revision extensions; CoverageJSON |
| `/gis/v1/runs/{runId}/revisions/{revision}/wms` | WMS 1.3.0 scoped to selected run/revision, including advertised links/time domain, capabilities, map, legend and identify |
| Catalogue-provided browser tile links | Stable published selection, declared matrix set/style and cacheable raster delivery |

- Default spatial sampling is nearest native cell and temporal selection is exact. A point result includes selection identity, native-cell coordinate, units, sampling method, value or explicit no-data reason, and provenance. Outside-coverage/nodata results are null with a reason, without edge substitution. Missing times cannot select another time/run.
- Domain longitude/latitude are named degrees; EDR follows its advertised CRS/profile and WMS follows version/CRS axis order. Domain errors distinguish 400 invalid input, 401/403 credentials/access, 404 unavailable selection, 410 expired data, 429 limits and 503 transient failure. OGC routes retain documented exception profiles. Publish OpenAPI and runnable examples.
- Pin QGIS during integration and validate keyed header access, available times, legends, full-resolution identify, masks and both EPSG:4326/3857. Product installation alone does not establish OGC conformance. EDR run/revision parameters are extensions; do not claim standard Instances support. Tiles/Maps facades require proven dimension forwarding before enabling.

### Access, viewer and operations

- Public demo access has separate limits and no organization secret. External organizational API/GIS access uses protected key representations, independently revocable keys and organization-level budgets. Authenticate and enforce limits before protected cache access; block direct backend/asset bypass. Provide operator key creation/revocation/rotation and limit commands; an administration portal is unnecessary.
- Bound rate, rendering dimensions, concurrent requests, duration and output size. Record request ID, organization/key ID, operation, product/run/revision, UTC timestamp, status, duration, bytes and cache outcome where available, including cache hits and rejected requests. Document retry/accounting rules. Never log recoverable secrets. Usage retention is separately configurable; monetary accounting is deferred.
- Implement the accepted Russian/UTC viewer: full-screen map, compact controls, bottom time bar, stable legend, point card and responsive control sheet. Default to newest usable run/first available time; run changes start at first available time. Missing-time selection clears layer/value. Explicitly accept new runs or refreshed revisions; clear point values on selection changes and discard stale responses. Show actual field identity and loading/missing/outside/nodata/error states, attribution, age and completeness.
- Serve basemap/styles/fonts locally with attribution and verified redistribution rights; a simple regional basemap is sufficient. Verify runtime independence from public services.
- Retain managed runs by reference time for seven days, configurable toward 30, including all published forecast times beyond the window. Expire discovery/access before removing unreferenced managed originals/copies, Zarr, COGs, manifests and cache after bounded reader grace. Superseded revisions have configurable grace/budgets; sessions cannot retain assets forever. Never clean organization source mounts. Provide cleanup dry-run and storage reporting; pin the historical demo or use a fixed demonstration clock.
- Use explicit persistent volumes, external secrets and read-only reader mounts where possible. Provide readiness/health diagnostics, logs, backlog/publication-lag/failure/storage/cache reporting, catalogue/config/key metadata backup and recovery from retained sources.

### Implementation gates and sequence

The following M1–M5 exit gates are preserved from accepted v0.2. All remain open implementation obligations. References to section 3.1 in the preserved tables mean section 3.1 of the linked accepted specification and the equivalent-adapter gate detailed below.

| Milestone | Deliverable and exit gate |
| --- | --- |
| M1 — Decode, compatibility and API comparison | Reproducible tools; all sample messages decoded; field/units/grid/masks and numeric round trip validated; locked storage readers; evidence-based numerical adapter choice under section 3.1 |
| M2 — Publication core | Durable jobs, immutable batches/manifests, selected derivatives, idempotent retries and retention; prove failed updates preserve previous data |
| M3 — GIS and API | GeoServer selection/visibility gate, scoped QGIS WMS, selected OGC adapter discovery/position and domain catalogue/point API; consistent run/time/values and authenticated access |
| M4 — Web map | Russian MapLibre viewer with accepted interaction, UTC, legend, click values, responsive controls and local basemap |
| M5 — Operational handoff | Keys/limits/usage, restart/cleanup/recovery exercises, documentation and configurable concurrent-load measurements |

M1 must first establish successful AEC-enabled ecCodes CCSDS decoding for packing template 5.42 and validate actual field identity, units, masks, coordinate placement and numerical round trips. Pin released dependencies and corresponding documentation; moving docs are not a tested lock.

Compare pygeoapi with a narrow Xarray/HTTP adapter using the **same manifest-backed Zarr sampling function**. Require equal values/masks, exact run/revision/time, unavailable-data behavior, output meaning and gateway policy before speed comparisons. Fix host/container budgets, dependencies, data hashes, chunks, request mix and worker counts; separate cold/warm caches and repeat runs. Measure required point/metadata operations; label time-series/cube experiments as future workloads. Report p50/p95/p99, successful throughput, errors, CPU/RSS/I/O, bytes, publication freshness and custom integration effort. Agree resource/latency thresholds for the measurement host before declaring a winner. Choose one adapter before finalizing M3. pygeoapi needs custom run/revision provider/routing integration; the narrow adapter requires ownership of advertised OGC schemas, encodings, resources, errors and conformance work.

Keep GeoServer for temporal WMS. Existing research includes ldproxy, GeoServer OGC API modules, TiPG and pg_featureserv as future feature-service candidates; do not substitute a feature-service benchmark for numerical-array evidence or ship all candidates. Revisit those engines only with representative vector schemas/data.

If decoding, storage readers, precision, GIS selection visibility or QGIS behavior fail a gate, retain evidence and reopen the relevant architecture/API decision. Do not hide failure behind mock data or silently substitute products. Identify the measurement host and agree resource/latency targets before the adapter decision; obtain operational inputs before rollout.

## Testing Decisions

Use local Docker Compose for automated integration testing with pinned API, worker, PostgreSQL/PostGIS and GeoServer containers behind the gateway. Use isolated test volumes and explicit test/demo clocks. Run decoder and storage checks in pinned containers as well. This specifies future implementation tests; no containers or tests were run to publish this issue.

Prefer one shared published-selection contract as the primary integration seam: ingest known input through the worker entry point and assert observable catalogue, numerical, GIS and cache/access behavior through the gateway. Add focused numerical boundary checks against ecCodes where the external result alone cannot establish conversion correctness. Test behavior and invariants, not private methods, database row layouts or internal call counts. Keep real service integration for publication/indexing and access gates; mocks cannot prove those gates.

The tested responsibilities are ingestion/normalization/derivatives, manifest publication and retention, catalogue/selection/sampling, gateway access/accounting, GIS delivery and browser selection behavior. Pin the desktop QGIS version and perform reproducible client checks against Compose; HTTP-only tests cannot establish QGIS compatibility. Exercise the viewer through its visible controls, including delayed-response races, responsive layout, Russian labels and UTC.

Prior art is the repository's reviewed illustrative forecast-interaction prototype for run/revision pinning, gaps and explicit updates, plus the sample inventory and accepted A1–A12. The repository contains planning/research and that throwaway prototype, with no implemented application test suite, decoder validation or benchmark to reuse. Synthetic fixtures must be clearly marked and supplement, rather than replace, actual sample compatibility checks.

Preserve these acceptance criteria and attach reproducible evidence to each during implementation:

| ID | Required evidence during implementation |
| --- | --- |
| A1 | All 24 sample messages decode; identities, times, surface, units, masks and coordinate placement are recorded and checked. |
| A2 | Zarr numeric baseline and COG derivatives meet precision/mask checks at representative cells and boundaries. |
| A3 | Browser, domain point API, standard position API and QGIS show the same selected run/revision/time/field and consistent values. |
| A4 | QGIS capabilities/time/legend/identify work with credentials in the pinned client version and both stated CRSs. |
| A5 | Explicit synthetic fixtures exercise overlapping runs, missing times, late/corrected batches and old-revision readers without silent mixing. |
| A6 | Crash/retry and derivative/indexing failure never expose unfinished assets or replace the last usable publication. |
| A7 | Public and protected routes behave as documented; invalid/revoked keys, limits, cache hits and usage records are exercised. |
| A8 | Russian UI/UTC, loading/errors/nodata, point-result clearing and stale-response rejection match the reviewed behavior. |
| A9 | Seven-/30-day policy configurations expire managed runs safely; source mounts remain intact; historical demo data remain usable. |
| A10 | Compose startup/restart, persistent storage, health and recovery documentation work on the agreed Linux host. |
| A11 | A runtime network check confirms locally served basemap/styles/fonts and no required public runtime services. |
| A12 | Benchmark report records workload/hardware/configuration, the equivalent-adapter comparison in section 3.1, and measured ingestion, publication lag, latency, CPU/RAM, bytes, temporary/final storage, cache rate, errors and backlog. |

Use the sample for correctness. Add explicit synthetic fixtures for overlapping runs, missing times, corrections, old-revision readers, native nodata, outside coverage, interrupted delivery, crash/retry and derivative/index failures. Verify availability and capabilities cannot expose staged data; expired requests and cache hits must respect the same manifest and access policy. Exercise invalid/revoked keys, limits and usage records including rejections; check source mounts remain unchanged after cleanup.

Local Compose integration results do not establish production sizing. Run operational compatibility and sizing checks on the agreed organization-controlled Linux host, recording environment and differences from local Docker. Measure representative multi-GB/multivariable/model updates and cold/warm map/click traffic during ingestion, using configurable profiles such as 1/10/50/100 clients. Record ingestion time, publication lag, latency, successful throughput, CPU/RAM/I/O, bytes, staging/final storage, cache hit rate, errors and backlog. Compare seven-/30-day envelopes including raw copies, Zarr, selected COGs/overviews, staging, superseded revisions and cache. These profiles are measurements, without an implied 100-client SLA.

## Out of Scope

- Implementing, decoding, benchmarking or deploying the application as part of this specification-publication task. This issue defines the future implementation scope; publication is not evidence of completion.
- Native mobile, production integration of tens of sources, live external-database connections, hydrology, long-term forecasts, imagery/observation production modules, fabricated data layers and wind particles.
- Numerical raster/coverage downloads, broader EDR queries, standard Instances claims without implementation and Tiles/Maps facades before dimension forwarding is proved.
- Initial Martin/vector layers or a new feature-serving engine without representative data and a separate decision.
- Payments, tariffs, monetary billing, an administration portal and full contracts for future modules.
- Unmeasured efficiency/storage advantages, general OGC conformance, production capacity guarantees, or server sizing before representative workloads and agreed targets.

## Further Notes

Planning is complete and the wayfinder map stays closed. Preserve accepted specification v0.2 and its Russian counterpart; this issue is an implementation synthesis rather than a new planning vote or an architecture replacement. The initial implementation frontier is M1, followed by publication core, GIS/API, viewer and operational handoff as gated above.

Before operational rollout obtain representative datasets, schema/access details, producer completion conventions, real per-model run cadence/daily volume, target server/storage/network, exact QGIS version, DNS/TLS/secrets and agreed service targets. Keep credentials out of this issue. Host sizing remains deferred until evidence exists; no adapter winner or benchmark outcome is predetermined.
