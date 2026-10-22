[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [ValidateSet('start','stop','status')][string]$Action = 'status',
    [ValidateRange(1,600)][int]$WaitSeconds = 120
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $repository 'publication/process.ps1')
$project = 'hmc-app-live'
$directory = Join-Path $repository 'data/live/hmc-app'
$environmentFile = Join-Path $directory 'environment.env'
$requiredServices = @('db','api','gateway','geoserver','viewer')

if (-not (Test-Path -LiteralPath $environmentFile)) {
    throw 'Демостенд ещё не настроен: отсутствует data/live/hmc-app/environment.env. Подготовьте проект по viewer/README.md; пароли сохраняйте только локально.'
}
if ($Action -eq 'start' -and -not (Test-Path -LiteralPath (Join-Path $directory 'published.json'))) {
    throw 'Отсутствует published.json готового демостенда. Сначала выполните первоначальную публикацию по viewer/README.md. Эта команда повторно включает существующий стенд.'
}
if ($Action -ne 'status' -and -not $PSCmdlet.ShouldProcess($project, $Action)) { return }

$report = Join-Path $directory ('operations/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $report -Force | Out-Null
$compose = @('compose','--env-file',$environmentFile,'--project-name',$project,'--file',(Join-Path $repository 'compose.publication.yaml'))
$step = 0
function Invoke-DemoCompose {
    param([string[]]$Arguments)
    $script:step++
    $name = '{0:D3}-{1}' -f $script:step,$Arguments[0]
    # Keep native diagnostics in the operation archive, outside the result stream.
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose + $Arguments) -ReportDirectory $report -Name $name | Out-Null
    Get-Content -Encoding utf8 -LiteralPath (Join-Path $report ($name + '.stdout.log')) |
        ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
}
function Get-RunningServices {
    @(Invoke-DemoCompose -Arguments @('ps','--status','running','--services'))
}
function Get-DemoUrl {
    $binding = @(Invoke-DemoCompose -Arguments @('port','viewer','8000'))
    if ($binding.Count -ne 1 -or $binding[0] -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Не найден единственный локальный порт viewer; проверьте архив операции.'
    }
    'http://127.0.0.1:' + $Matches[1] + '/'
}
function Test-DemoReady {
    param([string]$Url)
    $page = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    $catalogue = Invoke-RestMethod -Uri ($Url + 'api/v1/catalogue') -TimeoutSec 5
    $page.StatusCode -eq 200 -and @($catalogue.selections).Count -gt 0 -and $null -ne $catalogue.selections
}

Push-Location $repository
try {
    if ($Action -eq 'start') {
        Write-Output 'Запускаю демостенд…'
        Invoke-DemoCompose -Arguments (@('up','--detach','--no-build') + $requiredServices) | Out-Null
    }
    if ($Action -eq 'stop') {
        Invoke-DemoCompose -Arguments @('stop','--timeout','30') | Out-Null
        if ((Get-RunningServices).Count -gt 0) { throw 'В проекте остались работающие сервисы.' }
        $state = 'stopped'
        Write-Output 'Демостенд остановлен. Опубликованные данные и тома сохранены.'
    } else {
        $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
        $state = 'unavailable'
        do {
            $running = @(Get-RunningServices)
            $missing = @($requiredServices | Where-Object { $_ -notin $running })
            if ($running.Count -eq 0) { $state = 'stopped' }
            if ($missing.Count -eq 0) {
                $url = Get-DemoUrl
                try {
                    if (Test-DemoReady -Url $url) { $state = 'ready'; break }
                } catch {
                    $_.Exception.Message | Add-Content -LiteralPath (Join-Path $report 'readiness.log')
                }
            }
            if ($Action -eq 'status' -or [DateTime]::UtcNow -ge $deadline) { break }
            Start-Sleep -Seconds 1
        } while ($true)
        if ($Action -eq 'start' -and $state -ne 'ready') {
            throw 'Демостенд не готов за отведённое время. Сервисы сохранены для диагностики; остановка: tools/hmc-demo.ps1 -Action stop.'
        }
        if ($state -eq 'ready') {
            Write-Output "Демостенд готов. Открыть: $url"
        } elseif ($state -eq 'stopped') {
            Write-Output 'Демостенд остановлен.'
        } else {
            throw 'Демостенд недоступен: требуются все пять сервисов, HTTP 200 и непустой каталог. Проверьте архив операции.'
        }
    }
    @{action=$Action;project=$project;state=$state;url=$(if ($state -eq 'ready') { $url } else { $null });observed_at=[DateTime]::UtcNow.ToString('o');volumes_preserved=$true} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $report 'result.json') -Encoding utf8
} catch {
    @{action=$Action;project=$project;state='failed';error=$_.Exception.Message;observed_at=[DateTime]::UtcNow.ToString('o')} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $report 'result.json') -Encoding utf8
    throw
} finally {
    Pop-Location
    Write-Output "Архив операции: $report"
}
