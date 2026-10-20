# Просмотр выбранного прогноза в QGIS

Поддерживаемый клиент T11: **QGIS Desktop 3.44.11-Solothurn**, Windows,
WMS-провайдер из этой установки. Другая версия требует повторной проверки.
Сервер — закреплённый в [Compose](../compose.publication.yaml) GeoServer 2.27.0.
Числовые тайлы браузера не заменяют WMS-T, легенду и GetFeatureInfo.

## Подключение с заголовком ключа

1. Получите ключ организации с профилем `all` (для сверки с числовым API)
   или `gis` (только WMS) по [процедуре доступа](publication.md).
   Запросите `/org/api/v1/catalogue` с заголовком `X-API-Key` ключом `all`
   либо получите выбранные run/revision/time у оператора для ключа `gis`.
   Скопируйте ссылку `wms` выбранной ревизии и точный `valid_time` UTC.
   Используйте внешний адрес gateway и путь `/org/gis/v1/runs/.../revisions/.../wms`.
2. В QGIS откройте «Модули → Консоль Python». Выполните код ниже,
   подставив путь к клону репозитория, адрес gateway и выбранные значения.
   Ключ считывается из приватного файла, не вводится в URL или историю консоли.

   ```python
   from pathlib import Path
   exec(Path(r'D:/path/hmc-app-prototype/publication/qgis_desktop.py').read_text(encoding='utf-8'))
   key = Path(r'D:/private/organization-key').read_text().strip()
   layer = connect_forecast('http://127.0.0.1:8111', '/org/gis/v1/runs/RUN/revisions/REVISION/wms', key, '2026-10-15T01:00:00Z')
   assert layer.isValid(), 'Не удалось подключить WMS. Проверьте журнал QGIS.'
   QgsProject.instance().addMapLayer(layer)
   iface.setActiveLayer(layer)
   iface.zoomToActiveLayer()
   del key
   ```

3. В свойствах слоя откройте «Временные»: включите динамическую временную
   обработку от поставщика данных. В настройках WMS-T выбирайте **точное начало
   интервала**, а не ближайший момент. В контроллере времени выберите доступный
   UTC-момент. Список из capabilities содержит только времена выбранной ревизии;
   отсутствующий час возвращает 404, без подстановки соседнего прогноза.
4. Используйте EPSG:4326 или EPSG:3857; для смены CRS источника повторите
   `connect_forecast(..., crs='EPSG:4326')`. Не включайте инверсию или игнорирование
   порядка осей. WMS 1.3.0 передаёт EPSG:4326 как latitude/longitude, EPSG:3857
   как easting/northing. Параметр `dpiMode=0` и запросы не более 1024×1024
   соответствуют ограниченному профилю сервера; для большого окна задайте
   размер WMS-запроса 512×512 в параметрах источника (helper уже задаёт его).
   Helper переносит настоящий список времён capabilities в `timeDimensionExtent`
   и использует исходный scoped URL для всех операций (`IgnoreGetMapUrl`,
   `IgnoreGetFeatureInfoUrl`), поскольку ссылки capabilities относительные.
5. Раскройте слой для легенды температуры в **K**. Инструмент «Определить
   объекты» с текстовым форматом возвращает `GRAY_INDEX` исходного COG,
   без чтения цвета или browser tile. За пределами поля карта прозрачна,
   числового значения нет. Числовой API использует native spherical lon/lat;
   координаты отображения WGS84 преобразуются по принятой гипотезе
   [контракта v2](../publication/contract.v2.json), при нулевой исходной высоте.
   Поэтому сравнивайте одну физическую точку, а не одинаковые числа широты
   в разных датумных системах. Допуск COG/identify — 0.0001 K.

Заголовок хранится в URI слоя в памяти QGIS. Сохранение проекта или экспорт
подключения может сохранить ключ открытым текстом: используйте приватный профиль
и не публикуйте такой проект. Скрипт приёмки удаляет только созданные им слои
и не сохраняет проект. Для удалённого подключения используйте защищённый канал;
локальный стенд слушает только 127.0.0.1.

Основа настройки — [руководство клиента QGIS 3.44](https://doc.qgis.org/3.44/en/docs/user_manual/working_with_ogc/ogc_client_support.html)
и [контракт GetLegendGraphic GeoServer](https://docs.geoserver.org/2.27.x/en/user/services/wms/get_legend_graphic/index.html).

## Работа агента через QGIS MCP

Для аналогичных задач проекта рекомендуется **QGIS MCP (`qgis_mcp`)**,
когда он доступен: агент получает доступ к работающему QGIS Desktop и выполняет
проверенный PyQGIS-сценарий в настоящем настольном процессе.

1. Через `mcp__qgis__list_qgis_instances` определите нужный экземпляр,
   проверьте версию и текущий проект перед изменениями.
2. Через `mcp__qgis__execute_code` выполните приведённый ниже код загрузки
   `publication/qgis_desktop.py` и вызова `verify_desktop(...)`.
   Используйте тот же конфигурационный файл, который создал Prepare.
3. Проверьте созданные JSON/PNG и выполните Complete по процедуре ниже.
   Сохраняйте исходное состояние пользовательского проекта, удаляя только временные слои проверки;
   URI с ключом не выводите в диагностику.

Если MCP недоступен, тот же код выполняется в Python-консоли QGIS Desktop.
MCP — рекомендуемый способ управления клиентом; требования к версии QGIS,
реальным сервисам и доказательствам приёмки остаются общими для обоих способов.

## Воспроизведение приёмки

Проверьте наличие исходного GRIB с SHA256 из `decoder/inspect_forecast.py`,
Docker Desktop и работающего QGIS указанной версии. M1 выбран по
[результатам T3](evidence/t3/validation.md). Для каждого запуска нужен новый проект.

```powershell
powershell -NoProfile -File publication/run-qgis.ps1 -Project hmc-publication-t11-check -Phase Prepare
```

Prepare запускает проверки типов, реальную публикацию и регрессию T5,
проверку публичной ошибки и T11 WMS. Изолированный ключ находится в игнорируемом
`.scratch/hmc-meteo/<project>/key`; журналы не содержат ключа. Затем в консоли
настольного QGIS:

```python
from pathlib import Path
exec(Path(r'D:/path/hmc-app-prototype/publication/qgis_desktop.py').read_text(encoding='utf-8'))
verify_desktop(r'D:/path/hmc-app-prototype/.scratch/hmc-meteo/hmc-publication-t11-check/desktop.json')
```

Сценарий использует настоящие WMS provider, temporal renderer, identify и
legend fetcher настольного процесса, сохраняет PNG и JSON без ключей в каталоге
отчёта. HTTP-тест отдельно сравнивает каждое доступное время, центр, граничные
ячейки и точки вне поля с каноническим числовым API в обеих CRS. T5 дополнительно
проверяет неполные публикации, исправления и сохранённые ревизии.

```powershell
powershell -NoProfile -File publication/run-qgis.ps1 -Project hmc-publication-t11-check -Phase Complete
powershell -NoProfile -File tools/retire-publication-project.ps1 -Project hmc-publication-t11-check -ReportDirectory data/reports/t11/hmc-publication-t11-check
```

Complete требует успешный desktop-отчёт, перезапускает сервисы, повторяет WMS,
проверяет сохранённые ревизии, полный набор тестов и runtime, сверяет инвентарь
входных файлов. Между Prepare, QGIS и Complete файлы менять нельзя.
`-Development` пропускает длинную T5-регрессию и не является финальной приёмкой.
Runner сохраняет логи и автоматически архивирует/удаляет свой проект при ошибке
и после Complete, удаляя одноразовый ключ после успешной очистки. Если ошибка
возникла в самой консоли QGIS, сохраните диагностику без URI с ключами и выполните
команду retirement вручную по [процедуре очистки](development-workflow.md#test-environment-cleanup).
После ручной очистки удалите приватный файл ключа; отчёты и архивы сохраните.

Проверенный результат T11 и сохранённые изображения:
[отчёт приёмки](evidence/t11/validation.md).
