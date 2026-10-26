# Инструкция администратора

Для существующего `hmc-app-live`. Изменение `data/grib` само по себе не меняет карту.
Если вы удалили старые файлы и добавили новые, выполните:
**просмотр снятия → применение снятия → загрузку файлов → обновление карты**.

Ниже приведены команды для текущего Windows-стенда. Используются его реальные
env-файл, образ и файл с именами томов. Пароли в env-файле не меняйте и не публикуйте.
Первичная установка и обновление кода: [подготовка стенда](viewer/README.md#подготовка).
Команды Linux — в [отдельном разделе](#linux).

## Windows

### 1. Подготовить окно PowerShell и запустить стенд

Запустите Docker Desktop. Откройте PowerShell в корне проекта.
В каждом новом окне сначала выполните:

```powershell
$ErrorActionPreference = 'Stop'
$compose = @('compose',
    '--env-file', 'data/live/hmc-app/t19-ce4426e953b7/environment.env',
    '--project-name', 'hmc-app-live',
    '--file', 'compose.publication.yaml',
    '--file', 'data/live/hmc-app/t19-ce4426e953b7/compose.live.yaml')
$env:PUBLICATION_IMAGE = 'hmc-publication:grib52-live'
$env:PUBLICATION_INPUT_DIR = './data/grib'
$env:PUBLICATION_EVIDENCE_DIR = './data/live/hmc-app'
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$env:T4_PORT = '8141'
$env:T13_PORT = '8140'
$budget = '68719476736'

docker @compose start db geoserver api gateway viewer
if ($LASTEXITCODE -ne 0) { throw 'Стенд не запущен.' }
Invoke-RestMethod http://127.0.0.1:8141/health
```

Если health ещё не проходит, дождитесь запуска служб и повторите проверку.
Исторические демонстрационные часы не заменяйте текущей датой.
Файл `compose.live.yaml` сохраняет подключение к томам этого стенда.

Бюджет здесь — **64 GiB для обеих операций**. Это верхний предел, а не выделение
64 GiB на диске. Старые данные остаются на диске до штатной очистки, а загрузчик
пересчитывает оставшиеся файлы. Поэтому нужен запас под старые и новые данные.
32 GiB в прежнем рецепте использовались только для снятия. Если объём вырастет
до нового лимита, операция снова остановится. Параметр не меняет лимит живых служб.

### 2. Изменить файлы и проверить план снятия

Дождитесь завершения других загрузок. Удалите ненужные файлы из `data/grib`
и полностью скопируйте новые. После этого не меняйте папку до конца обновления.
Для этого рецепта используйте расширения `.grb`, `.grib`, `.grb2` или `.grib2`.
Подпапки и символические ссылки не обрабатываются.

```powershell
New-Item -ItemType Directory -Force ../hmc-app-evidence/grib-sync-operations | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$plan = "../hmc-app-evidence/grib-sync-operations/update-$stamp.json"
$report = "reload-grib-$stamp.json"

node tools/sync-grib.mjs preview --include-unlocated --storage-budget-bytes $budget --plan $plan
if ($LASTEXITCODE -ne 0) { throw 'План не подготовлен. Дальше не продолжайте.' }
$review = Get-Content -Raw -Encoding UTF8 $plan | ConvertFrom-Json
$review.actions | ForEach-Object { $_.missing } | Sort-Object -Unique
$review.unchecked | Select-Object root, reason
```

Сверьте список отсутствующих файлов. Команда preview также показывает снимаемые
редакции и число сохраняемых партий. `unchecked` — публикации, которые не будут
проверены. Подробности записаны в JSON-плане.

`--include-unlocated` нужен для старых публикаций этого стенда без исходного
каталога: их принадлежность `data/grib` подтверждена оператором.
Обычный режим оставляет их непроверенными. Применение требует тех же параметров,
что и просмотр. При смене имён, каталога, кода или бюджета создайте новый план.
**Пустая папка означает снятие всех публикаций в области синхронизации.**

### 3. Применить план, загрузить файлы и обновить службы

Выполняйте следующий блок только после проверки плана. Он останавливается при
ошибке: загрузка не начнётся после отказа снятия, службы не перезапустятся после
отказа загрузки. Файлы `.gitkeep` и `proj.txt` не считаются GRIB. Если GRIB не
осталось, блок пропустит загрузку и выполнит только снятие и перезапуск.

```powershell
& {
    node tools/sync-grib.mjs apply --include-unlocated --storage-budget-bytes $budget --plan $plan
    if ($LASTEXITCODE -ne 0) { throw 'Снятие не подтверждено. Обновление остановлено.' }

    $gribFiles = @(Get-ChildItem -LiteralPath data/grib -File | Where-Object {
        $_.Extension -in @('.grb', '.grib', '.grb2', '.grib2') -and
        -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
    })
    if ($gribFiles.Count -gt 0) {
        docker @compose run --rm --env "PUBLICATION_STORAGE_BYTES=$budget" --entrypoint python worker `
            -m publication.grib_batch --all-fields --clock $env:PUBLICATION_CLOCK --report "/evidence/$report"
        if ($LASTEXITCODE -ne 0) { throw "Загрузка не завершена. Проверьте data/live/hmc-app/$report" }
        (Get-Content -Raw -Encoding UTF8 "data/live/hmc-app/$report" | ConvertFrom-Json).files |
            Select-Object source, state, error
    }

    docker @compose restart api gateway
    if ($LASTEXITCODE -ne 0) { throw 'Службы не перезапущены. Проверьте их состояние.' }
    Invoke-RestMethod http://127.0.0.1:8141/health
}
```

`apply` снимает публикации отсутствующих исходников. `grib_batch --all-fields`
обрабатывает **все оставшиеся GRIB**, включая новые и изменённые файлы, и публикует
все поддерживаемые поля. Для этого профиля предел исходного файла — 128 MiB.
Ограничения форматов: [поддерживаемые данные](docs/grib-crs.md).
Снятие и загрузка — отдельные операции. Если загрузка отказала, уже выполненное
снятие остаётся в силе; исправьте причину и повторите нужный этап.

### 4. Проверить результат на карте

Блок выше выводит отчёт загрузки. У всех обработанных файлов должно быть
`state = published`. Сам отчёт остаётся в `data/live/hmc-app/$report`.
Откройте **http://127.0.0.1:8140**, нажмите **«Проверить обновления»** и примите
новую редакцию, если карта предлагает её. Выберите нужные расчёт, поле и срок.
Данные удалённых исходников должны исчезнуть, данные новых — появиться.
Снятые адреса возвращают `410 Gone`; физическая очистка выполняется позже.

Этот же полный порядок подходит, если файлы только добавлены, заменены или
удалены. Если снимать нечего, план будет без снятий; загрузка всё равно обновит
текущие GRIB. При обычном включении стенда повторная загрузка не нужна.

### Остановить стенд

Сначала дождитесь завершения операций в других окнах.

```powershell
docker @compose stop viewer gateway api geoserver db
```

Данные сохраняются. Для повторного запуска используйте шаг 1.
Не выполняйте `down --volumes`: эта команда удаляет тома с данными.

### Если произошла ошибка

Остановитесь. Перезапуск служб после ошибки не применяет незавершённый план.

```powershell
docker @compose ps --all
docker @compose logs --tail 80 db api gateway geoserver viewer
```

Сохраните план, сообщение об ошибке и отчёт загрузки, если он создан.
При устаревшем плане повторите шаг 2 с новым именем файла.
При `managed storage budget exhausted` проверьте
[бюджет операции](docs/grib-sync.md#если-превышен-бюджет-управляемого-хранилища).
Подробнее о снятии: [инструкция](docs/grib-sync.md).
Резервное копирование и восстановление: [инструкция](docs/stack-recovery.md).

## Linux

Для уже подготовленного Linux-стенда порядок тот же: preview → apply → загрузка
→ restart. Нужны Bash, Node.js 26.10.0, curl, Docker Engine и Compose v2.
Файлы настройки и тома должны соответствовать именно Linux-стенду. Пример ниже
подходит, если туда перенесены указанные env-файл и override с теми же именами томов.
UID 65532 должен читать `data/grib` и писать в `data/live/hmc-app` и каталог планов.
Первичная установка сюда не входит; проверка на сервере организации остаётся
в [№50](https://github.com/stepanosokin/hmc-app-prototype/issues/50).

В корне проекта задайте настройки, запустите службы и подготовьте план:

```bash
compose=(compose --env-file data/live/hmc-app/t19-ce4426e953b7/environment.env
    --project-name hmc-app-live --file compose.publication.yaml
    --file data/live/hmc-app/t19-ce4426e953b7/compose.live.yaml)
export PUBLICATION_IMAGE=hmc-publication:grib52-live
export PUBLICATION_INPUT_DIR=./data/grib
export PUBLICATION_EVIDENCE_DIR=./data/live/hmc-app
export PUBLICATION_CLOCK=2026-10-19T05:00:00Z
export T4_PORT=8141
export T13_PORT=8140
budget=68719476736
docker "${compose[@]}" start db geoserver api gateway viewer
curl --fail --show-error http://127.0.0.1:8141/health
mkdir -p ../hmc-app-evidence/grib-sync-operations
stamp=$(date +%Y%m%d-%H%M%S)
plan="../hmc-app-evidence/grib-sync-operations/update-$stamp.json"
report="reload-grib-$stamp.json"
node tools/sync-grib.mjs preview --include-unlocated --storage-budget-bytes "$budget" --plan "$plan"
```

При ошибке не продолжайте. Проверьте список снятия в выводе preview и JSON-плане.
После проверки примените план и загрузите файлы. `set -e` в отдельном блоке
прерывает этот блок при ошибке. Если GRIB не осталось, пропустите команду загрузки.

```bash
(
    set -e
    node tools/sync-grib.mjs apply --include-unlocated --storage-budget-bytes "$budget" --plan "$plan"
    docker "${compose[@]}" run --rm --env "PUBLICATION_STORAGE_BYTES=$budget" --entrypoint python worker \
        -m publication.grib_batch --all-fields --clock "$PUBLICATION_CLOCK" --report "/evidence/$report"
    docker "${compose[@]}" restart api gateway
    curl --fail --show-error http://127.0.0.1:8141/health
)
```

Проверьте `data/live/hmc-app/$report`: все обработанные файлы должны иметь
`state = published`. Откройте карту и нажмите «Проверить обновления».
Для остановки после завершения загрузок:

```bash
docker "${compose[@]}" stop viewer gateway api geoserver db
```
