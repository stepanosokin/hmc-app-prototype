# Локальные ресурсы рабочей карты T16

Проверено 21.10.2026 по оригинальным лицензиям поставляемых версий и первичным
источникам ниже. Интернет нужен только для установки/подготовки, не для просмотра.

| Ресурс | Версия и доставка | Основание распространения |
| --- | --- | --- |
| Береговая линия Natural Earth `ne_110m_land` | 5.1.2, локальный `/land.js`, координаты без свойств | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/), разрешены изменение и распространение; авторы Tom Patterson, Nathaniel Vaughn Kelso и участники |
| MapLibre GL JS, встроенные шейдеры, module worker и shared module | 6.15.0, `/vendor/` | [BSD-3-Clause и включённые notices](https://github.com/maplibre/maplibre-gl-js/blob/v6.15.0/LICENSE.txt), [сохранённая лицензия](../../../viewer/licenses/MapLibre.LICENSE.txt) |
| proj4js, включая импорт из worker | 2.22.0, `/vendor/proj4.js` | [MIT](https://raw.githubusercontent.com/proj4js/proj4js/v2.22.0/LICENSE.md), [сохранённая лицензия](../../../viewer/licenses/proj4.LICENSE.md) |
| D3 Array | 3.2.4, `/vendor/d3-array.min.js` | [ISC](https://raw.githubusercontent.com/d3/d3-array/v3.2.4/LICENSE), [сохранённая лицензия](../../../viewer/licenses/d3-array.LICENSE.txt) |
| D3 Geo / GeographicLib | 3.1.1, `/vendor/d3-geo.min.js` | [ISC и MIT notices GeographicLib](https://raw.githubusercontent.com/d3/d3-geo/v3.1.1/LICENSE), [сохранённая лицензия](../../../viewer/licenses/d3-geo.LICENSE.txt) |
| Стиль карты, CSS, подписи городов, проекции, числовой декодер, GPU-шейдеры | Исходники `viewer/`, точные SHA256 в frozen inputs попытки | Код проекта, без заимствования платных карт; отдельной внешней загрузки шейдеров нет |
| Шрифты | Системный стек / Courier New с fallback | Файлы шрифтов не поставляются и не скачиваются; используются установленные на устройстве |
| WASM, sprites, font glyph API, публичный tile/API service | Не используются текущим просмотрщиком | Нет обязательного внешнего runtime-ресурса |

Сборки библиотек закреплены размером и SHA256 в
[vendor-lock.json](../../../tools/display-projections/vendor-lock.json).
[prepare.mjs](../../../viewer/prepare.mjs) проверяет эти байты перед запуском
и копирует лицензии рядом с библиотеками; `/vendor/*LICENSE*` раздаётся локально.
Подложка и авторство обозначены в русской панели карты. Числовые данные идут
через локальный same-origin bridge в gateway, с контрактом
[native-display/1](../../../publication/native-display.v1.json).

Это проверка прав на ресурсы интерфейса. Частный метеорологический образец
не включается в распространяемый архив: сохраняются его SHA256 и результаты
сравнения, а не исходный GRIB.
