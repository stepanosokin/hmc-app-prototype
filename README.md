# Hydrometcenter meteorology prototype

Building a self-hosted weather map and external GIS/API service using organizational data.

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
- [Numeric browser tiles and GPU rendering decision](docs/adr/0002-numeric-browser-tiles.md)
- [One-time publication, operator commands and gateway contracts](docs/publication.md)
- [Лимиты организаций, публичного демо и учёт запросов T9](docs/budgets.md)
- [T4 local publication and numeric-engine evidence](docs/evidence/t4/validation.md)
- [Исходные GRIB, PostgreSQL, Zarr и COG: сравнение и обоснование](docs/source-storage-comparison.ru.md)

The user accepted both specification copies (revision 0.2) for implementation on 2026-10-19; the wayfinder planning effort is complete. The agreed baseline is a Zarr numerical core, selected COG products, GeoServer for temporal WMS/QGIS and MapLibre for the web map. Revision 0.2 compares OGC API alternatives; the user accepted selecting the numerical adapter through the M1 implementation measurement gate. Martin is deferred until vector layers arrive. GitHub Issues is the canonical tracker; local ticket Markdown files are snapshots.

Implementation and deployment follow the planning handoff. Local data under `data/` are ignored by Git except `.gitkeep` placeholders; keep one placeholder in each directory that should be preserved.

The [T2 storage comparison in Russian](docs/source-storage-comparison.ru.md) explains source GRIB archives, PostgreSQL tables/arrays and PostGIS Raster, the Zarr numerical core, selected COG map derivatives and metadata storage. It distinguishes forecast grids from observations, measured sample results from assumptions, and evidence that would justify reconsidering the choice. The comparison does not change accepted architecture.

Current waypoint (2026-10-19): **T1/A1 and the original T2 storage checks validated locally; T3 selects the narrow numerical HTTP adapter.** All 24 supplied messages retain exact Zarr values; numeric COGs meet the recorded 0.0001 K bound. Equivalent pygeoapi and narrow trials use the same manifest sampler through a real isolated gateway under the user-approved workstation envelope. The [T3 evidence](docs/evidence/t3/validation.md) records correctness, repeated point/metadata measurements, resource/byte counters, numerical catalogue visibility and the integration trade-off. Bilingual specification 0.3 extends the accepted baseline with numeric browser tiles and GPU rendering, including new A2 display checks; the completed wayfinder map remains closed. This is local prototype evidence, not a production SLA or successful GIS publication.

T4 now supplies a **locally validated M2/M3 foundation**: durable actual-sample jobs, one published time, manifest-selected numeric tiles, canonical points and scoped GeoServer WMS through the gateway. Its [evidence](docs/evidence/t4/validation.md) includes real readiness/indexing failures, granule filtering, discovery visibility, full-resolution identify and persistent-service restart. Subsequent M2 lifecycle/retention work and the complete external GIS/API profile remain open. QGIS compatibility, production access accounting and operational capacity require their separate gates before M3/M5 completion; Martin remains deferred.

Browser delivery amendment (v0.3): **manifest-selected numeric tiles → gateway/cache → MapLibre GPU scalar rendering**. GeoServer temporal WMS remains the QGIS/image interface. T4 freezes numeric contract v2 with owner-approved bilinear/error budgets and an explicit prototype datum operation, selecting float32 plus a validity mask after the three-engine comparison and local browser decode/upload checks. GPU rendering/interpolation and desktop/mobile performance targets remain #25/#31; the T3 point/metadata measurements do not establish those results. Wind particles, temporal blending and bulk coverage downloads remain deferred.

TLS readiness amendment (v0.4, accepted 2026-10-20): [T21 / #33](https://github.com/stepanosokin/hmc-app-prototype/issues/33) adds opt-in HTTPS for the website/API/GIS using organization-provided certificate/chain/private-key files. Local HTTP development remains available; test certificates establish readiness before organization credentials arrive. This is specified future work, not implemented TLS. See section 10.1 of both specification copies.

Visual concept amendment (v0.5, accepted 2026-10-20): [Windy is the agreed layout and interface-density reference](docs/prototypes/design-concept.ru.md), with Hydrometcenter's own styling, Russian/UTC controls, a full-screen map, dark translucent panels and a responsive bottom sheet. Section 9.1 of both specification copies records Q1–Q8. [T22 / #34](https://github.com/stepanosokin/hmc-app-prototype/issues/34) delivers the interactive desktop/phone demonstration mockup for visual approval before the real viewer work in #25/#27. The mockup is not yet created or approved; accepted functional scope and real-data/GPU validation remain unchanged.
