# Measure server, numeric-tile and browser GPU workloads

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/31 · Обновление объёма 22.10.2026; состояние перед публикацией: open.

## Parent

[Implementation specification #12](https://github.com/stepanosokin/hmc-app-prototype/issues/12). Approved slice T19; coverage: **M5; A12 full workload**.

Follow bilingual specification v0.3 and parent #12's numeric browser tile/GPU amendment, preserving M1-M5 and A1-A12. Numeric display tiles are in scope; bulk analytical coverage downloads remain deferred. Planning acceptance is not successful implementation evidence. Record failed compatibility gates and revisit the affected decision; do not silently replace the accepted architecture.

## What to build

A reproducible report describes completed-stack behavior and seven-/30-day resource envelopes under declared workloads, without inventing a production capacity guarantee.

## Acceptance criteria

- [ ] Use the correctness-validated sample and representative multi-GB/multivariable/model updates for sizing on the agreed measurement host; obtain required representative inputs before claiming sizing evidence.
- [ ] Run cold/warm map and click traffic while ingesting, with configurable profiles such as 1/10/50/100 clients, recording workload, hashes, dependencies, hardware/container budgets and test configuration.
- [ ] Report ingestion time, publication lag, p50/p95/p99 latency, successful throughput, CPU/RAM/I/O, bytes, temporary/final storage, cache rate, errors and backlog.
- [ ] Compare seven-/30-day storage including original copies, Zarr, selected COGs/overviews, staging, old revisions and cache; clearly state estimates versus directly measured quantities.
- [ ] Link and preserve T3's equivalent numerical-adapter comparison and selection. Do not silently change the adapter or claim a 100-client SLA from the measurement profiles.
- [ ] Retain repeatable local Compose load commands and distinguish local integration measurements from agreed-host operational sizing results.

- [ ] Agree tile-service and desktop/mobile browser targets before claiming performance readiness, separately from #15's approved point/metadata envelope. Record browser/device/GPU capabilities, viewport, zoom, network, tile encoding and server/container budgets; use actual browser measurements rather than HTTP-only simulation for rendering costs.
- [ ] Measure cold/warm numeric tile requests and a cached-image portrayal baseline: latency percentiles, successful throughput/errors, transferred bytes, tile generation/server CPU/RAM/I/O, browser decode/texture-upload time, frame-time/FPS and browser/GPU memory during pan/zoom/time changes and concurrent ingestion.
- [ ] Include numeric metadata/tile cache, decoded arrays/textures, bounded prefetch, eviction/context-loss behavior and seven-/30-day retained products in resource reporting. Report directly observed memory versus estimates where browsers lack exact GPU counters. Preserve T3 point/metadata results; they do not establish tile/GPU efficiency.

## Testing

Run relevant checks in local Docker Compose with pinned containers, isolated test volumes and explicit test/demo clocks. Exercise observable behavior through the gateway with real services for publication, GeoServer and access-policy gates; focused decoder/storage checks run in pinned containers. Test behavior rather than private implementation details. Synthetic fixtures are explicit supplements to actual-sample validation. Desktop QGIS checks and agreed-host operational measurements are required where stated; local success alone does not establish compatibility or capacity.

## Scope boundary

Deliver this approved slice only. Martin/vector layers, future production modules, native mobile, numerical raster downloads, payments and tariffs remain deferred. The M1 numerical-adapter comparison and selection must precede M3 finalization. Leave the content and status of parent #12 and the completed wayfinder map unchanged.

## Web-map projection amendment — v0.6 (accepted 2026-10-20)

Follow specification section 9.2 and [ADR 0003](https://github.com/stepanosokin/hmc-app-prototype/blob/main/docs/adr/0003-web-map-display-projections.md). These new requirements are unverified and do not change historical completed scope or milestones.

- [ ] Extend the declared desktop/mobile workloads to Mercator, strict orthographic globe and EPSG:3576 plus repeated switching, using T23 / #35's evidenced path. Measure cold/warm requests, generation/cache, transferred bytes, decode/upload, frame time/FPS and browser/GPU memory, including disposal of the previous mode's resources and concurrent ingestion.
- [ ] Agree mode-specific targets before readiness claims and distinguish technical feasibility measurements from final workload evidence. If server derivatives are selected, include their bounded generation, cache identities, readiness and seven-/30-day storage costs; preserve numeric-error budgets and the separate historical point/metadata comparison.

## Дополнение v0.7 — навигация по времени и прогнозный ряд точки

Согласованный раздел 9.3 родительской спецификации #12 реализуется в #39, #41. Новые критерии пока не выполнены; прежние обязательства и блокеры сохраняются. Финальный workload измеряет завершённые функции после #39/#41; подготовка измерительного окружения может выполняться раньше.

- [ ] Воспроизводимый workload включает повторную смену срока и график реального канонического ряда, с параллельным ingestion, в Chrome/Edge desktop и физическом Chrome/Android во всех трёх проекциях. Старые браузерные результаты не выдаются за проверку новых функций.
- [ ] Измерены задержки смены срока с раздельными холодными/прогретыми профилями, конфигурацией и ошибками без отменённых нормативов T26. Проверен общий бюджет управляемых массивов/кеша/текстур/framebuffer ≤128 МиБ.
- [ ] Измерены стоимость/число/байты/задержки ограниченных запросов прогнозного ряда, частичная ошибка/повтор и переиспользование ряда при смене только срока; новая точка/поле/расчёт/принятая редакция обновляют ряд. Числовая идентичность и состояния пропуска/nodata/ошибки/expiry сохраняются под нагрузкой.
- [ ] Доказано сохранение карты/подложки/камеры/точки, атомарная смена точных кадров без мигания/интерполяции, отсутствие роста ресурсов и возврата устаревшей/истёкшей выборки. Отчёт различает локальную приёмку новых функций и operational sizing на согласованном хосте, не создавая SLA из плановых целей.


## Уточнение 22.10.2026

22.10.2026 пользователь отменил T26 / #40: обязательный показ промежуточных сроков при перетаскивании и нормативы 100 мс / p95 100 мс / холодные 3 с. Сохраняется T25 / #39: готовый грид заменяется сразу и атомарно без анимации и пересоздания карты. Загрузка/ошибки, последний выбор и бюджет 128 МиБ сохраняются. Это изменение объёма, а не подтверждение реализации.
