# T4 numeric tile contract

Implements part of [#16](https://github.com/stepanosokin/hmc-app-prototype/issues/16).
The owner explicitly selected **bilinear, total error ≤0.01 K and encoding error
≤0.001 K** in this implementation conversation on 2026-10-19. The separate T2
COG conversion bound remains ≤0.0001 K. These are precision budgets, not browser
or server performance targets.

[Contract v2](../publication/contract.v2.json) is frozen before final engine selection.
It specifies two candidate wire encodings for the same scalar/mask semantics,
so float arrays and packed numeric PNG can be compared without changing the
agreed numerical budget. PNG channels encode temperature rather than colour.
An engine decision requires actual-sample, browser decode/upload and readiness
evidence; this contract alone does not select or validate an engine.

Projection preserves the sample's native spherical CRS. The original
[v1 angular placement](../publication/contract.v1.json) failed consistency with
GeoServer's spherical/geodetic conversion. The owner then explicitly approved a
registered project-local CRS and zero-shift geocentric prototype transform on
2026-10-19. v2 freezes that operation in both paths. Retain v1's failed comparison;
it is not eligible for publication. Producer datum confirmation and desktop QGIS
compatibility remain separate gates; no surveyed datum accuracy is claimed.

Compare GeoServer's numerical raster output, the released rio-tiler toolkit
(the raster engine used by TiTiler), and a project implementation against the
same native values, footprint, resampling, masks and halo rules. Inspect the
actual capabilities/output rather than assuming a coloured WMS response
preserves temperatures. Toolkit output must use full resolution; implicit
overviews and nodata weight renormalization require explicit checks.

Primary integration seam, already specified by parent #12: submit known input
through the worker and observe catalogue, exact point, scoped WMS and tiles
through the gateway with real PostgreSQL/PostGIS and GeoServer. Focused
numeric checks supplement this with independent source-based calculations.
Published selections must pin all dimensions, reject unavailable times, hide
staging and administrative routes, and remain invisible after failed tile
readiness or GIS indexing. A database transaction alone proves no GeoServer
visibility property.
