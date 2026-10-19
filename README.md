# Hydrometcenter meteorology prototype

Planning a self-hosted weather map and external GIS/API service using organizational data.

- [Specification — English](.scratch/hmc-meteo/spec.md)
- [Спецификация — русский](.scratch/hmc-meteo/spec.ru.md)
- [Wayfinder map — GitHub Issues](https://github.com/stepanosokin/hmc-app-prototype/issues/1)
- [Local planning snapshot](.scratch/hmc-meteo/map.md)
- [Domain glossary](GLOSSARY.md)
- [Research notes](docs/research)
- [OGC API alternatives comparison](docs/research/ogc-api-alternatives.md)
- [Forecast decoder, reproducible commands and A1 evidence](docs/decoder.md)
- [Zarr/COG round trip, shared sampler and A2 evidence](docs/storage.md)
- [M1 numerical-adapter comparison, approved envelope and reproduction](docs/adapter-comparison.md)
- [T3 numerical selection and measured evidence](docs/evidence/t3/validation.md)
- [Исходные GRIB, PostgreSQL, Zarr и COG: сравнение и обоснование](docs/source-storage-comparison.ru.md)

The user accepted both specification copies (revision 0.2) for implementation on 2026-10-19; the wayfinder planning effort is complete. The agreed baseline is a Zarr numerical core, selected COG products, GeoServer for temporal WMS/QGIS and MapLibre for the web map. Revision 0.2 compares OGC API alternatives; the user accepted selecting the numerical adapter through the M1 implementation measurement gate. Martin is deferred until vector layers arrive. GitHub Issues is the canonical tracker; local ticket Markdown files are snapshots.

Implementation and deployment follow the planning handoff. Local data under `data/` are ignored by Git except `.gitkeep` placeholders; keep one placeholder in each directory that should be preserved.

The [T2 storage comparison in Russian](docs/source-storage-comparison.ru.md) explains source GRIB archives, PostgreSQL tables/arrays and PostGIS Raster, the Zarr numerical core, selected COG map derivatives and metadata storage. It distinguishes forecast grids from observations, measured sample results from assumptions, and evidence that would justify reconsidering the choice. The comparison does not change accepted architecture.

Current waypoint (2026-10-19): **T1/A1 and T2/A2 validated locally; T3 selects the narrow numerical HTTP adapter.** All 24 supplied fields retain exact Zarr values; numeric COGs meet the recorded 0.0001 K bound. Equivalent pygeoapi and narrow trials use the same manifest sampler through a real isolated gateway under the user-approved workstation envelope. The [T3 evidence](docs/evidence/t3/validation.md) records correctness, repeated point/metadata measurements, resource/byte counters, numerical catalogue visibility and the integration trade-off. The bilingual specification 0.2 remains accepted, and the completed wayfinder map remains closed. This is local prototype evidence, not a production SLA or successful GIS publication.

Next implementation work is **M2 — Publication core** and the separate real-service GIS/external-profile gates in M3. Retain GeoServer temporal WMS and deferred Martin. Numerical catalogue visibility does not prove Zarr/COG/GeoServer publication atomicity, external CRS/QGIS compatibility or production access accounting; M3 cannot be finalized without those checks. A failed compatibility gate requires retained evidence and revisiting the affected decision.
