# T23a / №37 — ход реализации и отклонённые пробы

Задача: [№37](https://github.com/stepanosokin/hmc-app-prototype/issues/37).
Исходный HEAD: `ff451d1cd381b896a1e08147973f33291f9318c3`.
Это development evidence; итоговая приёмка пока не завершена.

## Согласование и границы

20 октября 2026 года владелец репозитория ответил «Yes I approve» на
[конкретный проект hmc-native-display/1](../../design/t23a-native-display-draft.md).
Ранее в этой же беседе подтверждены две публичные границы TDD: gateway metadata/
блоки и MapLibre renderer, независимый источник истины — исходный GRIB.
Frozen `hmc-temperature-tile/2` сохраняется. Согласование проекта не является
доказательством допуска, скорости или мобильной совместимости.

## Попытки

| Попытка | Наблюдение | Использование результата |
| --- | --- | --- |
| `hmc-publication-t23a-red1` | Публичный gateway возвращает 404 для нового metadata endpoint, test fails | Ожидаемый TDD red до реализации |
| `hmc-publication-t23a-green1` | Mypy 53 файла; первый native cell, padding и доступность v2 проверены | Первый backend-срез |
| `hmc-publication-t23a-blocks1` | 3 gateway tests прошли; все 18 блоков, маски/padding и горизонтальные/вертикальные halo; отзыв прогретого ключа | Кодирование против raw GRIB: максимум 0 K, доставка 5990760 байт |
| `hmc-publication-t23a-gpu1` | Backend tests прошли; реальный RTX 4070 readback для двух проекций; screenshot driver не смог сериализовать возвращённый MapLibre Map | Незавершённая development-проба, не приёмка |
| `hmc-publication-t23a-analysis-gpu1` | Одноразовый offline check не получил PYTHONPATH и не импортировал decoder | Отказ обёртки сохранён |
| `hmc-publication-t23a-analysis-gpu1b` | Независимый scalar GRIB/PROJ эталон для сохранённого readback: 0,391330848 K ortho, 0,138952680 K LAEA, маски без отличий | Этот вариант GPU inverse-transform отвергнут по допуску |
| `hmc-publication-t23a-gpu2` | Mypy обнаружил несовместимую выведенную типизацию результата reader; HTTP/GPU не запускались | Тип результата явно описан; Compose assets/network удалены |
| `hmc-publication-t23a-types-process` | Общий mypy обнаружил два Python-модуля `reference` | Новый эталон переименован в `native_reference.py` |
| `hmc-publication-t23a-types-process2` | Общий mypy: 58 файлов, ошибок нет | Проверка до следующего Compose-стенда |

В GPU1 загрузка всего поля заняла 33018 мс. Переинициализация Python sampler
при каждом прогретом запросе не удовлетворяет нужной модели повторного
использования immutable source. Исправление: один сериализованный сохраняющий
состояние reader, ограниченный deadline, размером ответа и kill/join при timeout;
проверка наличия опубликованных assets остаётся перед cache hit.

Readback GPU1 получен в Windows Chrome на ANGLE/NVIDIA GeForce RTX 4070 Laptop
GPU / Direct3D11. Для 1440×900 сохранено по 7590 экранных позиций каждой проекции.
Это реальный desktop GPU, а не подтверждение Android/iOS. Повторные статичные
repaint-кадры дали p95 около 17,3 мс; это не измерение интерактивного вращения,
pan/zoom и не принятие согласованных frame budgets.

Следующий числовой кандидат заменяет зависимую от реализации GLSL `atan2`
арифметику явным range-reduced полиномом; ортография использует тождества
`sin(c)=rho/R`, `cos(c)=sqrt(1-(rho/R)^2)`. Причину расхождения надо подтвердить
последующей независимой пробой, а не считать доказанной только по чтению кода.

## Review разработки

Статические проверки: полный mypy прошёл для 61 файла. Исторические evidence
negative tests прошли 7/7; первоначальная PowerShell-обёртка с `2>&1` ошибочно
трактовала unittest stderr как NativeCommandError, хотя сами тесты сообщили OK.
Повтор через штатный Invoke-CheckedProcess зафиксировал native exit 0;
оба transcript сохранены в текущем T12 attempt. Проверка ссылок сначала получила
один строковый аргумент с запятыми через `powershell -File`, затем вызвана с
настоящим массивом через `&`: 4 новых документа и 7 стандартных прошли.
Эти статические команды не создавали Compose-стеков; одноразовые контейнеры
помечены текущим T12 project и запущены с `--rm --network none`.

Последующие пробы (каждая завершена retirement с нулевыми ресурсами):

| Попытка | Фактический результат |
| --- | --- |
| GPU3, GPU6 | После проверки timeout публичная quota оставалась зарезервированной; браузер получал 429. Это ошибка изоляции тестового клиента, а не доказанная ошибка mutex генератора. |
| GPU4 | Числа уже укладывались в допуск, но canvas/scrollbar давал сдвиг геометрии 9,07 px. Исправлены overflow и resize; отрицательный readback сохранён. |
| GPU5 | Числа ≤0,0023974 K; геометрия ≤5,5e-13 px. Синтетический горизонт отличался на 33,86 м; использована устойчивая формула cos(c). |
| GPU7 | Отдельная timeout-организация: 504, затем ожидаемый 429, публичный клиент 200. Числа и маски прошли; синтетический полюс отличался на 2202 м из-за asin около единицы. Ортографическая широта заменена на atan2(up,hypot(north,east)). |
| GPU8, Chrome и Edge | Все 4 backend tests прошли, native encoding 0 K, GPU ≤0,0023973167 K, server ≤0,000015057 K, masks 0, geometry ≤5,5e-13 px, synthetic ≤1,648 м. Chrome cold desktop 3334 мс превышает 3000 мс; проба не является полной приёмкой. |
| GPU9 | Параллельная подготовка первой подложки включена в cold timer. Числа/маски снова прошли; Chrome cold 3279 мс, Edge 2659 мс. Проба отклонена по холодному Chrome. Профиль сохранён в native-profile.log. Первая команда профиля использовала отсутствующий created_at; исправленный запрос LIMIT 1 измерил реальные функции. |
| GPU10 | Чтения native-resolve объединены в текущую транзакцию. Backend 4 tests, числа/маски прошли; Chrome cold 3137 мс, Edge 2505 мс. Chrome всё ещё вне бюджета, поэтому проба не выбрана. |
| GPU11 | Подготовка shader и upload валидированных блоков идут параллельно доставке. Chrome cold 2723 мс, Edge 2495 мс; warm ≤101 мс, pan/zoom p95 ≤17,6 мс. Числа/маски прошли. После этой пробы исправлены русские UI сообщения при сетевых/MapLibre ошибках, поэтому финальные байты viewer проверяются заново. |
| GPU12 | Cold от navigation origin: Chrome 3259 мс, при load 2775 мс; числовые проверки и 4 HTTP tests прошли. Проба отклонена по полному cold budget. |
| GPU13 | Полный cold Chrome 2848 мс, Edge 2758 мс; p95 ≤17,7 мс, warm ≤123 мс; числа/маски прошли. Выбрана для финального архива. |
| evidence1 | Checker отверг отсутствие land.js в runner inventory; hash уже присутствовал в обоих browser reports. Исходные свидетельства сохранены, проект retired. |
| evidence2 | Производный union inventory: те же 109 runner inputs и один land.js из совпадающих browser hashes. Native/historical positive и 10 negative cases прошли; проект retired. |

В GPU8 prewarm загружает только код reader/HTTP workers, без данных поля.
В GPU8–GPU11 cold timer начинался при запуске runProbe после загрузки локальных
скриптов. Перед финальной пробой граница усилена: отсчёт от начала навигации
страницы (`performance.now()` относительно navigation origin), включая scripts
и worker startup. Прежние cold числа — development результаты более узкого
интервала; финальную цель ≤3 с подтверждает только новая проба.
Кандидат GPU13 начинает field I/O при инициализации page module параллельно
worker startup; create() ждёт workerReady до MapLibre Map, runProbe()
переиспользует единственный bootstrap. Cold timer по-прежнему начинается
от navigation origin. Standards/Spec подтвердили границы и lifecycle.
Квота после 504 сохраняет резерв до консервативного срока завершения backend;
новая fixture использует отдельную организацию и сохраняет request IDs/коды
в `native-timeout-budget.json`. Снижение конкуренции само по себе не объясняло
прежний 429; эта ранняя гипотеза не используется как вывод.

Профиль GPU9 показал для 18 resolve 36 подключений PostgreSQL, суммарно
1,091 с под cProfile, в основном SCRAM derivation. Кандидат GPU10 группирует
только связанные чтения одного native-resolve в одну текущую транзакцию:
retention snapshot и SELECT revision используют одно соединение. Это не pool
и не кеш результатов/доступа; каждое обращение выполняет проверки заново,
commit/rollback/close и ContextVar reset происходят на выходе. Default вызовы
database() не меняются. Независимые Standards/Spec reviewers проверяют изменение.

Финальный code-review относительно исходного HEAD выполнен параллельно по
Standards/Spec. Устранены накопление marker render listeners и возможность
прохождения evidence checker с пустыми mode/scope/retirement наборами.
Повторный review обоих направлений не выявил новых конкретных замечаний.

Навык `code-review`, два независимых направления Standards/Spec. До согласования
уточнены inverse 2D native→WGS84 h=0, row-major offsets и отсутствие raster-loader
при кликах. Backend review выявил: отсутствие hard cap 16 МиБ при разрешённой
общей настройке до 256 МиБ; противоречивые `/org` URL templates; разрешение
позднего запуска через `max(0.001, remaining)`; source verification вне killable
границы; затем потерю sampler reuse при одноразовых subprocess. Исправления
реализованы, окончательный review и регрессии ещё требуются.

Frontend review выявил неподдержанный bearing при доступных rotation handlers
и проверку бюджета после framebuffer allocation. В текущем экспериментальном
viewer поворот bearing отключён во всех пользовательских входах; пределы памяти
и texture sizes проверяются перед allocation. Смена центра строгой ортографии
и плавность вращения глобуса остаются задачей рабочей карты/T23.

Каждая завершённая попытка выше архивирована retirement helper в
`data/archives/publication/<project>/<archive-id>`; helper проверил длины/SHA256
и пустые container/network/volume inventories. Одноразовые offline/typecheck
контейнеры запускались с `--rm --network none`; их отчёты также архивированы.
Выбранные свидетельства, исходники и индекс перенесены в Git перед единым
commit/push №37; все завершённые попытки имеют retirement receipts.
