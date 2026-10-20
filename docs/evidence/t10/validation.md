# T10 / #22: числовой API

Задача [#22](https://github.com/stepanosokin/hmc-app-prototype/issues/22),
исходный коммит `7e68fd306ccb608781bd96d0cf78371e711014bb`.
Контракт и команды: [numerical-api.md](../../numerical-api.md).
Ревью: [review.md](review.md); сохранённые попытки: [failed-probes.md](failed-probes.md).

## Проверяемый объём

Discovery modules/models/runs/revisions и published selection collections;
общие canonical point и EDR Position/CoverageJSON; явные native CRS/CRS84,
identity/cell/units/provenance/null; точное время; OpenAPI и runnable examples;
manifest-scoped numeric tile metadata v2; применение существующих access/budget
правил к новым маршрутам. Узкий адаптер из #15 сохранён.

Публичная граница — HTTP через настоящий gateway в изолированном закреплённом
Docker Compose с PostGIS, API, worker и GeoServer. Реальный sample:
`ICON_EU_T_G_2026101500.grib2`, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Предварительная проверка выполнена до выделения проекта.
Часы явно зафиксированы: `2026-10-19T05:00:00Z`.

## Focused gate

Проект `hmc-publication-t8-t10-focused-final`: mypy, native runtime, реальный
sanitized GeoServer failure и пять T10 HTTP-тестов прошли. Проверены literal
ecCodes/reference value 298.2274169921875 K и равенство identity/value/cell у
point/EDR; hierarchy и advertised metadata; 400/401/403/404/410/429; вне покрытия
и synthetic native nodata; действительный missing array и missing chunk с 503
и восстановлением. Синтетическое дополнение явно помечено, не подменяет sample.

После обнаружения deadlock выполнена окончательная Development-проверка в
`hmc-publication-t9-t10-development`: три T9-теста, включая upgrade схемы без
backend_started/backend_done с сохранением usage, T8 access/cache/isolation,
authorization-store failure и restart, плюс все пять T10 HTTP-контрактов прошли.
OpenAPI проверен отдельно для public без auth и обязательного auth в /org.
Начальный и конечный input inventories совпали, проект архивирован и удалён.
Предшествующая проба 24 публикаций и 372 HTTP-чтений прошла после устранения
доказанного lock-upgrade deadlock; см. [deadlock-review.json](deadlock-review.json).

## Финальная приёмка

Выбран один полный успешный проект **hmc-publication-t9-t10-final**:

```powershell
powershell -NoProfile -File publication/run-budgets.ps1 -Project hmc-publication-t9-t10-final -Port 8110 -SkipBuild
```

Использован тот же hash-locked образ, который собран и проверен в окончательном
Development-прогоне; image IDs, ports и сети записаны в
[service-isolation.json](service-isolation.json). Все **23 процесса завершились
с native exit 0** — [process-results.jsonl](process-results.jsonl).
Все **80 входных файлов** совпали в начале, конце и при выборе свидетельств:
[inputs-start.json](inputs-start.json), [inputs.json](inputs.json).
Отдельные успешные фазы разных попыток не объединялись в финальный результат.

- T5 publication/restart: все 24 времени, late/correction/overlap fixtures,
  ожидаемые readiness/indexing failures и сохранённые читатели; 286.055 s.
  После restart подтверждены 28 ревизий и 28 уникальных batches, старое значение
  298.2274169921875 K и неизменность тайлов.
- T9: три actual-service проверки, включая обновление legacy usage без потери
  записей, quotas до кеша, ресурсные лимиты, таймауты и backend completion;
  132.194 s.
- T8: ключи/профили/ротация/отзыв, warm-cache policy, edge isolation,
  отказ authorization store, existing-volume provisioning и restart.
- Полный suite: **40 тестов, 108.531 s, OK (skipped=16)**.
  Все пять T10-контрактов выполнялись и прошли. Профильные T5/T8/T9 cases,
  пропущенные в общем discovery, отдельно выполнены выше в том же проекте.
  T6/T7 integration и исторический T4 job fixture этим gate не заявляются.
  Decoder/storage, native/runtime, numeric/retention boundaries также прошли.
- OpenAPI, точные параметры и ошибки, actual dimensions, native/CRS84,
  CoverageJSON/null/provenance, 401/403/429, missing array/chunk 503/recovery и
  expiry: [t10-numerical.json](t10-numerical.json), [t10-faults.json](t10-faults.json),
  [t10-usage-upgrade.json](t10-usage-upgrade.json),
  [full-suite.stderr.log](full-suite.stderr.log).

Проверки Markdown-ссылок прошли для стандартного набора и новых документов.
T10 добавлен в существующий `tools/check_evidence.py`; portable artifact index
связывает точные байты выбранных JSON, логов, inputs и документов.

## Очистка и хранение

Все **15 тестовых проектов** этой реализации архивированы и удалены, включая
неуспешные попытки. Каждый receipt подтверждает проверку SHA256/длин архива и
нулевой остаток контейнеров, сетей и томов. Дополнительная сверка точных Docker
labels после финального прогона: [cleanup-summary.json](cleanup-summary.json).
Живых стендов не оставлено; посторонний остановленный `vgdb_tools` не менялся.
Raw archives: `data/archives/publication/<project>/<archive-id>/`;
финальный archive-id — `0ac0568faf5843e7a995e4550fb343f0`.
Переносимые выбранные свидетельства находятся рядом с этим отчётом в
[artifact-index.json](artifact-index.json). `.env` и файлы ключей не включены.
Исторические T1–T9 свидетельства и shared Docker caches сохранены.

## Границы результата

Этот срез не закрывает M3 целиком. Instances, bulk coverage downloads, Features,
Martin, GPU viewer и operational capacity не реализуются. Полная OGC EDR/Tiles
conformance не заявлена. Геоцентрическая операция CRS84 → native использует
одобренную в T4 гипотезу прототипа с WGS84 height=0; подтверждение производителя
и desktop QGIS относятся к отдельным согласованным воротам.
