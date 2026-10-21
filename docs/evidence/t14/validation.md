# T14 — навигация по расчётам и срокам

Задача [№26](https://github.com/stepanosokin/hmc-app-prototype/issues/26).
Исходная точка: `ff297f8ace181daaa874ceb9ddca714e98de0dea`.
Объём: выбор опубликованного расчёта/редакции и срока в рабочем просмотрщике,
очистка пропусков, защита point/tile/decode/GPU от устаревших завершений.
Родитель №12, завершённая карта планирования и научные контракты не изменены.

## Поведение

Новейший пригодный расчёт открывается на первом опубликованном сроке;
смена расчёта начинает его шкалу заново. Навигация по времени закрепляет
расчёт и редакцию; отсутствующий +2 ч между +1/+3 ч остаётся выбираемым.
Пропуск немедленно очищает overlay, точку, текст карточки и очередь GPU.
Новая выборка отменяет ранее запланированное создание карты, а поздняя
ошибка старого вида не заменяет состояние текущего выбора.

CPU-подготовка и GPU-загрузка идут блоками между кадрами. Частичный слой
не отображается; удаление слоя отменяет следующий кадр, очищает очередь
и удаляет его текстуру. Ключ renderer дополняет идентичность расчёта,
редакции и срока сведениями об encoding/units/stored size. Смешивания
сроков, расчётов и редакций нет; пространственная bilinear-интерполяция
и принятый native-display/1 не менялись.

## Проверяемые границы

Требования задачи и parent задают границы проверки: видимые browser controls
и реальные API gateway над worker/PostGIS/GeoServer. Результаты point берутся
из canonical API; тесты не вычисляют их по цвету карты и не подменяют ответы.
`?validation=1&fixtures=1` явно включает подписанный тестовый overlapping run.
Обычный просмотрщик его исключает.

Согласованный illustrative interaction prototype выполняется в отдельном
браузерном документе. Проверяются его видимые состояния first/reset/pinned/gap;
DOM-состояния и SHA256 сохраняются для сопоставления с рабочими controls.
Иллюстративные числа прототипа не заменяют реальный GRIB.

Задержки удерживают реальные fetch/body completion и продолжение после реальной
записи `texSubImage3D`. После gap или run change завершаются старые операции:
ни одна не записывает прежнюю текстуру и не возвращает прежний overlay.
Удаление проверяется по конкретному объекту GPU texture. Отдельная задержка
point response проверяет отбрасывание ответа после смены расчёта.

## История Development

- [dev1](attempts/dev1/reports/browser/browser.json): сценарий пытался закрыть
  drawer, уже закрытый сменой расчёта. Исправлен тест. В этой Development-попытке
  исходник main.ts редактировался после start snapshot; она не устанавливает
  frozen-input acceptance и не используется для него.
- [dev2](attempts/dev2/reports/browser/browser.json): сценарий ошибочно считал
  второй пункт списка другим расчётом. API возвращает несколько редакций;
  тест исправлен на поиск расчёта по идентичности.
- [dev3](attempts/dev3/reports/browser/browser.json): целевой сценарий прошёл,
  включая шесть numeric races и поздний point response. Запуск ограничен
  навигацией и не подтверждает полную матрицу или числовую точность; записанные
  пустые comparison views не используются как числовое свидетельство.

Все три попытки архивированы и имеют проверенные retirement receipts.
Замечания двух независимых осей review и исправления: [review](review.md).

## Полная приёмка 21.10.2026

[final1](attempts/final1/reports/process-results.jsonl) выполнен после всех
исправлений review с `-Navigation -WithEdge -Final`, без focused-ограничения.
Во всех процессах native exit code 0. [Начальные](attempts/final1/reports/inputs-start.json)
и [конечные](attempts/final1/reports/inputs-end.json) идентичности 174 входов
совпадают; полные исходные байты сохранены в `attempts/final1/reports/inputs/`.
Хеши текущих входов и полных копий проверены отдельно.

| Проверка | Результат |
| --- | --- |
| [Chrome 155.0.8059.85](attempts/final1/reports/browser/browser.json) | 42 проверки, 7 управляемых гонок, 4 viewport, 0 необработанных ошибок |
| [Edge 155.0.4283.62](attempts/final1/reports/browser-edge/browser.json) | 42 проверки, 7 управляемых гонок, 4 viewport, 0 необработанных ошибок |
| [Chrome: raw GRIB/PROJ](attempts/final1/reports/native-comparison.json) | Ошибка ≤0,002159 K при допуске 0,01 K; расхождений масок 0 |
| [Edge: raw GRIB/PROJ](attempts/final1/reports/native-comparison-edge.json) | Ошибка ≤0,001749 K при допуске 0,01 K; расхождений масок 0 |
| [Canonical point](attempts/final1/reports/browser-canonical.json) / [Edge](attempts/final1/reports/browser-edge-canonical.json) | По 12 реальных кликов, nearest-native-cell и обратные координаты совпали с независимым эталоном |
| [Полный Python suite](attempts/final1/reports/full-suite.stderr.log) | 46 tests, OK; 22 пропущены по явным флагам отдельных T5–T12 стендов |
| [Node](checks/node.log), TypeScript | 5 tests passed; проверка типов и сборка успешны |
| [Полный CI mypy](checks/preflight.json) | 67 файлов, ошибок нет |
| [GPU недоступен](attempts/final1/reports/browser-unavailable/browser.json) | Русское объяснение и явное действие Меркатора; cleanup успешен |

Каждый браузер проверил 1440×900, 390×844, 360×740 и 640×360 в трёх режимах.
Windows, ANGLE/D3D11, NVIDIA GeForce RTX 4070 Laptop GPU; мобильные размеры —
эмуляция viewport, не физические устройства и не эксплуатационные измерения №31.
Числовой допуск и projection/mask contracts сохранены.

Визуально просмотрены desktop orthographic, 360×740 Mercator с обоими шрифтами
и обеими подложками, 360×740 orthographic и 640×360 Mercator point/LAEA.
Настольная и мобильная компоновка остаётся принятой T13; новая работа не меняет CSS.
Снимки сохранены рядом с соответствующими browser reports.

Все шесть критериев №26 подтверждены полным запуском. Четыре проекта
архивированы и удалены: [итоговый inventory](final-resource-inventory.json)
и retirement receipts в каждой попытке подтверждают отсутствие ресурсов.
Каждый browser runner удалил собственный процесс/profile. У временного
typecheck container использован `--rm`; ресурс-свободные проверки не создавали
стендов. Live stacks не оставлены; исходный GRIB, shared images/caches и
исторические свидетельства сохранены.

[Индекс архива](artifact-index.json) фиксирует размер и SHA256 каждого файла.
Индексы retirement сверены с копиями отчётов; дополнительно восстановлены и
сверены все исходные входы, включая расширения, не копируемые retirement helper.

## Воспроизведение

После подготовки локальных ресурсов по [инструкции просмотрщика](../../../viewer/README.md):

```powershell
npm --prefix viewer test
npm --prefix viewer run check
powershell -NoProfile -File tools/run-weather-viewer.ps1 -Project hmc-publication-t13-t14-new -Navigation -WithEdge -Final
```

Нужны исходный частный GRIB с SHA256 из preflight, существующий locked образ
`hmc-publication:t12`, Chrome/Edge и локальный Docker. Runner использует отдельные
volumes/ключи и явные часы `2026-10-19T05:00:00Z`, сохраняет входы/отчёты
и выполняет retirement в `finally`.

Состояние этой записи — до коммита: задача открыта, commit/push pending.
Объём №26 реализован и проверен полностью; блокеров нет. После commit/push
проверяются remote HEAD и закрытое live-состояние с полным checklist;
они сообщаются отдельно в итоговом результате.
