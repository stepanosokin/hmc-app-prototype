# T12 / #24: итоговый M3 gate

Задача [#24](https://github.com/stepanosokin/hmc-app-prototype/issues/24).
Проверка 20 октября 2026 года; исходный коммит
`99acfbb80c3cfbf17d65a56d8c67a0a140ea5d11`.
[Воспроизведение и профиль](../../integrated-publication.md),
[ревью](review.md), [разработочные и неуспешные попытки](development.md).

## Выбранная конфигурация

Итоговый проект `hmc-publication-t12-final2`, порт 8112, полный режим
`run-integrated.ps1 Prepare → QGIS Desktop → Complete`.
[Gate](gate.json): `status=passed`, `m3_passed=true`, `development=false`.
Выбранный в [M1/T3](../t3/validation.md) узкий HTTP-адаптер использует общий
manifest-backed Zarr sampler; GeoServer 2.27.0 обслуживает temporal WMS.
Числовые тайлы сохраняют выбранный в T4 `project-bilinear/1`, Float32/маску,
контракт v2 и утверждённые бюджеты 0,001 K encoding / 0,01 K total display.
[M1 preflight](m1-reference.json) проверил байты исходного сравнения, три
успешных повтора каждого кандидата и явное решение ADR 0001.

Фактический источник `ICON_EU_T_G_2026101500.grib2`, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Часы изолированного стенда: `2026-10-19T05:00:00Z`.
Закреплённые Compose-образы PostGIS/GeoServer и hash-locked Python image;
кеш `665640` bytes и fault flags неизменны во всех итоговых фазах.
Ключи передаются заголовками; их значений в переносимых материалах нет.

## Проверенные результаты

- Предварительный mypy по текущему read-only workspace: **52 файла, exit 0**;
  Compose mypy: **51 файл, exit 0**. PowerShell syntax, документационные ссылки
  и совпадение рабочих/будущих Git bytes проверены до итогового запуска.
- Ранняя проверка `sanitized_service_failure` прошла до дорогого T5.
- **T5: 280,502 s**, все 24 реальных срока, usable intermediate revisions,
  delayed 02, повторная доставка, overlapping run, исправление +1 K,
  настоящие tiles/index failures и сохранённые читатели.
  [Отчёт](t5-acceptance.json) явно отделяет синтетические дополнения.
- **T12: 158,165 s**, пять выборок исходной/исправленной публикации.
  Для каждой — шесть независимых baseline-ячеек через защищённые point,
  EDR position и full-resolution WMS identify; значения и identity совпали.
  Проверены outside-coverage null, scoped time domain и discovery.
  Три тайла каждой выборки декодированы через gateway: representative,
  world/footprint и lazy. Reference — отдельный scalar bilinear из исходного
  GRIB при тех же display coordinates, включая halo. Маски совпали;
  максимальная наблюдённая ошибка **0,0000152286 K**.
  [Числовой отчёт](t12-integrated.json).
- Старые point/EDR/tile/WMS ответили до выхода worker при успешном исправлении
  и обоих настоящих отказах. После успешного worker доступны две новые ревизии;
  после tiles/index failures новых ревизий нет.
  [Счётчики пересечения](t12-publications.json) не подменяют это требованием
  поймать каждую быструю ревизию последовательным polling.
- T12 явно проверил eviction → cold 503 → повторный прогрев exact metadata/bytes;
  при отключённой генерации cold=503, warm bytes=200. Collection/position/point/
  metadata/bytes/WMS подчинились invalid/revoked keys=401, quotas=429 и expiry=410.
  **191** HTTP request ID сопоставлен с usage, identity key, status и bytes.
- **T9: три теста, 131,620 s** — upgrade usage, sliding quotas, shared keys,
  output/bytes/dimensions/time/concurrency, cold generation и eviction,
  реальные очереди и завершение backend после client timeout, usage retention.
  **T8 policies: 25,536 s** — реальные ключи, rotation/revocation, профили,
  WMS map/capabilities, доказанный warm hit и защищённые ссылки.
- **T11 WMS: 38,763 s**. Сохранённая ревизия содержит только 01/03 UTC,
  хотя позже опубликованы остальные сроки и другой run. Проверены scope,
  времена, legend, карты/alpha и identify в EPSG:4326 и EPSG:3857.
- **QGIS Desktop 3.44.11-Solothurn: 24,61 s**, настоящий provider, temporal
  renderer, identify и legend fetcher через QGIS MCP. **20 наблюдений** для двух
  сроков и двух CRS совпали с HTTP/native reference. [Desktop](t11-desktop.json).
  [Карты 4326/01](qgis-4326-01.png), [4326/03](qgis-4326-03.png),
  [3857/01](qgis-3857-01.png), [3857/03](qgis-3857-03.png),
  [легенда](qgis-legend-4326.png) просмотрены визуально.
  Хеши карт двух сроков различаются в обеих CRS: [PNG hashes](qgis-image-hashes.json).
  Временные слои удалены; исходный пользовательский проект не сохранялся.
- Complete проверил repeated access provisioning, отсутствие опубликованных
  backend ports, невозможность достичь API/GeoServer/DB из edge, fail-closed
  при остановленной БД ключей и настоящие restart API/gateway/GeoServer.
  После restart сохранены **30 batches / 30 revisions**, старый point
  `298.2274169921875 K`; WMS повторно прошёл за **39,276 s**,
  независимый ключ работает, отозванный остаётся запрещённым.
- Общий suite: **42 теста, 109,932 s, OK (skipped=18)**.
  Профильные T5/T12/T9/T8/T11 выполнены отдельно в этом же запуске.
  T6/T7 operational integration этой цепочкой не заявляется.
  Выполнены decoder/storage, numeric boundary и T10 native nodata/fault checks.
  [Журнал suite](full-suite.stderr.log).
- Три native runtime import/startup/shutdown probes завершились с exit 0.
  Все **32** шага launcher имеют native exit 0:
  [process results](process-results.jsonl).

## Входы и доказательства

[Начальный инвентарь](inputs-start.json) и [конечный](inputs.json) побайтно
совпали: **86 файлов**, исходный коммит и SHA256 приватного sample.
Desktop связан с SHA256 того же начального инвентаря и той же HTTP selection.
Файлы и конфигурация не менялись между Prepare, desktop и Complete.
Перед commit рабочие SHA256 всех 86 входов сверены с этим инвентарём,
а четыре изменённых входа — с фактическими blobs index:
[staged inputs](staged-inputs.json). После commit эти blobs повторно
проверяются по HEAD. Historical evidence остаётся связано
со своими исходными байтами, а не с новым кодом.

Полный итоговый архив, включая консольные и service logs:
`data/archives/publication/hmc-publication-t12-final2/2808e33fa38c44e680cd36bca8467659`.
[Индекс архива](archive-artifact-index.json) и [retirement receipt](retirement-final.json)
фиксируют проверку SHA256/длин перед удалением. В Git отобрана переносимая
часть с собственным `artifact-index.json`; полный архив остаётся локально.
Расширенный `tools/check_evidence.py` проверяет T12 наряду с T3–T11.
[Disposable corruption probe](evidence-check.json) прошёл: исходные 598
ссылок проверены, изменённая временная копия T12 gate отклонена.

## Очистка и границы

Удалены **пять** проектов всех попыток; контейнеров, сетей и томов каждого
осталось **0**. [Cleanup summary](cleanup-summary.json).
Чужой остановленный `vgdb_tools` сохранён. Живых демонстрационных стендов нет.
Одноразовые ключи удалены, исходный GRIB и общие Docker caches сохранены.

M3 серверной/GIS-интеграции подтверждён для указанного локального профиля.
Исходная сфера и WGS84 различаются; утверждённый datum relationship остаётся
прототипной гипотезой при исходной высоте 0. В sample нет внутренних missing
cells: synthetic native nodata — отдельное дополнение suite, внешняя footprint
mask проверена реальными tiles/WMS/QGIS. Другие QGIS-версии и production capacity
требуют своих проверок. Browser/GPU/interpolation части A2/A3/A8 остаются
#25–#28 и итоговой приёмке; #15 остаётся point/metadata evidence.
Parent #12 и завершённый wayfinder не менялись.
