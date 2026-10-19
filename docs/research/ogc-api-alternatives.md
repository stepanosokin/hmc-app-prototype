# OGC API server alternatives for the hybrid meteorology prototype

Research date: 2026-10-19. Advisory response to the user's specification correction: evaluate alternatives to pygeoapi and determine whether it is the most efficient option. Canonical research ticket: https://github.com/stepanosokin/hmc-app-prototype/issues/11. No software was installed, benchmarked or selected by this research.

## Finding

There is no evidence that pygeoapi is the most efficient option for this system. It is a relevant integration candidate because its existing Xarray provider reads Zarr and exposes environmental queries. That reduces some initial integration work; it does not establish lowest latency, highest throughput, lowest memory consumption or lowest maintenance cost. Different operations have different credible candidates. The already accepted Zarr numeric core, selected COG derivatives and GeoServer temporal WMS remain the comparison baseline.

The useful question is which adapter best meets each contract: numerical position/time-series/cube queries; raster portrayal and desktop GIS; future vector Features/Tiles; catalogue/discovery; and organization authentication/accounting. A server that excels at PostGIS features is not automatically an alternative implementation of Zarr EDR.

## Capability comparison

“Not documented” below means no matching built-in capability was established in the cited provider inventory, not that an extension is impossible. All forecast-specific rows require the shared publication manifest and immutable revision selection.

| Candidate | Numerical Zarr / EDR | Raster maps and existing WMS | Future PostGIS Features / Tiles | Main integration tradeoff |
| --- | --- | --- | --- | --- |
| pygeoapi | Existing Xarray EDR provider: Zarr/NetCDF, Position and Cube; Instances unsupported [1] | WMSFacade and WMTSFacade can wrap existing services [2][3] | Multiple providers, including direct PostGIS MVT and Martin proxy [3] | Broad adapter framework and Python extension seam; forecast runs, time precision, publication refresh and provider costs still need proof. |
| ldproxy | No Zarr/EDR provider established in published provider/specification inventory [5][6] | External XYZ tile provider; not a direct replacement for the accepted temporal WMS [5][7] | Rich Features, CRS, filters and Tiles; SQL provider supports PostGIS [5][6] | Strong feature modelling and standards support; numerical service would remain a separate adapter or substantial extension. |
| GeoServer OGC API modules | No direct Zarr EDR path established; community Coverages reuses configured WCS coverages [10] | Reuses WMS layers for community Maps and GeoWebCache for community Tiles [9][11] | Features extension has a substantially different maturity status from other API modules [8] | Reuse an already required server and catalogue, but verify module-specific release/conformance limits rather than assuming all APIs equal WMS maturity. |
| TiPG | PostGIS backend; no direct multidimensional Zarr/EDR capability documented [12] | Vector tiles, not a weather raster/WMS replacement [12] | Focused Features + Tiles over PostGIS, SQL functions and filters [12][13] | Useful future feature specialist; another service and query implementation, not a solution to current Zarr sampling. |
| pg_featureserv | PostGIS feature/function service; no direct Zarr/EDR documented [15] | No raster WMS or integrated Tiles role established; companion tile server is separate [15] | SQL-backed Features and spatial functions [15] | Small feature-serving scope and SQL reuse; validate standards/query coverage for the pinned release. |
| Focused Xarray/FastAPI adapter | Can directly implement the required manifest-backed Zarr reads [17][18] | Link/proxy existing WMS; retain GeoServer rendering | Features/Tiles would need another implementation | Maximum domain control and minimal advertised query surface; all standards discovery, metadata, errors, encodings and conformance become project maintenance work. |

## Evidence and maturity

### pygeoapi

The checked release page lists 0.24.0, and stable provider documentation identifies that version. Xarray EDR supports Position/Cube and parameter/time arguments, but its matrix explicitly excludes Instances. A forecast run cannot therefore be presumed to work as an EDR instance through stock configuration. A custom provider or immutable per-run collection mapping must be evaluated. [1][4]

Its WMSFacade maps an existing WMS backend into OGC API Maps; its tile providers include a WMTS facade, Martin MVT proxy and direct PostGIS MVT. These can avoid reinventing discovery/adaptation, while adding an extra hop when proxying. Whether that hop materially costs anything depends on payload, caching and request mix. [2][3]

Plugins can live outside the pygeoapi codebase and be selected through configuration. This is a practical seam for a shared domain query service, rather than forking the server. It remains custom maintained code, especially for immutable revision selection and incremental publication. [19]

### ldproxy

Current specifications list published Features Parts 1/2/3, Tiles and CQL2, alongside separately classified draft extensions. The provider inventory focuses on SQL, WFS and feature-oriented sources; it does not establish direct Zarr environmental sampling. Features/Tiles are a serious alternative for observations and hydrology, particularly where schema mapping, CRS and filtering dominate. They do not remove the separate numerical adapter. [5][6]

The Tiles building block distinguishes feature-derived tiles from external tile sources; external imagery tiles do not turn ldproxy into a scientific array engine. The documentation classifies this block as mature. A release page opened directly lists 4.8.2, while a search result had still shown 4.8.0: pin actual release artifacts and documentation instead of treating search snippets as current. [7][20]

### GeoServer

Do not classify all GeoServer OGC API support as experimental. Current Features status says Core 1.0.1 and CRS 1.0.1 pass compliance tests, with Filtering/CQL2 1.0 implemented. Its Features extension is a credible reuse option once vector sources arrive. This implementation statement is not certification of a deployed Hydrometcenter service. [8]

The separate Maps community module documentation describes an early draft and partial functionality while reusing WMS layers. Tiles documents an early draft not updated to the final standard while reusing GeoWebCache. Coverages documents partial functionality based on WCS, with spatial/temporal subsets but missing scaling and CRS transformation. These caveats apply to those documented modules, not to mature WMS/WMTS service delivery. [9][10][11]

Version caveat: GeoServer's moving `stable` URLs returned both a newer documentation layout and cached pages explicitly labelled 2.28.x. Treat these as evidence of documented scope and limitations, not as verification that every currently downloadable binary has the same capabilities. Implementation must select a release, matching extension artifacts and exact conformance classes before relying on the APIs. [8][9][10][11]

### PostGIS specialists

TiPG's documentation explicitly targets Features and Tiles with PostGIS. Its support table marks Features CRS Part 2 unsupported, so it is not interchangeable with a Features implementation supporting that part. Functions can expose geometry-bearing results as features/tiles. Changelog evidence includes released 1.6.1 dated 2026-09-03. This is a credible focused comparison for future stations/rivers, with database indexes, filtering and output limits central to performance. [12][13][14]

pg_featureserv is another deliberately narrow candidate. Its documentation describes database tables/views and functions, with read access controlled by the connection role's visible data. The release page lists 1.3.1. Documentation and main-branch API claims must be checked against the pinned release; basic “supports Features” wording is not enough to conclude complete coverage of all optional query capabilities. Neither specialist provides evidence that it replaces this prototype's Zarr EDR or temporal raster contract. [15][16]

### Focused custom adapter

Xarray directly opens Zarr and exposes options controlling chunks, decoding and consolidated metadata. FastAPI supplies a web API framework and OpenAPI tooling. Combining them is feasible for a small query contract, but the framework is not an OGC implementation. The project would own the OGC-specific resources, collection metadata, forecast dimensions, content negotiation, error behavior, coordinate rules, test coverage and future compatibility. [17][18]

A meaningful comparison is therefore a pygeoapi provider delegating to one domain sampling function versus a thin custom HTTP adapter calling the same function. Keep array access, caching and output semantics identical to isolate adapter overhead. This also allows replacing the standards layer without rewriting ingestion or the scientific model.

## Efficiency evidence and limits

The original 2024 ISPRS study by Chowdhury and colleagues compares geospatial web architectures using German cadastre data, PostGIS, GeoServer traditional services, pygeoapi and OpenLayers. Its abstract reports longer rendering times for pygeoapi and improved rendering after vector tiles were introduced. This is relevant evidence against a blanket “pygeoapi is fastest” assertion. It is not a current apples-to-apples server benchmark for Zarr EDR, and it does not rank ldproxy/TiPG/pg_featureserv for this workload. No numeric result from it is used as a capacity estimate here. [21]

Within this bounded primary-source review, no reproducible current comparison was found that holds the required data layout, query semantics, output encodings, cache state, deployment limits and publication behavior constant across this shortlist. Therefore there is no measured overall winner. Project marketing terms such as lightweight, fast or mature, and implementation language alone, do not establish relative efficiency.

Engineering inference: chunk reads/decompression, coordinate selection, output serialization, database indexes, raster reprojection, cache hits, connection pools and publication refresh can dominate different operations. A protocol facade cannot compensate for an unsuitable storage layout or fetching more data than requested. Operational efficiency also includes containers to patch, duplicated catalogues, plugin compatibility and custom code to own; sharing GeoServer can reduce deployment work while concentrating resources in its process.

## Forecast identity, updates and security

Every candidate must resolve the same model/run/revision/variable/level/valid-time identity against the publication manifest. A `datetime` query typically selects temporal data; it does not by itself distinguish overlapping forecast runs or corrected ingestion revisions. Feature properties/filters can represent that identity in PostGIS, but SQL views/schema mappings and indexes are additional application design. EDR instance selection is likewise a domain mapping, not proof of storage consistency.

Use immutable published numerical assets, pin readers to revisions, atomically publish availability and retire them according to retention. Measure whether each adapter observes new data and rejects retired/unavailable data without restart or stale dataset handles. Catalogue reload/reconfiguration behavior is part of the comparison, not a harmless deployment detail.

ldproxy documents integrated bearer-token validation with OIDC, USER_INFO or JWT providers. pygeoapi explicitly leaves access control to deployment. Those are different capabilities; neither establishes the complete organization-key/quota/usage-accounting product. [22][23]

Retain one gateway policy for keyed organization access, request limits, response-size limits and accounting before protected cache hits. Forward only intended source IDs and selection parameters; prevent direct backend bypass. Record organization/key ID, operation, revision, status, bytes and duration without raw secrets. Account for public browser requests separately. A candidate's HTTP metrics or audit log can help operations but does not establish future billable units.

## Proposed bounded comparison gate

This is future implementation validation, not work executed during this planning effort.

1. Fix correctness first: decoded reference values, nodata, exact UTC hour, surface/level, coordinate order, out-of-extent behavior, overlapping runs and immutable revision selection. Exclude a candidate from an operation if it cannot meet that contract; do not award it a latency win for different results.
2. Compare numerical adapter paths: pygeoapi with the needed domain provider against a narrow custom adapter using the same domain reads. Use the supplied 24-hour sample for functional checks, then representative larger runs for performance decisions. Include one point/hour, one point/time-series, a bounded cube and several concurrent users.
3. Compare vector paths only after representative observations/hydrology are available: GeoServer Features, ldproxy, TiPG and optionally pg_featureserv over the same indexed tables, with the same filters, selected properties, pagination and equivalent output. Evaluate Martin only for the separately defined feature-tile workload.
4. Measure portrayal separately: use the accepted GeoServer WMS/WMTS baseline; measure any OGC API proxy overhead with identical backend requests rather than comparing a color image against a numeric response.
5. Pin images, dependency versions, CPU/RAM limits, worker/pool counts, storage, dataset hashes and client load. Run cold and warm caches separately, fixed and randomized locations, concurrent ingestion, and repeated runs. Report p50/p95/p99 latency, successful throughput, error rate, response bytes, peak RSS/CPU, I/O/chunks read and publication-to-visible delay.
6. Include protected gateway requests, cache hits/misses, invalid keys, quotas and usage records; compare resource and maintenance budgets as well as response time. Set acceptance thresholds with the deferred operating envelope before calling one option sufficient or superior.

## Conditional recommendation for the reopened decision

Keep pygeoapi on the shortlist for numerical standards adaptation because it has the closest documented Zarr/EDR starting point among these candidates. Compare it with a focused domain adapter before making it mandatory. This recommendation is about integration fit, not a performance ranking.

Reuse GeoServer for the accepted QGIS temporal WMS path. Evaluate its Features extension before adding a second feature server when vector data becomes available. Prefer ldproxy when richer feature schemas/CRS/filtering justify a dedicated standards service; consider TiPG or pg_featureserv when a narrow PostGIS feature API is sufficient. Do not install all of them or force feature servers to represent raster grids as millions of feature objects.

The specification should name required interfaces and the comparison gate, and mark the standards facade selection reopened until the user chooses an implementation strategy. No change to Zarr/COG storage or Martin deferral follows from this research.

## Primary sources

1. [pygeoapi 0.24 EDR providers](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-edr.html)
2. [pygeoapi Maps providers](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-maps.html)
3. [pygeoapi Tiles providers](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-tiles.html)
4. [pygeoapi releases](https://github.com/geopython/pygeoapi/releases)
5. [ldproxy specifications and technologies](https://docs.ldproxy.net/references/specifications)
6. [ldproxy feature providers and maturity](https://docs.ldproxy.net/providers/feature/)
7. [ldproxy Tiles building block](https://docs.ldproxy.net/services/building-blocks/tiles)
8. [GeoServer Features implementation status](https://docs.geoserver.org/stable/en/user/services/features/status/)
9. [GeoServer Maps community module](https://docs.geoserver.org/stable/en/user/community/ogc-api/maps/index.html)
10. [GeoServer Coverages community module](https://docs.geoserver.org/stable/en/user/community/ogc-api/coverages/index.html)
11. [GeoServer Tiles community module](https://docs.geoserver.org/stable/en/user/community/ogc-api/tiles/)
12. [TiPG scope and implementation matrix](https://developmentseed.org/tipg/)
13. [TiPG function layers](https://developmentseed.org/tipg/advanced/functions/)
14. [TiPG release notes](https://github.com/developmentseed/tipg/blob/main/CHANGES.md)
15. [pg_featureserv guide](https://access.crunchydata.com/documentation/pg_featureserv/latest/), [collections and role visibility](https://access.crunchydata.com/documentation/pg_featureserv/latest/usage/collections/)
16. [pg_featureserv releases](https://github.com/CrunchyData/pg_featureserv/releases)
17. [Xarray open_zarr API](https://docs.xarray.dev/en/stable/generated/xarray.open_zarr.html)
18. [FastAPI official documentation](https://fastapi.tiangolo.com/)
19. [pygeoapi plugins](https://docs.pygeoapi.io/en/stable/plugins.html)
20. [ldproxy releases](https://github.com/ldproxy/ldproxy/releases)
21. [Chowdhury et al. original 2024 comparative study and abstract](https://isprs-archives.copernicus.org/articles/XLVIII-4-W12-2024/11/2024/)
22. [ldproxy authorization](https://docs.ldproxy.net/application/20-configuration/40-auth)
23. [pygeoapi security](https://docs.pygeoapi.io/en/stable/security.html)
