# Кэш ветровых барб графика точки — №89

Задача [№89](https://github.com/stepanosokin/hmc-app-prototype/issues/89).
Начальный commit `1a69195`, ветка `main`. Уровень тестирования — базовый;
среда — офлайн-фикстуры viewer + живой стенд `127.0.0.1:8140` только для чтения
(paced-прокси внутри runner), Chrome по пути
`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`.

## Причина и изменение

`PointChart.update` (`viewer/point-chart.ts`) на каждую перерисовку заново вызывал
`windBarb()` и создавал для каждого срока с ветром узел `<g>` с `<path>` и
`<title>`, хотя символ зависит только от скорости и направления.

- Добавлен кэш барб по ключу `entry.time` с проверкой `speed`/`direction`.
  При совпадении узел переиспользуется, обновляется только его размещение
  (`translate`/`rotate`/`scale`) — позиция зависит от числа сроков и ширины.
  При изменении значения ветра пересоздаётся только этот узел.
- Символы штиля (`<circle>`) кэшируются так же: повторная перерисовка не создаёт
  их заново.
- Кэш очищается при смене ряда; записи для сроков, исчезнувших из ряда,
  удаляются.
- `evidence()` дополнен `barb_builds` и `barb_reuses`; они уже попадают в
  `captureWeatherEvidence().point_charts`.
- В `viewer-wind-fixtures.mjs` добавлены проверки: повторная перерисовка
  переиспользует те же узлы; переиспользуемые узлы перепозиционируются при
  изменении раскладки; смена только скорости и только направления пересоздаёт
  ровно один узел; штиль строится один раз и переиспользуется.

## Проверка

- `node viewer/build.mjs` — сборка и проверка типов прошли.
- `node --test --test-isolation=none test-*.mjs` (каталог `viewer`) — 82 теста
  прошли.
- `node tools/check-wind-overlay.mjs data/reports/wind72/chart-89-fixtures5 chrome --fixtures-only`
  (Chrome через `HMC_WIND_BROWSER`) — пройден: 88 синтетических проверок
  (включая 6 новых проверок кэша), 42 палитры и 42 проверки частиц.
- Полный `node tools/check-wind-overlay.mjs data/reports/wind72/chart-89-full chrome`
  — пройден: 65 проверок, 41 скриншот, вьюпорты 1440, 360×740 и 640×360,
  включая `scalar chart with wind flags` и `popup graph can be exposed by scrolling`.
- Попытка `chart-89-fixtures4` завершилась неудачей на слишком строгом новом
  ассерте: у нулевого слота `x` не меняется при добавлении срока. Ассерт уточнён
  (проверяются сдвинувшиеся слоты), повторный прогон `fixtures5` пройден.
- Focused T27 (`tools/run-weather-viewer.ps1 -PointSeries -Offline`) не
  запускался: он не входит в согласованный базовый уровень; сквозную проверку
  реального просмотрщика покрывает полный `check-wind-overlay.mjs`.

## Ретроспектива (после №89)

`check-wind-overlay.mjs --fixtures-only` печатал в итоговой строке `checks: 0`,
хотя 172 фикстурные проверки прошли: они лежат в `synthetic`, `palettes` и
`particles`, а не в верхнеуровневом `checks`. Приходилось вручную разбирать
`validation.json`, чтобы подтвердить результат. Теперь итоговая строка содержит
`fixture_checks` и `total_checks`, а `tools/validation-summary.mjs` показывает
`fixture_checks` по группам; добавлен тест на отчёт без фикстурных payload.

- `node --test tools/test-validation-summary.mjs` — 9 тестов прошли.
- `check-wind-overlay.mjs --fixtures-only` (Chrome) — пройден: `fixture_checks:
  172` (88 синтетических + 42 палитры + 42 частицы), `total_checks: 172`.
- Полный `check-wind-overlay.mjs` (Chrome) после изменения раннера — пройден:
  65 живых + 172 фикстурные = 237 проверок, 41 скриншот, 3 вьюпорта.

## Архив

`HMC_EVIDENCE_ROOT/chart-redraw-89/`:
- `wind-fixtures-failed-layout` — 115 файлов, индекс SHA256
  `f1ada8d9425bc5997712798181e779d609feacd80743a6c82933ff5d537cf2e5`.
- `wind-fixtures-final` — 114 файлов, индекс SHA256
  `604ae5f99188fc833590b06ad5da571cec0602fc9f89b54108e2ff92d71784d3`.
- `full` — 152 файла, индекс SHA256
  `e23395f1c58f6688311a59504b49b5df2bf4ce3d04382c92bca214ac7df69c1c`.
- `retro-fixtures` — 114 файлов, индекс SHA256
  `924d3aa2b66aaa2c0603228e1a620d05f18d001d3c44d3307d6f73dd75286e63`.
- `retro-full-pass` — 152 файла, индекс SHA256
  `0a8d0d24779a711ae4e74a1f5c2c027df64dc2361446fd9d00a06add497658c7`.

Очистка: профиль браузера удалён, процессов браузера 0, тестовый прокси закрыт,
Docker-ресурсы не создавались, живые сервисы и данные не изменены; живой стенд
сохранён. Фаза записи — до commit; финальное подтверждение push/закрытия — после
commit.
