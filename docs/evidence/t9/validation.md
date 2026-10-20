# T9: лимиты и учёт запросов

Задача [№21](https://github.com/stepanosokin/hmc-app-prototype/issues/21),
исходный commit `4854e0a6bbada59b257db17dfd8307088a4f85f8`.
Срез не меняет родительскую спецификацию, CRS, числовые значения, выбранные
адаптер/encoding, тарифы или платежи. EDR остаётся сравнительным T3-интерфейсом;
текущий publication stack публикует domain point, числовые тайлы/метаданные и WMS.
Операторский контракт: [budgets.md](../../budgets.md).

Финальные входы заморожены после двухосевого [ревью](review.md).
Реальный GRIB SHA256:
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Publication/retention clock явный: `2026-10-19T05:00:00Z`; запросы и квоты
используют реальное UTC. Историческое время collector тестируется отдельным
`--now` без перемещения часов запросов.

## Критерии

| Критерий | Проверка через реальные внешние границы |
| --- | --- |
| Организация и отдельное демо, rate/bytes/concurrency/duration/output | Два ключа одной организации делят квоту; другая организация и общий demo bucket независимы; 429 с Retry-After, 413, 504; WMS dimensions, byte reservation |
| Авторизация и квота до защищённого кэша | Реальные point, metadata, f32 bytes, capabilities/GetMap; отозванный ключ и If-None-Match не дают выдачу; профили T8, закрытые backend-порты |
| Поля request accounting | Usage CLI сопоставляет request ID с HTTP status/bytes, UTC timestamp, duration, org/key, backend product/run/revision и фактическим hit/miss |
| Cache hits, отказы, неизвестная identity, retries и retention | Прогретый tile работает при запрещённой генерации; 413 сохраняет hit и identity; неверный секрет с верным открытым ID не получает identity; каждая попытка отдельная; сборщик сохраняет текущее окно и удаляет старое |
| Реальные gateway/cache, без платежей | T9 HTTP и T8 access/revocation/restart/store-failure; никакой денежной модели |
| Тайлы и metadata, generation/cache/prefetch/bypass | Zoom и tile dimensions, 332820 bytes, один генератор и 429 двух cold requests от разных org; killable generator; LRU двух тайлов и доказанное вытеснение; общий demo prefetch limit; edge isolation |

Медленное чтение моделируется явным тестовым маркером в изолированном
actual-sample API: четыре потока заняты по 50 секунд. Started-work продолжает
занимать quota slot после 40 секунд. Просроченные queued requests не начинают
backend, что проверяется usage flags. Это fault supplement к реальной
публикации/кэшу, а не замена организации GRIB или оценка performance.

## Статус финальных gates

Выбраны два полностью успешных прогона на неизменных исходниках:

- `hmc-publication-t9-final2`: **24 native checks, все exit 0**. T5 actual-sample
  regression прошёл; оба T9 HTTP-теста прошли; T8 operator/access, edge isolation,
  недоступная auth-store, повторная миграция и отзыв после restart прошли.
  После restart подтверждены 28 batches/revisions и прежнее значение
  `298.2274169921875 K`. Полная suite: **34 теста, OK, 15 ожидаемых skips**.
- `hmc-publication-t9-recovery-final3`: **12 native checks, все exit 0**.
  Все 7 recovery-проверок прошли, включая реальные worker crashes, managed-source
  recovery, cold/warm tiles и сохранённых читателей. После настоящего restart
  point/tile/WMS остались доступны, доставка опубликована без исходного файла.
  Полная suite: **34 теста, OK, 15 ожидаемых skips**.

Skips относятся к отдельно включаемым T5/T6/T7/T8/T9 и старому T4 job fixture.
T5/T6/T8/T9 выполнены отдельными HTTP-фазами без пропуска нужных сценариев.
Новый T7 gate не заявляется: политика forecast retention и миграция retained
revisions не менялись. Его существующие boundary-тесты входят в полную suite.

`inputs-start.json` и `inputs.json` совпали; T6 дополнительно сравнил исходный
и конечный host inventory. Перед commit проверяется SHA256 каждого runtime
input и сохраняется соответствующий Git blob с учётом установленных EOL rules.
Ни одна успешная фаза не заимствована из невыбранных попыток.

## Архивирование и cleanup

Оба выбранных стенда удалены с проверкой нулевых containers/networks/volumes.
Все завершённые попытки перечислены в [retirement.json](retirement.json).
Live stacks не оставлены; несвязанный `vgdb_tools` сохранён. Исходные GRIB,
исторические evidence и общий image/build cache не удалялись.

Проверенные полные архивы:

```text
data/archives/publication/hmc-publication-t9-final2/cb9a256c02294e21ad86c1abd72b06cf
data/archives/publication/hmc-publication-t9-recovery-final3/c6dceb1e727e462680277adcf5e34472
```

Переносимая выборка хранится рядом с этим отчётом; `artifact-index.json`
связывает точные длины и SHA256. Существующий `tools/check_evidence.py` теперь
проверяет и T9; отдельная disposable-копия с повреждённым T9 gate отклонена.
Integrity-проверка также архивирована и удалена; всего подтверждено удаление
**16 тестовых проектов**, без оставленных live stacks. `source-bindings.json`
связывает runtime SHA256 с Git blobs и проверяет совпадение T6/T9 inputs.
`.env`/`.key` не входят в переносимую выборку; T8 restart проверил
отсутствие сырых ключей в журналах/отчётах.

Доказательства разработки и невыбранные попытки: [failed-probes.md](failed-probes.md).
Desktop QGIS, TLS, GPU lifecycle и agreed-host capacity не входят в T9.
