# T23: повторная реализация после диагностики

Задача [№35](https://github.com/stepanosokin/hmc-app-prototype/issues/35), база
`e7f6722c638d7cc77611eb0ef4ef29bbe64ca2a7`, текущая ветка `main`.
**Реализовано и принято в уточнённом пользователем объёме: Chrome/Edge desktop и Chrome/Android. Safari/iOS отложен, не проверен.** Новые попытки не заменяют
исторические архивы [продолжения](../continuation/validation.md) и
[диагностики](../diagnosis/diagnosis.md).

## Реализация

MapLibre GL JS 6.15.0 сохраняет карту, WebGL2-слой погоды, масштаб и обработку
событий. Ортография использует параллельные лучи, WGS84-углы на сфере
отображения R=6378137 м, плоскую камеру pitch=0. Во время жеста меняются
общие lon₀/lat₀; Map/CRS не пересоздаются. Масштаб берётся от фиксированного
плоского transform. Новые состояния проверяются независимым PROJ/GRIB.

Уже закреплённый D3 Geo теперь рисует локальный Natural Earth и границу
покрытия в отдельном Canvas2D, а не только отсекает геометрию. Этот canvas
находится под прозрачным WebGL canvas; общий центр/масштаб используются
обоими. HTML-подписи/маркер и обратный экранный выбор используют тот же вид.
Это новый проверяемый вариант контекста внутри MapLibre-карты, без новой
зависимости или смены научной модели. EPSG:3576 сохраняет прежний фиксированный
MapLibre/proj4-путь. Native f32/mask/halo, frozen v2, nearest-native-cell point,
GRIB/Zarr/COG и внешние WMS/EDR/CRS не меняются.

`reader_sessions.py` переиспользует не более трёх свободных соединений на
поток для ролей `hmc_api`/`hmc_gateway`; максимальный возраст повторного
использования — 60 секунд. Соединения не передаются другим потокам,
решения access/retention не кешируются. Ошибки удаляют соединение из повторного
использования, commit/rollback завершают транзакцию. Короткие deadlines и
неподходящие роли используют первоначальный socket timeout; worker не получает
пул, поскольку владеет также сессионными advisory locks. Его намеренный
`database(timeout=120)` сохранён.

После профиля реального accounting соединения разделены по точным socket
timeouts 2/5 с; значение входит в identity вместе с PID/ролью/credentials.
Три idle-сессии покрывают удерживаемый retention reader, вложенное чтение и
accounting. Другие и динамические таймауты не округляются и не переиспользуются.
DB-профиль test_client без request-id не выполнял backend accounting и потому
не подтверждал затраты реального HTTP. В `android4` медиана прямого HTTP с
accounting уменьшилась примерно со 125 до 21 мс; HTTP Session reuse не помог
(после DB-исправления 21/24 мс). HTTP executor оставлен прежним.

В `tools/native-display/budgets.mjs` выделен явный gate cold ≤3000 мс,
warm ≤1000 мс, frame p95 ≤33/50 мс, числовой передачи ≤8 МиБ и managed arrays/
textures ≤128 МиБ. `-EnforceBudgets` в runner делает превышение ошибкой после
числового сравнения. Этот gate дал красный результат на старом архиве
(5653 мс). Команда `node tools/diagnose-t23-rotation.mjs` сначала дала красный
результат (0 обновлений при движении), затем зелёный (10 обновлений до отпускания).
Последняя проверяет обработчик с recording viewer; она не заменяет GPU gate.

## Попытки и наблюдения

- `rotate1`: native HTTP 4/4; браузерный сценарий начал проверку вращения в
  LAEA и дождался CDP timeout. Сценарий теперь явно переходит в ортографию.
  Неудачная попытка и 118 точных входов сохранены; проект retired.
- `rotate2`: настоящий Google Chrome 155.0.8059.85 найден в `Program Files (x86)`;
  Edge 155.0.4283.62. По три viewport, независимое сравнение ≤0,002397317 K,
  расхождений масок 0. Chrome rotation p95 19,4–20,4 мс, Edge ≤19,4 мс,
  Map сохраняется. Первый cold 4326/3405 мс ещё не проходит. На снимке
  Canvas2D перекрывал поле: исправлен порядок canvas. 120 входов start=end,
  архив сохранён, проект retired. Это development, не приёмка.
- `pool-profile1`: настоящий gateway без браузера 2937/2998 мс; main-thread
  API test_client 1214/267 мс. Новых DB-соединений стало 2 вместо 76 в
  прежней диагностике. Это подтверждает устранение значительной повторной
  аутентификации, но не прохождение cold-показа. Архив и 120 входов сохранены,
  проект retired.
- `rotate3`: настоящий экранный CDP click после вращения не выбирал точку.
  Причина — захват указателя на pointerdown перенаправлял обычный click.
  Захват теперь включается после начала перетаскивания. Неудачная попытка
  сохранена с точными входами, проект retired.
- `rotate4`: Chrome прошёл actual CDP click, PROJ/GRIB point и GPU-сравнение,
  контроль D3 и реальных DOM bounds; поле визуально видно, кнопки проверены
  elementFromPoint. p95 вращения около 19,5 мс. Cold первого вида 4687 мс,
  последующих 2562/2583 мс. Дополнительный профиль gateway показывает ожидание
  HTTP worker как основной оставшийся участок; сравнение reuse транспорта
  проводится отдельно. Полный архив и 120 входов сохранены, проект retired.

У API-профиля нет заголовка gateway request accounting и concurrency=1;
его время нельзя напрямую вычитать из browser/gateway wall time. cProfile
усиливает Python-затраты; отдельный прежний unprofiled DB connect дал 23,45 мс.
Последующие viewport имеют холодный browser field cache, но тёплый backend;
OS page cache нигде не сбрасывался. Перезапуск API/gateway перед первым
браузером сбрасывает их payload/sampler caches, загружая только код reader.

## Физический Android: промежуточные попытки

- `android1`: Chrome 155.0.8059.84, SM-S936B / Android 16, без эмуляции;
  cold 3604 мс. Touch drag отменялся после 2° вместо 8°: исправлен CSS
  `touch-action:none`. Вкладка и mappings удалены; Compose retired.
- `android2`: проверка сообщения вне LAEA завершилась ошибкой до физических
  жестов; сохранены ошибка, профили и точные 120 входов. Следующая попытка
  дополнила assertion фактическим состоянием; сбой в ней не воспроизвёлся.
- `android3`: trusted drag 8°, та же Map; pinch увеличил zoom 1,014 → 2,152
  без изменения центра. Полные page/OS screenshots сохранены и просмотрены.
  Независимый reference отклонил расстояние requested/actual tap 3,086 px при
  пределе 3 px. Драйвер теперь посылает целые CSS-координаты и сохраняет исходную
  географическую цель отдельно от реально отправленной точки.
- `android4`: cold 1675 мс, warm 135 мс; браузерная часть прошла. Reference
  снова отклонил tap: MapLibre event.point отличается примерно на CSS-пиксель
  от отправленного ввода. Обратное преобразование теперь использует original
  touch/mouse clientXY относительно canvas bounds. Допуски PROJ/GRIB не менялись.
  JS heap после interaction 15,31 МБ, backing store 7,93 МБ — это показатели
  renderer, не полная память браузера/VRAM. Gate целиком пока не прошёл.
- `android5`: cold 1689 мс, браузерная часть прошла; reference снова отклонил
  requested/actual tap. Original DOM input также оказался на соседнем CSS-пикселе:
  это уточняет причину как растеризацию внедрённого Android touch, а не только
  преобразование MapLibre. Драйвер выбирает центр CSS-пикселя вместо целой
  границы; допуск 3 физических пикселя оставлен прежним.

Все пять попыток архивированы с точными frozen inputs и retirement receipts
в `attempts/android1`–`attempts/android5`. Очистка телефона: собственная вкладка,
forward/reverse и HTTP listener удалены, пользовательский Chrome сохранён.
Reverse создаётся с `--no-rebind`, владение записывается только после успеха;
при отказе CDP предусмотрен HTTP close только известного task target id.

## Успешный кандидат: одинаковые 120 входов

`android6` и `desktop1` завершились с exit 0, native comparison и
`-EnforceBudgets` прошли. Их `probe-inputs-start.json` / `probe-inputs-end.json`
побайтно согласованы по path/SHA256; наборы desktop/Android совпадают между
собой и сохранены в `inputs` каждого архива.

| Среда | Первый cold, мс | Warm, мс | Rotation p95, мс | Максимальная ошибка, K |
|---|---:|---:|---:|---:|
| Chrome 155.0.8059.85, desktop | 1871,9 | ≤173,5 | ≤20,1 | 0,002397317 |
| Edge 155.0.4283.62, desktop | 1245,4 | ≤172,7 | ≤19,5 | 0,002397317 |
| Galaxy SM-S936B, Android 16, Chrome 155.0.8059.84 | 1896,3 | 174,8 | 19,8 | 0,002610777 |

Desktop проверяет 1440×900 / 390×844 / 360×740 на настоящем desktop GPU;
два малых viewport остаются эмуляцией. На Galaxy viewport 384×694 CSS,
1080×1952 canvas, DPR 2,8125; GPU ANGLE / Qualcomm Adreno 830, эмуляции нет.
Передача числового вида 5995872 байта. Managed estimate Galaxy 75142080 байт;
heap/backing store сохранены отдельно. Различия масок 0; реальные D3 controls
и DOM bounds согласованы, пределы geometry <0,001 px и layout <0,1 px сохранены.
Канонический point API сравнен с сырым GRIB после настоящего экранного ввода.

Trusted Android drag изменил lon на 8° без замены Map; pinch увеличил zoom без
изменения центра. Independent GPU readback проверен также после этих жестов.
Tap выполняется при явно сброшенном zoom=0. Контроль координаты отправленного
tap <3 physical px сохранён; драйвер выбирает центр CSS-пикселя.

Первый Chrome/Android вид включает холодные browser field и API payload/sampler
caches после restart. Edge выполняется после Chrome с тёплым backend; последующие
viewport имеют свежий browser field cache при тёплом backend. OS cache не сбрасывался.
Raw reports и скриншоты всех viewport/режимов сохранены; полные Android OS/page
и desktop 360×740 снимки просмотрены. Техническая панель/атрибуция доступны.

Команды (из корня репозитория):

```powershell
$env:T23_ANDROID_SERIAL='<paired task device>'
$env:T23_ADB=Join-Path (Get-Location) 'data/tools/t23-android/platform-tools/adb.exe'
powershell -NoProfile -File tools/run-native-display.ps1 -Project hmc-publication-t23a-android6 -Image hmc-publication:t23 -Interaction -EnforceBudgets -Port 8137
# Отдельный процесс без Android env:
powershell -NoProfile -File tools/run-native-display.ps1 -Project hmc-publication-t23a-desktop1 -Image hmc-publication:t23 -Interaction -WithEdge -EnforceBudgets -Port 8137
```

Для воспроизведения нужны новые project/report names и новое сопряжение;
секретный pairing code не архивируется. Image ID и зависимости сохранены в
retirement/archive inventories. Local Platform Tools 37.0.1 downloaded from Google;
ADB executable SHA256 сохранён в browser report. Task server использовал порт
5041, не default 5037. После последней Android-пробы mappings, собственная вкладка,
сервер, listeners и неизменившиеся task-generated home keys удалены. Пользователь
подтвердил удаление сопряжения и выключение wireless debugging на телефоне;
см. [adb-cleanup.json](adb-cleanup.json). Пользовательский Chrome сохранён.

## Сервисные проверки и итоговая граница

21.10.2026 пользователь явно отложил Safari/iOS и поручил завершить №35,
создать commit и push; см. [решение о завершении](completion-decision.md).
Исходная полная матрица с Safari не проверена; согласованная матрица данной
приёмки — Chrome/Edge desktop и Chrome/Android.
Актуальные Chrome/Edge/Galaxy результаты приведены выше; они подтверждают
одинаковые frozen runtime-входы. Старые Android-пробы не используются вместо них.

Cold/HTTP-исправление и browser budgets подтверждены. T9 Development полностью
прошёл (`attempts/t9-development1`, 104 замороженных service inputs, start=end),
включая budgets 3/3, policies, edge isolation, остановку DB и restart/access.
Полный T9 завершился успешно: T5 actual 24 срока и retained readers, 28 batches/
редакций после restart, budgets 3/3, policies/cache/edge/store failure, full suite
46 tests (22 opt-in skips), access restart и неизменные 104 inputs. Архив
`attempts/t9-full1` retired; отдельные opt-in сценарии выполняются своими gates.

`t7-full1` обнаружил несогласованную старую фикстуру: четыре публичных reader
при действующей public concurrency=2 получили корректный 429. Все другие
retention-предпосылки прошли; отказ сохранён и проект retired. Изменён только
opt-in тест: он временно меняет concurrency на 4 при сохранении остальных
эффективных полей policy, затем восстанавливает точную исходную строку/отсутствие
с readback. Reader readiness требует 200; allowlist 200/503, реальное перекрытие
collection и удаление не ослаблены. `t7-full2` прошёл 4/4, startup/shutdown
в трёх import orders, restart expiry и неизменные 104 service inputs; policy
восстановлена с readback. Его архив verified retired.
Производственные бюджеты не меняются. Отличие от browser/T9 inventory —
единственный test-only файл, см. [validation-input-difference.json](validation-input-difference.json).

Два отдельных image audit подтвердили все 77 закреплённых версий пакетов.
Raw hashes двух lock-файлов в старом image отличаются только CRLF/LF: после
нормализации их полные байты совпали с текущими. См.
[image-dependencies.json](image-dependencies.json), `attempts/image-audit1/2`.
Неудачный абсолютный `-ReportDirectory` при первом retirement повторён с
поддерживаемым относительным путём; оба audit проекта verified retired.

Итоговый `final-checks1` на окончательном дереве: mypy 58 файлов, ordinary suite
46 tests (30 private-service skips), archive checker tests 16/16, historical
references 876 и T23a references 1162. Это проверка исторической целостности,
не заявление о проверке Safari/iOS. Unbound decoder/trials code из browser/T9 image
совпал с текущими 15 исходниками после нормализации CRLF/LF; publication/tests
выполнялись из read-only workspace mounts. Все 120 финальных входов сохранены
в [final-input-inventory.json](final-input-inventory.json).

Основные service-команды:

```powershell
docker tag hmc-publication:t23 hmc-publication:t9
powershell -NoProfile -File publication/run-budgets.ps1 -Project hmc-publication-t9-t23dev1 -Port 8137 -Development -SkipBuild
powershell -NoProfile -File publication/run-budgets.ps1 -Project hmc-publication-t9-t23full1 -Port 8137 -SkipBuild
powershell -NoProfile -File publication/run-retention.ps1 -Project hmc-publication-t7-t23full2 -Port 8137 -SkipBuild
python -m unittest discover -s tools -p test_evidence.py -v
python tools/check_evidence.py
python tools/check_evidence.py --native-display
```

Нужны свежие имена проектов; `hmc-publication:t7` перед T7 собран текущим
Dockerfile с hash-locked зависимостями. Scoped WMS/QGIS, recovery и tile-cache
контракты не менялись; отдельные QGIS/T6 цепочки не повторялись. T5/T8 service
регрессии покрыты согласованным объединённым T9, retention — отдельным T7.

После всех попыток сохранены retirement receipts, исходники и неудачные
результаты. [Итоговый inventory](final-resource-inventory.json): **19 проверочных
проектов retired, тестовых containers/networks/volumes 0**, listeners
8137/8138/5041 и собственных browser processes 0; task-generated ADB keys удалены.
Wireless pairing/debugging на Galaxy удалены/выключены по подтверждению пользователя.
Живых стендов не оставлено; shared Docker images/tool cache сохранены неактивными.

Общий [artifact-index.json](artifact-index.json) связывает выбранные browser
результаты, service gates, failed attempts, review, inputs и cleanup. Все
записанные SHA256/размеры проверены; различие test-only T7 fixture явно сохранено.

Объём №35 завершён с явно отложенной Safari/iOS validation. Критерий 5
уточняется под подтверждённую пользователем матрицу и отмечается по имеющимся
свидетельствам; пропущенная Safari-проверка не выдаётся за успешную.
Итоговое [чтение tracker перед публикацией](issue-status.json): 8/8,
реализация завершена; закрытие следует после единственного commit/push и
проверки remote HEAD. Родитель и закрытая №37 сохраняются.
