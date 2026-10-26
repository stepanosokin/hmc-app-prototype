param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Project = 'hmc-app-live',
    [string]$InputDirectory = 'data/grib',
    [ValidateRange(1,9007199254740991)][long]$StorageBudgetBytes = 68719476736,
    [string]$ReportRoot,
    [switch]$PlanOnly,
    [switch]$Yes
)

. (Join-Path $PSScriptRoot '../publication/process.ps1')

function Get-RefreshGribFiles {
    param([string]$Directory)
    foreach ($file in Get-ChildItem -LiteralPath $Directory -File) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $stream = [IO.File]::OpenRead($file.FullName)
        try {
            $header = New-Object byte[] 4
            if ($stream.Read($header,0,4) -eq 4 -and [Text.Encoding]::ASCII.GetString($header) -eq 'GRIB') { $file }
        } finally { $stream.Dispose() }
    }
}

function Invoke-GribRefresh {
    param(
        [ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Project = 'hmc-app-live',
        [string]$InputDirectory = 'data/grib',
        [ValidateRange(1,9007199254740991)][long]$StorageBudgetBytes = 68719476736,
        [string]$ReportRoot,
        [switch]$PlanOnly,
        [switch]$Yes
    )
    $ErrorActionPreference = 'Stop'
    $repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $environmentNames = @('PUBLICATION_IMAGE','PUBLICATION_INPUT_DIR','PUBLICATION_EVIDENCE_DIR','PUBLICATION_CLOCK')
    $previousEnvironment = @{}
    foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
    Push-Location -LiteralPath $repository
    $directory = $null
    $workerContainer = 'hmc-refresh-'+[guid]::NewGuid().ToString('N')
    $workerOwner = [guid]::NewGuid().ToString('N')
    $workerStarted = $false
    $status = @{state='starting';project=$Project;stage='preflight'}
    try {
        $inputPath = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($InputDirectory)) { $InputDirectory } else { Join-Path $repository $InputDirectory }))
        if (-not (Test-Path -LiteralPath $inputPath -PathType Container) -or
            ((Get-Item -LiteralPath $inputPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Исходная папка отсутствует, недоступна или является ссылкой.'
        }
        if (-not $ReportRoot) {
            $evidenceRoot = if ($env:HMC_EVIDENCE_ROOT) { $env:HMC_EVIDENCE_ROOT } else { Join-Path (Split-Path $repository -Parent) 'hmc-app-evidence' }
            $ReportRoot = Join-Path $evidenceRoot 'refresh-grib-operations'
        }
        $directory = Join-Path ([IO.Path]::GetFullPath($ReportRoot)) ((Get-Date -Format yyyyMMdd-HHmmss)+'-'+[guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        $status.report_directory = $directory
        $status.input_directory = $inputPath
        $status.storage_budget_bytes = $StorageBudgetBytes
        # The worker requires the accepted publication decision and its bound probes.
        foreach ($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
            Copy-Item -LiteralPath (Join-Path $repository "tests/fixtures/publication/tile-engine/$name") -Destination (Join-Path $directory $name)
        }

        function Step {
            param([string]$Name,[string]$Program,[string[]]$Arguments)
            $status.stage = $Name
            try {
                Invoke-CheckedProcess -FilePath $Program -ArgumentList $Arguments -ReportDirectory $directory -Name $Name | Out-Null
            } catch {
                $details = if (Test-Path -LiteralPath (Join-Path $directory "$Name.stderr.log")) {
                    (Get-Content -LiteralPath (Join-Path $directory "$Name.stderr.log") -Encoding UTF8 -Tail 8) -join [Environment]::NewLine
                }
                throw "Ошибка этапа '$Name'. $($_.Exception.Message)`n$details"
            }
        }
        function Read-StepOutput {
            param([string]$Name)
            $value = Get-Content -LiteralPath (Join-Path $directory "$Name.stdout.log") -Raw -Encoding UTF8
            if ($null -eq $value) { return '' }
            $value.Trim()
        }

        Step 'find-api' 'docker' @('container','ls','--all','--quiet','--filter',"label=com.docker.compose.project=$Project",'--filter','label=com.docker.compose.service=api')
        $apiIds = @(Read-StepOutput 'find-api' | ForEach-Object { $_ -split '\r?\n' } | Where-Object { $_ })
        if ($apiIds.Count -ne 1) { throw 'API стенда не найден однозначно. Запустите существующий стенд отдельно.' }
        # Select only labels/state/image. Config.Env contains passwords and must never enter logs.
        Step 'api-running' 'docker' @('inspect','--format','{{.State.Running}}',$apiIds[0])
        if ((Read-StepOutput 'api-running') -ne 'true') { throw 'API остановлен. Запустите существующий стенд отдельно.' }
        Step 'api-labels' 'docker' @('inspect','--format','{{json .Config.Labels}}',$apiIds[0])
        $labels = Read-StepOutput 'api-labels' | ConvertFrom-Json
        if (-not $labels.'com.docker.compose.project.working_dir' -or
            [IO.Path]::GetFullPath($labels.'com.docker.compose.project.working_dir').TrimEnd('\','/') -ne $repository.TrimEnd('\','/')) {
            throw 'Стенд принадлежит другому каталогу проекта.'
        }
        $environmentFile = $labels.'com.docker.compose.project.environment_file'
        $configFiles = @($labels.'com.docker.compose.project.config_files' -split ',' | Where-Object { $_ })
        if (-not $environmentFile -or -not $configFiles.Count) { throw 'В метках стенда нет env-файла или файлов Compose.' }
        foreach ($file in @($environmentFile)+$configFiles) {
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Не найден файл настройки: $file" }
        }
        Step 'api-image' 'docker' @('inspect','--format','{{.Image}}',$apiIds[0])
        $compose = @('compose','--env-file',$environmentFile,'--project-name',$Project)
        foreach ($file in $configFiles) { $compose += @('--file',$file) }

        $env:PUBLICATION_IMAGE = Read-StepOutput 'api-image'
        $env:PUBLICATION_INPUT_DIR = $inputPath
        $env:PUBLICATION_EVIDENCE_DIR = $directory
        $env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
        $budget = $StorageBudgetBytes.ToString([Globalization.CultureInfo]::InvariantCulture)
        $plan = Join-Path $directory 'plan.json'
        $common = @('--project',$Project,'--input-directory',$inputPath,'--include-unlocated','--storage-budget-bytes',$budget,'--plan',$plan)
        $status.plan = $plan
        Write-Host '1/4. Создаю план снятия публикаций.'
        Step 'preview' 'node' (@('tools/sync-grib.mjs','preview')+$common)
        $review = Get-Content -LiteralPath $plan -Raw -Encoding UTF8 | ConvertFrom-Json
        $missing = @($review.actions | ForEach-Object { $_.missing } | Sort-Object -Unique)
        Write-Host "Отсутствующих имён: $($missing.Count). Редакций к снятию: $(@($review.actions).Count)."
        foreach ($name in $missing) { Write-Host "  $name" }
        Write-Host "Непроверенных публикаций: $(@($review.unchecked).Count). План: $plan"
        $status.unchecked = @($review.unchecked).Count
        $plannedFiles = @(Get-RefreshGribFiles $inputPath)
        Write-Host "GRIB-файлов к загрузке: $($plannedFiles.Count). Бюджет операции: $budget байт."
        if ($PlanOnly) { $status.state='planned'; return [pscustomobject]$status }
        if (-not $Yes -and (Read-Host 'Проверьте план. Для снятия и загрузки введите ДА') -ne 'ДА') {
            $status.state='cancelled'
            Write-Host 'Обновление отменено. Публикации не изменены.'
            return [pscustomobject]$status
        }

        Write-Host '2/4. Снимаю публикации отсутствующих файлов.'
        Step 'apply' 'node' (@('tools/sync-grib.mjs','apply')+$common)
        $status.withdrawal_applied = $true
        $files = @(Get-RefreshGribFiles $inputPath)
        $status.grib_files = $files.Count
        if ($files.Count) {
            Write-Host "3/4. Загружаю GRIB: $($files.Count). Дождитесь завершения."
            Write-Host "Ход загрузки: $(Join-Path $directory 'load.stdout.log')"
            $workerStarted = $true
            Step 'load' 'docker' ($compose+@('run','--rm','--no-deps','--name',$workerContainer,'--label',"hmc.refresh-grib.owner=$workerOwner",'--env',"PUBLICATION_STORAGE_BYTES=$budget",'--entrypoint','python','worker',
                '-m','publication.grib_batch','--all-fields','--clock',$env:PUBLICATION_CLOCK,'--report','/evidence/reload-grib.json'))
            $report = Get-Content -LiteralPath (Join-Path $directory 'reload-grib.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($report.state -ne 'passed' -or @($report.files | Where-Object { $_.state -ne 'published' }).Count) {
                throw 'В отчёте загрузки есть неопубликованные файлы. Перезапуск не выполняется.'
            }
            $report.files | Select-Object source,state,error | Out-Host
        } else { Write-Host '3/4. GRIB-файлов нет. Загрузка пропущена.' }
        Write-Host '4/4. Перезапускаю API и gateway.'
        Step 'restart' 'docker' ($compose+@('restart','api','gateway'))
        $status.state='completed'
        Write-Host 'Готово. В карте нажмите «Проверить обновления». '
        Write-Host "План и отчёты: $directory"
        return [pscustomobject]$status
    } catch {
        $status.state='failed'
        $status.error=$_.Exception.Message
        if ($directory) { Write-Host "Обновление остановлено. План и журналы: $directory" }
        throw
    } finally {
        try {
            if ($workerStarted) {
                Invoke-CheckedProcess -FilePath docker -ArgumentList @('container','ls','--all','--quiet','--filter',"name=^/$workerContainer`$") -ReportDirectory $directory -Name 'cleanup-list' | Out-Null
                $remaining = Read-StepOutput 'cleanup-list'
                if ($remaining) {
                    Invoke-CheckedProcess -FilePath docker -ArgumentList @('inspect','--format','{{json .Config.Labels}}',$remaining) -ReportDirectory $directory -Name 'cleanup-owner' | Out-Null
                    $owner = Read-StepOutput 'cleanup-owner' | ConvertFrom-Json
                    if ($owner.'hmc.refresh-grib.owner' -ne $workerOwner) { throw 'Не подтверждён владелец контейнера загрузки.' }
                    Invoke-CheckedProcess -FilePath docker -ArgumentList @('rm','--force',$remaining) -ReportDirectory $directory -Name 'cleanup-remove' | Out-Null
                    Invoke-CheckedProcess -FilePath docker -ArgumentList @('container','ls','--all','--quiet','--filter',"name=^/$workerContainer`$") -ReportDirectory $directory -Name 'cleanup-verify' | Out-Null
                    if (Read-StepOutput 'cleanup-verify') { throw 'Контейнер загрузки не удалён.' }
                }
            }
        } catch {
            $status.state='failed'
            $status.error=$_.Exception.Message
            throw
        } finally {
            try {
                if ($directory) {
                    $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $directory 'refresh.json') -Encoding UTF8
                }
            } finally {
                foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name,$previousEnvironment[$name],'Process') }
                Pop-Location
            }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-GribRefresh -Project $Project -InputDirectory $InputDirectory -StorageBudgetBytes $StorageBudgetBytes -ReportRoot $ReportRoot -PlanOnly:$PlanOnly -Yes:$Yes | Out-Null
    } catch {
        Write-Error "Обновление GRIB остановлено: $($_.Exception.Message)"
        exit 1
    }
}
