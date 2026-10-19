# Evaluate pygeoapi, Martin, and vector tiles in the hybrid design

Label: wayfinder:research
Type: research
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/9
Assignee: research_delivery
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: 03, 04

## Question

In response to the user's question, where do pygeoapi and Martin fit in the accepted Zarr-core/selected-COG architecture? Establish current documented integration, suitability of vector tiles for stations/hydrology/contours versus dense weather grids, numerical vector fields versus vector feature tiles, QGIS/WMS requirements, run/revision/time filtering and accounting seams. Distinguish Martin's constrained image-COG support from scientific float COGs and pygeoapi provider-specific capabilities from standards conformance. Recommend initial versus deferred roles without adding services or changing the user's accepted storage decision on their behalf.


## Answer

pygeoapi explicitly documents Martin integration through MVT-proxy, offers its own PostGIS MVT provider, and can wrap GeoServer through WMSFacade/WMTSFacade. Its Zarr-capable xarray-edr provider supports Position and Cube but does not support Instances, so forecast run/revision selection requires a proven adapter contract. Martin suits future feature tiles for stations, rivers, catchments, warnings and scientifically derived contours. Dense scalar grids and continuous U/V arrays do not automatically benefit from per-cell feature tiles. Martin's documented COG path requires aligned EPSG:3857 8-bit imagery; it does not accept scientific float/16-bit COGs and ignores transparency masks. Its contour postprocessor expects Terrarium elevation tiles, not arbitrary numeric weather COGs. Keep the accepted Zarr/selected-COG/GeoServer first path, evaluate pygeoapi for standards adaptation, and defer Martin until representative vector layers justify it; this is advisory and adds no service. Shared immutable run/revision/time/level identity and gateway accounting apply across all adapters. Report links primary evidence and distinguishes stable release from beta documentation.

Local report: `C:/Users/s.osokin/AppData/Local/Temp/hmc-pygeoapi-martin/docs/research/pygeoapi-martin.md`.
Workspace report snapshot: [pygeoapi, Martin and vector tiles](../../../docs/research/pygeoapi-martin.md).

Branch: `research/hmc-pygeoapi-martin`; commit: `722c35d5d8f5d12c776450097b07cd80d1681e15`. Report path on branch: `docs/research/pygeoapi-martin.md`. No push, PR, installs, implementation or tests were performed.
