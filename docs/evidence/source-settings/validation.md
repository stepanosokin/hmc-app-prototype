# WMS/API и источник — итог №46

Дата: 22.10.2026. Исходный HEAD: `15d815e68769633e1c0ac0ab12175cc6477f765a`.
Фаза архива: **перед единым коммитом**; commit/push/closure после этого снимка
проверяются отдельно в live tracker и итоговом отчёте пользователю.

## Результат

- Реализован согласованный раздел «WMS и API»: открываемые ссылки, readonly URL
  и копирование; WMS закрепляет run/revision, API — также точный срок/точку.
  Без точки подписан пример центра покрытия, исходные значения — K.
- Вместо JSON — русские поля источника/расчёта/срока/редакции/доступности/полноты,
  полный документ отдельно. Подпись удерживаемого кадра содержит его собственные
  run/time/revision, включая другую редакцию того же UTC.
- Viewer разрешает только существующий публичный scoped WMS path в тот же
  фиксированный gateway. Прежние bounds/timeouts/no-redirect/no-credentials
  сохранены; `/org`, unscoped GIS и admin paths не открываются.
- На живом `localhost:8140` перезапущен **только viewer**. [Исходная проба](probe.mjs)
  теперь passed: WMS=200 XML, point API=200 с числом, текст метаданных **320**
  символов против **8711**. [Скриншот](live-after/settings.png) и report сохранены.
- [Каталог не изменился](live-data-preserved.json): полный SHA256 до/после совпал,
  все 24 опубликованных срока сохранены. Worker/API/gateway/DB не изменялись.

## Локальные проверки

Выбранный complete gate, Windows, Docker Desktop, существующий locked image:

```powershell
powershell -NoProfile -File tools/run-weather-viewer.ps1 `
  -Project hmc-publication-t13-settings46accept -Port 8241 -ViewerPort 8240 `
  -WithEdge -Offline
```

[Chrome/Edge summary](browser-summary.json): Chrome 155.0.8059.85,
Edge 155.0.4283.62; оба прошли 1440×900, 390×844, 360×740, 640×360.
В каждой конфигурации реальные GetCapabilities/GetMap/point/metadata дали 200,
GetMap — PNG, clipboard проверен настоящим чтением буфера. Сняты оба шрифта
и обе подложки; отдельно сняты читаемые метаданные. Просмотрены desktop,
360×740 и 640×360: содержимое прокручивается, ширина не переполняется, элементы
и шкала остаются доступны. На коротком landscape панель показывает часть
содержимого, остальные адреса/поля доступны прокруткой.

Проверены выбор/удаление точки, пример покрытия, смена срока и редакции,
missing time, held loading, synthetic 503/410, подписи удерживаемого кадра
и same-time revision.
Синтетические сбои меняют только fetch в тестовой странице, не публикацию.
Перед прежней числовой регрессией страница навигируется заново.
Прежние три проекции, actual-sample GPU/PROJ/mask checks и 12 canonical picks
на браузер passed с неизменёнными научными допусками. GPU unavailable passed.
Нового cold-performance/SLA или нового QGIS/Android/iOS conformance не заявлено.
Мобильные размеры являются эмуляцией; новый физический device gate не запускался.

TypeScript/build, **12 existing viewer tests**, **2 bridge checks** и mypy
**75 Python files** passed. Последние проверки не повторялись после UI review:
[reuse manifest](checks/reused-static-inputs.json) подтверждает неизменность
75 Python inputs и шести зависимостей viewer tests. Остальные backend/GIS suites
не затронуты. GitHub Actions не использовались.

## Входы и попытки

- `before/`: первоначальный реальный отказ отсутствующего WMS и 8711 символ.
- `attempts/development/`, `attempts/states/`: успешные focused прогоны, по 199
  входов start/end; второй добавил реальные GetMap и synthetic states.
- `attempts/review-matrix/`: успешная полная матрица до review подписи редакции;
  она не смешивается с итоговой приёмкой.
- `attempts/acceptance/`: выбранная полная матрица после review, **199 одинаковых
  inputs start/end**, все source/runtime copies сверены по длине/SHA256.
  [Разница с review](input-difference.json) — только source-settings.ts,
  viewer-settings.mjs и сгенерированный source-settings.js.
- `revision-before/`, `revision-after/`, `revision-confirmed/`, `revision-final/`:
  адресная диагностика подписи прежней редакции; первая версия одноразового
  assert пострадала от кодировки PowerShell, как объяснено в [review](review.md).
  [DOM comparison](checks/revision-label-comparison.json) и исправленный probe
  проверяют именно отдельное имя удерживаемой редакции, не только текст статуса.
- Начальные статические corrections и отсутствие npm в PATH разобраны в
  [диагностике](diagnosis.md); проверочные логи сохранены в `checks/`.

`.gitattributes` в snapshots хранится как `gitattributes.snapshot`, чтобы не
изменять filters вложенного архива. Staged whitespace check исключает только
четыре `docs/evidence/source-settings/attempts/*/inputs/**` source snapshots;
их байты проверяются независимо. Изменённые файлы и остальные артефакты
проверяются staged check. Все попытки и отказы остаются в архиве.

## Cleanup и завершение

[Независимый receipt](cleanup.json) подтверждает ноль контейнеров/сетей/томов
во всех **четырёх** тестовых проектах. Каждый runner также архивировал и проверил
собственный retirement receipt. Standalone check containers отсутствуют;
статические Node/документные проверки ресурсов не создавали.
Browser reports подтверждают нулевой остаток процессов и удаление профилей,
включая диагностические пробы. Пользовательский `hmc-app-live` сохранён с пятью
работающими сервисами; каталог и исторические evidence не изменялись.

Текущих блокеров нет. После архивной/hash и staged/index проверки выполняется
один ticket commit/push в текущую ветку, затем readback remote HEAD и closure
№46. Родитель №12 и прежние закрытые задачи не меняются.
