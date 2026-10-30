# Береговая линия Natural Earth

`coastline-data.js` содержит только координаты линий из
[ne_110m_coastline.geojson, Natural Earth v5.1.2](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_coastline.geojson).
Все 134 линии сохранены без упрощения; свойства удалены, линии объединены
в MultiLineString. Исходный GeoJSON: SHA256
`851f581ff5ffb844deed8ae1a9ce22e3c4bb3d74fa342cadb5d8e39b41ae7c3c`.

Данные — [общественное достояние](https://www.naturalearthdata.com/about/terms-of-use/).
Авторы: Tom Patterson, Nathaniel Vaughn Kelso и участники Natural Earth.
Масштаб 1:110m соответствует локальной подложке; небольшие острова могут
отсутствовать. Государственные границы и берега внутренних озёр не добавляются.
Данные включены локально, сетевых запросов к Natural Earth при работе карты нет.

Используется линейный источник: обводка обрезанных полигонов суши добавила бы
ложные линии на горизонте и границах области отображения. Согласованные
требования: [береговая линия поверх растров](../docs/design/coastline-discussion.md).
