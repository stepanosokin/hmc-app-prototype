param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Project = 'hmc-publication-t4-check',
    [int]$Port = 8097,
    [switch]$SkipBuild,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:T4_PORT = [string]$Port
$t4Directory = Join-Path (Get-Location) 'data/reports/t4'
New-Item -ItemType Directory -Force $t4Directory | Out-Null
$t4Environment = Join-Path $t4Directory 'environment.env'
if (-not (Test-Path -LiteralPath $t4Environment)) {
    $t4Lines = @('GEOSERVER_ADMIN_USER=t4operator')
    foreach ($t4Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD')) {
        $t4Lines += $t4Key + '=' + [guid]::NewGuid().ToString('N')
    }
    $t4Lines | Set-Content -Encoding ascii -LiteralPath $t4Environment
}
$t4Compose = @('compose','--env-file','data/reports/t4/environment.env','-p',$Project,'-f','compose.publication.yaml')
function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t4Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Get-Catalogue {
    return @((Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/catalogue").selections | ForEach-Object { $_.selection })
}
function Invoke-Job {
    param([string]$Scenario,[string]$Clock)
    $t4Before = @(Get-Catalogue)
    $t4Job = [string](Invoke-Compose run --rm worker submit --clock $Clock --legacy-one-time | Select-Object -Last 1)
    $t4Job = $t4Job.Trim()
    $t4Arguments = $t4Compose + @('run','--rm')
    if ($Scenario -ne 'actual') { $t4Arguments += @('--env',"T4_TEST_FAILURE=$Scenario") }
    $t4Arguments += @('worker','once')
    $t4Process = Start-Process -FilePath 'docker' -WindowStyle Hidden -ArgumentList $t4Arguments -PassThru `
        -RedirectStandardOutput (Join-Path $t4Directory "$Scenario-worker.log") `
        -RedirectStandardError (Join-Path $t4Directory "$Scenario-worker.stderr.log")
    $t4Observations = 0
    do {
        Start-Sleep -Milliseconds 300
        $t4Visible = @(Get-Catalogue)
        $t4Status = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/jobs/$t4Job"
        if ($t4Status.state -ne 'published' -and ($t4Visible -join ',') -ne ($t4Before -join ',')) {
            throw 'Unfinished selection became visible through gateway'
        }
        $t4Observations++
        $t4Process.Refresh()
    } while (-not $t4Process.HasExited)
    $t4Status = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/jobs/$t4Job"
    if ($Scenario -eq 'actual' -and $t4Status.state -ne 'published') { throw "Actual job failed: $t4Job" }
    if ($Scenario -ne 'actual' -and $t4Status.state -ne 'failed') { throw "Failure gate did not reject: $Scenario" }
    return @{id=$t4Job;observations=$t4Observations;state=$t4Status.state;error=$t4Status.error}
}
if (-not $ValidateOnly) {
if (-not $SkipBuild) { Invoke-Compose build worker }
Invoke-Compose run --rm --entrypoint python check -m publication.runtime
Invoke-Compose up --detach db api gateway geoserver
Invoke-Compose run --rm init-assets
for ($t4Attempt=0; $t4Attempt -lt 60; $t4Attempt++) {
    try { Invoke-RestMethod "http://127.0.0.1:$Port/health" | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
}
Invoke-Compose run --rm compare prepare
Invoke-Compose run --rm --entrypoint python compare -m publication.probe-geoserver
& node publication/check-browser.mjs
if ($LASTEXITCODE -ne 0) { throw 'Browser compatibility failed' }
Invoke-Compose run --rm compare select
$t4Actual = Invoke-Job actual '2026-10-19T00:00:00Z'
$t4Published = @(Get-Catalogue)
$t4Tiles = Invoke-Job tiles '2026-10-19T00:01:00Z'
$t4Index = Invoke-Job index '2026-10-19T00:02:00Z'
$t4Cases = @{actual=$t4Actual.id;tiles=$t4Tiles.id;index=$t4Index.id;published_selections=$t4Published;
    observations=@{actual=$t4Actual;tiles=$t4Tiles;index=$t4Index};clock='2026-10-19T00:00:00Z';project=$Project}
$t4Cases | ConvertTo-Json -Depth 8 | Set-Content -Encoding ascii (Join-Path $t4Directory 'job-cases.json')
} else {
    $t4Published = @((Get-Content -Raw (Join-Path $t4Directory 'job-cases.json') | ConvertFrom-Json).published_selections)
}
# Restart real services; the named data volumes remain attached.
Invoke-Compose restart db api geoserver
Invoke-Compose -ComposeArguments @('run','--rm','--entrypoint','python','compare','-c',
    "import time; from publication import geoserver; time.sleep(15); geoserver.admin('GET','/about/version.json')")
if ((@(Get-Catalogue) -join ',') -ne ($t4Published -join ',')) { throw 'Restart changed catalogue' }
Invoke-Compose run --rm typecheck
$t4TestProcess = Start-Process -FilePath 'docker' -WindowStyle Hidden `
    -ArgumentList ($t4Compose + @('run','--rm','--env','T4_HTTP=1','check')) -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $t4Directory 'full-validation.stdout.log') `
    -RedirectStandardError (Join-Path $t4Directory 'full-validation.log')
Get-Content (Join-Path $t4Directory 'full-validation.log')
if ($t4TestProcess.ExitCode -ne 0) { throw 'Full test suite failed' }
Write-Output "T4 checks passed. Gateway: http://127.0.0.1:$Port ; isolated project: $Project"
