# Choose the ingestion, publication, and module architecture

Label: wayfinder:grilling
Type: grilling
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/5
Assignee: root
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: 01, 02, 03, 07

## Question

Which storage, ingestion, catalog, publication, rendering, API, and access-accounting boundaries should the Docker Compose prototype adopt? Select an achievable initial stack and explain how run/time/level selection, immutable publication, failures, new modules, future data sources, and a mobile client fit without building those later products now. Record tradeoffs and explicit reversibility limits.

## Comments

### Architecture round: proposed baseline, pending human agreement

- Source GRIB remains authoritative and read-only. Decode with ecCodes/AEC; create lossless numeric COG slices with explicit units/masks and overviews. Evaluate Zarr only if measured future multidimensional access justifies it.
- Use GeoServer/ImageMosaic for temporal WMS and browser raster delivery, a domain API for catalogue/availability/point values and organization access accounting, PostgreSQL for metadata, and a MapLibre web interface. Compose services retain clear responsibilities; a single domain API can host module interfaces rather than requiring a microservice per future module.
- Gate this choice on successful sample decoding, QGIS run/time/identify/authentication checks, and consistent incremental publication. Do not assume a database catalogue pointer alone makes a separately updated GeoServer index atomic.
- GeoServer documentation supports mosaic custom dimensions and incremental harvesting: [configuration](https://docs.geoserver.org/stable/en/user/data/raster/imagemosaic/configuration/), [harvesting](https://docs.geoserver.org/main/en/user/rest/imagemosaic/). Standard local GeoTIFF access must be distinguished from the optional community COG module for remote range readers: [COG module](https://docs.geoserver.org/main/en/user/community/cog/cog/).
- Run reference time and valid time must remain independently selectable. Avoid a layer for every forecast time; prove the selected run-dimension mapping in the target QGIS version.
- Retention proposal pending: seven days by run reference time for application-managed data, configurable to a month; do not delete source-file-server data. Clarify copies, cached tiles, stale/expired requests, active revisions, and the fixed historical sample mode.

### User response to the architecture round

- The COG baseline is not accepted yet. The user requested an explicit Zarr-first comparison before choosing storage and the serving stack. [Compare a Zarr-first baseline with COG publication](07-zarr-first-comparison.md) blocks this decision.
- Confirmed: retain application-managed runs for seven days by reference time, including forecast values beyond the retention window; make the interval configurable toward a month. Organizational source files remain read-only.
- Confirmed: default to the newest usable run, preserve that run while navigating forecast times, expose gaps, and allow explicit older-run selection. Do not silently mix runs.
- The definition of usable must allow a validated partial run, consistent with incremental publication; usability must not imply completeness.

### Comparison ready for the human decision

[Compare a Zarr-first baseline with COG publication](07-zarr-first-comparison.md) is resolved. The report supplies three concrete routes, immutable per-time Zarr batches/manifest/provider, time-chunk tradeoffs, WMS/QGIS integration limitations and proof gates. Original GRIB preservation, publication identity, API accounting, module boundaries and retention apply to every candidate. The proposed COG baseline remains unaccepted until the user chooses after this comparison.

## Answer

The user selected **Hybrid: Zarr core and selected COG products** after comparing the alternatives. This supersedes the earlier proposed COG-only baseline. Retention and explicit run selection are confirmed above.

### Processing and serving responsibilities

1. A read-only source adapter inventories complete GRIB2 files and records checksums and producer metadata. Preserve source bytes in managed retention storage where file-server retention cannot guarantee reproducibility; never delete or modify organization source files.
2. An ingestion worker decodes with an AEC-capable ecCodes build, validates metadata/values, and writes compatible normalized numeric Zarr batches. Use immutable batches for available field/time groups and small revision manifests, avoiding a whole-run copy on every update. Preserve run/reference time, forecast lead, valid time/interval, grid, surface, member, units, masks and statistical meaning. Reader/codec/format versions and numerical precision are explicit implementation compatibility gates.
3. A configured publication profile chooses which model/variable/level combinations become map products. For the sample, publish all 24 available forecast times of its sole field after decoding confirms their meaning. Generate lossless numeric COGs and display overviews **from the validated Zarr batch**, so the two products share provenance. Do not automatically multiply every future GRIB variable/level into a public map layer.
4. GeoServer/ImageMosaic serves temporal WMS and browser raster tiles from selected COG products. QGIS uses WMS display/time/identify. The web map uses MapLibre; a Python domain API provides catalogue, run/availability, native-cell point values from Zarr and organization access accounting. HTTP clients consume product identifiers, not storage URLs.
5. PostgreSQL/PostGIS holds application metadata, publication manifests, jobs, consumer/key metadata and usage records; the mosaic index uses a separate schema/role. Raster arrays remain in mounted file storage. An edge/gateway route authenticates organizational requests and applies quotas/accounting before protected cache delivery; public demo routes have their own limits and never embed organization keys.
6. Docker Compose separates edge/web, domain API, ingestion worker, GeoServer and database responsibilities. Module-specific code remains in a modular backend with registered source/publication capabilities; a new subject-area module does not require a new deployment service. Future hydrology/imagery/observation adapters can reuse catalogue/access/accounting without being forced through Zarr/COG if their data model differs.

### Shared publication contract

- An immutable published selection identifies model, run, revision, variable, surface/level, valid time/interval, grid and member where applicable. Default to the newest run with at least one validated map-ready forecast time for the selected layer. Keep run selection fixed while moving through time; list actual available times and never silently substitute an older run or nearest time.
- A map-ready time requires its Zarr numeric batch, COG and GeoServer selection to pass validation. Additional internal normalized data are not automatically public products. Expose prepared availability, and commit a new shared revision only after all required products are durable and queryable. Failed derivative generation or indexing leaves the existing public revision usable.
- PostgreSQL publication alone cannot make an independently updated GeoServer index atomic. Keep internal serving/staging routes private; the gateway must constrain map/identify/capabilities requests to assets and times belonging to the requested published revision. Prove filtered granule selection, discovery metadata and cache isolation before accepting the integration. Avoid creating a coverage for every forecast time or copying an entire run for each publication.
- Browser clicks and QGIS identify must describe the same native field/time/cell with units and agreed precision. Rendered color and downsampled overview values are not the reference. Prove coordinate order, reprojection, masks and sampling; numerical queries use the Zarr baseline.
- Retain eligible runs for seven days by reference time, configurable toward a month; include their future forecast steps. Expire discoverability first, then clean unreferenced managed assets/caches after bounded active-reader grace. Historical sample mode must pin the fixture or use a fixed clock so the demonstration does not disappear as wall time advances. Never apply cleanup to read-only source mounts.

### Implementation gates and tradeoffs

First implementation work validates CCSDS decoding, the exact Zarr writer/reader/codec chain, Zarr-to-COG values, QGIS time/run/identify/authentication, incremental revision visibility and cleanup. Benchmark concurrent ingestion/rendering and peak temporary/final storage before sizing. The hybrid duplicates selected numeric products and adds coordination work; this is an accepted consequence of the user's chosen baseline, not an established performance advantage. WMS is the initial GIS contract; OGC API adapters, broader grids, native mobile, analytical downloads and billing remain staged extensions.
