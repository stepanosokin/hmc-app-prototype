# Meteorology delivery standards and client options

Research date: 2026-10-19. Advisory evidence for the architecture decision; no implementation, load measurements, or conformance claims.

## Scope and local evidence

The agreed demonstration starts with one GRIB2 sample, map overlay, legend, time selection, map-click value, and external API, deployed with Docker Compose on one Linux server. The sample inventory reports 24 hourly surface-temperature messages for one run, a regular geographic grid, and no wind components. Values, units, missing values and orientation still require decoder validation. New user clarification makes desktop GIS raster interoperability the first external-client priority. The map is public; organization API credentials, limits and usage records are required. Setup can use the Internet; runtime should be self-hosted.

## Published standards versus candidates

| Interface | Verified status on research date | Fit and limits for this prototype |
| --- | --- | --- |
| OGC API - Tiles Part 1 | Approved 1.0 | Tile retrieval and tileset metadata; covers map, coverage and vector tiles. Suitable modern discovery around browser tiles, but numerical encoding and forecast dimensions still need a contract. [OGC Tiles](https://ogcapi.ogc.org/tiles/) |
| OGC API - Maps Part 1 | Approved 1.0, published 2024-08-09 | Styled portrayals, optional spatial/time/resolution controls and map tilesets. Useful when a client supports it; an arbitrary map image is not the native numeric field. [Maps specification](https://docs.ogc.org/is/20-058/20-058.html) |
| OGC API - EDR Part 1 | Approved 1.2, published 2026-09-08 | Environmental sampling patterns including position and cube; good candidate for future point/time-series and bounded subsets. The landing page still links 1.1, so use the actual published document. [EDR 1.2](https://docs.ogc.org/is/19-086r9/19-086r9.html) |
| OGC API - Coverages Part 1 | Candidate, no approval verified | Official public-comment window was 2026-09-15 to 2026-10-15. The project site still calls it draft. Do not make published conformance a milestone. [Call](https://www.ogc.org/requests/ogc-seeks-public-comment-on-proposed-ogc-api-coverages-part-1-core/), [project status](https://ogcapi.ogc.org/coverages/) |
| OGC API - Features Part 1 | Approved 1.0.1 corrigendum | Object-level queries, suitable for stations, observations represented as features and future hydrological features. Do not turn every raster pixel into a feature. Core alone does not define a complete observation model. [Features specification](https://docs.ogc.org/is/17-069r4/17-069r4.html) |
| WMS | Published 1.3.0 | GIS-oriented rendered maps; use its time/elevation dimensions where needed. Display and identify are distinct from analytical grid download. [OGC WMS](https://www.ogc.org/standards/wms/) |
| WMTS | Published 1.0.0 | Fixed tile matrices and imagery, REST and KVP bindings. Good cache and desktop-map option; forecast dimensions and exact client behavior need validation. [WMTS standard](https://portal.ogc.org/files/?artifact_id=35326) |
| WCS | Published 2.1 core; 2.0.1 also available | Numerical multidimensional coverages. Range selection, scaling, CRS and encoding depend on supported extensions; validate exact desktop versions and profiles. [OGC WCS](https://www.ogc.org/standards/wcs/) |

Approval of a standard does not establish implementation completeness, client interoperability, or service certification. Publish only implemented conformance classes and run the relevant checks before asserting conformance.

## Desktop GIS changes the first delivery choice

Conditional recommendation: if external organizations primarily want raster layers in desktop GIS, prioritize a thin WMS 1.3.0 interface with TIME and clearly defined run selection, alongside efficient browser tiles. WMTS can be added if required by the actual clients and caching workload. Keep OGC API Tiles metadata as an evaluated modern option; do not assume every desktop GIS offers native OGC API Maps/Tiles discovery.

QGIS 3.44 documents WMS/WMTS temporal controls and selection of a reference time reported by the service. Its API Header authentication method explicitly supports a WMS API key in an `X-API-KEY` header. This makes authenticated temporal WMS a credible candidate, subject to an actual end-to-end check. Identify target GIS products and versions before fixing the acceptance matrix; QGIS evidence is not proof for ArcGIS or another client. [QGIS OGC clients](https://docs.qgis.org/3.44/en/docs/user_manual/working_with_ogc/ogc_client_support.html), [QGIS authentication](https://doc.qgis.org/3.44/en/docs/user_manual/auth_system/auth_overview.html)

A rendered WMS layer satisfies visual overlay use. If organizations need raster calculations, agree a separate numeric product: original or normalized GeoTIFF download for an explicit field, or a bounded WCS subset if the client supports the chosen WCS version and encoding. A single fixed-time XYZ URL does not automatically provide a usable desktop temporal controller.

## Browser portrayal, numbers and future wind

MapLibre GL JS directly consumes raster tile sources. Its custom-layer interface permits WebGL rendering in the map context. Those are useful foundations for a weather map; the time selector, legend and scientific value contracts remain application work. [Raster source example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/), [custom layers](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/)

Proposed browser contract: fixed-size PNG/WebP tiles for the selected run/field/level/valid time, with a separately requested numeric map-click value from the canonical decoded field. A color-ramped image loses numerical information; never infer an authoritative temperature from the rendered color. Fix a product-specific scale across times rather than rescaling every frame, so the legend retains its meaning.

Numeric tiles can later support GPU color changes and interpolation. TiTiler advertises NumPy tile and GeoTIFF outputs as well as images, demonstrating available server machinery. Such payloads still need browser decoding and a documented shape, dtype, nodata mask, units and resampling method; they are not automatically interoperable weather products. [TiTiler features](https://developmentseed.org/titiler/)

Future wind particles require paired U/V values with matching run/time/level/grid, units, masks and orientation, plus a custom renderer. Vector tiles of points or lines are not by themselves a continuous vector field. This is an engineering inference from the required particle integration; the supplied sample cannot validate it. Expose numerical vector components independently of the animation so mobile clients can reuse them.

## Discovery and forecast semantics

STAC API is an OGC Community Standard for browsing/searching asset metadata and returning links to assets. It can catalogue model outputs and satellite products; it does not define a rendering, point-value or grid-subsetting service. A small internal asset registry can precede STAC publication. [STAC API Community Standard](https://docs.ogc.org/cs/25-005/25-005.html)

Proposed common identifiers across WMS, tiles, downloads and numerical queries:

- Module, model, run reference time, immutable ingestion revision, variable, surface/level type and value, valid time, grid identifier, and ensemble member when applicable.
- UTC timestamps; run reference time and valid time are separate. An hourly lead is not interchangeable with a run date. For accumulations, add interval bounds and processing semantics.
- Explicit units, nodata, native extent, CRS, coordinate order, cell interpretation and spatial sampling rule. Report the sampled cell coordinate for nearest-cell click values. Reject requests outside coverage; do not silently sample an edge pixel.
- List available times and levels rather than deriving them from nominal cadence. Missing requested fields/times must not silently select a different run.

EDR defines instances for versions/releases/runs and query dimensions including datetime and z. An eventual adapter can map the above identifiers into instances and documented query parameters. This is a mapping proposal, not a claim that installing an EDR server establishes forecast semantics. [EDR 1.2](https://docs.ogc.org/is/19-086r9/19-086r9.html)

## Small self-hosted candidates

| Candidate | Why examine it | Material limit / proof needed |
| --- | --- | --- |
| MapLibre + TiTiler + domain API | Flexible browser; TiTiler supports COG, STAC, Xarray multidimensional inputs, images and numeric outputs | TiTiler is a tiling toolkit, not a complete meteo catalogue or temporal WMS server. Wrap internal asset access with stable field IDs. [TiTiler](https://developmentseed.org/titiler/) |
| MapLibre + GeoServer ImageMosaic + domain API | Conventional raster GIS delivery is a priority; ImageMosaic supports indexed raster collections and GeoServer documents WMS/WCS/WMTS | Prove run/valid-time indexing, publishing new files, numeric precision and container resource use with the selected release. Avoid duplicate inconsistent ingestion registries. [ImageMosaic](https://docs.geoserver.org/stable/en/user/data/raster/imagemosaic/index.html) |
| pygeoapi adapter | Framework with extensible provider contracts for features, maps, tiles and EDR | Xarray EDR source currently contains instance-selection TODOs and nearest-selection logic; run/time semantics require implementation checks. Security is external to pygeoapi. [Plugins](https://docs.pygeoapi.io/en/stable/plugins.html), [Xarray EDR source](https://github.com/geopython/pygeoapi/blob/master/pygeoapi/provider/xarray_edr.py), [security](https://docs.pygeoapi.io/en/latest/security.html) |
| ncWMS | Environmental WMS over CF-compliant NetCDF, based on EDAL | Appropriate if CF NetCDF becomes the chosen serving product; the guide does not prove direct COG/Zarr/this GRIB support or current container suitability. [ncWMS guide](https://reading-escience-centre.gitbooks.io/ncwms-user-guide/content/) |

These are alternatives and possible adapters, not a recommendation to deploy all of them. With desktop GIS now central, the GeoServer route or a small standards adapter deserves comparison against the extra work needed to add temporal WMS to a TiTiler-based route. Choose after the storage research and target-GIS decision. No stack was installed or benchmarked.

## Caching, credentials and future accounting

Dynamic tiling reads source blocks and performs processing at request time; TiTiler documents both the latency tradeoff and a cache in front of a tiler. Cache efficacy depends on constraining style and processing choices. [Dynamic tiling](https://developmentseed.org/titiler/user_guide/dynamic_tiling/)

Proposed publication rule: publish a validated asset set atomically, pin requests to its immutable revision, and cache that revision's tile URLs. The set may be part of an incomplete run if the operating-envelope decision permits incremental publication; atomic visibility does not require waiting for the whole run. Resolve a short-lived `latest` catalogue pointer for a consistent selection; make switching to newly available data explicit rather than mixing runs while stepping through time. Include run, revision, valid time, field, level, grid, tile coordinate, style version, resampling and format in the cache identity. For KVP services, normalize equivalent requests. This is engineering advice, not a standards mandate.

Use an external gateway or domain API to identify organizations, validate API keys, enforce limits and record requests before a protected cache response is returned. Ensure capabilities, map, tile, identify and download links retain the same authenticated public origin. Document authentication in OpenAPI; API key header schemes are supported by the specification. [OpenAPI security](https://spec.openapis.org/oas/v3.0.3)

Keep public demo tiles distinct from protected organization access. A secret embedded in public browser JavaScript is not an organization credential. Proposed usage record: request ID, organization/key ID, operation, dataset/run, timestamp, status, bytes and duration, with cache hit/miss where available. Limit request rate, concurrent work and subset/output size. Exclude raw keys from records. Counting at a worker misses cache hits; counting at the edge supports future accounting. Billing units, retry charging and retention remain policy decisions.

## Suggested evidence before architecture acceptance

Confirm the target desktop GIS/version; then demonstrate its capabilities discovery, selected time and run, correct map/legend/identify, API key header, missing/invalid key handling, limit handling and usage recording. Compare a clicked native-cell value against the decoded source. Repeat the same selection through browser tiles and any numeric download. Exercise unavailable times and overlapping runs explicitly. This defines future validation work; none of these checks was executed during this research.
