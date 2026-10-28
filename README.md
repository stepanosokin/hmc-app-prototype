# Hydrometcenter meteorology prototype

Building a self-hosted weather map and external GIS/API service using organizational data.

- [Администратору: запуск, остановка и обновление данных стенда](ADMIN.md)
- [Снятие публикаций удалённых GRIB: просмотр и применение плана](docs/grib-sync.md)
- [Specification — English](.scratch/hmc-meteo/spec.md)
- [Спецификация — русский](.scratch/hmc-meteo/spec.ru.md)
- [Wayfinder map — GitHub Issues](https://github.com/stepanosokin/hmc-app-prototype/issues/1)
- [Local planning snapshot](.scratch/hmc-meteo/map.md)
- [Domain glossary](GLOSSARY.md)
- [Research notes](docs/research)
- [OGC API alternatives comparison](docs/research/ogc-api-alternatives.md)
- [Forecast decoder, reproducible commands and A1 evidence](docs/decoder.md)
- [Zarr/COG round trip, shared sampler and A2 evidence](docs/storage.md)
- [CRS из GRIB2 и единый файл значений по умолчанию](docs/grib-crs.md)
- [M1 numerical-adapter comparison, approved envelope and reproduction](docs/adapter-comparison.md)
- [T3 numerical selection and measured evidence](docs/validation/archives.md)
- [Numeric browser tiles and GPU rendering decision](docs/adr/0002-numeric-browser-tiles.md)
- [One-time publication, operator commands and gateway contracts](docs/publication.md)
- [Числовой API: discovery, point, EDR Position и OpenAPI](docs/numerical-api.md)
- [QGIS: закреплённый клиент, подключение с ключом и проверка WMS-T](docs/qgis.md)
- [T11: проверка QGIS Desktop, scoped WMS и доказательства](docs/validation/archives.md)
- [M3: интегрированная защищённая публикация и воспроизведение T12](docs/integrated-publication.md)
- [T12: локальный M3 подтверждён в Compose и QGIS Desktop](docs/validation/archives.md)
- [Лимиты организаций, публичного демо и учёт запросов T9](docs/budgets.md)
- [T4 local publication and numeric-engine evidence](docs/validation/archives.md)
- [Исходные GRIB, PostgreSQL, Zarr и COG: сравнение и обоснование](docs/source-storage-comparison.ru.md)
- [Рабочая GPU-карта: запуск, выбор прогноза и проверки T13](viewer/README.md)

Управление стендом в Windows и Linux выполняется одной командой:

```text
node hmc-app.mjs deploy hmc-app-live
node hmc-app.mjs refresh-grib hmc-app-live --folder data/grib
node hmc-app.mjs revisions hmc-app-live --report
```

`deploy` создаёт стенд без GRIB. `refresh-grib` показывает план, снимает
публикации отсутствующих файлов и загружает только новые. Уже опубликованные
имена пропускаются; изменение содержимого под прежним именем не проверяется.
`revisions` показывает редакции и управляет их очисткой отдельно от загрузки.
Доступны также `start`, `stop`, `status`, `remove` и
`refresh-grib --remove-all` для очистки всех GRIB-публикаций без удаления
исходных файлов. Краткие команды, системные требования и переход со старых
публикаций — в [ADMIN.md](ADMIN.md). Справка: `node hmc-app.mjs --help`.

Далее сохранена история решений и этапов с их исходными датами. Указанный
в ней статус отдельного этапа относится к той дате, а не к текущему состоянию.

The user accepted both specification copies (revision 0.2) for implementation on 2026-10-19; the wayfinder planning effort is complete. The agreed baseline is a Zarr numerical core, selected COG products, GeoServer for temporal WMS/QGIS and MapLibre for the web map. Revision 0.2 compares OGC API alternatives; the user accepted selecting the numerical adapter through the M1 implementation measurement gate. Martin is deferred until vector layers arrive. GitHub Issues is the canonical tracker; local ticket Markdown files are snapshots.

Implementation and deployment follow the planning handoff. Local data under `data/` are ignored by Git except `.gitkeep` placeholders; keep one placeholder in each directory that should be preserved.

The [T2 storage comparison in Russian](docs/source-storage-comparison.ru.md) explains source GRIB archives, PostgreSQL tables/arrays and PostGIS Raster, the Zarr numerical core, selected COG map derivatives and metadata storage. It distinguishes forecast grids from observations, measured sample results from assumptions, and evidence that would justify reconsidering the choice. The comparison does not change accepted architecture.

Current waypoint (2026-10-19): **T1/A1 and the original T2 storage checks validated locally; T3 selects the narrow numerical HTTP adapter.** All 24 supplied messages retain exact Zarr values; numeric COGs meet the recorded 0.0001 K bound. Equivalent pygeoapi and narrow trials use the same manifest sampler through a real isolated gateway under the user-approved workstation envelope. The [T3 evidence](docs/validation/archives.md) records correctness, repeated point/metadata measurements, resource/byte counters, numerical catalogue visibility and the integration trade-off. Bilingual specification 0.3 extends the accepted baseline with numeric browser tiles and GPU rendering, including new A2 display checks; the completed wayfinder map remains closed. This is local prototype evidence, not a production SLA or successful GIS publication.

T4 now supplies a **locally validated M2/M3 foundation**: durable actual-sample jobs, one published time, manifest-selected numeric tiles, canonical points and scoped GeoServer WMS through the gateway. Its [evidence](docs/validation/archives.md) includes real readiness/indexing failures, granule filtering, discovery visibility, full-resolution identify and persistent-service restart. Subsequent M2 lifecycle/retention work and the complete external GIS/API profile remain open. QGIS compatibility, production access accounting and operational capacity require their separate gates before M3/M5 completion; Martin remains deferred.

Browser delivery amendment (v0.3): **manifest-selected numeric tiles → gateway/cache → MapLibre GPU scalar rendering**. GeoServer temporal WMS remains the QGIS/image interface. T4 freezes numeric contract v2 with owner-approved bilinear/error budgets and an explicit prototype datum operation, selecting float32 plus a validity mask after the three-engine comparison and local browser decode/upload checks. GPU rendering/interpolation and desktop/mobile performance targets remain #25/#31; the T3 point/metadata measurements do not establish those results. Wind particles, temporal blending and bulk coverage downloads remain deferred.

TLS readiness amendment (v0.4, accepted 2026-10-20): [T21 / #33](https://github.com/stepanosokin/hmc-app-prototype/issues/33) adds opt-in HTTPS for the website/API/GIS using organization-provided certificate/chain/private-key files. Local HTTP development remains available; test certificates establish readiness before organization credentials arrive. This is specified future work, not implemented TLS. See section 10.1 of both specification copies.

Visual concept amendment (v0.5, accepted 2026-10-20): [Windy is the agreed layout and interface-density reference](docs/prototypes/design-concept.ru.md), with Hydrometcenter's own styling, Russian/UTC controls, a full-screen map, dark translucent panels and a responsive bottom sheet. Section 9.1 of both specification copies records Q1–Q8. [T22 / #34](https://github.com/stepanosokin/hmc-app-prototype/issues/34) delivers the interactive desktop/phone demonstration mockup for visual approval before the real viewer work in #25/#27. The base T22 mockup is approved and #34 is closed; accepted functional scope and real-data/GPU validation remain unchanged.

The web map opens in LAEA - RF (WGS84, centre 60N/90E), fitted to available forecast coverage. Mercator, the strictly orthographic globe and Arctic LAEA EPSG:3576 remain selectable. Display changes preserve the forecast and point, without GRIB reingestion or publication changes. See [viewer instructions](viewer/README.md) and [ADR 0003](docs/adr/0003-web-map-display-projections.md).

Time navigation and point-series amendment (v0.7, accepted 2026-10-21): section 9.3
of the [English](.scratch/hmc-meteo/spec.md) and [Russian](.scratch/hmc-meteo/spec.ru.md)
specifications requires preserving the map during time changes, smooth presentation
of exact forecast frames while dragging the slider, and a real forecast graph in
the point card. The [confirmed decisions](.scratch/hmc-meteo/time-navigation-graph-discussion.md)
include loading/gap/error behavior, graph interaction, timing targets and the
128 MiB bound. These are new requirements with six unchecked implementation
criteria; publication does not establish their implementation.

The [v0.7 implementation plan](.scratch/hmc-meteo/implementation-plan-v07.md)
tracks #39 (stable time changes), then independent #40 (slider) and #41 (point
graph), followed by the extended measurement and handoff gates #31/#32.
