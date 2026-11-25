# Проверки обновления существующего стенда

Используйте этот маршрут при применении уже принятого кода к существующему
стенду без изменения приложения. Сначала согласуйте уровень проверок и среду.
Обновление с изменением кода проходит также соответствующие строки
[таблицы проверок](../development-workflow.md#choose-validation-by-the-change).

## Сборка и запуск

Следуйте [ADMIN.md](../../ADMIN.md#состояние-остановка-и-запуск): сохраните
приватную конфигурацию, порты и постоянные тома. Для серверных изменений
соберите `Dockerfile.publication`, закрепите полученный image ID в существующей
приватной конфигурации проекта и выполните штатный `start`. Сборка просмотрщика
выполняется отдельно; она уже меняет файлы работающего стенда.

Соберите серверный образ до окна остановки. Сохраните прежний image ID,
приватную конфигурацию и рабочую сборку Viewer в каталоге стенда для отката.
После освобождения слотов и остановки обновите Viewer и закрепите новый image ID.
Проверьте, что API, шлюз и Viewer запущены с этим образом. При отказе запуска
верните прежнюю конфигурацию и сборку, затем проверьте готовность после возврата.

Запускайте native-команды через существующий
[Invoke-CheckedProcess](../../publication/process.ps1). Он сохраняет оба
потока и проверяет exit code, включая успешный процесс с диагностическим stderr:

```powershell
. ./publication/process.ps1
$report = Join-Path (Get-Location) ('data/reports/live-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $report | Out-Null
Invoke-CheckedProcess -FilePath (Get-Command node -CommandType Application).Source `
    -ArgumentList @('viewer/build.mjs') -ReportDirectory $report -Name viewer-build -OutputMode Summary
Invoke-CheckedProcess -FilePath (Get-Command node -CommandType Application).Source `
    -ArgumentList @('hmc-app.mjs','start','hmc-app-live') -ReportDirectory $report -Name start -OutputMode Summary
```

## HTTP и ресурсы

Проверьте готовность служб и соответствие JavaScript через
`node tools/check-viewer-runtime.mjs http://127.0.0.1:8140`.
Для численного изменения проверьте затронутый маршрут через тот же вход Viewer
на опубликованной выборке. Минимальная проверка прогнозного ряда использует один запрос
`/api/v1/point-series` с реальной скалярной группой и совместимой парой U/V,
если она доступна. Сверьте состав сроков и наличие значений.
Для каждого HTTP-запроса выберите отдельный пустой каталог:

```text
node tools/check-live-http.mjs "http://127.0.0.1:8140/gis/v1/wms?SERVICE=WMS&REQUEST=GetCapabilities" data/reports/live-update/http-wms-01
```

Инструмент выполняет один публичный GET без credentials и redirects. Он
сохраняет `body.bin` и `result.json`: статус, длительность, request ID,
Content-Type и Retry-After. HTTP-отказ, сетевая ошибка или обрыв тела дают
ненулевой exit code. При обрыве сохраняются уже полученные статус и request ID.
Успешный повтор записывайте отдельно; он не объясняет первый отказ.
Для WMS проверьте дерево, конечные слои и advertised snapshot URL, затем
отдельным запросом — закреплённый каталог. Тела ответов остаются в архиве,
не выводите полный каталог в беседу.

До обновления и после завершения штатной очистки снимите ресурсы. Из результата
`docker inspect` сохраняйте только публичные поля, исключая Config/Env:

```powershell
$ids = docker ps --all --quiet
if ($LASTEXITCODE -ne 0) { throw 'Не удалось получить контейнеры' }
$items = docker inspect $ids | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Не удалось прочитать контейнеры' }
$snapshot = @($items | ForEach-Object {
    [pscustomobject]@{
        name = $_.Name; id = $_.Id; state = $_.State.Status
        mounts = @($_.Mounts | ForEach-Object {
            [pscustomobject]@{type=$_.Type; name=$_.Name; source=$_.Source; destination=$_.Destination; read_only=(-not $_.RW)}
        })
        networks = @($_.NetworkSettings.Networks.PSObject.Properties.Name)
    }
})
```

Сохраните массив `$snapshot` через `ConvertTo-Json -Depth 8` в отдельные
`before.json` и `after.json`. Сравните их, явно перечислив только контейнеры,
которые разрешено пересоздать:

```text
node tools/compare-live-resources.mjs data/reports/live-update/before.json data/reports/live-update/after.json data/reports/live-update/resources.json /hmc-app-live-api-1 /hmc-app-live-gateway-1 /hmc-app-live-viewer-1
```

Сравнение нормализует порядок массивов и эквивалентные Windows-пути Docker
Desktop. Регистр Linux-путей сохраняется. Замена тома, источника, назначения,
режима read-only, сети или состояния, исчезновение/появление контейнера и
неразрешённая замена ID дают отказ. Этот снимок не заменяет проверку readiness
и [очистку](cleanup.md); оставляйте работающим только согласованный стенд.

## Подготовка и архивирование

Для финальной подготовки используйте
[archive-prepared-validation.ps1](../../tools/archive-prepared-validation.ps1).
Передайте свой PowerShell-скрипт с параметром `ReportDirectory`: он должен
проверить входы и записать `inputs.json` и `attempt-notes.json` в каталог отчёта.
Ошибка native-команды внутри подготовки должна завершать её ненулевым кодом;
используйте тот же `Invoke-CheckedProcess`. Подготовка содержит только публичные
свидетельства. Их полнота определяется требованиями конкретной проверки.

```powershell
& ./tools/archive-prepared-validation.ps1 -PreparationScript $preparationScript `
    -ReportDirectory $report -Archive 'live-update/unique-attempt'
```

Инструмент проверяет успешный exit подготовки, наличие и синтаксис обоих JSON,
затем вызывает существующий проверенный копировщик. Уже подготовленный каталог
не принимается повторно, чтобы старые JSON не скрыли ошибку новой подготовки.
Для неудачной попытки сохраните журналы отдельно обычным
[архивированием](../validation/evidence-storage.md), явно отметив её failed.
SHA256-индекс подтверждает копирование файлов, а не успешность проверки.

Регрессии без Docker и live: `node --test tools/test-live-validation.mjs` и
`powershell -NoProfile -File tools/check-prepared-validation-tests.ps1`.
Они подключены к Viewer/Windows в `check-local.ps1` и manual CI.
