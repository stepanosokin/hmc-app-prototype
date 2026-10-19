# pygeoapi, Martin and vector tiles in the meteorology prototype

Research date: 2026-10-19. Primary-source advisory research; no installation, implementation or benchmarks. Context: the user accepted a Zarr numeric core, selected derived COGs, GeoServer for desktop GIS, and shared run/revision identities.

## What each component contributes

| Component | Useful role | Boundary |
| --- | --- | --- |
| pygeoapi | Standards-facing collections and provider adapters; future environmental queries and feature access | Provider support must be checked separately for each query and forecast dimension. |
| Martin | Browser-oriented feature tiles from PostGIS or prepared tiles; possible future observation/hydrology portrayal | Does not replace the multidimensional scientific store, its publication manifest or the required temporal WMS interface. |
| GeoServer | Accepted QGIS-oriented WMS delivery from selected published raster products | Remains a separate renderer even if pygeoapi is placed in front. |
| Zarr + numeric COG | Canonical arrays and selected raster derivatives | Retain full field identity, units, missing data and precision independently of visual products. |

pygeoapi explicitly documents an `MVT-proxy` configuration that reads Martin's XYZ tile endpoint and publishes it through OGC API Tiles. It also offers `MVT-postgresql`, using PostGIS `ST_AsMVT`, so Martin is an optional specialist rather than a prerequisite for PostGIS tiles. Its `WMTSFacade` adapts a backend WMTS, with matching tile-matrix requirements. This is a documented integration route; no end-to-end system conformance is established by configuring it. [pygeoapi tile providers](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-tiles.html)

For the accepted Zarr core, pygeoapi's `xarray-edr` provider reads NetCDF/Zarr and documents Position and Cube queries, including parameter and time arguments. The provider matrix explicitly marks Instances unsupported. A forecast run and a valid time are distinct, so the stock provider does not establish the required run-selection contract. Evaluate a provider extension or collections pinned to immutable run revisions before choosing it as the numerical API adapter. [pygeoapi EDR providers](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-edr.html)

pygeoapi's `WMSFacade` takes an existing WMS URL, layer and optional style to expose maps. It wraps the rendering backend; it does not turn Martin into a temporal WMS or eliminate GeoServer. A facade must preserve run, valid-time and level selection consistently across its public and backend interfaces. [pygeoapi Maps providers](https://docs.pygeoapi.io/en/stable/publishing/ogcapi-maps.html)

## Where vector tiles help

Mapbox Vector Tiles encode feature geometry and attributes in tiled protobuf payloads. This supports browser-side styling, labels and feature interaction. Good potential products include weather stations, river reaches, catchments, warning polygons and derived isolines. Zoom-dependent aggregation and simplification can reduce what the browser must draw, at the cost of not representing every original feature at every scale. [MVT specification](https://mapbox.github.io/vector-tile-spec/)

Engineering assessment: vector tiles are not automatically more efficient for every weather layer. The sample grid has about 0.9 million cells for each time. Encoding each cell as a point or polygon adds geometry and feature overhead to an already regular array. A continuous temperature overlay is naturally delivered as rendered raster tiles, or as bounded numeric raster payloads when GPU styling is needed. Measure payload size, server work and browser frame time against representative fields before claiming an efficiency win.

Derived contours are a useful separate vector product, but their geometry is a processed representation. A value on a contour or a generalized station tile must not silently become the source of an authoritative native-grid click query. Scientific wind vectors mean paired U/V component arrays: this is different from vector feature tiles. Sparse wind arrows may be encoded as features; particle advection still needs a defined continuous field sampling contract and matching time/level/grid semantics.

## Martin's raster and contour limits

Martin now documents COG imagery support, but its requirements are specific: EPSG:3857, square pixels without rotation, WebMercatorQuad-aligned full-resolution image and overviews, and internally aligned square interleaved tiles. Documented image inputs are 8-bit. Floating-point and 16-bit imagery are unsupported, and transparency masks are ignored. Thus the selected scientific numeric COGs cannot simply be handed to this COG path. A separate 8-bit styled imagery derivative would be a different product, with its own precision and nodata decisions. [Martin COG sources](https://maplibre.org/martin/sources-cog-files/)

Martin's documented contour postprocessor traces elevation tiles in Terrarium encoding and returns contour lines carrying elevation attributes. Its units and rounding are elevation-oriented. It is not a documented general-purpose contour engine over arbitrary native float temperature/pressure COGs. Meteorological isolines should be produced by a scientifically defined preprocessing step, then served as vector features/tiles, unless a separate validated adaptation is deliberately built. [Martin contours](https://maplibre.org/martin/postprocessing/contour/)

Version caveat: the current changelog contains both 1.16.1 dated 2026-09-07 and 2.0.0-beta.3 dated 2026-10-09, with breaking changes. Pin and evaluate a chosen release/build; do not assume the unversioned documentation describes every stable binary. [Martin changelog](https://maplibre.org/martin/changelog/)

## Forecast filters, security and accounting

Martin PostgreSQL function sources accept XYZ coordinates and an optional JSON representation of URL query parameters. This provides a mechanism to implement approved run, revision and time filters in SQL. The filters, indexes, validation and authorization rules still have to be designed; passing an arbitrary timestamp is not proof that it selects the intended forecast. [Martin function sources](https://maplibre.org/martin/sources-pg-functions/)

Proposed consistency rule across every adapter: identify module/model, run, immutable ingestion revision, variable, level, valid time and derived-product version; read availability from one publication manifest. Tile and feature-query cache keys must include all selection parameters. A pygeoapi proxy must forward or resolve those parameters explicitly; the documented XYZ proxy example alone does not establish dynamic forwarding.

Use the existing planned gateway for organization keys, quotas and usage accounting before protected cache responses. Keep Martin/GeoServer internal, publish only intended sources, and record stable organization/key IDs rather than secrets. Public browser access must not embed an organization secret. pygeoapi itself documents that it has no built-in access control and must be secured externally. [pygeoapi security](https://docs.pygeoapi.io/en/stable/security.html)

## Conditional recommendation

Keep the accepted Zarr/selected-COG/GeoServer design as the first GRIB path. Treat pygeoapi as a candidate standards adapter for metadata and the numerical API; its run/revision and hourly selection compatibility are explicit evaluation gates. Add Martin when representative station, hydrological or derived-contour data justify a vector-tile service. Compare that need with pygeoapi's own PostGIS tile provider before adding both.

This recommendation preserves useful extension points without making the initial surface-temperature demonstration depend on a new vector-data pipeline. The architecture remains the user's decision; this report does not authorize adding services. Future validation should compare the same selected revision across Zarr click values, numeric COGs, WMS and browser products; exercise overlapping runs, partial availability, nodata and key/quota failures; and measure any claimed vector-tile advantage on the intended data.
