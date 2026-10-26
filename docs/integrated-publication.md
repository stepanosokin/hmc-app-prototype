# M3: согласованная защищённая публикация

Задача [T12 / #24](https://github.com/stepanosokin/hmc-app-prototype/issues/24)
проверяет совместную работу существующих сервисов. Выбранный в
[M1 / T3](validation/archives.md) узкий HTTP-адаптер вызывает общий
manifest-backed Zarr sampler. Temporal WMS остаётся в GeoServer; числовые
тайлы используют выбранный в [T4](validation/archives.md) `project-bilinear/1`,
контракт `hmc-temperature-tile/2`, Float32 и отдельную маску.

Поддерживаемый профиль:

| Клиент | Выборка и числовой смысл |
| --- | --- |
| Domain point | Точные selection/run/revision/time/field, исходная ячейка, K |
| Ограниченный EDR position | Один POINT и срок, CoverageJSON, тот же native sampler; run/revision — расширения проекта |
| Числовые тайлы | EPSG:3857, zoom 0–6, 256×256 + halo 1, native bilinear; погрешность кодирования ≤0,001 K, общий бюджет ≤0,01 K |
| GeoServer 2.27.0 / WMS 1.3.0 | Scoped capabilities, отдельный домен времени ревизии, карта, легенда, full-resolution identify |
| QGIS 3.44.11-Solothurn | Настоящий WMS provider, temporal renderer, identify и легенда; EPSG:4326 и EPSG:3857 |

Вход point/EDR по умолчанию — долгота/широта исходной сферы, а не WGS84.
Переход к отображению использует утверждённую гипотезу нулевого datum shift,
исходную высоту 0 и явное geocentric преобразование. WMS 1.3.0 EPSG:4326
принимает BBOX latitude/longitude. Полная OGC conformance не заявляется.
Ключ организации передаётся заголовком, защищённые ссылки начинаются с `/org`.
Публичный демонстрационный профиль существует отдельно.

## Воспроизведение

Нужны Docker Desktop, приватный исходник `data/grib/ICON_EU_T_G_2026101500.grib2`
с SHA256 `dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a`
и работающий QGIS указанной версии. Runner проверяет исходник до создания
стенда, использует закреплённые Compose-образы, новые тома и явные часы
`2026-10-19T05:00:00Z`. Для каждой попытки нужен новый project.

```powershell
./publication/run-integrated.ps1 -Project hmc-publication-t12-check -Port 8112 -Phase Prepare
```

Prepare выполняет mypy, раннюю проверку публичной ошибки, T5 с 24 реальными
сроками, T12 cross-client/policy/expiry, T9 budgets, T11 WMS и T8 access.
`-Development` оставляет короткую публикацию 01/03, T12, T11 и T8 policy;
также выполняет T9 budgets с кешем ровно на два тайла (`665640` bytes).
Это проверка новых сценариев, а не итоговый M3 gate.

Далее через QGIS MCP выполните тот же desktop helper, что в
[процедуре T11](qgis.md#работа-агента-через-qgis-mcp):

```python
from pathlib import Path
exec(Path(r'D:/path/hmc-app-prototype/publication/qgis_desktop.py').read_text(encoding='utf-8'))
verify_desktop(r'D:/path/hmc-app-prototype/.scratch/hmc-meteo/hmc-publication-t12-check/desktop.json')
```

```powershell
./publication/run-integrated.ps1 -Project hmc-publication-t12-check -Port 8112 -Phase Complete
```

Complete проверяет привязку desktop к HTTP selection и SHA256 входов,
повторное provisioning access, изоляцию backend от edge, fail-closed при
недоступной БД ключей, перезапуск API/gateway/GeoServer, сохранённые ревизии,
повторный WMS, отозванные ключи после restart, полный suite и native runtime.
Исходники между фазами менять нельзя. Итоговый gate требует полного режима
и совпадения начального/конечного инвентаря входов.

T12 читает защищённые point/EDR/WMS для шести независимых baseline-ячеек
каждого проверяемого срока. Тайлы через gateway декодируются и сверяются
с bilinear reference непосредственно из GRIB, включая halo и footprint mask.
Исправление +1 K и пропуск срока — явно обозначенные синтетические дополнения.
Во время публикации опрашиваются защищённые каталоги/collections/capabilities,
новые числовые ответы и сохранённый старый читатель. Реальные отказы
metadata readiness и GIS index не должны менять доступную публикацию.
Отключение lazy generation доказывает warm-cache hit; тот же URL подчиняется
revocation, квотам и expiry. Usage связывается с HTTP request ID и длиной ответа.

После Complete и после ошибки runner сохраняет service logs и автоматически
архивирует/удаляет проект по [workflow](development-workflow.md#test-environment-cleanup).
При ошибке в самом QGIS сначала сохраните обезличенную диагностику, затем:

```powershell
./tools/retire-publication-project.ps1 -Project hmc-publication-t12-check -ReportDirectory data/reports/t12/hmc-publication-t12-check
```

Удалите одноразовый `.scratch/hmc-meteo/<project>/key` после успешной очистки.
Приватные environment/key файлы не входят в переносимые доказательства.

M3 относится к серверной интеграции и указанному desktop-клиенту. Он не
закрывает browser/GPU/interpolation части A2/A3/A8: это задачи #25–#28 и
итоговая приёмка. T3 остаётся point/metadata evidence. Производственная
ёмкость, другие версии QGIS, browser navigation и TLS здесь не заявляются.

Проверенный результат: [итоговый M3 gate и доказательства T12](validation/archives.md).
