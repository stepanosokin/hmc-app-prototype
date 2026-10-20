# T23a / №37 — числовое отображение

Задача: [№37](https://github.com/stepanosokin/hmc-app-prototype/issues/37).
Исходный commit: `ff451d1cd381b896a1e08147973f33291f9318c3`.
Контракт [hmc-native-display/1](../../../publication/native-display.v1.json)
явно утверждён пользователем 20.10.2026; frozen v2 сохранён.

Финальные service/GPU gates пройдены. Выбрана проба
`hmc-publication-t23a-gpu13`; [индекс архива](artifact-index.json) связывает
контракт, точные входные байты, Chrome/Edge, регрессии и retirement receipts.
Проверка native/historical архивов прошла; 10 негативных случаев отвергнуты
(checksum, matrix/scope, нулевые samples, input drift, cold budget, cleanup).
Исходные 109 runner inputs дополнены только land.js из совпадающих Chrome/Edge
hashes: [provenance](validation/input-provenance.json). Все 110 исходников
сохранены в `inputs/`; исходные start/end отчёты не переписаны.

| Показатель | Результат | Предел |
| --- | --- | --- |
| GPU относительно raw GRIB | ≤0,002397317 K | ≤0,01 K |
| Native encoding | 0 K | ≤0,001 K |
| Server fixed-screen | ≤0,000015057 K | ≤0,01 K |
| Различия масок | 0 | 0 |
| Геометрия control points | ≤5,5e-13 px | ≤0,001 px |
| Synthetic projection probes | ≤1,648 м | ≤10 м diagnostic |
| Полный холодный показ 1440×900, Chrome / Edge | 2848 / 2758 мс | ≤3000 мс |
| Тёплое переключение, все viewport/browser | ≤123 мс | ≤1000 мс |
| Pan/zoom frame p95 | ≤17,7 мс | ≤33 мс desktop |
| Поле, wire bytes | 5990760 + metadata | ≤8 МиБ |
| Числовые массивы/GPU/readback estimate | ≤47217600 байт | ≤128 МиБ |

Cold начинается от navigation time origin, включая local scripts, worker,
field I/O, shader и uploads. API/gateway перезапущены перед первым desktop
открытием; prewarm включает только код. OS page cache не объявляется очищенным.
Narrow viewport emulation сохраняется отдельной desktop областью измерения.

## Метод и границы

Независимый источник — исходный ICON-EU GRIB, SHA256
`dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`.
Все 18 native блоков сравниваются с исходными ячейками, padding и halo; GPU
сравнивается с отдельной scalar bilinear реализацией raw GRIB в тех же
географических позициях. Fixed-screen серверный вариант сравнивается в тех же
пикселях отдельно. COG ≤0,0001 K остаётся отдельной границей преобразования.

Проверены оба режима, три viewport и два desktop браузера на реальном Windows
ANGLE/NVIDIA GeForce RTX 4070 Laptop GPU / Direct3D11. Узкие viewport — desktop
эмуляция, не Android/iOS. Полюс, ±180°, горизонт и отсечение 45° — явно
синтетические projection-only cases; они не расширяют покрытие ICON-EU.

Выбран нативный путь с однократной GPU-интерполяцией. Серверные fixed-screen
производные подтверждают применимость альтернативы для сравнения; они доступны
только в изолированном test режиме и не объявлены публичным тайловым контрактом.
Проверенные отвергнутые варианты сохранены в [development](development.md),
независимый [review](review.md) включает Standards и Spec.

Технический browser driver сохраняет `compatibility-probe-complete` и
`acceptance=incomplete`: он сам не принимает полную T23/рабочую карту.
Границы №37 (матрица режимов/точек, допуски, бюджеты, service gates и retirement)
проверяются отдельно командой `tools/check_evidence.py --native-display`.

## Воспроизведение

На Windows с Docker, закреплёнными образами publication и приватным образцом:

```powershell
powershell -NoProfile -File tools/run-native-display.ps1 -Project hmc-publication-t23a-unique -WithEdge
powershell -NoProfile -File publication/run-integrated.ps1 -Project hmc-publication-t12-unique -Port 8140 -Phase Prepare -SkipBuild
# В закреплённом QGIS Desktop выполнить publication/qgis_desktop.py: verify_desktop(конфигурация Prepare).
powershell -NoProfile -File publication/run-integrated.ps1 -Project hmc-publication-t12-unique -Port 8140 -Phase Complete -SkipBuild
```

Объединённый T12 выбран вместо повторных отдельных T5/T8/T9: он проверяет их
актуальные сценарии, T10 persistence/access-store failures, WMS, desktop QGIS и
полный набор тестов. T6 требуется из-за изменений tile-cache/gateway execution.
T7 не выбран: retention policy, collection, миграция retained revisions и
семантика срока хранения не изменены; expiry нового native cache проверяется
через gateway отдельно. Parent T23/#35, рабочая карта, вращение глобуса и
физические Android/iOS сохраняют собственные gates.

Пройдены full T12 `hmc-publication-t12-t23a-final1`: T5 — 1 тест, T12 — 1,
T9 — 3, WMS — 1 до и после restart, полный T8 policies/restart, изоляция edge,
отказ access store, desktop QGIS 3.44.11-Solothurn и runtime. Полный набор:
46 тестов, 22 пропущены по отдельным opt-in gates, ошибок нет. Полный mypy
прошёл для 61 файла; 7 исторических evidence negative tests прошли отдельно.

Пройден T6 `hmc-publication-t6-t23a-final1`: 7 recovery tests, detached managed
source, restart, legacy publication, повторные types/full suite (46 тестов,
22 opt-in skips), проверка 876 исторических evidence references. Native exit
всей цепочки 0. Оба проекта retired, receipts проверены, временный QGIS key
удалён; проект QGIS остался без добавленных слоёв.

Для каждого из 29 проверочных проектов сохранён retirement receipt с
`archive_verified=true` и пустыми container/network/volume inventories.
Последний evidence gate сам выполнен в `--rm --network none` и retired.
Профили браузеров/локальные HTTP servers удалены. Приватный GRIB сохранён вне
Git; unrelated проекты и shared caches не очищались. Live demo не оставлен.

Финальная проверка обоих направлений review подтвердила derivation inventories,
совпадение 110 байтовых источников и выбранные численные/service результаты.
Git-индекс и затем HEAD сверяются с теми же SHA256 до заявления о push.
