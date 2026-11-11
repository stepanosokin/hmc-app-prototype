# Ускорение перерисовки графика точки — №87

Задача [№87](https://github.com/stepanosokin/hmc-app-prototype/issues/87).
Начальный commit `3a4d72b`, ветка `main`. Уровень тестирования — базовый;
среда — офлайн-фикстуры viewer + браузер.

## Причина и изменение

График точки в `viewer/point-chart.ts` пересобирал весь SVG через
`replaceChildren` на каждый загруженный срок: `PointSeries.fetchEntries`
грузит сроки последовательно и уведомляет после каждого (`viewer/series.ts`),
что через `seriesChanged`/`renderPoint` (`viewer/main.ts`) вызывало
`chart.update()` — полную пересборку на каждый срок. Для N сроков это N
полных пересборок.

- `PointChart.update` при `series.busy` больше не строит SVG: обновляет только
  статус «Загрузка ряда: X из Y», ползунок и подпись; при смене ключа ряда
  очищает старый SVG. Полная пересборка — один раз после загрузки ряда.
- Добавлен замер: `full_builds`, `rebuilds_while_busy`, `build_ms`, экспонируется
  в `captureWeatherEvidence` как `point_charts` (`?validation=1`).
- В `viewer-point-series.mjs` добавлен ассерт `rebuilds_while_busy === 0`
  (во время загрузки ряда полных пересборок SVG нет).

Сеть (последовательная загрузка), кэш wind-барб, пропуск невидимой копии
`mobilePoint` и pointermove вынесены в follow-up №88/89/90.

## Проверка

- `node viewer/build.mjs` — сборка и типобезопасность прошли.
- `node tools/check-wind-overlay.mjs data/reports/wind72/chart-87-edge edge --fixtures-only`
  — пройден, 82 синтетические проверки: построение графика точки (сильные
  ветры, адаптивные 9/25 сроков на 240/264/320 px, выбор клавиатурой/кликом,
  независимый PROJ, состояния ветрового ряда). Чисто: профиль удалён,
  процессов браузера 0, Docker-ресурсы не создавались, живой стенд не изменён.
- `node tools/check-weather-viewer.mjs` (focused `T27_POINT_SERIES=1`) —
  **не выполнен до конца**: runner сперва запускает `checkSourceSettings`,
  который падает на не связанном с задачей ассерте формата WMS-ссылки
  (`.../revisions/<rev>/fields/<field>/wms` вместо ожидаемого
  `.../revisions/<rev>/wms`). Это предшествующее расхождение теста и живых
  данных; изменение №87 к нему отношения не имеет. Ассерт
  `rebuilds_while_busy === 0` в этом прогоне не подтверждён выполнением,
  но путь занятости (`series.busy`) проверен код-ревью и типизацией.

## Архив

`HMC_EVIDENCE_ROOT/chart-redraw-87/`:
- `wind-fixtures-final` — 114 файлов, индекс SHA256
  `7ec72b5cd299d9cc178653b544aea2641e8bacf01983d914c657f0bd3b9a7dd2`.
- `point-series-blocked` — 2 файла (browser.json, failure.png), индекс SHA256
  `56882d2272e6f7bce0ce219355edcc55fcfbf087d6246e4aa6b4bfb2739b514f`.

Фаза записи — до commit; финальное подтверждение push/закрытия — после commit.
