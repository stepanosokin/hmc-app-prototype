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

The user accepted both specification copies (revision 0.2) for implementation on 2026-10-19; the wayfinder planning effort is complete. The agreed baseline is a Zarr numerical core, selected COG products, GeoServer for temporal WMS/QGIS and MapLibre for the web map. Revision 0.2 compares OGC API alternatives; the user accepted selecting the numerical adapter through the M1 implementation measurement gate. Martin is deferred until vector layers arrive. GitHub Issues is the canonical tracker; local ticket Markdown files are snapshots.

Implementation and deployment follow the planning handoff. Local data under `data/` are ignored by Git except `.gitkeep` placeholders; keep one placeholder in each directory that should be preserved.

Current waypoint (2026-10-19): **T1 / A1 sample decoding validated locally.** All 24 supplied CCSDS-packed messages decode with pinned AEC-enabled ecCodes. Surface identity, times, masks and native-cell coordinates are checked; reproducible commands and machine-readable evidence are linked above. The bilingual specification 0.2 remains accepted, and the completed wayfinder map remains closed. Application publication and performance measurements have not started.

Next implementation gates in **M1 — Decode, compatibility and API comparison**: Zarr/COG correctness and reader compatibility, followed by an equivalent comparison of pygeoapi against the narrow Xarray/HTTP adapter. Identify the measurement host and agree resource/latency targets before selecting the numerical adapter; M1 must select one before M3 is finalized. Record any failed compatibility gate and reopen the affected decision rather than silently changing the architecture.
