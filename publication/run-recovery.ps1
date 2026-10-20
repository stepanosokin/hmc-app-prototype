param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Project = 'hmc-publication-t6-check',
    [int]$Port = 8098,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$t6ExistingVolumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --quiet)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable' }
if ($t6ExistingVolumes.Count -ne 0) { throw 'Use a fresh Compose project; existing volumes are preserved.' }
$t6Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $t6Listener.Start() } finally { $t6Listener.Stop() }
$t6Directory = Join-Path (Get-Location) "data/reports/t6/$Project"
if (Test-Path -LiteralPath $t6Directory) { throw 'Use a fresh project/report directory; previous evidence is retained.' }
New-Item -ItemType Directory -Force $t6Directory | Out-Null
$t6Environment = Join-Path $t6Directory 'environment.env'
$t6Lines = @('GEOSERVER_ADMIN_USER=t6operator')
foreach ($t6Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $t6Lines += $t6Key + '=' + [guid]::NewGuid().ToString('N')
}
$t6Lines | Set-Content -Encoding ascii -LiteralPath $t6Environment
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = 'hmc-publication:t6'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t6/' + $Project
$env:T6_TEST_FAULTS = '1'
$t6Fixtures = Join-Path $t6Directory 'fixtures'
New-Item -ItemType Directory $t6Fixtures | Out-Null
$t6Sample = Join-Path $t6Fixtures 'ICON_EU_T_G_2026101500.grib2'
Copy-Item -LiteralPath 'data/grib/ICON_EU_T_G_2026101500.grib2' -Destination $t6Sample
Copy-Item -LiteralPath $t6Sample -Destination (Join-Path $t6Fixtures 'removable.grib2')
$t6Bytes = [System.IO.File]::ReadAllBytes($t6Sample)
[System.IO.File]::WriteAllBytes((Join-Path $t6Fixtures 'partial.grib2'), $t6Bytes[0..15])
[System.IO.File]::WriteAllBytes((Join-Path $t6Fixtures 'truncated.grib2'), $t6Bytes[0..($t6Bytes.Length - 6)])
[System.IO.File]::WriteAllBytes((Join-Path $t6Fixtures 'unsupported.grib2'), [System.Text.Encoding]::ASCII.GetBytes('unsupported delivery'))
$env:PUBLICATION_INPUT_DIR = $t6Fixtures
$t6Compose = @('compose','--env-file',$t6Environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Invoke-T6Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t6Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Invoke-T6Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($t6Compose + $Arguments) -ReportDirectory $t6Directory -Name $Name
}
# Reuse the exact immutable, successful T4 engine decision and its bound probes.
# No new encoding/CRS/dependency decision is made by T6.
foreach ($t6Evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
    Copy-Item -LiteralPath (Join-Path 'docs/evidence/t4' $t6Evidence) -Destination $t6Directory
}
if (-not $SkipBuild) { Invoke-T6Compose build worker }
Invoke-T6Check -Name runtime -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
Invoke-T6Compose up --detach db api gateway geoserver
Invoke-T6Compose run --rm init-assets
Invoke-T6Check -Name readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
Invoke-T6Compose run --rm worker once --migrate
Invoke-T6Check -Name types -Arguments @('run','--rm','typecheck')
Invoke-T6Check -Name acceptance -Arguments @('run','--rm','--env','T6_HTTP=1','--entrypoint','python','check',
    '-m','unittest','discover','-s','tests','-p','test_publication_recovery.py','-v')
Invoke-T6Check -Name detached-delivery -Arguments @('run','--rm','worker','submit','--recoverable',
    '--clock','2026-10-19T07:00:00Z','--hours','20','--source-name','removable.grib2',
    '--delivery-sha256','dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a')
Remove-Item -LiteralPath (Join-Path $t6Fixtures 'removable.grib2')
Invoke-T6Check -Name detached-process -Arguments @('run','--rm','worker','once')
Invoke-T6Compose restart db api gateway geoserver
Invoke-T6Check -Name restart -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_recovery')
Invoke-T6Compose run --rm worker submit --clock 2026-10-19T08:00:00Z --legacy-one-time
Invoke-T6Check -Name legacy-publication -Arguments @('run','--rm','worker','once')
Invoke-T6Check -Name final-types -Arguments @('run','--rm','typecheck')
Invoke-T6Check -Name full-suite -Arguments @('run','--rm','--env','T4_HTTP=1','check')
Invoke-T6Check -Name archived-evidence -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--workdir','/workspace',
    '--entrypoint','python','check','tools/check_evidence.py')
$t6Base = (& git rev-parse HEAD).Trim()
Invoke-T6Check -Name inputs -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python',
    'check','-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t6Base)
& docker image inspect hmc-publication:t6 --format '{{.Id}}' | Set-Content -Encoding ascii (Join-Path $t6Directory 'image-id.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not record image identity' }
Write-Output "T6 checks passed. Evidence: $t6Directory"
