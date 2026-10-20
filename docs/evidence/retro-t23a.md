# Ретроспектива реализации T23a / №37

Дата: 20.10.2026. Исходный commit ретроспективы:
`c65458dbd23b614e84ec4f69553061551d26d3e7`.
Объект — текущая сессия реализации
[№37](https://github.com/stepanosokin/hmc-app-prototype/issues/37).
Первичные источники: [попытки](t23a/development.md),
[review](t23a/review.md), [приёмка](t23a/validation.md),
[происхождение inventory](t23a/validation/input-provenance.json),
[архивные negative cases](t23a/validation/t23a-negatives.py),
[CI](../../.github/workflows/checks.yml) и
[workflow](../development-workflow.md).

Выводы в порядке значимости:

1. **Полную границу cold нужно определить до оптимизации.** GPU8–GPU11
   считали время после загрузки scripts/worker. В GPU12 navigation-origin
   отсчёт показал 3259 мс при field-load 2775 мс; прежний результат не
   подтверждал цель 3 с для страницы. GPU13 запустил field I/O параллельно
   worker initialization и достиг 2848/2758 мс в Chrome/Edge. Workflow теперь
   задаёт начало/конец измерения, cache scope и раздельные метрики до первой
   performance-пробы. Для дальнейшего исправления бюджета сначала нужен профиль:
   GPU9 выявил 36 PostgreSQL connections на 18 resolve; часть времени уходила
   на SCRAM, а не на GPU.

2. **Inventory должен охватывать все runtime inputs до финальных gates.**
   Extension-based обход пропустил подложку вне code directories. Evidence1
   отверг архив; совпадающие browser hashes позволили построить явно
   производный union из 109 runner inputs и land.js без изменения оригиналов.
   Native runner теперь включает land.js непосредственно. Новая Windows CI
   проверка выполняет только его сбор путей и сравнивает их с записанными
   browser inputs. Она воспроизвела исходный отказ и прошла после исправления.
   Полный snapshot сохраняет прежние Git-filter/byte checks; режим PathsOnly
   делает проверку покрытия быстрой и независимой от checkout line endings.

3. **Semantic rejection evidence checker должен работать в регулярном CI.**
   Review нашёл vacuous success пустых views/retirements. Исправление и
   десять negative cases были в реализации, но cases остались архивным
   одноразовым скриптом. В существующий tools/test_evidence.py добавлена
   NativeEvidence fixture: полный синтетический архив проходит, а неполные
   matrices, нулевые samples, пропавшие/живые ресурсы, input drift,
   unbound browser input, development gate и budget overruns отвергаются.
   Для semantic cases hashes пересчитываются, чтобы отказ доказывал проверку
   содержания. Действующий CI уже запускает этот файл; второго test framework
   и общего coding standard не требуется.

4. **Timeout fixture должна сохранять независимость admission buckets.**
   GPU3/GPU6 получили 429 после timeout публичного клиента. Первоначальная
   гипотеза о mutex не объясняла причинность; отдельная организация доказала
   504, последующий reservation 429 и публичный 200. Это уже закреплено
   native HTTP test и workflow; новая инструкция или изменение production
   budgets не нужны.

5. **Использовать уже имеющиеся PowerShell рецепты и узкий вывод.**
   Сессия повторила известные ошибки `-File` с массивом путей и stderr
   unittest, хотя workflow уже содержит `& ... -Path @(...)` и
   Invoke-CheckedProcess. Большие повторные чтения приводили к усечению вывода;
   частый пустой polling не давал новых данных. Существующих launcher tests,
   metadata инструментов и адресных отчётов достаточно. Новые запреты в
   AGENTS.md и дополнительный launcher не добавлены. EOF warnings в измеренных
   байтах остаются частью исторического review, без переписывания архива.

Изменены workflow, этот отчёт, native input capture и проверки в существующем
CI. AGENTS.md уже направляет к workflow; сторонние skills, исторические
свидетельства и закрытая №37 не изменяются. Новые service/GPU claims не делаются.

Проверки ретроспективы: ожидаемый red/green input capture; synthetic evidence
suite, полный mypy и native/historical archive verification в одноразовых
контейнерах; documentation links и review diff относительно исходного commit.
Результаты: input-capture red — ожидаемый exit 1 из-за land.js, green — exit 0
(8 browser paths); 16 evidence tests прошли за 0,087 с; mypy — 61 файл без ошибок;
архивы — 876 historical и 1162 native references проверены. Стандартные ссылки
прошли для 7 документов, отдельная проверка — для двух изменённых документов.
Полный snapshot проверен отдельно: 111 записей, реальный SHA256 land.js,
совпадение набора путей с PathsOnly. Быстрый check требует непустые input sets.
Проверки приложения, GPU и QGIS не повторялись: изменены capture/CI и workflow,
без изменения scientific contract или отображения.

[Архив проверок](retro-t23a-checks/artifact-index.json) и
[retirement receipt](retro-t23a-checks/retirement.json) фиксируют
`hmc-publication-t23a-retro1`: контейнеры `--rm --network none`,
`archive_verified=true`, остаточные container/network/volume inventories пусты.
Отдельный Compose stack не поднимался. Protected sources, unrelated проекты
и shared caches сохранены. Скопированные артефакты сверены по длинам/SHA256;
затем выполнены review diff и staged whitespace check перед commit.
