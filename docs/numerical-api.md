# Числовой API T10

Задача [#22](https://github.com/stepanosokin/hmc-app-prototype/issues/22).
Выбран узкий адаптер из [ADR 0001](adr/0001-numerical-http-adapter.md),
общий published resolver и проверенный Zarr sampler. Данные staging не являются
коллекциями. Каждая коллекция — одна immutable selection: model/run/revision,
field, level, member, grid и точное valid_time. Каталог не подбирает последнюю
ревизию за клиента.

## Discovery и возможности

`/api/v1/modules` описывает доступные модули через общий набор source/product/query/access
возможностей. Сейчас реализована только meteorology: manifest-zarr,
surface-temperature, point/position и scope api. Эти поля — расширяемая граница
описания возможностей, а не требование к хранилищу и временным моделям будущих модулей.
`/api/v1/models`, `/api/v1/runs?model=...`,
`/api/v1/revisions?model=...&run=...` перечисляют только опубликованную доступность.
`/api/v1/catalogue` сохраняет совместимость прежних клиентов и добавляет ссылки
`collection` и `position`. Полный набор измерений и пространственные границы
конкретной выборки доступны в `/ogc/collections/{selection}`.

`/ogc` содержит ссылки на коллекции, OpenAPI и `/ogc/conformance`.
Последний возвращает пустой `conformsTo`: профиль **hmc-edr-position/1**
реализует ограниченную форму EDR Position и CoverageJSON, но не заявляет полную
OGC EDR Core/Instances/Tiles conformance. Поддерживается только GET одной
двумерной точки и одного точного UTC-времени, параметр `T_G`.
`run` и `revision` — обязательные расширения; selection задана collectionId.
Нет автоматического выбора запуска, ближайшего времени, серии, cube или скачивания массива.

Нормативные ориентиры: [OGC EDR 1.1, 19-086r6](https://docs.ogc.org/is/19-086r6/19-086r6.html)
и [CoverageJSON 1.0](https://docs.ogc.org/cs/21-069r2/21-069r2.html).
Использование их формы запроса/ответа не является сертификацией соответствия.

## Координаты и значения

Domain point и EDR вызывают один sampler: ближайшая native-ячейка,
точное время, никакой замены запуска или подстановки крайней ячейки за границами.
При внутренних равных расстояниях выбирается ячейка восточнее/севернее.
Граница покрытия полуоткрытая: west/south включены, east/north исключены.
Долгота нормализуется в [-180, 180). Широта должна быть конечной и лежать в [-90, 90].
По умолчанию вход — `urn:hmc:crs:icon-sphere-6371229`, оси **долгота, широта**,
градусы на исходной сфере R=6371229 м, Greenwich.

Дополнительный входной `crs=http://www.opengis.net/def/crs/OGC/1.3/CRS84`
интерпретируется как WGS84 долгота/широта с высотой 0 м. Применяется та же
одобренная для прототипа нулевая геоцентрическая операция, что в
[контракте тайлов v2](numeric-tile-contract.md): WGS84 geodetic → Cartesian →
native sphere geodetic. Это гипотеза прототипа; подтверждение производителем и
desktop QGIS остаются отдельными воротами. EPSG:4326 не является псевдонимом
native CRS, не принимается и не меняет порядок осей неявно.
CoverageJSON всегда содержит native-координаты выбранной ячейки и явно ссылается
на native CRS; `selection` содержит её row/column, координаты, units, source/batch,
identity, method и причину отсутствия значения. Вне покрытия координаты домена
обозначают запрошенную точку в native CRS, cell=null, value=null,
reason=outside_coverage. При исходном missing: cell заполнена, value=null,
reason=native_nodata. В реальном образце nodata отсутствует; проверяется отдельно
помеченным синтетическим дополнением.

## Ошибки и доступ

Domain и EDR используют JSON exception `{code, description}` с HTTP-статусом:

| Статус | Значение |
| --- | --- |
| 400 | Некорректное время/точка/CRS/формат, неизвестный или повторный query-параметр |
| 401 | Нет действующего ключа в /org |
| 403 | Профиль ключа не допускает числовой API |
| 404 | Нет опубликованной выборки, поля или точного времени; identity не совпадает |
| 410 | Выборка истекла, в том числе при прогретом кеше |
| 413 | Лимит размера ответа gateway |
| 429 | Бюджет запросов или параллельной работы; Retry-After |
| 503 | Временно недоступны хранилище, сервис или authorization store; Retry-After |
| 504 | Deadline gateway; Retry-After |

Неверный путь gateway может вернуть пустой 404. WMS сохраняет отдельный
существующий профиль. Обработчики не передают внутренние пути и исключения сервисов.
Ответы имеют no-store, кроме существующего private/no-cache контракта тайлов/WMS.
Политика доступа, отзыв ключей и бюджеты проверяются до любого чтения кеша.
Все `/ogc`-маршруты относятся к числовому scope `api`: numeric/all разрешены,
gis запрещён. Организационные ссылки сохраняют префикс `/org`.

## Числовые тайлы

`numeric_tiles` коллекции и ссылка `tiles` каталога раскрывают один и тот же
manifest-scoped контракт: выбранный f32, little-endian 258×258 значений и uint8
mask, WebMercatorQuad/EPSG:3857, zoom 0..6, halo, bilinear и бюджеты ошибок.
Сохранён [выбор T4](evidence/t4/validation.md): погрешность кодирования ≤0.001 K,
общая display-погрешность ≤0.01 K. Это отдельные допуски от канонического point/EDR
и COG ≤0.0001 K. При клике значение читают из point, никогда из цветов палитры.
Availability и ошибки/expiry описаны в metadata. Tiles conformance не заявлена.

## Пример PowerShell

На запущенном изолированном стенде:

```powershell
$base = 'http://127.0.0.1:8100'
$s = (Invoke-RestMethod "$base/api/v1/catalogue").selections |
    Where-Object fixture -eq actual | Select-Object -First 1
Invoke-RestMethod ($base + $s.collection)
$q = @{
    run=$s.run; revision=$s.revision; datetime=$s.valid_time
    coords='POINT(-23.5 29.5)'; 'parameter-name'='T_G'
    crs='urn:hmc:crs:icon-sphere-6371229'; f='CoverageJSON'
}
Invoke-RestMethod -Uri ($base + $s.position) -Body $q
Invoke-RestMethod -Uri ($base + $s.point) -Body @{
    selection=$s.selection; run=$s.run; revision=$s.revision
    valid_time=$s.valid_time; layer=$s.field; lon='-23.5'; lat='29.5'
}
Invoke-RestMethod "$base/api/v1/openapi.json"
```

Для организаций: `$base='http://127.0.0.1:8100/org'`, запрос каталога и каждого
ресурса с `-Headers @{Authorization="Bearer $organizationKey"}`. Ссылки ответа
уже содержат `/org`, поэтому соединяйте их с origin без повторного `/org`.
Не передавайте ключи в URL.

## Проверка

Используется существующий закреплённый Compose runner: `publication/run-budgets.ps1`
в полном режиме; он включает publication/restart T5, реальные GeoServer failures,
access/cache/isolation T8, budgets/accounting T9, mypy, native runtime и полный unittest suite.
Полный T9 выбран потому, что при проверке T10 устранён доказанный deadlock
повторной миграции usage во время gateway-чтения. Лимиты и алгоритм учёта не меняются.
Новые HTTP-контракты находятся в `tests/test_publication_numerical.py`, включаются
`T4_HTTP=1`. Пример запуска с новым именем проекта:

```powershell
powershell -NoProfile -File publication/run-budgets.ps1 -Project hmc-publication-t9-t10-check -Port 8110
```

Runner архивирует свидетельства и удаляет контейнеры, сети и тома своего проекта
в finally. Результаты реализации фиксируются отдельно в отчёте T10; эта инструкция
сама по себе не является свидетельством успешной проверки.
