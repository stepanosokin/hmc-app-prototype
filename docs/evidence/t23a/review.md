# Review №37

Исходная точка: `ff451d1cd381b896a1e08147973f33291f9318c3`.
Навык `code-review`, независимые направления Standards и Spec; review охватывает
изменённые и новые файлы до единого commit. Исторические T23 helpers используются
как зависимости экспериментального viewer; исходные результаты T23 сохранены.

Standards проверил репозиторные правила, ограничение процессов, очереди,
таймауты, output limits, cleanup и полноту свидетельств. Spec проверил соответствие
№37, wire format, однократную интерполяцию, CRS/операцию, маски и смысл selection.

Исправлены замечания разработки: source verification перенесён в killable child;
immutable sampler сохраняется между запросами; native cache ограничен 16 МиБ;
URL metadata согласованы с `/org`; deadline не допускает позднего запуска;
404 отсутствующей selection отделён от 503 повреждённых assets; неизвестный
bearing отключён; бюджет GPU проверяется до allocation. Ортографическая широта
использует устойчивое `atan2(up,hypot(north,east))` около полюса.

Последний review выявил два дефекта: повторные клики удерживали старые render
listeners/DOM nodes; evidence checker принимал пустые comparison/views/retirements.
Теперь маркер и обработчик переиспользуются, при смене режима снимаются;
checker требует точную матрицу трёх viewport × двух режимов × двух scopes,
положительное число точек и receipt каждого выбранного проекта/регрессии.
Повторный review Standards/Spec подтвердил исправления без новых конкретных
замечаний. Review не подменяет финальные service/GPU gates.

Дополнительный focused review подтвердил группировку текущих native-resolve
чтений через ContextVar-транзакцию: проверки выполняются на каждый запрос,
commit/rollback/close и reset остаются внешними; обычные database() не меняются.
Также просмотрена подготовка карты/shader параллельно доставке и GPU upload
каждого валидированного блока: поле скрыто до всех 18 блоков, бюджет проверяется
до allocation, cold timer включает весь путь. Новых замечаний нет.

Staged audit подтвердил все 110 Git blobs против измеренных SHA256. Default
`git diff --cached --check` отметил только дополнительные пустые строки EOF
в process_channel.py и зеркале существующего test_publication_numerical.py.
Измеренные байты сохранены. Source whitespace check использует
`core.whitespace=-blank-at-eof` и исключает `docs/evidence/**`: архивные
per-path attributes иначе включают EOF warning обратно. Архив проверяется
по точным длинам/SHA256; source check проверяет остальные whitespace defects
без изменения замороженных входов.
