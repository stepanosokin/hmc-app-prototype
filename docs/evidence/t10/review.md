# Ревью T10 / #22

Проверены незакоммиченные изменения относительно
`7e68fd306ccb608781bd96d0cf78371e711014bb` по двум независимым осям навыка
`code-review`. Источники: issue #22, обе спецификации, ADR 0001, контракт тайлов v2,
AGENTS.md, development-workflow.md, GLOSSARY.md и соседний код.

## Standards

Нарушений документированных правил нет. Первоначально отмечено повторение
парсинга POINT и преобразования координат при формировании outside-coverage
ответа. Исправлено: sample возвращает query_position в native CRS, CoverageJSON
использует готовую cell либо query_position. Повторная проверка: 0 открытых
нарушений и 0 существенных эвристических замечаний.

## Spec

Найдено несоответствие различению 404/503 при исчезновении Zarr-массива после
прогрева sampler. Добавлен реальный HTTP fault/recovery test и перевод ошибок
чтения опубликованного поля в PublicationUnavailable. Red-прогон показал также
200 с fill value при отсутствующем longitude directory: consolidated metadata
не доказывает наличие chunks. Исправление проверяет наличие и длины всех файлов
выбранного поля по уже проверенному immutable manifest inventory. Отдельный
chunk также проверяется fault-тестом. Повторная проверка: 0 открытых замечаний,
расширения scope нет.

При полной приёмке дополнительно воспроизведён существующий deadlock повторной
миграции usage с запросами gateway: CREATE INDEX удерживал ShareLock, затем
ALTER IF NOT EXISTS требовал AccessExclusiveLock, конфликтуя с INSERT читателя.
Миграция теперь добавляет только отсутствующие columns до CREATE INDEX; свежая
таблица сразу содержит columns. По повторному Standards/Spec review замечаний
нет. Проверяется и legacy-схема без columns. OpenAPI уточняет public security=[]
и обязательные Bearer/API key для /org. T9 runner сохраняет failure logs до retirement.

Ревью статическое. Результаты исполнения, исходные хеши и очистка стендов
фиксируются в [validation.md](validation.md) и JSON/логах этого каталога.
