# Evaluate web delivery and external API standards

Label: wayfinder:research
Type: research
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/4
Assignee: research_delivery
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: none

## Question

Which delivery interfaces best support a Windy-style raster map, accurate point/time-series queries, and external organizational clients? Compare applicable published OGC APIs and OGC Web Services with efficient custom interfaces, STAC discovery, and browser rendering options. Establish current standards status, supported semantics, implementation maturity, caching, numerical versus rendered products, future wind fields/mobile clients, and API key/usage accounting seams. Assess a small self-hosted container stack without assuming production scale or claiming conformance. Use primary sources.

## Comments

Research is advisory; the architecture ticket makes the human decision. Findings will be captured on a disposable research branch and linked here.


## Answer

Desktop GIS raster interoperability favors evaluating temporal WMS 1.3.0 alongside efficient browser tiles. QGIS 3.44 documents temporal WMS/WMTS and API-key header authentication, but the user's GIS product/version and numerical analysis requirements remain decisions. OGC API Tiles 1.0, Maps 1.0 and EDR 1.2 are published; EDR 1.2 publication is 2026-09-08. OGC API Coverages remained a candidate after its public-comment window ended on 2026-10-15. STAC supports discovery rather than map/numeric delivery. Future EDR queries are useful, but pygeoapi Xarray provider run-instance handling has TODOs and must be proven. MapLibre/TiTiler and GeoServer ImageMosaic are candidate routes with distinct integration costs, not an architecture decision. The report specifies shared run/valid-time/level semantics, protected gateway/cache accounting seams and bounded validation work without performance claims.

Report: `docs/research/delivery-standards.md` on local branch `research/hmc-delivery-standards`, commit `5e306add49825793014089404e6fcaac33800a5f`.

Preserved local file: `C:/Users/s.osokin/AppData/Local/Temp/hmc-delivery-standards/docs/research/delivery-standards.md`.
Workspace report snapshot: [Meteorology delivery standards and client options](../../../docs/research/delivery-standards.md).

Remote publication deferred: parent reported automatic approval review rejected the analogous storage-report push because the report contains organization-specific research and the GitHub destination/payload lacks explicit publication approval. This report was not pushed; no remote URL exists. Research conclusions remain usable locally. Sources are linked inline in the report.
