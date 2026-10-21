# T16 / M4 — локальный runtime рабочей карты

21.10.2026 выполнен утверждённый объём [№28](https://github.com/stepanosokin/hmc-app-prototype/issues/28):
карта работает без обязательных публичных runtime-сервисов. Добавлены режим
проверки `-Offline`, реестр прав и свидетельства A11/T13–T15. Эта запись имеет
фазу **после приёмки и очистки, до commit/push/закрытия**; окончательный Git/tracker
статус проверяется после публикации отдельно. Родитель №12 и завершённая карта
планирования не изменялись.

## Матрица и результат

| Платформа | Проверка |
| --- | --- |
| Google Chrome 155.0.8059.85 / Windows / RTX 4070 Laptop, WebGL 2 | [desktop-final2/browser](attempts/desktop-final2/reports/browser/browser.json): 1440×900, 390×844, 360×740, 640×360; последние три — эмуляция |
| Edge 155.0.4283.62 / Windows / тот же GPU | [desktop-final2/browser-edge](attempts/desktop-final2/reports/browser-edge/browser.json): та же полная матрица |
| Galaxy S25+ / SM-S936B / Android 16 / Chrome 155.0.8059.84 / Adreno 830 | [android-repeat1](attempts/android-repeat1/reports/browser/browser.json): физические touch, pinch, native select; CSS viewport 384×694 |
| Недоступный WebGL | [явное русское состояние и Меркатор](attempts/desktop-final2/reports/browser-unavailable/browser.json), без автоматической подмены режима |

Safari/iOS не проверен и не заявляется поддерживаемым; действует граница
поддержки принятого T23/просмотрщика. Эти проверки устанавливают M4/A11 на
указанной матрице, не производственную ёмкость/A12 или готовность будущих модулей.

## Критерии №28

| Критерий | Проверенное основание |
| --- | --- |
| Локальные подложка, стили, шрифты и права | [Реестр ресурсов](runtime-rights.md), pinned SHA256 подготовки, attribution/локальные лицензии в панели; системные шрифты без font API |
| Network audit и недоступная публичная runtime-сеть | `network` каждого выбранного browser report: внешние HTTP(S) блокируются до отправки; page/worker/nested-worker probes действительно перехвачены; обязательных внешних запросов нет |
| Реальное поле, legend, point, run/time, явные updates и русский UTC UI | Полные T13–T15 сценарии, trusted inputs, независимые raw-GRIB/PROJ point/GPU checks, реальные gateway/EDR/scoped WMS и API/GPU failure/recovery |
| Interaction/A11 для M4 | [Итоговый аудит](checks/final-audit.json), полный desktop и физический Android, исходные reports/screenshots/frozen inputs |
| Локальные shaders/decoder/workers/WASM и capability matrix | Шейдеры и decoder — локальный код проекта/MapLibre; worker и proj4 закреплены SHA256; WASM текущему viewer не требуется; palette/units не скачивают блоки повторно; GPU unavailable и context loss проверены |
| Три проекции выбранного T23 пути | Mercator, строгая ортография и EPSG:3576 в реальном GPU-слое; inverse picking сверено независимым PROJ и native-cell значениями; synthetic horizon/pole/dateline/45° cut дополняют реальные данные; переключение сохраняет выборку |

`Fetch` включён до загрузки приложения, браузерный кеш отключён, service worker
обходится. Проверяется приложение и его dedicated workers; сеть остальных
приложений/фоновых процессов устройства не отключается. Setup-time интернет
разрешён. Ошибка DNS сама по себе не даёт успешный probe: отчёт требует журнал
всех трёх реально заблокированных URL. Любая другая внешняя зависимость отклоняет gate.

Фиксированные версии/права указаны в реестре. Источник — приватный реальный
ICON-EU T_G с SHA256 `dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Синтетический перекрывающийся расчёт и коррекция +1 K явно обозначены и служат
только проверке updates/races. Исходный GRIB в распространяемый архив не включён.

## Числовая проверка и взаимодействия

Независимые [Chrome](attempts/desktop-final2/reports/native-comparison.json),
[Edge](attempts/desktop-final2/reports/native-comparison-edge.json) и
[Android](attempts/android-repeat1/reports/native-comparison.json) comparisons
прошли: максимальная ошибка по всей выбранной матрице ≤0,002574 K при допуске
0,01 K, mask differences 0. Canonical inverse picks: по 12 desktop и 3 physical
Android, nearest-native-cell и provenance совпали с raw GRIB. После обновления
отдельно сверены GPU/point/EDR/WMS; ошибка ≤0,001754 K, маски 0.

Проверены newest usable run/first time, явный выбор редакции, отсутствие +2 ч,
отмена устаревших fetch/decode/upload/point completions; отказ от/принятие
публикации, прежняя usable revision при API/GPU failure, атомарная замена
поля/точки/identity и переход к новому расчёту. Проверялись реальные ответы,
не подменённые numerical fixtures. Вращение глобуса непрерывное, на телефоне
выполнен pinch. Ограничения 8 МиБ/выборку и 128 МиБ managed numerical resources
не превышены. Это функциональная приёмка, не performance/capacity benchmark.

Просмотрены полные HTML/page/OS screenshots телефона, малый portrait 360×740,
landscape 640×360, обе подложки и оба шрифта, три режима, point/settings панели,
UTC/time bar и сообщения отказов. Историческое оформление viewer не изменялось.

## Frozen inputs и проверки

В каждой попытке сохранены все **181** source/runtime inputs, включая build,
worker, vendor и basemap. У выбранных попыток start/end совпадают. После полной
Android-приёмки изменена только desktop-ветка cleanup runner: оба review-агента
подтвердили незатронутость Android и необходимость полного desktop rerun.
[Точное различие](checks/validation-input-difference.json) и
[diff](checks/desktop-cleanup-only.diff) сохранены; остальные 180 входов
идентичны. Android не выдаётся за запуск на новых байтах runner. Все текущие
application inputs совпадают с обеими выбранными приёмками.

Review по Standards/Spec завершён без оставшихся замечаний:
[review.md](review.md). После исправлений полный desktop gate повторён.
Python suite: **46 tests, OK, 22 opt-in skips** для отдельных service-профилей;
actual-source publication/gateway/browser/point/EDR/WMS этого gate прошли отдельно.
Полный mypy CI scope — **70 файлов**, runner scope — 59; TypeScript и **6 Node
tests** прошли. Исторические T13/T14/T15 архивы сохранены и проверены: 1362,
1012 и 3459 references соответственно. Новых изменений publication/access/
retention/QGIS контрактов нет; их дополнительные service gates не требуются.

Ресурс-свободные Node/документационные проверки стендов не создавали;
containerized static/archive checks использовали `--rm`. Неудачные попытки,
ошибки форматирования вспомогательных отчётов и их успешные повторы сохранены
в [Development-записи](development.md) и `checks/`.

## Архив и очистка

Все **8** изолированных проектов retired; для каждого проверены оригинальный
artifact index, receipt, дополнительные полные frozen inputs и пустые
container/network/volume inventories. Финальная
[инвентаризация](checks/final-cleanup.json): 0 task browser/ADB processes,
0 listeners, живых task stacks нет. Посторонний `vgdb_tools`, исходники,
исторические свидетельства и shared images/caches сохранены.

Отдельная cleanup fixture явно отделена от GPU-приёмки. Временные телефонные
вкладки, UI dumps, ADB mappings/server 5041, SDK и проверенные по SHA256
task-created keys удалены. [Локальная очистка](android-tools/cleanup.json) и
[подтверждение владельца](android-tools/device-cleanup.json) удаления pairing
и выключения wireless debugging сохранены.

Архив публикуется с SHA256/размерами/Git object identities в `artifact-index.json`.
При проверке whitespace исключаются только неизменяемые `reports/inputs/**`
и сырой `checks/desktop-cleanup-only.diff`; source/docs checks остаются обязательными.
Перед commit проверяются staged blobs, после commit — HEAD blobs и remote HEAD.

## Воспроизведение

После [локальной подготовки viewer](../../../viewer/README.md):

```powershell
powershell -NoProfile -File tools/run-weather-viewer.ps1 -Project hmc-publication-t13-t16-new -Offline -Navigation -Updates -WithEdge -Final
```

Физическая матрица использует отдельный проект/порты, явно заданные `T13_ADB`
и `T13_ANDROID_SERIAL`, те же `-Offline -Navigation -Updates`, без `-WithEdge`.
Каждая попытка автоматически архивируется и удаляется в `finally`.
