# Проверки ретроспективы T16

Изменены archive checker, его тесты, CI и документация. Runtime карты,
Compose-конфигурация, browser runners, научные допуски и исторические архивы
не меняются. По change-to-check table нужны весь archive test suite и оба
затронутых архива T15/T16; реальный Compose/GPU gate не требуется.

Development: 58 тестов прошли до дополнения проверки navigation/history;
после дополнения прошли 59. Первый запуск тестов был прерван оболочкой:
PowerShell с `ErrorActionPreference=Stop` интерпретировал штатный unittest stderr
как terminating NativeCommandError. Это ошибка обёртки, не результат suite;
полный повтор с native exit code прошёл. Одноразовый контейнер удалён.
Прямой исторический T16 check прошёл: 2132 ссылки.

Первый финальный T16 check выявил ошибочное требование отдельного T14 navigation
report на Android. В историческом gate этот сценарий выполнялся на Chrome/Edge
desktop, а телефон проходил T13 base и T15 updates. Проверка теперь требует
navigation races на обоих desktop browsers; positive fixture Android явно
не содержит navigation. Ошибка и исходные frozen inputs сохранены как
`final-t16.stderr.log` и `inputs-attempt1.json`; копии входов в `attempt1-inputs/`
восстановлены из точной обратной правки и сверены с исходными длинами/SHA256.
После исправления весь suite,
mypy и оба архива проверяются повторно с префиксом `final2-`.

Перед финальной приёмкой выполнен review diff относительно `e96619d`:
общий путь T15 сохраняет прежний контракт; T16 добавляет отдельные проверки,
не ослабляя GPU/числовые условия. Проверены CI wiring, негативные тесты после
rehash, точная desktop-only замена, все восемь попыток и отсутствие изменений
runtime/исторического архива. Замечаний, требующих изменения runtime, нет.

Финальная приёмка после review использует [frozen inputs](inputs.json).
Native exit codes записаны в [process results](process-results.jsonl),
stdout/stderr каждого процесса — рядом. Проверяются весь archive test suite,
исторические T15/T16, полный CI scope mypy, документация и staged diff.
Перед commit индекс сверяется с frozen inputs и [индексом свидетельств](artifact-index.json).

Итог повторной полной проверки: **59 tests OK**, mypy **72 файла**, T15
**3459** и T16 **2132** архивные ссылки, native exit codes `final2-*` — **0**.
Сводка документарных/Git проверок: [results](results.json).

[Cleanup](cleanup.json) фиксирует отсутствие временных check-контейнеров;
они запускались с `--rm --network none`, без томов/сетей Compose и browser/ADB.
Документационные/Git/Node проверки ресурсов не создают. По прежнему запросу
сохраняется живой `hmc-publication-t13-demo-20261021-3`, UI
`http://127.0.0.1:8140/`; посторонний `vgdb_tools` и shared caches сохранены.
Пароли, исходный GRIB и operational env-файл в Git не добавляются.

Фаза этой записи — до отдельного retro commit/push. Задача №28 уже закрыта;
при чтении подтверждены `closed/completed` и шесть отмеченных критериев.
Ретроспектива не меняет родителя, карту планирования и статус задачи.
Проверка remote HEAD и чистого рабочего дерева выполняется после push.
