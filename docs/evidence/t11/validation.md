# T11 / #23: выбранный прогноз в QGIS

Задача [#23](https://github.com/stepanosokin/hmc-app-prototype/issues/23).
Исходный коммит: `8f5966e56d84b1c032b2d3c7f90961793b765f93`.
Инструкция: [qgis.md](../../qgis.md), [ревью](review.md),
[предыдущие попытки](failed-probes.md).

## Итоговая конфигурация

Проверка 20 октября 2026 года: проект `hmc-publication-t11-final2`, порт 8111,
полный режим `run-qgis.ps1 Prepare → QGIS Desktop → Complete`.
Закреплённые Compose-образы PostGIS и GeoServer 2.27.0, hash-locked Python image;
настольный клиент **QGIS 3.44.11-Solothurn** из работающего Windows GUI-процесса.
M1-адаптер выбран ранее в [T3](../t3/validation.md); архитектура не заменена.

Реальный источник `ICON_EU_T_G_2026101500.grib2`, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Часы стенда: `2026-10-19T05:00:00Z`; fault markers включены только
в изолированном API для существующей T8-проверки. Ключи передаются заголовком
`X-API-Key`; их значения не входят в эти материалы.

[inputs-start.json](inputs-start.json) и [inputs.json](inputs.json)
побайтно совпадают: 84 входных файла, включая новый SLD и desktop-сценарий.
Исходники и конфигурация не менялись между фазами. Desktop-отчёт содержит
SHA256 этого инвентаря; Complete проверил его и выбранную selection.
Перед запуском проверены совпадение изменённых рабочих файлов с будущими
Git blobs и mypy по текущему read-only workspace (51 файл).
После staging все 84 рабочих входа сверены с инвентарём, а 9 изменённых
входов — с фактическими blobs index: [staged-inputs.json](staged-inputs.json).

## Выполненные проверки

- Типы в Compose: 50 файлов, успешно. Ранний `sanitized_service_failure`
  выполнен до дорогой T5-регрессии.
- T5: **279.127 s**, все 24 реальных срока, промежуточные usable revisions,
  задержанный срок 02, повторная доставка, отдельный overlapping run,
  исправление +1 K и реальные отказы tiles/index. Сохранённые читатели
  point/tile/WMS остаются доступны. Синтетические дополнения явно помечены
  в [t5-acceptance.json](t5-acceptance.json).
- T11 WMS через настоящий gateway: **39.733 s**. Выбрана сохранённая ревизия
  с доменом **01:00 и 03:00 UTC**, хотя T5 уже опубликовал поздние сроки
  и другой run. Capabilities рекламирует только выбранный слой, домен и
  scoped ссылки. Проверены PNG-легенда, авторизация, запрет SLD/чужого слоя/
  чрезмерного размера и несуществующего времени. Сравнены центр, первая/
  последняя ячейки и точки вне покрытия: обе CRS, карта/alpha и full-resolution
  GetFeatureInfo против canonical point, K, допуск 0.0001 K.
- T8 policies: **25.602 s**, настоящие ключи/профили/rotation/revocation,
  защищённые ссылки и WMS, доказанный warm-cache hit при отказе cold tile.
  Это policy-сценарий; полный T8 edge/auth-store gate здесь не заявляется.
- QGIS Desktop: **24.44 s**, настоящий WMS provider, temporal map renderer,
  legend fetcher и identify. **20 наблюдений** для двух доступных сроков
  и двух CRS совпали с HTTP/native reference. Identify использует отдельный
  provider с точным временем URI, независимо от клона renderer.
  [t11-desktop.json](t11-desktop.json), [t11-http.json](t11-http.json).
- После реального restart API/gateway/GeoServer: readiness, T5 retained-reader
  проверка (28 ревизий / 28 batches) и T11 WMS повторно прошли (**39.916 s**).
- Полный suite: **41 тест, 107.174 s, OK (skipped=17)**;
  [журнал](full-suite.stderr.log). Профильные T5, T8 policies и T11,
  пропущенные в общем discovery, выполнены отдельно в этом же запуске.
  T6/T7/T9 operational integration и отдельный T8 restart этим результатом
  не заявляются. Числовые контракты T10, в том числе synthetic native nodata,
  decoder/storage и границы numeric tiles выполнены в общем suite.
- Native runtime: все три import/startup/shutdown probes с exit 0.
  Все launcher checks завершились с native exit 0:
  [process-results.jsonl](process-results.jsonl).

У реального sample нет внутренних missing cells; WMS no-data здесь проверен
вне покрытия, включая прозрачность. Синтетический native nodata числового API
является отдельным дополнением полного suite. Исходная spherical grid и WGS84
не смешиваются: HTTP использует принятый PROJ pipeline v2, desktop-reference
независимо вычисляет обратное cartesian/geodetic преобразование при нулевой
исходной высоте. WMS 1.3.0 EPSG:4326 использует latitude/longitude BBOX;
EPSG:3857 — easting/northing. QGIS axis override не включён.

## Изображения и очистка

PNG получены рендерером работающего QGIS Desktop, а не HTTP-заглушкой:
[4326 / 01](qgis-4326-01.png), [4326 / 03](qgis-4326-03.png),
[3857 / 01](qgis-3857-01.png), [3857 / 03](qgis-3857-03.png),
[легенда](qgis-legend-4326.png). Визуально проверены размещение поля и шкала
240–320 K; карты двух сроков различаются в обеих CRS
([хеши изображений](qgis-image-hashes.json)). Пользовательский проект QGIS
не сохранялся; временные слои удалены.

Полный архив итогового запуска, включая service logs:
`data/archives/publication/hmc-publication-t11-final2/4fe997008ffd406fa7d780797ab45272`.
[Индекс полного архива](archive-artifact-index.json) и
[receipt](retirement-final.json) фиксируют проверку SHA256/длин до удаления.
В репозитории сохранена отобранная доказательная часть с собственным
`artifact-index.json`; полные service/build logs остаются в локальном архиве.

Удалены **7** проектов всех попыток; контейнеров, сетей и томов каждого из них
осталось **0**. [cleanup-summary.json](cleanup-summary.json).
Чужой остановленный `vgdb_tools` сохранён. Живых демонстрационных стендов нет;
одноразовые файлы ключей удалены. Общие образы и build cache сохранены по workflow.

Это проверка указанного настольного клиента и локальных реальных сервисов.
Другие версии QGIS и производственная нагрузка требуют своих проверок.
Числовой browser tile/GPU путь не менялся; реальный temporal WMS GeoServer
остаётся desktop-контрактом карты, времени, легенды и identify.
