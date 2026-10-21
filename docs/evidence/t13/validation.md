# T13 — приёмка рабочей карты

[Задача №25](https://github.com/stepanosokin/hmc-app-prototype/issues/25),
21.10.2026. База review: `ea89769c9f1de99bcec6e7118b66dc241d9f1770`, ветка `main`.
Объём T13 выполнен. Полный нагрузочный отчёт относится к №31; этот отчёт
не устанавливает эксплуатационную ёмкость или соблюдение полного frame budget.

## Входы и воспроизведение

Команды и ограничения приведены в [README просмотрщика](../../../viewer/README.md).
Окончательные попытки: [desktop2](attempts/desktop2/reports/process-results.jsonl)
и [android4](attempts/android4/reports/process-results.jsonl). Перед ними выполнено
[двухосевое review](review.md), открытых замечаний нет. В каждом запуске проверены
неизменность 172 входов start/end и отсутствие Git-filter преобразования новых
исходников. Инвентари обоих запусков совпадают; все 172 файла, включая runtime
vendor/build/land, сохранены в [inputs](inputs) с [SHA256](frozen-inputs.json).
Retirement архивирует ограниченный набор расширений, поэтому полный снимок
дополнительно скопирован из исходного start snapshot с проверкой каждого SHA256.

Образец: `ICON_EU_T_G_2026101500.grib2`, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Сам частный GRIB в Git не добавлялся. Контракт `hmc-native-display/1`, SHA256
`3c245dada032f3cf4ee0f26e2c371e863ba0094a3c5f8de4e5f2c6af3ef4c1f0`,
утверждён в закрытых №35/№37. Frozen v2 не изменён. Принятые
[encoding/QGIS данные T23a](../t23a/validation.md) и
[QGIS baseline T12](../t12/validation.md) сохранены. Внешние point/EDR/WMS,
datum operation и отдельный COG bound не менялись; новых QGIS CRS утверждений нет.

Реальные сервисы: locked Compose, отдельные тома/ключи, реальная публикация
сроков +1/+3 ч, пропуск +2 ч, перезапуск API/gateway перед браузером. Браузеры
используют видимые controls и gateway; regional context, worker, шрифты и код
не запрашиваются из внешних сервисов во время работы. Старый `reports/browser.json`
— входной исторический compatibility baseline; текущие отчёты находятся именно
в `reports/browser/browser.json` и `reports/browser-edge/browser.json`.

## Браузеры и численная проверка

| Среда | Реальный renderer | Размеры | GPU max error | Канонические клики |
| --- | --- | --- | --- | --- |
| Chrome 155.0.8059.85, Windows | RTX 4070 Laptop / D3D11, WebGL2 highp 23 | 1440×900, 390×844, 360×740, 640×360 | 0,001748906 K | 12 |
| Edge 155.0.4283.62, Windows | RTX 4070 Laptop / D3D11, WebGL2 highp 23 | те же 4 размера | 0,001748906 K | 12 |
| Galaxy S25+ SM-S936B, Android 17, Chrome 155.0.8059.84, USB | Adreno 830, WebGL2 highp 23 | физический CSS 384×694, без emulation | 0,002334259 K | 3 |

Каждый размер проверен в Меркаторе, строгой вращаемой ортографии и EPSG:3576.
Raw-GRIB/PROJ reference независим от browser kernel. Итоги:
[Chrome](attempts/desktop2/reports/native-comparison.json),
[Edge](attempts/desktop2/reports/native-comparison-edge.json),
[Galaxy](attempts/android4/reports/native-comparison.json).
Во всех случаях различий масок 0; границы покрытия, соседние блоки/halo,
синтетические nodata/полюс/антимеридиан/горизонт и отсечение LAEA проверены отдельно
от реального покрытия. Совокупная ошибка ≤0,01 K; native f32 encoding сохраняет
исходные значения (0 K по принятой проверке T23a, предел ≤0,001 K).
DOM-совмещение ≤0,02070 px при допуске 0,1 px; синтетическая геометрия
≤2,683 м при diagnostic-допуске 10 м. Недопустимый Mercator pole не выдаётся
за конечную точку. Канонические nearest-native-cell клики сверены с исходным
GRIB, идентичностью выборки, source SHA, row/column и независимым inverse pick.

Снимки реально просмотрены: [desktop](attempts/desktop2/reports/browser/1440x900-mercator.png),
[минимальный телефон](attempts/desktop2/reports/browser/360x740-laea-point.png),
[физический Galaxy](attempts/android4/reports/browser/physical-laea.png).
Архив содержит все режимы, два шрифта и обе подложки на desktop/360×740,
короткий landscape, карточки точек и физические full-page снимки. Native select
Galaxy выбирается через настоящий Android dialog; touch click ожидает реальное
DOM click. Реальные drag/pinch проверяют поворот, zoom и сохранение центра.

Safari/iOS ранее явно отложен владельцем в T23 и не входит в поддерживаемую
матрицу. Требуются WebGL2, highp ≥23, texture arrays и проверенные лимиты.
Реальный `--disable-webgl` даёт русскую причину и явный переход к Меркатору;
автоматической замены вида или перспективного глобуса нет.

## Критерии №25

| Критерий (порядок в задаче) | Проверка и свидетельство |
| --- | --- |
| 1. Compose, TypeScript/MapLibre, реальный scalar | `viewer/`, public-only `publication/viewer.py`, compose runner; реальные снимки и browser requests. Только T_G поверхность, единицы/легенда/источник. |
| 2. Русский UI, UTC, возраст/полнота | Browser assertions и source panel; реальные reference/valid timestamps, отсутствие фиктивной полноты и неверной подписи 2 м. |
| 3. Каноническая точка | 27 кликов основной матрицы, `browser-canonical.json` / `browser-edge-canonical.json`, raw-GRIB reference, раскрываемые cell/provenance. |
| 4. Раздельные состояния, без секретов | Видимый missing +2 ч удаляет старое поле/точку; loading/error/outside/native_nodata имеют отдельные русские ветки `main.ts` и обработку null reason. Маски nodata проверены синтетическим GPU supplement, не выдаются за actual nodata GRIB. Browser network проверяет локальность/отсутствие auth headers; bridge whitelist не передаёт cookies/auth и запрещает redirects. |
| 5. Реальные controls/API и локальная подложка | Chrome/Edge/Galaxy reports: actual click вызывает новый point request; независимый inverse/raw-GRIB и неизменённый QGIS baseline выше. Все runtime HTTP requests same-origin. |
| 6. Основной GPU numeric путь | Native f32/mask texture array, одна bilinear; palette/unit switches не добавляют block requests. WMS/images не используются для погоды. |
| 7. Погрешность/маски/границы | Три independent comparison отчёта выше + T23a encoding; scalar value берётся из point API. |
| 8. Bounded lifecycle/fallback | 18 блоков, 2 fetch, 8 МиБ, 128 МиБ estimate; Node stale/abort/invalid tests. Реальная потеря контекста, смена вида при loss и restore в обоих desktop browsers; явный unsupported-WebGL сценарий. Review проверяет удаление Canvas2D и GPU ресурсов до смены Map. |
| 9. Desktop/mobile и первичные измерения | Настоящий Adreno + desktop GPU, таблица ниже и raw timings. Цели согласованы в T23; полный workload/performance readiness остаётся №31. Нет blending/U/V/particles. |
| 10. Макет T24 | Проверены снимки тёмных панелей, map/context, верхнего выбора, нижнего времени, легенды, карточки точки, responsive controls; ссылки на утверждённый T24 сохранены. |
| 11. Initial/current fit | Каждая навигация начинается с Mercator fit; видимые fit controls, выборка сохраняется; читаемые °C/K легенды в матрице размеров. |
| 12. Пререквизиты и три проекции | №35/№36/№37 закрыты до приёмки; ортография без perspective, EPSG:3576 ≥45°N, внешние контракты сохранены. |
| 13. Alignment/inverse во всех режимах | Реальный source/GPU/DOM/control grid и отдельно помеченные synthetic masks/geometry в каждом mode; fixed datum и COG bound не расширялись. |
| 14. Mercator при открытии, loss/unsupported | Начальный mode проверяется при каждой навигации, persistence нет; fit текущего покрытия, сообщение/кнопка Mercator, реальный loss→смена вида→restore. |

## Первичные измерения и пределы вывода

| Показатель | Chrome desktop | Edge desktop | Физический Galaxy |
| --- | --- | --- | --- |
| Cold navigation → полный первый field | 1825 мс | 1342 мс | 2341 мс |
| Warm mode switch (вся матрица) | ≤104 мс | ≤110 мс | ≤120 мс |
| Один block decode, максимум | 1,1 мс | 1,3 мс | 2,6 мс |
| Один upload submission, максимум | 0,5 мс | 0,5 мс | 0,7 мс |
| Managed arrays/textures/framebuffer estimate | ≤52 396 488 B | ≤52 396 488 B | ≤45 956 040 B |
| Wire на выборку с metadata | 5 995 872 B | 5 995 872 B | 5 995 872 B |
| Render interval p95 во время trusted drag | 34,9 мс | 34,2 мс | 55,9 мс |

Cold включает scripts/workers, metadata/field I/O, shader/upload/первый complete
render; отдельный browser profile, новая страница, перезапущенные API/gateway.
OS page cache не объявляется очищенным. Warm и cold имеют отдельные границы.
Upload — CPU submission без `gl.finish`, не GPU execution time. Память — учтённая
оценка, не весь driver/browser RSS; heap сохранён отдельно. Эмуляция узкого
экрана использует desktop GPU и не подменяет физический Galaxy.

**Frame-цели T23 (33 мс desktop / 50 мс mobile) этим коротким input-driven
измерением не подтверждены:** p95 включает cadence CDP dispatch и ожидание
доставки событий. Это сохранённый исходный результат, а не проход performance
gate и не доказательство, что задержка целиком в renderer. Диагностика driver
cadence/GPU и полный воспроизводимый workload остаются №31. Cold ≤3 с,
warm ≤1 с, transfer ≤8 МиБ и managed estimate ≤128 МиБ в данной выборке соблюдены.

## Сервисные проверки, review и очистка

Отдельный свежий [T5](attempts/t5-final1/reports/process-results.jsonl) прошёл
incremental/revisions, legacy publication, restart retention, full Python suite
(46 tests, 22 условных skip), historical evidence gate и mypy 59 файлов.
Раздельный проект необходим: T5 ожидает начальный каталог +1 ч, а карта уже
публикует +1/+3 ч. Неуспешный combined `desktop1` сохранён без изменения assertions.
После исправления только типов старого диагностического инструмента повторён
[полный CI mypy, 67 файлов](checks3/python-types.stdout.log).
TypeScript и 4 Node-теста прошли в [checks2](checks2/process-results.jsonl);
история отказов и исправлений — [development](development.md).

Все 16 попыток (включая отказы до создания ресурсов) имеют проверенные retirement
receipts; [копии и SHA256 проверены](archive-copy-verification.json).
[Итоговый inventory](final-resource-inventory.json): контейнеры/сети/тома всех
проектов отсутствуют, временные mypy-контейнеры удалены, live stacks не оставлены.
Browser runners проверили удаление собственных profiles/processes; Android
закрыл только свою вкладку, удалил mappings/XML, сохранил пользовательский Chrome.
[Task ADB/keys/SDK очищены](android-tools/host-cleanup.json), приватные ключи и
коды сопряжения не архивировались. Владелец
[подтвердил](android-tools/device-cleanup.json) удаление новой записи и выключение
беспроводной отладки. Shared caches и исходные данные сохранены.

Данный документ фиксирует pre-commit фазу: №25 открыт, commit/push pending.
После commit/push live состояние проверяется отдельно в итоговом сообщении;
родитель №12 и завершённые задачи не меняются. Блокеров объёма T13 нет.
