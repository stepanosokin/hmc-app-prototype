# Compare OGC API server alternatives and efficiency for the hybrid prototype

Label: wayfinder:research
Type: research
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/11
Assignee: research_delivery
Parent: [Hydrometcenter meteorology prototype](https://github.com/stepanosokin/hmc-app-prototype/issues/1)
Blocked by: none

## Question

The user requested corrections before accepting the specification: evaluate alternatives to pygeoapi and establish whether it is the most efficient choice. Compare a bounded shortlist against the accepted Zarr numerical core, selected COG products, temporal WMS/QGIS delivery, external organization keys/accounting, frequent updates and future PostGIS features.

Separate numerical EDR/coverage access from feature APIs and portrayal/tiles. Evaluate pygeoapi, ldproxy, the already-planned GeoServer OGC API modules, and a relevant PostGIS-focused alternative such as TiPG or pg_featureserv; include a focused custom adapter where it meaningfully changes the tradeoff. Verify released versus experimental capabilities, run/revision integration and maintenance/deployment costs using current primary sources. Do not infer efficiency from implementation language or unrelated benchmarks. Define reproducible measurements and distinguish measured evidence from architectural inference; no server/data benchmark has been performed.

## Comments

This research reopens [Choose the standards API facade and vector tile timing](https://github.com/stepanosokin/hmc-app-prototype/issues/10). Zarr/selected COG and Martin deferral remain accepted. Both specification copies need correction after the revised API decision. GitHub is the canonical tracker; this file is a local snapshot. Native GitHub issue identity is added after creation.

## Answer

No evidence establishes pygeoapi as the most efficient option. It is a relevant Zarr/EDR integration candidate, with stock provider gaps including Instances, rather than a measured performance winner. ldproxy and GeoServer Features are credible richer feature standards options; TiPG and pg_featureserv are focused PostGIS alternatives, not direct Zarr environmental query replacements. GeoServer Features extension maturity must be distinguished from early-draft Maps/Tiles/Coverages community modules. A narrow custom Xarray adapter is a meaningful numerical comparator if the project accepts owning its OGC contracts. A real 2024 primary study found slower pygeoapi rendering in a cadastre/traditional-service comparison, which cannot rank current Zarr/EDR implementations. The report defines correctness gates and equivalent per-operation performance/resource/publication/security measurements. It recommends retaining pygeoapi on a shortlist, comparing its domain provider against a thin adapter, reusing existing GeoServer and deferring feature-specialist selection until vector evidence exists. No architecture choice or benchmark was performed.

Report: `C:/Users/s.osokin/AppData/Local/Temp/hmc-ogc-api-alternatives/docs/research/ogc-api-alternatives.md`.

Local branch: `research/hmc-ogc-api-alternatives`; commit: `52a3ea9e16fa3b5eed6d424c4cad6abed469e5a3`; report path on branch: `docs/research/ogc-api-alternatives.md`. No push. Canonical research: [Compare OGC API server alternatives and efficiency for the hybrid prototype](https://github.com/stepanosokin/hmc-app-prototype/issues/11).

Workspace snapshot: [OGC API server alternatives](../../../docs/research/ogc-api-alternatives.md). The comparison research is complete; the human API strategy and final specification review remain open.
