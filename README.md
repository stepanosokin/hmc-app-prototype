# Hydrometcenter meteorology prototype

Planning a self-hosted weather map and external GIS/API service using organizational data.

- [Specification — English](.scratch/hmc-meteo/spec.md)
- [Спецификация — русский](.scratch/hmc-meteo/spec.ru.md)
- [Wayfinder map — GitHub Issues](https://github.com/stepanosokin/hmc-app-prototype/issues/1)
- [Local planning snapshot](.scratch/hmc-meteo/map.md)
- [Domain glossary](GLOSSARY.md)
- [Research notes](docs/research)
- [OGC API alternatives comparison](docs/research/ogc-api-alternatives.md)

The user accepted both specification copies (revision 0.2) for implementation on 2026-10-19; the wayfinder planning effort is complete. The agreed baseline is a Zarr numerical core, selected COG products, GeoServer for temporal WMS/QGIS and MapLibre for the web map. Revision 0.2 compares OGC API alternatives; the user accepted selecting the numerical adapter through the M1 implementation measurement gate. Martin is deferred until vector layers arrive. GitHub Issues is the canonical tracker; local ticket Markdown files are snapshots.

Implementation and deployment follow the planning handoff. Local data under `data/` are ignored by Git except `.gitkeep` placeholders; keep one placeholder in each directory that should be preserved.

Current waypoint (2026-10-19): **planning complete; bilingual specification 0.2 accepted for implementation.** All ten decision tickets and the wayfinder map are closed. Application implementation, decoding validation and performance measurements have not started.

Next planning step: turn **M1 — Decode, compatibility and API comparison** into a bounded implementation backlog. Identify the measurement host and resource/latency targets, then plan reproducible sample decoding, Zarr/COG correctness and compatibility checks, and an equivalent comparison of pygeoapi against the narrow Xarray/HTTP adapter. M1 must select one numerical adapter before M3 is finalized. Record any failed compatibility gate and reopen the affected decision rather than silently changing the architecture.
