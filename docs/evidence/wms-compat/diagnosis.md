# QGIS WMS: воспроизведение и согласованный контракт

Задача [№47](https://github.com/stepanosokin/hmc-app-prototype/issues/47).
Исходный коммит: `a4dd856cf3f382ce99d5ba804ba8094466b13656`.

Проверка `live-probe.mjs before` на сохранённом `hmc-app-live` воспроизвела
проблему обычного подключения: capabilities не объявлял предел размеров,
GetMap с DPI получал 400, без TIME — 404, Identify большого окна — 400.
Исходный результат сохранён в `live-before.json`. Это не отсутствие данных:
выбранная редакция содержит 24 срока. Публикация не менялась.

GetFeatureInfo уже существовал и возвращал `GRAY_INDEX` числового COG.
Причиной несовместимости были общий предел размеров для картинки и контекста
Identify, запрет служебных DPI-параметров и несоблюдение объявленного default
при отсутствии TIME. Старый desktop helper обходил ограничения через
`dpiMode=0`, `maxWidth=maxHeight=512`, `IgnoreGetMapUrl/IgnoreGetFeatureInfoUrl`.

Пользователь подтвердил Q1–Q7: обычное подключение без ручных настроек;
температура поверхности в K по существующему GIS-контракту, NoData без
подстановки; максимум GetMap **512×512**; первый опубликованный срок при
отсутствии TIME; явно отсутствующее время остаётся ошибкой; проверенные
DPI-подсказки не меняют данные/палитру/размер PNG; большой Identify обрабатывается
отдельно. Новых терминов предметной области или труднообратимых архитектурных
решений нет: отдельные glossary/ADR не добавлялись.

Источник для различия GetMap и Identify —
[код провайдера QGIS 3.44](https://github.com/qgis/QGIS/blob/release-3_44/src/providers/wms/qgswmsprovider.cpp):
draw использует maximumTileSize, identify передаёт размеры контекста вызывающей
стороны. Поэтому объявить MaxWidth/MaxHeight без отдельной обработки Identify
недостаточно. Отсутствующий dpiMode означает DpiAll в
[настройках провайдера](https://github.com/qgis/QGIS/blob/release-3_44/src/providers/wms/qgswmscapabilities.cpp).
