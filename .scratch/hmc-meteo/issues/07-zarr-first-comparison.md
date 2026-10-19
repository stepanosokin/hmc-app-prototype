# Compare a Zarr-first baseline with COG publication

Label: wayfinder:research
Type: research
Status: resolved

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/8
Assignee: research_storage
Parent: [Hydrometcenter meteorology prototype](../map.md)
Blocked by: 01, 02, 03

## Question

At the user's request, compare a concrete Zarr-first architecture against the proposed COG/GeoServer baseline before the architecture is chosen. For tens of models, GB-scale input files, 15-minute/hourly updates, seven-day run-based retention and QGIS display/time/identify, establish reader compatibility, WMS adapter options, chunking and immutable incremental publication, storage/read/write amplification, future API value and operational cost. Include a hybrid Zarr-plus-derived-COG option. Separate documented capabilities, unproven interoperability, hypotheses and measurements. Do not assume faster ingestion, smaller storage, or stock GeoServer Zarr support.

## Answer

Compared a concrete xarray/Zarr + dynamic-tiler + xpublish-wms route with COG/GeoServer and a selective hybrid. Zarr-first is a credible first-class feasibility candidate, but no measured storage/speed advantage is established. Exact v2/v3 codec/reader compatibility, QGIS time/run/identify behavior and low-zoom costs require proof. Inspected xpublish-wms identify source exposes interoperability risks (EPSG:4326, x/y, CoverageJSON, nearest time), not a confirmed client failure. Use immutable small time/lead batches plus a manifest/provider to publish increments without copying whole multi-GB runs; that requires application integration, not stock xarray transactions. Include time-chunk=1 fairness, pyramid/cache costs and per-run retention. Architecture choice remains pending human decision.

Report branch: `research/hmc-zarr-first`; commit `037c42f`; path: `docs/research/zarr-first-comparison.md`.
Local report: [zarr-first-comparison.md](C:/Users/s.osokin/AppData/Local/Temp/hmc-zarr-first-research/docs/research/zarr-first-comparison.md).
Worktree: `C:/Users/s.osokin/AppData/Local/Temp/hmc-zarr-first-research`.
Workspace report snapshot: [Zarr-first baseline compared with COG publication](../../../docs/research/zarr-first-comparison.md).
No push attempted, as instructed. No installation, decoding, benchmark or prototype run.
