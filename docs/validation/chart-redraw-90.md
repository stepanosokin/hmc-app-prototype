# Кэш рамки и троттлинг подписи на графике точки — №90

Задача [№90](https://github.com/stepanosokin/hmc-app-prototype/issues/90).
Начальный commit `36fd8d0`, ветка `main`. Уровень тестирования — базовый;
среда — локальная сборка viewer, Chrome по пути
`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` и свежий
изолированный стек публикации (порты 8142/8143); живой стенд `127.0.0.1:8140`
не изменялся.

## Причина и изменение

`locate` в `PointChart` (`viewer/point-chart.ts`) на каждый `pointermove`
вызывал `getBoundingClientRect()` (потенциально форсирует layout) и
`describe()` (обновляет `<output>` и `aria-valuetext`).

- Рамка SVG кэшируется в `rect`; `getBoundingClientRect()` читается только при
  первом наведении после изменения размера, прокрутки или нового наведения.
  Кэш сбрасывают `ResizeObserver`, `pointerenter` и `scroll` (capture/passive),
  поэтому сдвиг карточки без resize не оставляет устаревшие координаты.
- `describe()` на наведении планируется через `requestAnimationFrame` и
  выполняется один раз на кадр; серия `pointermove` в одном кадре обновляет
  подпись однократно.
- `evidence()` дополнен `pointer_events`, `pointer_rect_reads` и
  `pointer_describes`; `captureWeatherEvidence().point_charts` отдаёт их без
  дополнительных запросов.
- В `viewer-point-series.mjs` добавлен ассерт на 12 синтетических
  `pointermove` в одном кадре: все события доходят до графика, дополнительных
  чтений рамки не больше одного, обновлений подписи меньше числа событий.
  Поведение hover/Enter проверяется прежними ассертами: наведение не меняет
  выбор, Enter выбирает явно.

Попутно исправлены предшествующие дефекты тестового окружения, блокировавшие
T27 на стартовой проекции LAEA-RF:

- выбор точки в `viewer-point-series.mjs`, `viewer-series-synthetic.mjs` и
  `viewer-settings.mjs` больше не пересчитывает пиксель через Mercator;
  используется `geographicPointPixel`/`nativePointPixel` из
  `tools/viewer-fields.mjs` с учётом текущей проекции.
- `nativePointPixel` получил дополнительные кандидаты внутри покрытия, поэтому
  на landscape 640×360 находит видимую точку карты, не закрытую панелями.

## Проверка

- `node viewer/build.mjs` — сборка и проверка типов прошли.
- `node --test --test-isolation=none test-*.mjs` (каталог `viewer`) — 82 теста
  прошли.
- `node --test tools/test-validation-summary.mjs` — 9 тестов прошли.
- Полный T27 на свежем стеке (`T27_POINT_SERIES=1`, Chrome): 4 вьюпорта
  (1440×900, 390×844, 360×740, 640×360), во всех — 24 значения ряда, три
  проекции, synthetic loading/gaps/nodata/outside/partial/late/expiry.
  Для каждого вьюпорта 12 `pointermove` дали `rect_reads` 0–1 и
  `describes = 1`; hover не менял выбор, Enter выбирал явно.
- Независимое сравнение `viewer-series-reference.py` — 96 сравнений (24 срока ×
  4 вьюпорта), `max_abs_error_K = 0.0` при допуске `0.0001`.
- Прогон без GPU — пройден, показан явный русский отказ и Mercator-fallback.
- Общий стенд `127.0.0.1:8140` для T27 не подошёл: два прогона получили HTTP 429
  на burst точечных запросов (24 отклонённых запроса). Ограничение стенда, не
  изменение. После согласования поднят свежий стек; он удалён после проверки.
- Очистка: профили браузера удалены, процессов браузера 0, тестовые стеки
  `hmc-publication-t13-debug90` и `hmc-publication-t13-final90` удалены, порты
  8142/8143 свободны, живой стенд 8140 отвечает 200 и не изменялся.
- Хэши проверенных входов (`inputs-start.json`/`inputs-end.json`, 436 файлов):
  `viewer/point-chart.ts` — `9599fdda6601d8e8884da9f3ea81712b545f58b89913dc9dc789e98f36673c92`;
  `data/viewer/build/point-chart.js` — `6a4e51e53b4d4528f1f9bf4a6f86ab9404b646c1fb47eb3b2f6892e33dfb17f7`;
  `tools/viewer-fields.mjs` — `3a7c234745b6498ce2ca41b7b780bb0efd0d4d30e0e37f5583e26bbf4667c46d`;
  `tools/viewer-point-series.mjs` — `a32fc376b4a5e87a7e9b15b0ec6fa56644c621f5b56404210dc445e432a77054`;
  `tools/viewer-series-synthetic.mjs` — `903f8701a2b1f4ce93e32d279f8d6ed981ccdaebf2faa2ee265faab46d9cf460`;
  `tools/viewer-settings.mjs` — `4803eb899e6f7386da337f86ecd30d1073546c8815dec12e4e65a46239be24a2`.

## Архив

Полные отчёты и снимки — в `HMC_EVIDENCE_ROOT/chart-redraw-90/`:
- `t27-final` — 479 файлов, индекс SHA256
  `c50c088314b974799bdaa286fe7e477f1f26cd1741f06e7aace6bca942a3183c`
  (финальная матрица после правок ревью: 4 вьюпорта, synthetic,
  series reference, unavailable GPU).
- `t27-fresh` — 490 файлов, индекс SHA256
  `50040abd98f14c36a35bae13bb7b0d8036d959b468e38b938a57611f1b174627`
  (предыдущий полный прогон до инвалидации кэша по scroll/pointerenter).
- `t27-shared-429` — 7 файлов, SHA256
  `18c5cfe2835d88c1e8c654ba36ac8f196afccf1a0d3723c4e8f6b85ae84ae100`.
- `t27-shared-429b` — 2 файла, SHA256
  `068346eb8790ea693db52a4d3e84d05a74dc238777a63cb5866934ad13ea6b31`.
- `t27-fresh-failed-pick` — 470 файлов, SHA256
  `1a6ff2dd37c88f2675880b82fe47b3e1136cd41af0519d78afcb2f055998de39`
  (клик вне экрана из-за Mercator-допущения).
- `t27-fresh-synthetic-pick` — 473 файла, SHA256
  `c45fc90284f5807dc19a2a645d36d13d11ca4ac4bd5bafd708bc41e40c5172d6`.
- `t27-fresh-landscape-pick` — 490 файлов, SHA256
  `810c3cad41de705d249ae4d7bdc7d7ef0dab50579619b2e69b2a70bbe66e2a61`.
- `t27-fresh-landscape-panels` — 490 файлов, SHA256
  `0b7790df2eddb4d73b6f24cc406626426082a86567b59d96cc0af03e89bee78b`.
- `t27-fresh-settings-panel` — 465 файлов, SHA256
  `2f15a2b6ad831e98bd2bdc12ff1c2d0f0d36280829e0f7f0c21889fdfd879715`.
