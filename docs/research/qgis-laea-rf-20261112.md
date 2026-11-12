# Серверная LAEA — РФ в штатном QGIS

Исследование от 12.11.2026 для [вопроса карты](https://github.com/stepanosokin/hmc-app-prototype/issues/98).
Версии: QGIS `final-3_44_11`; GeoServer `2.27.0`, использующий GeoTools `33.0`
([зависимость в pom.xml](https://github.com/geoserver/geoserver/blob/2.27.0/src/pom.xml#L92)).
Практические GIS-эксперименты, запуск QGIS и изменение live в этом исследовании не выполнялись.

## Вывод

**Для проверенной поставки QGIS не найден путь, который одновременно даёт точную серверную LAEA — РФ
и обычное подключение WMS по URL без подготовки клиента.** Добавить определение только в GeoServer
недостаточно: клиент должен самостоятельно распознать CRS, чтобы вычислять BBOX, оси и координаты Identify.
Точного готового идентификатора в проверенных поставляемых базах нет; разбор WMS в этой версии QGIS
не загружает определение неизвестной CRS с сервера.
Это вывод о проверенных версиях и базах, не утверждение невозможности во всех будущих клиентах и реестрах.

Требуемая CRS:

```text
+proj=laea +lat_0=60 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs
```

EPSG:3576 имеет полярный центр 90°/90°, а здесь нужен 60°/90°.
Это разные представления, поэтому существующее согласование стандартных CRS остаётся в силе:
[решение о фиксированных CRS](../validation/qgis-wms-crs-decision-20261112.md).
Серверную поддержку точной LAEA — РФ нельзя включать в обещания первого этапа.

## Где возникает ограничение

| Участок | Установленное поведение | Следствие |
| --- | --- | --- |
| WMS 1.3.0 | §6.7.3.1 разрешает идентификатор-label или URL определения; §7.2.4.6.7 объявляет CRS именами | Стандарт не требует ограничиваться EPSG, но объявления имени недостаточно для поддержки конкретным клиентом |
| Capabilities QGIS | `parseLayer` читает содержимое CRS/SRS как строки, разделённые пробелами | WKT/PROJ с пробелами не передаётся этим путём как полноценное определение |
| Разбор CRS QGIS | `createFromOgcWmsCrs` ищет локальные user/custom/QGIS ID, legacy ID, bundled srs.db и PROJ authority/code | Произвольное определение из Capabilities не импортируется |
| URL и URN QGIS | `parseCrsName` распознаёт известные формы OGC URL/URN и извлекает authority/code | URL здесь служит формой имени, а не командой скачивания WKT |

Источники:
[WMS 1.3.0, OGC 06-042, §§6.7.3.1 и 7.2.4.6.7](https://docs.ogc.org/is/06-042/06-042.pdf);
[QGIS parseLayer](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmscapabilities.cpp#L1250);
[полный createFromOgcWmsCrs](https://github.com/qgis/QGIS/blob/final-3_44_11/src/core/proj/qgscoordinatereferencesystem.cpp#L436);
[parseCrsName](https://github.com/qgis/QGIS/blob/final-3_44_11/src/core/qgsogcutils.cpp#L3782).

В полном WMS-разборе CRS нет обратного перехода к общему `createFromString`, разбора произвольного WKT/PROJ
или HTTP-загрузки определения. Финальная попытка `loadFromAuthCode` вызывает `proj_create_from_database`.
Следовательно, общая способность QGIS создавать пользовательские CRS не означает поддержку того же текста
в поле WMS CRS.
[QGIS loadFromAuthCode](https://github.com/qgis/QGIS/blob/final-3_44_11/src/core/proj/qgscoordinatereferencesystem.cpp#L2537).

Инвентаризация поставляемых локальных баз выполнена только на чтение:
PROJ 9.8.1, EPSG v12.029, ESRI ArcGIS Pro 3.6. В PROJ проверены 150 LAEA-записей через таблицу conversion;
единицы углов подтверждены как градусы, широты центра 60° среди них нет.
Из 173 текстовых projected CRS четыре содержат LAEA, ни одна не соответствует 60°/90°.
В bundled QGIS srs.db проверены 155 LAEA, численно разобранные lat_0 также не содержат 60°.
Хеши баз до/после совпадают.
Это инвентаризация поставляемых файлов OSGeo4W, а не установление эффективного PROJ search path
запущенного клиента, всех пользовательских баз или всех существующих реестров.
Подробности и SHA256: [запись проверки](../validation/qgis-laea-rf-research-20261112.md).

## Почему AUTO/AUTO2 не решает задачу

В WMS 1.3.0 AUTO2 позволяет передать выбранные центр и единицы, но только для предусмотренного метода.
Annex B задаёт 42001 UTM, 42002 Transverse Mercator, 42003 Orthographic, 42004 Equirectangular
и **42005 Mollweide**. Последний код не обозначает Lambert Azimuthal Equal Area.
[WMS 1.3.0, §6.7.3.4 и Annex B.7–B.11](https://docs.ogc.org/is/06-042/06-042.pdf).

В GeoTools 33.0 `AutoCRSFactory` регистрирует 42001–42004; 42005 закомментирован.
Расширения 97001–97004 не добавляют LAEA: 97003 — сферическая Azimuthal Equidistant,
97004 — Geostationary. Сходные названия равнопромежуточной и равновеликой азимутальных
проекций не делают их взаимозаменяемыми.
[AutoCRSFactory](https://github.com/geotools/geotools/blob/33.0/modules/library/referencing/src/main/java/org/geotools/referencing/factory/wms/AutoCRSFactory.java#L73),
[Auto97003](https://github.com/geotools/geotools/blob/33.0/modules/library/referencing/src/main/java/org/geotools/referencing/factory/wms/Auto97003.java#L21),
[Auto97004](https://github.com/geotools/geotools/blob/33.0/modules/library/referencing/src/main/java/org/geotools/referencing/factory/wms/Auto97004.java#L21).

Заметка GeoServer про AUTO/AUTO2 содержит оговорки ещё о 2.8.x; текущая доступность методов выше
проверена по исходникам зависимой версии, а не выведена из возраста этой документации.
[Документ в теге 2.27.0](https://github.com/geoserver/geoserver/blob/2.27.0/doc/en/user/source/services/wms/nonstandardautonamespace.rst).

В закреплённом WMS-пути QGIS также нет отдельного механизма построения AUTO2 CRS из параметров;
общий путь снова идёт через локальный authority/code. Даже добавление нового AUTO-кода только
на сервере не добавит клиенту знание метода.
[Разбор QGIS](https://github.com/qgis/QGIS/blob/final-3_44_11/src/core/proj/qgscoordinatereferencesystem.cpp#L436).

## Серверное определение и выбор CRS слоя

GeoServer допускает регистрацию собственного WKT через `user_projections/epsg.properties`.
GeoTools 33.0 реализует LAEA с параметрами широты/долготы центра, false easting/northing
и выбором сферических либо эллипсоидальных формул.
Это основание считать серверную регистрацию технически осуществимой, а не выполненная проверка рендера.
[Custom CRS в теге GeoServer 2.27.0](https://github.com/geoserver/geoserver/blob/2.27.0/doc/en/user/source/configuration/crshandling/customcrs.rst),
[GeoTools LAEA provider](https://github.com/geotools/geotools/blob/33.0/modules/library/referencing/src/main/java/org/geotools/referencing/operation/projection/LambertAzimuthalEqualArea.java#L504).

Собственный номер, названный EPSG, от этого не становится официальным EPSG и не появляется в базе QGIS.
Переопределение известного кода в другую проекцию создаёт разное понимание координат клиентом и сервером;
такое решение не соответствует требованию корректного отображения.
Это вывод из независимого разрешения CRS двумя сторонами, а не результат практического эксперимента.

При добавлении через Browser `createUri` сначала ищет среди объявленных CRS распознанный authid,
совпадающий с текущим CRS проекта; иначе использует первый объявленный CRS. Выбранный код сохраняется в URI.
Диалог WMS формирует фильтр CRS и начальный выбор отдельно.
[Browser createUri](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmsdataitems.cpp#L459),
[WMS source select](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmssourceselect.cpp#L895).

После создания провайдера GetMap и GetFeatureInfo используют сохранённый `mImageCrs`.
Смена проекта сама по себе не является повторным выбором CRS запроса из Capabilities.
Поэтому обещание «при переключении проекта любой старый WMS-слой автоматически перейдёт на серверный LAEA»
не следует из возможности начального автоматического выбора.
[GetMap](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmsprovider.cpp#L1267),
[GetFeatureInfo](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmsprovider.cpp#L3132),
[setSRSQueryItem](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmsprovider.cpp#L4789).

## Варианты и цена интеграции

Оценка ниже качественная, без обещания сроков или ускорения.

| Вариант | Условие клиента | Цена и пригодность |
| --- | --- | --- |
| Согласованный первый этап: сохранить 4326/3857 и добавить 3576 | Известные стандартные CRS | Наименьшее расширение текущего контракта; 3576 сохраняет согласованные отдельные правила покрытия |
| LAEA — РФ только на GeoServer под частным кодом | Клиент должен знать этот код | Серверная работа ограничена, но требование свежего штатного QGIS без подготовки не выполнено |
| Регистрация LAEA на клиенте, плагин, Python или готовый проект | Дополнительная подготовка | Технический обход, явно исключённый пользователем; не выбран |
| Публикация определения по URL/WKT в Capabilities | Нужна поддержка импорта клиентом | Для проверенного WMS-пути QGIS не работает как автоматический импорт |
| Будущий общий зарегистрированный код и поставка его клиентам/серверу | Обновление реестров и клиентов | Возможное отдельное направление с внешними зависимостями; не обещание для текущей версии |
| Существующий проект уже настроен в LAEA — РФ, слой запрашивается в 4326/3857 | CRS проекта уже известна пользователю | QGIS может перепроецировать слой; это не непосредственный серверный LAEA и не настройка CRS для нового пользователя |

Первые два варианта следуют из согласованного решения и найденных путей разрешения CRS.
Последний использует обычное разделение CRS провайдера и проекта; его производительность и устойчивость
не устанавливаются чтением исходников. Чужой стандартный код нельзя подменять приватным WKT.

## TIME, Identify, легенда и доступ

Расширение горизонтальной CRS концептуально не требует другого протокола времени.
QGIS Browser создаёт WMS-T URI из объявленных time/reference_time и включает provider temporal updates.
Но это не доказательство полной приёмки сочетания новой CRS, времени и Identify:
рендер и опрос значения имеют разные пути.
[WMS-T создание URI](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmsdataitems.cpp#L413).

GetFeatureInfo должен передавать те же CRS, BBOX, размер и срок, по которым вычисляется пиксель карты;
разбор осей и преобразование точки должны соответствовать точному определению.
Легенда связана со стилем и может оставаться общей при смене CRS; контекстная легенда требует проверки
своего BBOX/CRS. Наличие тега CRS само по себе не проверяет ни один из этих путей.
[WMS GetFeatureInfo §7.4.3.3 и Style §7.2.4.6.5](https://docs.ogc.org/is/06-042/06-042.pdf),
[QGIS GetFeatureInfo](https://github.com/qgis/QGIS/blob/final-3_44_11/src/providers/wms/qgswmsprovider.cpp#L3132).

В проекте будущая CRS должна пройти ту же ограниченную API-поверхность: allowlist CRS,
объявления и bbox в Capabilities, GetMap и GetFeatureInfo; policy/budget/access остаются на gateway.
Обход gateway прямой ссылкой на GeoServer не является решением требования доступа.
Это оценка интеграции по текущему
[API](../../publication/api.py) и [gateway](../../publication/gateway.py), не новая политика
и не подтверждённая проверками совместимость.

## Границы результата

Исследование разрешает технический вопрос: только серверного изменения для точной LAEA — РФ в указанных
условиях недостаточно. Оно не выбирает за пользователя ослабление ограничений, не реализует CRS
и не меняет ранее согласованное расширение стандартных CRS.
Практические рендеры, WMS-запросы, Identify, измерение производительности и правки live не выполнялись.
Доказательства чтения версий, инвентаризация баз и архивные хеши связываются через
[запись проверки](../validation/qgis-laea-rf-research-20261112.md).
