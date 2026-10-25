# Инструкция администратора

Для уже подготовленного стенда `hmc-app-live`.
Команды Windows приведены ниже; команды Linux — в [отдельном разделе](#linux).

## Windows

Все команды выполняйте в PowerShell из корня проекта. Запустите Docker Desktop
и дождитесь его готовности. Для каждого нового окна PowerShell сначала выполните:

```powershell
$compose = @('compose', '--env-file', 'data/live/hmc-app/environment.env',
    '--project-name', 'hmc-app-live', '--file', 'compose.publication.yaml')
```

Файл `data/live/hmc-app/environment.env` содержит настройки и пароли стенда.
Используйте существующий файл; не публикуйте его содержимое. Обновление кода
приложения и первичная установка описаны отдельно в [подготовке стенда](viewer/README.md#подготовка).

### Запустить

```powershell
docker @compose start db geoserver api gateway viewer
docker @compose ps
Invoke-RestMethod http://127.0.0.1:8141/health
```

Дождитесь запуска сервисов. Если проверка ещё не проходит, повторите её через
несколько секунд. Откройте карту: **http://127.0.0.1:8140**.
При обычном запуске повторно загружать данные не нужно.

### Остановить и снова включить

Сначала дождитесь завершения загрузки данных, если она выполняется в другом окне.

```powershell
docker @compose stop viewer gateway api geoserver db
```

Данные сохраняются. Для повторного включения выполните команды раздела «Запустить».
Не используйте `down --volumes`: эта команда удаляет тома с данными.

### Загрузить или обновить данные

1. Запустите стенд.
2. Полностью скопируйте готовые файлы GRIB2 в `data/grib`.
   Для обновления замените нужный исходный файл готовой новой версией.
   Во время загрузки файлы не меняйте.
3. Выполните:

```powershell
powershell -NoProfile -File tools/reload-grib.ps1 -Image hmc-publication:grib49-final
if ($LASTEXITCODE -ne 0) { throw 'Загрузка не завершена. Проверьте ошибки в разделе ниже.' }
docker @compose restart api gateway
```

Команда пересчитывает **все** GRIB-файлы непосредственно в `data/grib`.
Подпапки, включая `data/grib/test`, не обрабатываются. Текущий профиль принимает
температуру поверхности в K: один расчёт модели на файл, одно поле на срок;
предел размера файла — 64 MiB. Подробнее: [поддерживаемые данные](docs/grib-crs.md).

Новые данные публикуются как новая редакция — версия данных расчёта.
Прежние редакции сохраняются в пределах действующей политики хранения.
Стенд использует исторические демонстрационные часы `2026-10-19T05:00:00Z`;
не заменяйте их текущей датой при обычном обновлении.

### Проверить результат

Посмотрите итог обработки каждого файла:

```powershell
(Get-Content -Raw -Encoding UTF8 data/live/hmc-app/reload-grib.json |
    ConvertFrom-Json).files | Select-Object source, state, error
```

У успешно загруженных файлов `state` равен `published`. В карте нажмите
«Проверить обновления» и явно примите новую редакцию. Для другой модели или
расчёта выберите нужный пункт в карте; проверьте сроки прогноза и значение в точке.
Для исходного образца ICON-EU должны быть доступны все 24 срока.

### Если возникла ошибка

```powershell
docker @compose ps --all
docker @compose logs --tail 80 db api gateway geoserver viewer
```

Ошибки загрузки указаны в `data/live/hmc-app/reload-grib.json`;
журналы команды — `reload-grib.stdout.log` и `reload-grib.stderr.log` в той же папке.
При ошибке остановитесь и сохраните отчёт. Не удаляйте тома и не создавайте
другой Compose-проект вместо существующего стенда.

Резервное копирование и восстановление: [инструкция](docs/stack-recovery.md).
Проверка на Linux-сервере организации выполняется отдельно в
[задаче №50](https://github.com/stepanosokin/hmc-app-prototype/issues/50).

## Linux

Для уже подготовленного Linux-стенда с запущенным Docker Engine и Compose v2.
Нужны Bash, curl и доступ оператора к Docker. Выполняйте команды из корня проекта.
Должны существовать образ `hmc-publication:grib49-final`, контейнеры стенда,
файл `data/live/hmc-app/environment.env` и каталоги данных. Контейнерный
пользователь UID 65532 должен читать `data/grib` и писать в `data/live/hmc-app`.
Первичная установка в этот раздел не входит.

В каждом новом сеансе Bash выполните:

```bash
compose=(compose --env-file data/live/hmc-app/environment.env
    --project-name hmc-app-live --file compose.publication.yaml)
export PUBLICATION_IMAGE=hmc-publication:grib49-final
export PUBLICATION_INPUT_DIR=./data/grib
export PUBLICATION_EVIDENCE_DIR=./data/live/hmc-app
export PUBLICATION_CLOCK=2026-10-19T05:00:00Z
```

### Запустить

```bash
docker "${compose[@]}" start db geoserver api gateway viewer
docker "${compose[@]}" ps
curl --fail --show-error http://127.0.0.1:8141/health
```

Дождитесь готовности сервисов; при необходимости повторите проверку health.
Карта доступна на **http://127.0.0.1:8140** на самом Linux-хосте.
При удалённой работе настройте SSH-перенаправление локального порта 8140
на `127.0.0.1:8140` сервера и откройте тот же адрес на своём компьютере.

### Остановить и снова включить

Дождитесь завершения текущей загрузки данных, затем выполните:

```bash
docker "${compose[@]}" stop viewer gateway api geoserver db
```

Данные сохраняются. Для повторного запуска используйте команды выше.
Не выполняйте `down --volumes`: эта команда удаляет тома с данными.

### Загрузить или обновить данные

Запустите стенд. Скопируйте готовые GRIB2 в `data/grib`; для обновления замените
нужные файлы новыми версиями. Во время загрузки файлы не меняйте.
Ограничения данных и демонстрационные часы те же, что в разделе Windows.

```bash
if docker "${compose[@]}" run --rm --entrypoint python worker \
    -m publication.grib_batch --clock "$PUBLICATION_CLOCK" \
    --report /evidence/reload-grib.json \
    >data/live/hmc-app/reload-grib.stdout.log \
    2>data/live/hmc-app/reload-grib.stderr.log; then
    docker "${compose[@]}" restart api gateway
else
    printf '%s\n' 'Загрузка не завершена. Проверьте отчёт и журналы.' >&2
fi
```

### Проверить результат и ошибки

```bash
cat data/live/hmc-app/reload-grib.json
docker "${compose[@]}" ps --all
docker "${compose[@]}" logs --tail 80 db api gateway geoserver viewer
```

В отчёте проверьте `source`, `state` и `error` каждого элемента `files`.
У успешно загруженных файлов `state` равен `published`. В карте нажмите
«Проверить обновления», примите редакцию и проверьте сроки и значение в точке.
При ошибке сохраните отчёт и журналы `reload-grib.stdout.log` и
`reload-grib.stderr.log` из той же папки. Не удаляйте тома и не создавайте
другой Compose-проект для исправления ошибки.

Команды сверены с конфигурацией проекта; проверка на Linux-сервере организации
остаётся в [задаче №50](https://github.com/stepanosokin/hmc-app-prototype/issues/50).
