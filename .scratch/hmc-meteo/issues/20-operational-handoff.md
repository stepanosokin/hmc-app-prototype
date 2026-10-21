# Verify the operational handoff — M5 gate

GitHub: https://github.com/stepanosokin/hmc-app-prototype/issues/32 · Snapshot 21.10.2026 · open.
GitHub — источник истины; старые разделы сохранены, добавлен v0.7.

## Parent

[Implementation specification #12](https://github.com/stepanosokin/hmc-app-prototype/issues/12). Approved slice T20; coverage: **M5 exit; A1-A12 final evidence index**.

Follow bilingual specification v0.3 and parent #12's numeric browser tile/GPU amendment, preserving M1-M5 and A1-A12. Numeric display tiles are in scope; bulk analytical coverage downloads remain deferred. Planning acceptance is not successful implementation evidence. Record failed compatibility gates and revisit the affected decision; do not silently replace the accepted architecture.

## What to build

The project owner receives a repeatable end-to-end acceptance run, complete evidence index and usable operator/consumer handoff for the accepted prototype.

## Acceptance criteria

- [ ] Produce a traceable A1-A12 evidence index referencing the individual ticket results, exact versions, inputs, host/configuration and repeatable commands/client steps; retain M1-M5 exit records.
- [ ] Run the final integrated sample scenario across worker, publication, catalogue, numerical APIs, scoped QGIS WMS and browser through the Compose gateway, including update/failure/expiry and key/limit/accounting behavior.
- [ ] Include operator startup, key management, diagnostics, retention dry-run, backup/recovery and consumer API/QGIS procedures, plus local-runtime network evidence and measured workload reports.
- [ ] List unresolved operational inputs honestly: representative data/schema/access, producer conventions, real cadence/volume, server/storage/network, QGIS version, DNS/TLS/secrets and agreed service targets. Keep credentials out of documentation.
- [ ] Leave failed or unmet criteria explicitly open and revisit the affected decision on proven incompatibility; no mock data, unsupported conformance claims or silent architecture substitutions close a gate.
- [ ] Preserve accepted v0.3 scope, Zarr/selected-COG/GeoServer/MapLibre choices, selected numerical adapter and Martin/future-module deferrals. Do not edit or close parent #12 or the completed wayfinder map as part of ticket delivery.

- [ ] Index the v0.3 additions without replacing historical evidence: A2 numeric encoding/resampling/GPU checks, A3 selection/display semantics, A5/A8 tile/GPU races, A6 readiness, A7 protected tiles, A9 cache expiry, A11 local shaders/decoders and A12 server/browser measurements.
- [ ] Final acceptance must demonstrate actual numeric tiles and GPU scalar rendering, explicit capability/fallback behavior, canonical point/EDR and retained real GeoServer/QGIS WMS through the gateway, with agreed desktop/mobile targets and no unsupported tile/GPU claims from #15.
- [ ] Preserve v0.3 scope and the accepted Zarr/COG/GeoServer core. Wind particles, temporal blending and bulk analytical raster downloads remain deferred; numeric display tiles are required. Leave implementation issues open when any new required evidence is missing.

## Testing

Run relevant checks in local Docker Compose with pinned containers, isolated test volumes and explicit test/demo clocks. Exercise observable behavior through the gateway with real services for publication, GeoServer and access-policy gates; focused decoder/storage checks run in pinned containers. Test behavior rather than private implementation details. Synthetic fixtures are explicit supplements to actual-sample validation. Desktop QGIS checks and agreed-host operational measurements are required where stated; local success alone does not establish compatibility or capacity.

## Scope boundary

Deliver this approved slice only. Martin/vector layers, future production modules, native mobile, numerical raster downloads, payments and tariffs remain deferred. The M1 numerical-adapter comparison and selection must precede M3 finalization. Leave the content and status of parent #12 and the completed wayfinder map unchanged.

## Web-map projection amendment — v0.6 (accepted 2026-10-20)

Follow specification section 9.2 and [ADR 0003](https://github.com/stepanosokin/hmc-app-prototype/blob/main/docs/adr/0003-web-map-display-projections.md). These new requirements are unverified and do not change historical completed scope or milestones.

- [ ] Index specification v0.6 / section 9.2, ADR 0003, T23 / #35, T24 / #36 and any required server-extension ticket. Final actual-data/GPU/Compose evidence covers all three modes, strict orthography, EPSG:3576 domain, initial Mercator, state preservation/stale-result rejection, inverse picking, explicit unsupported-mode behavior, local resources and agreed measurements. Keep historical #16/#22/#23/#24/#34 evidence and states intact; do not claim production completion from planning or mockups.

## Дополнение v0.7 — финальная приёмка навигации и графика

Сохранить все прежние обязательства. Новый охват раздела 9.3 спецификации #12: #39 — стабильная смена срока; #40 — плавный ползунок; #41 — реальный прогнозный ряд. Полные замеры включены в #31, которая остаётся блокером финального handoff.

- [ ] Индекс A3/A5/A8/A12 связывает v0.7 и результаты #39/#40/#41/#31 с точными входами, версиями, сценариями, desktop/physical Android и тремя проекциями. Шесть критериев v0.7 не отмечаются на основании создания тикетов или исторических свидетельств.
- [ ] Итоговый реальный Compose/GPU/gateway сценарий показывает сохранение карты/подложки/камеры/точки при смене времени, дискретные кадры ползунка без мигания, явные shown/requested times, поведение пропусков/ошибок/expiry, canonical forecast graph, его выбор срока и подсказки/телефон, переиспользование ряда и отклонение устаревших результатов при явных updates.
- [ ] В handoff включены воспроизводимые результаты целей 100 мс / p95 100 мс / холодные 3 с и бюджета 128 МиБ из #31, числовая идентичность графика/point/EDR/карты, известные ограничения и проверенный cleanup. Незавершённые функции/замеры остаются открытыми; закрытые задачи, родитель #12 и завершённая карта планирования не переоткрываются и не закрываются этим тикетом.
