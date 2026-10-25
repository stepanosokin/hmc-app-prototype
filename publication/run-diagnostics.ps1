param(
    [ValidatePattern('^hmc-publication-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t17-check',
    [int]$Port = 8098,
    [string]$Image = 'hmc-publication:t17',
    [switch]$SkipBuild,
    [switch]$Development,
    [switch]$SkipSuite
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
if ((Get-FileHash -Algorithm SHA256 -LiteralPath 'data/grib/ICON_EU_T_G_2026101500.grib2').Hash.ToLowerInvariant() -ne
    'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') { throw 'Actual sample checksum mismatch' }
$t17ExistingVolumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --quiet)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable' }
if ($t17ExistingVolumes.Count -ne 0) { throw 'Use a fresh Compose project; existing volumes are preserved.' }
$t17Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $t17Listener.Start() } finally { $t17Listener.Stop() }
$t17Directory = Join-Path (Get-Location) "data/reports/t17/$Project"
if (Test-Path -LiteralPath $t17Directory) { throw 'Use a fresh project/report directory; previous evidence is retained.' }
New-Item -ItemType Directory -Force $t17Directory | Out-Null
$t17Environment = Join-Path $t17Directory 'environment.env'
$t17Lines = @('GEOSERVER_ADMIN_USER=t17operator')
foreach ($t17Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $t17Lines += $t17Key + '=' + [guid]::NewGuid().ToString('N')
}
$t17Lines | Set-Content -Encoding ascii -LiteralPath $t17Environment
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = $Image
$env:T6_TEST_FAULTS = '1'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t17/' + $Project
$t17Fixtures = Join-Path $t17Directory 'fixtures'
New-Item -ItemType Directory $t17Fixtures | Out-Null
Copy-Item -LiteralPath 'data/grib/ICON_EU_T_G_2026101500.grib2' -Destination $t17Fixtures
$env:PUBLICATION_INPUT_DIR = $t17Fixtures
$t17Compose = @('compose','--env-file',$t17Environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Invoke-T17Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t17Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Invoke-T17Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($t17Compose + $Arguments) -ReportDirectory $t17Directory -Name $Name
}
# Reuse the exact immutable, successful T4 engine decision and its bound probes.
# No new encoding/CRS/dependency decision is made by T17.
foreach ($t17Evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
    Copy-Item -LiteralPath (Join-Path 'docs/evidence/t4' $t17Evidence) -Destination $t17Directory
}
try {
if (-not $SkipBuild) { Invoke-T17Compose build worker }
Invoke-T17Check -Name runtime -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
Invoke-T17Compose up --detach db api gateway geoserver
Invoke-T17Compose run --rm init-assets
Invoke-T17Check -Name readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
Invoke-T17Compose run --rm worker once --migrate
Invoke-T17Check -Name types -Arguments @('run','--rm','typecheck')
if ($Development) {
    Invoke-T17Check -Name seed -Arguments @('run','--rm','worker','submit','--clock','2026-10-19T05:00:00Z','--hours','1,3')
    Invoke-T17Check -Name publish -Arguments @('run','--rm','worker','once')
} else {
    Invoke-T17Check -Name publication -Arguments @('run','--rm','--env','T5_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_revisions.py','-v')
}
Invoke-T17Compose up --detach worker
Start-Sleep -Seconds 3
function Observe-T17([string]$Phase) {
    Invoke-T17Check -Name $Phase -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_diagnostics',$Phase)
}
Observe-T17 baseline
Rename-Item -LiteralPath (Join-Path $t17Fixtures 'ICON_EU_T_G_2026101500.grib2') -NewName 'absent.grib2'
try { Observe-T17 source } finally {
    Rename-Item -LiteralPath (Join-Path $t17Fixtures 'absent.grib2') -NewName 'ICON_EU_T_G_2026101500.grib2'
}
Invoke-T17Compose stop worker
Start-Sleep -Seconds 16
Invoke-T17Check -Name queued -Arguments @('run','--rm','worker','submit','--clock','2026-10-19T05:00:00Z','--hours','1')
Observe-T17 worker
Invoke-T17Compose up --detach worker
Observe-T17 job-linked
foreach ($t17Service in @('api','geoserver','db')) {
    $t17Phase = @{api='api';geoserver='gis';db='database'}[$t17Service]
    Invoke-T17Compose stop $t17Service
    try { Observe-T17 $t17Phase } finally {
        Invoke-T17Compose start $t17Service
        Invoke-T17Check -Name ($t17Phase+'-ready') -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    }
}
Observe-T17 recovered
foreach ($t17Fault in @('generation','cache')) {
    Invoke-T17Compose -ComposeArguments @('run','--rm','--entrypoint','python','worker','-c',"from pathlib import Path; Path('/assets/.t6-$t17Fault').touch()")
    try { Observe-T17 $t17Fault } finally {
        Invoke-T17Compose -ComposeArguments @('run','--rm','--entrypoint','python','worker','-c',"from pathlib import Path; Path('/assets/.t6-$t17Fault').unlink()")
    }
}
if (-not $Development -and -not $SkipSuite) {
    Invoke-T17Check -Name full-suite -Arguments @('run','--rm','--env','T4_HTTP=1','check')
}
} finally {
    try {
        & docker @t17Compose logs --no-color --tail 1500 | Out-File -Encoding utf8 -LiteralPath (Join-Path $t17Directory 'services.log')
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Service logs incomplete; attempt remains failed' }
        & node publication/check-diagnostic-logs.mjs $t17Directory
        if ($LASTEXITCODE -ne 0) { throw 'Diagnostic log acceptance failed' }
    } finally {
        & ./tools/retire-publication-project.ps1 -Project $Project -ReportDirectory ('data/reports/t17/' + $Project)
    }
}
Write-Output "T17 checks passed. Evidence: $t17Directory"
