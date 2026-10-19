# Choose the standards API facade and vector tile timing

Label: wayfinder:grilling
Type: grilling
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/10
Assignee: root
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: 08

## Question

Should the specification adopt pygeoapi as the planned standards-facing API adapter, with a provider that respects the publication/run/revision contract, while keeping Martin as an optional vector-tile profile until a vector dataset or basemap requires it? Alternatively, should Martin be part of the initial basemap delivery or should both remain future options? Preserve the accepted Zarr-core/selected-COG design, GeoServer temporal WMS/QGIS capabilities, gateway accounting, and a small modular domain implementation.

## Comments

Evidence: [Evaluate pygeoapi, Martin, and vector tiles in the hybrid design](08-pygeoapi-martin.md). This is a human component-scope decision; the documented integrations are not a performance result. Compatibility of pygeoapi providers with forecast runs/revisions and the chosen Zarr layout is an early implementation gate.

## Answer

The user selected **pygeoapi API; Martin when vector layers arrive**. Plan pygeoapi as the standards-facing adapter over the common publication/domain logic, with custom provider/routing work to enforce explicit run, revision, valid-time and field selection. Keep GeoServer for temporal WMS/QGIS and selected COG portrayal. Keep organization authentication, quotas and usage accounting at the gateway/domain layer. Martin is deferred until representative vector observations, hydrology, contours or another justified vector product is introduced; it is not an initial mandatory container or an assumption about scientific floating-point COG delivery. Provider compatibility and exact supported OGC profiles remain implementation gates, not claimed conformance.

## Reopened for specification corrections

The user requested comparison of alternatives to pygeoapi and asked whether it is currently the most efficient option. The earlier answer is historical; API server selection is provisional until [Compare OGC API server alternatives and efficiency for the hybrid prototype](https://github.com/stepanosokin/hmc-app-prototype/issues/11) is reviewed. Zarr/selected COG, the temporal WMS requirement and Martin deferral remain accepted. The canonical issue is [Choose the standards API facade and vector tile timing](https://github.com/stepanosokin/hmc-app-prototype/issues/10).

The completed comparison supports no measured overall winner. Specification revision 0.2 proposes an M1 gate comparing pygeoapi and a narrow Xarray adapter over identical domain reads, while retaining GeoServer for temporal WMS and postponing feature-specialist selection until vector schemas exist. The user accepted this strategy on 2026-10-19.

## Accepted resolution

Accepted by the user on 2026-10-19: select the numerical adapter through the M1 comparison gate. Compare pygeoapi and a narrow Xarray adapter using the same manifest-backed Zarr sampling function, equivalent correctness, cache conditions, request mix and resource budgets. Select one using measured performance/resource use and integration cost; no adapter has yet been selected or benchmarked. Keep external contracts independent of the server, GeoServer for temporal WMS/QGIS, and Martin deferred until vector layers arrive. Evaluate feature specialists against representative future vector schemas. This supersedes the earlier mandatory-pygeoapi answer. Overall bilingual specification handoff remains a separate review.
