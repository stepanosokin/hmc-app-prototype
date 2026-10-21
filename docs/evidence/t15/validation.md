# T15 — явное принятие публикаций и мобильная карта

Задача [№27](https://github.com/stepanosokin/hmc-app-prototype/issues/27).
Исходная точка: `b5fc10660aae054f171f8ae40b5ca3bd588fc6b4`.
Фаза записи: приёмка перед единственным ticket commit; commit/push и закрытие
проверяются отдельно по живому Git/GitHub после публикации.

## Поведение

Новые редакции и расчёты обнаруживаются без изменения закреплённой выборки.
Действия обновления редакции и перехода к другому расчёту разделены. Редакция
сохраняет точный срок; другой расчёт начинает первый опубликованный срок.
«Позже», смена выбора или проекции отменяют старую работу. Настоящий отказ API,
ошибка GPU и потеря контекста не принимают новую публикацию автоматически.

Транзакция готовит поле, метаданные, значение точки и невидимую GPU-текстуру.
До готовности остаются прежние поле и значение; затем идентичности заменяются
синхронно. Сохраняются калибровка существующей Map и актуальная камера глобуса.
Одновременно существуют максимум текущая и промежуточная числовые текстуры;
проверяется общий бюджет 128 МиБ и удаление конкретной отменённой текстуры.

Телефон использует одну изначально закрытую панель. Карта открывает точку,
вкладки переключают точку/настройки, временная шкала остаётся доступной.
Изменение срока очищает старое значение, сохраняя открытую панель и контекст.
Русские подписи и UTC, три вида карты и явное восстановление Меркатора сохранены.
Наблюдения, нативное мобильное приложение, смешивание сроков и ветер не добавлены.

## Проверяемые границы

Реальные видимые browser controls и gateway над worker/PostGIS/GeoServer.
Удерживаются настоящие ответы fetch/body и реальные GPU uploads, а не
подменяются числовые ответы. Старый каталог завершается после нового;
старые fetch/decode/upload/point завершаются после отмены. Проверяются отказ
во время загрузки, смена проекции, вращение глобуса и context loss.

Валидационный URL явно разрешает подписанные overlapping run и correction
+1 K. Нормальная карта показывает реальные продукты. Числовая проверка
обновления использует настоящий GRIB +3 ч и явно указанную коррекцию;
она отдельно сравнивает GPU, canonical point, диапазон/единицы/оси EDR
и identify scoped WMS. Исходные point/EDR/WMS и frozen v2 не изменены.

Сохраняется [неизменённый desktop QGIS baseline](../t13/validation.md).
Новые CRS внешнего GIS, эксплуатационная мощность и performance readiness
не заявляются. Safari/iOS остаётся ранее согласованной отсрочкой T23.

## Приёмка

Выбраны полные прогоны [desktop final2](attempts/final2/reports/console.log)
и [physical Android final2](attempts/android-final2/reports/console.log).
Одинаковые 178 входов сохранены в начале и конце обоих прогонов. Предыдущие
неудачи и их очистка сохранены в [истории Development](development.md).
[Две оси review и исправления](review.md) завершены до окончательных прогонов.

| Платформа | Проверка обновления | Числовая ошибка, K | GPU |
| --- | --- | --- | --- |
| Windows Chrome 155.0.8059.85 | 6387 сэмплов | 0,001739026 | RTX 4070 Laptop, ANGLE/D3D11 |
| Windows Edge 155.0.4283.62 | 6387 сэмплов | 0,001739026 | RTX 4070 Laptop, ANGLE/D3D11 |
| Samsung SM-S936B, Android 17, Chrome 155.0.8059.84 | 5915 сэмплов | 0,001753609 | Adreno 830, ANGLE/OpenGL ES |

Во всех трёх проверках маски совпали, point/EDR/WMS согласованы. Допуск
0,01 K сохранён. Основная числовая регрессия всех проекций также прошла:
ошибка desktop ≤0,001749 K, телефона ≤0,003021 K, маски без расхождений;
12 desktop и 3 физических canonical picks. Обновления ограничены двумя
array-текстурами (19 170 432 байт вместе); полный управляемый бюджет ≤128 МиБ.
Это проверка совместимости и корректности, не эксплуатационная ёмкость.

Node: 6 тестов; TypeScript и сборка прошли. Полный Python discovery завершился
`Ran 46 tests`, `OK (skipped=22)`: 24 выполнены, 22 относятся к отдельно
включаемым service/native/access/retention gates. Эти пропуски не выдаются за
прохождение таких gates. Реальные browser/native/GPU/EDR/WMS проверки выше
выполнены отдельно на изолированных Compose-проектах.

| № критерия в задаче | Проверенное поведение и доказательство |
| --- | --- |
| 1 | Уведомления, отдельные действия refresh/new run, decline: `updates.before/declined/gap_refresh/new_run` в отчётах браузеров. |
| 2 | Прежние поле и точка остаются при API outage, ошибке upload и GPU loss: `updates.failures`, `races`. |
| 3 | Полноэкранная карта, компактные панели, легенда/точка и нижнее время: полная матрица 1440×900, 390×844, 360×740, 640×360. |
| 4 | Реальные Compose publication/outage/recover и устаревшие ответы: журналы `update-*`, browser `updates.races`. |
| 5 | Независимый GRIB/PROJ, point/EDR/scoped WMS; русские подписи/UTC. Неизменный QGIS baseline T13, без новых GIS CRS. |
| 6 | `updates.atomic` фиксирует одновременные metadata/texture/point identities; отменённая texture удалена, `resources.max_arrays=2`. |
| 7 | Одна изначально закрытая панель, вкладки точка/настройки, доступное время: `updates.layouts`, native Android controls. |
| 8 | Сверка с утверждённым T22/T24 и реальные point/settings/time/update/failure: визуальное чтение ниже и снимки обоих браузеров/телефона. |
| 9 | Три доступных вида, сохранение выбора/единиц/точки, скрытие с объяснением, запрет background picks: основные `checks` и native comparisons. |
| 10 | Fetch/decode/upload/point/catalogue races, mode change, context loss, Mercator startup/fit/fallback: `checks`, `updates.races/failures`. |

Машиночитаемые результаты:
[Chrome](attempts/final2/reports/browser/browser.json),
[Edge](attempts/final2/reports/browser-edge/browser.json),
[Android](attempts/android-final2/reports/browser/browser.json),
[Chrome update comparison](attempts/final2/reports/browser-updates-comparison.json),
[Edge update comparison](attempts/final2/reports/browser-edge-updates-comparison.json),
[Android update comparison](attempts/android-final2/reports/browser-updates-comparison.json).

## Визуальная сверка

Утверждённый исходник T22/T24 включён в frozen inputs; SHA256
`17f88db4aae00b3094aed1439e41a5f9f9b3db09c5f2ba19fe86531e04565ac7`.
Сравнены [утверждённые портреты](../t24/visual-review/final-chrome1-360x740.png)
и горизонтальная концепция с final2: desktop 1440×900, обе гарнитуры и обе
подложки при 360×740, все три вида, низкий 640×360 и физический 384×694.
Сохранены полупрозрачные панели, термометр справа, точка около маркера на
desktop, компактный прогноз и нижнее время на телефоне. Реальные данные
заменяют явно демонстрационное поле макета. На низком экране содержимое
правой карточки прокручивается; легенда и время не пересекаются с ней.

Проверены [панель после изменения срока](attempts/final2/reports/browser/updates-360x740-point-time.png),
[короткий landscape](attempts/final2/reports/browser/updates-640x360-point-time.png),
[реальная ошибка API на телефоне](attempts/android-final2/reports/browser/updates-service-failure.png)
и [физическая панель/время](attempts/android-final2/reports/browser/updates-384x694-point-time.png).
После смены срока карточка остаётся открытой и честно убирает старое значение.
Переходы point/settings, нативные select и время проверены настоящими
касаниями, а не только изображениями. Дополнительно проверены 700/701 px
по обе стороны breakpoint; viewport телефона остаётся 384×694 без сдвига.

## Очистка и целостность

Каждая попытка имеет retirement receipt с `retired`, `archive_verified=true`
и пустыми контейнерами/сетями/томами. Браузеры/profile desktop удалены;
телефонная тестовая вкладка, ADB forward/reverse и UI dump удалены,
пользовательский Chrome сохранён. [SDK/сервер 5041/ключи](android-tools/cleanup.json)
удалены после сверки принадлежности и хешей. Владелец
[подтвердил отключение USB-отладки и кабеля](android-tools/device-cleanup.json).
Чужие проекты и shared caches сохранены; живые тестовые стенды не оставлены.
Ресурс-свободные Node/TypeScript/документационные проверки стендов не создают;
mypy (68 файлов) использовал временный контейнер `--rm`, удалённый после проверки.
[Финальная инвентаризация](checks/final-cleanup.json) подтверждает отсутствие
T15-ресурсов и сохранение постороннего проекта. [Аудит архивов](checks/final-audit.json)
проверяет 14 receipts, оригинальные индексы и каждый сохранённый вход;
desktop/Android start/end и текущие исходники совпадают.
Проверка staged blobs подтвердила точные байты 3457 артефактов и всех 15
изменённых входов. `diff --check` исходников/документации прошёл; из него
исключены только неизменяемые копии исторических входов: исходные vendor
лицензии и baseline-файлы содержат прежние пробелы/пустые строки в конце.
[Результат и границы проверки](checks/publication-checks.json) сохранены;
архивные байты не исправлялись ради форматирования.

## Воспроизведение

После [подготовки локальных ресурсов](../../../viewer/README.md):

```powershell
npm --prefix viewer test
npm --prefix viewer run check
powershell -NoProfile -File tools/run-weather-viewer.ps1 -Project hmc-publication-t13-t15-new -Navigation -Updates -WithEdge -Final
```

Физический прогон использует отдельный проект/порты, `T13_ADB`,
`T13_ANDROID_SERIAL`, `-Navigation -Updates` и весь browser gate.
Каждая попытка архивируется и удаляется в `finally`; SDK/ADB/собственные
ключи учитываются отдельно. Источники, общие caches и чужие проекты сохраняются.
