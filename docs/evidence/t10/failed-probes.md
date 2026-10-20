# Разработка и неуспешные проверки T10

Все перечисленные Compose-проекты изолированы, архивированы и удалены штатным
retirement helper. Архивы находятся в `data/archives/publication/<project>/`;
их квитанции и выбранные логи включаются в T10 artifact index. Они не используются
вместо финальной приёмки на замороженных исходниках.

- Первый запуск scratch wrapper завершился до обращения к Docker: путь
  process.ps1 вычислялся относительно scratch. Путь исправлен; ресурсы не создавались.
- `hmc-publication-t8-t10-red`: RED, новый gateway-тест получил KeyError
  `collection` — старый каталог ещё не имел ссылки на EDR-коллекцию.
- `hmc-publication-t8-t10-green1`: mypy отклонил передачу `*match.groups()` с
  позиционными аргументами; исправлены два вызова. Ранний failed project удалён.
- `hmc-publication-t8-t10-green2`: первый сквозной discovery/point/EDR путь прошёл.
- `hmc-publication-t8-t10-green3`: четыре расширенных HTTP-сценария прошли,
  включая synthetic nodata, expiry и профили numeric/gis.
- `hmc-publication-t8-t10-fault-red`: RED, отсутствие реального longitude
  directory после прогрева вернуло 200 с координатой 0 вместо ожидаемого 503.
  Сохранён лог неуспеха. Причина — consolidated Zarr metadata и fill values.
- `hmc-publication-t8-t10-fault-green`: пять HTTP-сценариев прошли после проверки
  наличия array metadata и обработки storage exceptions. Ревью расширило ту же
  защиту на отдельные ожидаемые chunks, а не только directory/.zarray.
- `hmc-publication-t8-t10-focused-final`: проверяет окончательный код, оба
  storage faults, восстановление и остальные сценарии до полной приёмки.
- `hmc-publication-t8-t10-final`: первая полная приёмка остановилась в T5
  retained-reader regression на 503 gateway для metadata во время повторной
  публикации часа 2. Лог и receipt сохранены, результат не засчитан. Автоматическая
  очистка завершилась до попытки получить дополнительные container logs.
- `hmc-publication-t8-t10-debug`: повторяет существующий T5-тест на тех же
  исходниках и сохраняет service logs до retirement. Полный T5-тест прошёл
  (279.273 s); ошибок API/gateway и непредусмотренных ошибок БД в логе нет.
  Ожидаемый отказ `schema nonexistent` относится к штатному indexing fault T5.
  Дополнительный discovery-запрос на 303 опубликованные коллекции вернул 200,
  2700701 байт. Проход повторного теста не объясняет первый отказ: его причина
  остаётся неустановленной, программное исправление наугад не вносилось.
- `hmc-publication-t8-t10-final2`: T5 снова получил русский gateway 503,
  теперь при частичной публикации часов 4/5. Gate не засчитан, стенд удалён.
- `hmc-publication-t8-t10-migration`: 40 worker once без новых заданий и
  120 metadata-запросов прошли; одной повторной миграции оказалось недостаточно
  для короткого воспроизведения.
- `hmc-publication-t8-t10-publish-probe`: воспроизведение 24 новых публикаций
  и чтения catalogue/point/metadata/tile упало на итерации 23, metadata 503.
  PostgreSQL записал точный deadlock INSERT access.usage ↔ ALTER TABLE
  access.usage ADD COLUMN IF NOT EXISTS backend_started. Это установило
  причину предыдущих отказов. Сохранены 359 наблюдений, исходник пробы и service log.
  Временная DEBUG-t10 диагностика полностью удалена.
- `hmc-publication-t8-t10-publish-green`: та же проба проверяет исправленную
  миграцию перед Development и финальным объединённым T9 gate. Все 24 публикации
  и 372 HTTP-запроса прошли; в сохранённом service log deadlock нет.

Документационный вызов через `powershell -File -Path a,b` был отклонён как одно
несуществующее имя файла. Повторный вызов с настоящим массивом PowerShell прошёл.
Эти проверки Docker-ресурсов не создают.

GitHub connector вернул `403 Resource not accessible by integration` при
обновлении checklist. Использован существующий repository-scoped tracker helper,
как предписывает development-workflow.md; секреты не включаются в свидетельства.
