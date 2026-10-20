# T23: review повторной реализации

База review: `e7f6722c638d7cc77611eb0ef4ef29bbe64ca2a7`, uncommitted changes
текущей `main`. Проверка выполнена двумя независимыми read-only агентами по
осям Standards / Spec, затем повторена после исправлений. Существующие архивы
T23/T23a сохранены; эта запись не утверждает полной приёмки Safari.

## Standards

Исправлены замечания:

- Worker не должен получать reader pool или сокращённый socket timeout:
  сохранено закрытие после транзакции и намеренный `timeout=120` retention.
- Ошибки cursor/commit/rollback исключают возврат соединения; захват cursor
  находится внутри защищённого блока, оставшийся deadline проверяется повторно.
- Android reverse не должен заменять чужой mapping: `--no-rebind`, владение
  регистрируется только после успеха.
- При отказе CDP закрывается только известный task target через HTTP endpoint,
  затем проверяется отсутствие именно этой вкладки. Остальные cleanup шаги
  продолжаются независимо; `Browser.close` на пользовательском Android не вызывается.

Последнее повторное чтение не выявило обязательных замечаний. Пул хранит точные
таймауты 2/5 с, PID/роль/credentials; максимум три idle-соединения на thread и
возраст 60 с. Три нужны для retention guard, вложенного чтения и accounting.
Динамические deadlines не округляются, решения доступа/retention не кешируются.

После отказа `t7-full1` отдельно проверена opt-in фикстура `reader_budget`:
четыре читателя требуют явно допускающей их изолированной policy. Фикстура
сохраняет исходную строку либо отсутствие строки, меняет только concurrency и
восстанавливает исходное состояние во внешнем finally с readback. Готовность
каждого reader требует 200, allowlist 200/503 и фактические overlap/deletion
сохранены. Новых замечаний нет; производственные лимиты не менялись.

## Spec

Общая ортографическая камера обновляет поле, D3-контекст, подписи, coverage и
маркер без пересоздания Map на движении. Научные raw-GRIB/PROJ, маски и
числовые допуски сохранены. Synthetic cases явно отделены от опубликованных
продуктов. Mercator доступен только явной командой.

Физический drag/pinch проверяет trusted touch отдельно от scripted pointermove
frame p95. Tap выполняется после явного возврата zoom=0; это не свидетельство
inverse при масштабе pinch. `target_pixel` сохраняет исходную цель, а
`requested_pixel` — действительно отправленную координату. Исправление original
DOM touch/mouse относительно canvas меняет реальный inverse, не только отчёт.

Runtime.getHeapUsage описывается как renderer JS heap/backing store; это не
полное потребление браузера/VRAM. Числовые массивы и текстуры имеют отдельную
консервативную оценку и согласованный gate 128 МиБ.

Новых подтверждённых ошибок при повторном чтении не найдено. Приёмка требует
актуальных frozen Android/Chrome/Edge результатов, cold-budget, service checks
бюджетов/отзыва доступа/перезапуска/retention и завершённого архива/cleanup.
Физический Safari не проверен. 21.10.2026 пользователь явно отложил эту проверку
для завершения №35; см. [решение](completion-decision.md). Поддержка Safari
не заявляется, исходные результаты не меняются.

Единственный последующий source diff — тело opt-in T7 fixture, не выполнявшееся
в browser/T9 gates. Их полные inventories сохранены и не объявляются одинаковыми
с новым T7: [явное различие](validation-input-difference.json) фиксирует 119
неизменных входов и один test-only diff. Это не требует повторной GPU-пробы;
новый T7 и итоговые статические/обычные тесты проверяют окончательное дерево.

## Статус

Результаты завершённых доступных проверок фиксируются в [validation.md](validation.md):
Chrome/Edge/Galaxy budgets и independent numeric reference, T9 Development/full,
T7 full, final static/ordinary suite и архивная целостность прошли; cleanup проверен.
Проверки согласованной матрицы завершены. По явному решению пользователя
Safari/iOS отложен; №35 закрывается после commit/push с 8/8 уточнённых критериев.

Finalization documentation review (Standards and Spec): no mandatory findings.
The open 8/8 snapshot explicitly precedes commit/push; closure is verified
by a separate GitHub readback after publication.
