# Hydrometcenter meteorology prototype — implementation specification

Updated 2026-10-20 to bilingual specification v0.5: the user-confirmed Windy visual concept is assigned to T22 / #34 for an interactive desktop/phone mockup, followed by production viewer work in #25/#27. Optional TLS using organization-provided certificates remains assigned to T21 / #33. The accepted v0.3 browser amendment remains: numeric browser tiles and GPU scalar rendering replace primary browser colour-image delivery. Preserve milestone IDs M1–M5 and acceptance IDs A1–A12. Scope agreement does not establish completion of TLS or other implementation gates.

Source of truth:

- [Current specification v0.5 — English](https://github.com/stepanosokin/hmc-app-prototype/blob/main/.scratch/hmc-meteo/spec.md)
- [Текущая спецификация v0.5 — русский](https://github.com/stepanosokin/hmc-app-prototype/blob/main/.scratch/hmc-meteo/spec.ru.md)
- [Accepted specification v0.2 — English](https://github.com/stepanosokin/hmc-app-prototype/blob/25ae9044c6d9d0c3804285d0b8b05541c5b944ec/.scratch/hmc-meteo/spec.md)
- [Согласованная спецификация v0.2 — русский](https://github.com/stepanosokin/hmc-app-prototype/blob/25ae9044c6d9d0c3804285d0b8b05541c5b944ec/.scratch/hmc-meteo/spec.ru.md)
- [Completed wayfinder map](https://github.com/stepanosokin/hmc-app-prototype/issues/1) and [explicit handoff acceptance](https://github.com/stepanosokin/hmc-app-prototype/issues/7#issuecomment-6263046933)
- [Domain glossary](https://github.com/stepanosokin/hmc-app-prototype/blob/25ae9044c6d9d0c3804285d0b8b05541c5b944ec/GLOSSARY.md)

The pinned v0.2 links above preserve the historical accepted baseline. The working-tree specification files `.scratch/hmc-meteo/spec.md` and `spec.ru.md` are now v0.5; `docs/adr/0002-numeric-browser-tiles.md` records the accepted amendment. This issue carries the operative amendment below, with the same M1–M5/A1–A12 IDs. The completed wayfinder map remains historical and unchanged. Incompatibility requires recorded evidence and revisiting the affected decision; planning agreement does not prove implementation.

## Problem Statement

The organization has frequently updated meteorological data but needs a self-hosted way to publish consistent forecasts to a public web map and authenticated external QGIS/API consumers. A rendered image alone cannot establish numerical correctness, and forecasts arriving in parts or being corrected must not silently mix model runs, valid times or publication revisions. Operators also need bounded storage, recoverable publication and organization-level access accounting.

T1/T2 validate the supplied sample's 24 messages and Zarr/COG numerical identity locally; T3 (#15) selects the narrow HTTP adapter for the measured point/metadata workload. These reports do not validate numeric tile encoding/resampling, browser GPU rendering, real publication or QGIS. Wider file sizes, update frequency and an estimated audience below 100 concurrent users are planning context, with no measured capacity or server sizing established.

## Solution

Deliver a Docker Compose prototype on one organization-controlled Linux server. Decode the supplied sample, normalize a lossless Zarr numerical core, derive selected numeric COG products for GeoServer temporal WMS/QGIS, and deliver versioned numeric display tiles to a Russian MapLibre GPU scalar viewer alongside documented domain and OGC numerical APIs. Browser, QGIS and numerical clients must resolve the same explicit published selection and consistent values.

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

- Preserve the accepted Zarr numerical core, selected derived COGs, GeoServer/ImageMosaic temporal WMS, PostgreSQL/PostGIS metadata and MapLibre/TypeScript GPU scalar viewer with numeric display tiles. Use the narrow point/metadata adapter selected by #15; select the tile engine separately in #16. Martin and vector layers remain deferred.
- Separate edge, web, API, worker, GIS and database responsibilities in Compose. API and worker share domain logic and identifiers and may use one image with different commands. Persist jobs in PostgreSQL; separate application and mosaic schemas/roles. No service per subject-area module, distributed queue, Kubernetes or public cloud store is required.
- Represent model, model run, reference time, valid time, field, published layer and publication revision according to the glossary. Field identity preserves provider/model, parameter/table identifiers, surface/level or layer bounds, grid, member where applicable, valid time/interval and source revision. Preserve statistical processing semantics for future interval products.
- Domain catalogue, source adapters, publication profiles, a manifest-backed selection/sampling boundary and access policy are the extension interfaces. Future imagery, observations, hydrology and long-term forecasts can introduce other formats and temporal semantics; their full contracts are deferred.

### Ingestion, storage and publication

- Use local or read-only mounted sources initially. Prefer a producer manifest or atomic-delivery signal; otherwise document stability delay plus structural validation/retry, without treating stable size as proof of completeness. Quarantine partial/truncated/unsupported files. Preserve original bytes when source retrievability is not guaranteed.
- Record source checksum, pipeline version, provenance and decoder/definition versions. Process bounded compatible batches, with bounded job concurrency, retries, disk and cache budgets.
- Begin compatibility validation with explicit Zarr format 2, lossless encoding and pinned writers/readers/codecs. Keep immutable batches by compatible field/time/grid/level group, and small immutable run manifests reusing unchanged batches. Corrections replace batches in a new publication revision; do not copy an entire growing run for each update. Compaction remains a later measured optimization.
- Ingest all 24 sample messages and publish every successfully validated time of its sole field. Generate lossless numeric COGs, masks and overviews from Zarr. Preserve native-grid numerical identity; use GeoServer for WMS reprojection, declare numeric tile projection/resampling separately and retain native resolution for canonical point values. Any dtype conversion needs a recorded variable-specific tolerance: the initial sample-temperature bound is maximum absolute error 0.0001 K. Failure blocks publication. Check cell centres, scanning direction, longitude normalization and half-cell georeferencing.
- Preserve the lifecycle discovered → staged → decoded → normalized → derivatives_ready → validated → published, with per-field/time progress and diagnostic retry. One validated map-ready time can make a partial run usable; completeness remains unknown without an expected producer inventory.
- Publish only after required Zarr batches, COG products, numeric tile path/metadata and GIS selections are durable, validated and queryable. Define eager/lazy tile readiness and prove deterministic representative requests before visibility; do not require prebuilding every possible tile. Prove revision-filtered granule selection and discovery visibility; a database transaction alone cannot synchronize an independently updated GeoServer index. Keep staging and administrative routes private. Failed derivative/index updates preserve the last usable revision; restart recovery is idempotent.
- Pin run/revision for readers. Published referenced assets are immutable. Scope capabilities, maps, identify, tiles and numerical reads to the selected manifest. Numeric tile identity includes run/revision, field, level, exact time, grid/member, matrix/coordinates, resampling and encoding version. Palette changes do not refetch unchanged numeric bytes; style/shader versions identify rendered products separately.

### Numeric browser tile and GPU amendment — v0.3

**Delivery:** manifest-selected Zarr → numeric tile generation/cache → gateway → browser decode/GPU textures → MapLibre scalar weather layer. Retain GeoServer temporal WMS for QGIS, the shared domain/EDR point sampler and CoverageJSON position responses. CoverageJSON is not the tile protocol. Wind particles, temporal blending and bulk analytical coverage downloads remain deferred; the actual sample supplies only scalar surface temperature.

Derive display tiles from manifest-selected Zarr values, directly or through a validated numeric derivative. Before finalizing the tiler, compare float-array and packed-value encodings with actual browser decode/upload measurements. Freeze versioned metadata, URL template/content type, matrix set/CRS, zoom range, tile dimensions/origin/orientation, bands, dtype/byte order or scale/offset, units, compression, nodata mask and resampling/halo rules. Ordinary precoloured images cannot substitute for numeric values. No tile encoding or URL shape is selected by this specification.

Agree variable-specific display error budgets before selecting an encoding: test decoded values against the canonical baseline after the declared resampling, including quantization and GPU interpolation. Keep the existing 0.0001 K COG conversion bound separate. Validate source-sphere/geographic-to-map projection, cell placement, coverage edges, tile seams/halos and missing-data masks. Display interpolation has documented semantics; point and EDR remain exact-time/nearest-native-cell queries. CoverageJSON is the position-response encoding, not the browser tile protocol.

- #16 owns tile contract, display-error-budget agreement, the engine comparison/selection and first numeric tile delivery. Evaluate GeoServer for all publication requirements alongside an existing numerical tiler and a small project implementation; prefer reuse where it proves the required values, masks, dimensions and browser costs. An additional standalone service is optional.
- #17–#24 carry tile identity, availability, failure recovery, retention, authentication, quotas, discovery and real publication evidence through the same manifest/gateway. Tile cache hits cannot bypass policy.
- #25 owns browser numeric decoding/GPU scalar rendering, palette changes without unchanged-data refetch, masks/projection/seams, bounded arrays/textures and explicit GPU capability/context-loss/fallback behavior. #26–#28 cover navigation/update races, mobile layout and locally served shaders/decoders/workers/WASM where needed.
- #29–#32 cover tile diagnostics/recovery, reproducible cold/warm delivery and cached-image comparison, bytes, browser decode/upload/frame-time/FPS/memory on declared desktop/mobile browsers, and final acceptance. Agree new server/browser performance targets before readiness claims; #15's workstation point/metadata envelope does not authorize tile/GPU thresholds.

### Optional TLS amendment — v0.4

The user accepted this amendment on 2026-10-20. [T21 / #33](https://github.com/stepanosokin/hmc-app-prototype/issues/33) implements an opt-in HTTPS reverse proxy in front of the existing gateway for the website, numerical API, tiles and GIS. Local HTTP development remains usable without certificates. Once the organization supplies its server certificate, trust chain and matching private key, an operator enables TLS through deployment configuration without application-code changes or rebuilding the application. Providing real organization certificates is not a prerequisite for implementing or testing this capability.

Supply certificate/chain and key as external PEM files mounted read-only into the TLS proxy; keep them outside Git, images, web assets, logs and portable evidence. TLS private keys and organization API access keys are distinct secrets. Document server name, external HTTPS origin, ports, file paths and client CA trust. In TLS mode only the HTTPS edge exposes protected services externally; plain HTTP must not serve protected requests. Redirecting a request cannot protect credentials already sent over HTTP. Preserve the gateway access policy, internal backend isolation, /org profile and run/revision scope. Catalogue, tile metadata and WMS capabilities links must retain the external HTTPS origin without mixed content; arbitrary client forwarding headers must not control that origin or bypass policy.

Document certificate replacement with configuration validation and controlled reload/restart, verification and recovery of the previous configuration. Missing, unreadable or mismatched certificate/key files must produce a clear startup/configuration error without automatic fallback to exposed HTTP. Validate the real proxy/gateway using a test CA and hostname-valid certificate with certificate verification enabled: trusted chain/name, wrong name/untrusted CA rejection, public/protected API/tiles/WMS, external links, warm-cache authorization/revocation, backend isolation, certificate replacement and failure behavior. Reuse the actual-sample access/publication gates for affected components, archive evidence without private keys and retire all test resources under the development workflow.

This gate proves TLS readiness using test certificates. Organization DNS, real certificate/key/chain installation and target-host/client trust verification remain operational rollout inputs. Automatic certificate issuance/renewal (ACME), mutual TLS and replacement of existing API-key authentication are outside T21. Full desktop QGIS acceptance remains in its existing GIS task.

### External contracts

| Interface | Required behavior |
| --- | --- |
| `/api/v1/modules`, `/api/v1/models`, model/run/revision listings | Domain catalogue and actual availability/dimensions |
| `/api/v1/point` | Explicit layer/run/revision/valid_time/lon/lat; shared manifest resolver and numerical sampling |
| `/ogc/collections` and collection metadata | Approved products and query/portrayal links |
| `/ogc/collections/{collectionId}/position` | EDR position with coords, datetime, parameter-name and documented run/revision extensions; CoverageJSON |
| `/gis/v1/runs/{runId}/revisions/{revision}/wms` | WMS 1.3.0 scoped to selected run/revision, including advertised links/time domain, capabilities, map, legend and identify |
| Catalogue-provided numeric tile links and metadata | Stable published selection, declared versioned encoding/matrix/mask/resampling contract and cacheable numeric values for browser GPU rendering |

- Default spatial sampling is nearest native cell and temporal selection is exact. A point result includes selection identity, native-cell coordinate, units, sampling method, value or explicit no-data reason, and provenance. Outside-coverage/nodata results are null with a reason, without edge substitution. Missing times cannot select another time/run.
- Domain longitude/latitude are named degrees; EDR follows its advertised CRS/profile and WMS follows version/CRS axis order. Domain errors distinguish 400 invalid input, 401/403 credentials/access, 404 unavailable selection, 410 expired data, 429 limits and 503 transient failure. OGC routes retain documented exception profiles. Publish OpenAPI and runnable examples.
- Pin QGIS during integration and validate keyed header access, available times, legends, full-resolution identify, masks and both EPSG:4326/3857. Product installation alone does not establish OGC conformance. EDR run/revision parameters are extensions; do not claim standard Instances support. Tiles/Maps facades require proven dimension forwarding before enabling.

### Accepted Windy visual concept — v0.5

[Windy.com](https://www.windy.com/) is the accepted reference for layout and interface density. Use Hydrometcenter's own colours and identity, compact buttons and translucent panels, Russian controls/states/messages and UTC timestamps. The reference does not expand the accepted feature set: the first release shows the actual available temperature field; wind particles, temporal blending and other deferred products remain deferred. The [confirmed concept](https://github.com/stepanosokin/hmc-app-prototype/blob/main/docs/prototypes/design-concept.ru.md) records Q1–Q8; the earlier illustrative HTML remains an interaction artifact, not the agreed visual design.

- The map fills the viewport with compact controls over it. On desktop, model/field/run controls sit at the upper left, layer selection on the right, the time bar at the bottom and the stable legend on the right above that bar. A selected point's value appears beside its marker.
- Initially fit the full coverage of the available forecast. A Russian-labelled “К области данных” control returns to that extent. Keep the existing newest-usable-run/first-available-time default; this spatial choice does not change the pinned selection or missing-time behavior.
- Keep reference time and valid time in UTC visible at all times. Source/publication details expand separately; retain the existing attribution, age, availability and completeness requirements.
- On a phone, use one bottom sheet, initially collapsed. A map tap opens point details to half the screen; settings use that same sheet. The time bar and selected time remain accessible, and run/time context is preserved.
- Use dark translucent panels, light text, a quiet basemap and a distinct temperature colour scale consistent with the legend. Exact shades, dimensions, opacity and readability are assessed on the visual mockup.
- [T22 / #34](https://github.com/stepanosokin/hmc-app-prototype/issues/34) delivers an interactive desktop/phone HTML mockup with Russian labels and explicitly marked demonstration data, before connecting real data. Record visible interaction checks, desktop/phone captures and the user's visual approval. The concept is accepted; the mockup has not yet been created or approved.

The approved mockup guides #25's production viewer and #27's responsive controls; those tickets must retain their actual-sample, numerical/GPU and Compose acceptance gates. A demonstration mockup cannot establish A2/A3/A8/A11 or replace real browser/GIS evidence. Basemap/style/font assets remain subject to local serving, attribution and redistribution requirements; the design reference does not imply reuse of Windy's assets or services.

### Access, viewer and operations

- Public demo access has separate limits and no organization secret. External organizational API/GIS access uses protected key representations, independently revocable keys and organization-level budgets. Authenticate and enforce limits before protected cache access; block direct backend/asset bypass. Provide operator key creation/revocation/rotation and limit commands; an administration portal is unnecessary.
- Bound rate, rendering dimensions, tile zoom/bytes/generation concurrency, request duration, output size and cache growth. Record request ID, organization/key ID, operation, product/run/revision, UTC timestamp, status, duration, bytes and cache outcome where available, including cache hits and rejected requests. Document retry/accounting rules. Never log recoverable secrets. Usage retention is separately configurable; monetary accounting is deferred.
- Implement the accepted Russian/UTC viewer: full-screen map, compact controls, bottom time bar, stable legend, point card and responsive control sheet. Default to newest usable run/first available time; run changes start at first available time. Missing-time selection clears layer/value. Explicitly accept new runs or refreshed revisions; clear point values on selection changes and discard stale responses. Show actual field identity and loading/missing/outside/nodata/error states, attribution, age and completeness.
- Serve basemap/styles/fonts locally with attribution and verified redistribution rights; a simple regional basemap is sufficient. Verify runtime independence from public services.
- Retain managed runs by reference time for seven days, configurable toward 30, including all published forecast times beyond the window. Expire discovery/access before removing unreferenced managed originals/copies, Zarr, COGs, manifests and cache after bounded reader grace. Superseded revisions have configurable grace/budgets; sessions cannot retain assets forever. Never clean organization source mounts. Provide cleanup dry-run and storage reporting; pin the historical demo or use a fixed demonstration clock.
- Use explicit persistent volumes, external secrets and read-only reader mounts where possible. Provide readiness/health diagnostics, logs, backlog/publication-lag/failure/storage/cache reporting, catalogue/config/key metadata backup and recovery from retained sources.

### Implementation gates and sequence

The following M1–M5 IDs are preserved from v0.2 and amended by v0.3. Local M1 evidence is linked from #15; M2–M5 and the new numeric tile/GPU checks remain implementation obligations. References to section 3.1 in the preserved tables mean section 3.1 of the linked accepted specification and the equivalent-adapter gate detailed below.

| Milestone | Deliverable and exit gate |
| --- | --- |
| M1 — Decode, compatibility and API comparison | Reproducible tools; all sample messages decoded; field/units/grid/masks and numeric round trip validated; locked storage readers; evidence-based numerical adapter choice under section 3.1 |
| M2 — Publication core | Durable jobs, immutable batches/manifests, COG and numeric tile readiness/contract, idempotent retries and retention; prove failed updates preserve previous data |
| M3 — GIS and API | GeoServer selection/visibility gate, scoped QGIS WMS, selected OGC adapter discovery/position, domain catalogue/point and numeric tile delivery; consistent selection and protected caches |
| M4 — Web map | Russian MapLibre GPU scalar viewer, validated numeric decoding/masks/seams, accepted selection/UTC/legend/click behavior, responsive controls and local runtime assets |
| M5 — Operational handoff | Keys/limits/usage, optional TLS readiness under T21 / #33, restart/cleanup/recovery exercises, documentation and concurrent server/tile/browser-GPU measurements against agreed targets |

M1 must first establish successful AEC-enabled ecCodes CCSDS decoding for packing template 5.42 and validate actual field identity, units, masks, coordinate placement and numerical round trips. Pin released dependencies and corresponding documentation; moving docs are not a tested lock.

Compare pygeoapi with a narrow Xarray/HTTP adapter using the **same manifest-backed Zarr sampling function**. Require equal values/masks, exact run/revision/time, unavailable-data behavior, output meaning and gateway policy before speed comparisons. Fix host/container budgets, dependencies, data hashes, chunks, request mix and worker counts; separate cold/warm caches and repeat runs. Measure required point/metadata operations; label time-series/cube experiments as future workloads. Report p50/p95/p99, successful throughput, errors, CPU/RSS/I/O, bytes, publication freshness and custom integration effort. Agree resource/latency thresholds for the measurement host before declaring a winner. Choose one adapter before finalizing M3. pygeoapi needs custom run/revision provider/routing integration; the narrow adapter requires ownership of advertised OGC schemas, encodings, resources, errors and conformance work.

Keep GeoServer for temporal WMS. Existing research includes ldproxy, GeoServer OGC API modules, TiPG and pg_featureserv as future feature-service candidates; do not substitute a feature-service benchmark for numerical-array evidence or ship all candidates. Revisit those engines only with representative vector schemas/data.

If decoding, storage readers, precision, GIS selection visibility or QGIS behavior fail a gate, retain evidence and reopen the relevant architecture/API decision. Do not hide failure behind mock data or silently substitute products. Identify the measurement host and agree resource/latency targets before the adapter decision; obtain operational inputs before rollout.

## Testing Decisions

Use local Docker Compose for automated integration testing with pinned API, worker, PostgreSQL/PostGIS and GeoServer containers behind the gateway. Use isolated test volumes and explicit test/demo clocks. Run decoder and storage checks in pinned containers as well. This specifies future implementation tests; no containers or tests were run to publish this issue.

Prefer one shared published-selection contract as the primary integration seam: ingest known input through the worker entry point and assert observable catalogue, numerical, GIS and cache/access behavior through the gateway. Add focused numerical boundary checks against ecCodes where the external result alone cannot establish conversion correctness. Test behavior and invariants, not private methods, database row layouts or internal call counts. Keep real service integration for publication/indexing and access gates; mocks cannot prove those gates.

The tested responsibilities are ingestion/normalization/derivatives, manifest publication and retention, catalogue/selection/sampling, gateway access/accounting, GIS delivery and browser selection behavior. Pin the desktop QGIS version and perform reproducible client checks against Compose; HTTP-only tests cannot establish QGIS compatibility. Exercise the viewer through its visible controls, including delayed-response races, responsive layout, Russian labels and UTC.

Prior art is the repository's reviewed illustrative forecast-interaction prototype for run/revision pinning, gaps and explicit updates, plus the sample inventory and accepted A1–A12. Reuse the local T1 decoder, T2 Zarr/COG and T3 point/metadata suites/reports within their measured scope. They do not establish the new numeric tile/GPU checks or real GIS publication. Synthetic fixtures must be clearly marked and supplement, rather than replace, actual sample compatibility checks.

Preserve these acceptance criteria and attach reproducible evidence to each during implementation:

| ID | Required evidence during implementation |
| --- | --- |
| A1 | All 24 sample messages decode; identities, times, surface, units, masks and coordinate placement are recorded and checked. |
| A2 | Zarr and COG precision/mask evidence is retained; numeric tile encode/decode, declared resampling and GPU interpolation pass separately agreed display error budgets at representative cells, coverage edges and tile seams. |
| A3 | Browser tiles/GPU, domain point, EDR position and QGIS use identical run/revision/time/field. Compare decoded display values under declared resampling/tolerances with the canonical baseline; canonical click values come from the point API, never inferred from colours. |
| A4 | QGIS capabilities/time/legend/identify work with credentials in the pinned client version and both stated CRSs. |
| A5 | Labelled fixtures exercise overlapping runs, missing times, late/corrected batches and old-revision readers without mixing, including delayed tile fetch/decode/upload during navigation and explicit updates. |
| A6 | Crash/retry, numeric tile generation/metadata readiness and GIS derivative/indexing failures never expose unfinished selections or replace the last usable publication. |
| A7 | Public/protected numerical, tile-metadata/tile and GIS routes exercise invalid/revoked keys, limits, warm cache hits, expiry, bypass prevention and usage records. |
| A8 | Russian UI/UTC, the specification section 9.1's accepted Windy layout/mobile behavior and visually approved T22 mockup, GPU-rendered scalar values/masks/legend, loading/errors/nodata, stale point/tile rejection, bounded resource lifecycle and explicit GPU capability/context-loss behavior match the contract. Mockup evidence alone does not establish production behavior. |
| A9 | Seven-/30-day retention safely expires managed runs and numeric tile/metadata/server caches; browser caches cannot resurrect expired selections; source mounts and historical demo rules remain intact. |
| A10 | Compose startup/restart, persistent storage, health and recovery documentation work on the agreed Linux host; optional TLS enablement, certificate replacement and failure behavior pass specification section 10.1 using test certificates before organization credentials arrive. |
| A11 | Network and disconnected-public-runtime checks confirm locally served basemap/styles/fonts, shaders, decoders and any required WASM/workers; no mandatory public runtime service. |
| A12 | Report declared workload/hosts/browsers/configuration, preserved M1 point/metadata comparison, ingestion/publication/server metrics, cold/warm numeric tiles and image baseline, bytes, decode/upload time, frame-time/FPS, browser/GPU memory, cache/storage/errors/backlog. Agree server and desktop/mobile browser targets before readiness claims. |

Use the sample for correctness. Add explicit synthetic fixtures for overlapping runs, missing times, corrections, old-revision readers, native nodata, outside coverage, interrupted delivery, crash/retry and derivative/index failures. Verify availability and capabilities cannot expose staged data; expired requests and cache hits must respect the same manifest and access policy. Exercise invalid/revoked keys, limits and usage records including rejections; check source mounts remain unchanged after cleanup.

Local Compose integration results do not establish production sizing. Run operational compatibility and sizing checks on the agreed organization-controlled Linux host, recording environment and differences from local Docker. Measure representative multi-GB/multivariable/model updates and cold/warm map/click traffic during ingestion, using configurable profiles such as 1/10/50/100 clients. Record ingestion time, publication lag, latency, successful throughput, CPU/RAM/I/O, bytes, staging/final storage, cache hit rate, errors and backlog. Compare seven-/30-day envelopes including raw copies, Zarr, selected COGs/overviews, staging, superseded revisions and cache. These profiles are measurements, without an implied 100-client SLA.

## Out of Scope

- Implementing, decoding, benchmarking or deploying the application as part of this specification-publication task. This issue defines the future implementation scope; publication is not evidence of completion.
- Native mobile, production integration of tens of sources, live external-database connections, hydrology, long-term forecasts, imagery/observation production modules, fabricated data layers and wind particles.
- Bulk numerical raster/coverage downloads (numeric display tiles are in scope), broader EDR queries, standard Instances claims without implementation and Tiles/Maps facades before dimension forwarding is proved.
- Initial Martin/vector layers or a new feature-serving engine without representative data and a separate decision.
- Payments, tariffs, monetary billing, an administration portal and full contracts for future modules.
- Unmeasured efficiency/storage advantages, general OGC conformance, production capacity guarantees, or server sizing before representative workloads and agreed targets.

## Further Notes

The completed wayfinder map stays closed. Bilingual v0.5 adds the confirmed Windy concept and T22 / #34 visual mockup before #25/#27. Optional TLS readiness from v0.4 in T21 / #33 and numeric browser tiles/GPU from v0.3 remain required. M1–M5/A1–A12 and existing completion states remain unchanged; T22 / #34 is added as the visual approval prerequisite for #25/#27. Existing numerical/GIS, real-browser and operational implementation gates remain mandatory.

Before operational rollout obtain representative datasets, schema/access details, producer completion conventions, real per-model run cadence/daily volume, target server/storage/network, exact QGIS version, DNS/TLS/secrets and agreed service targets. Keep credentials out of this issue. Host sizing remains deferred until evidence exists; #15's narrow numerical-adapter choice remains bounded to the recorded point/metadata evidence; tile/GPU outcomes are not predetermined.
