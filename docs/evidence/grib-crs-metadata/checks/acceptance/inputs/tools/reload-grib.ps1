param(
    [string]$Project='hmc-app-live',
    [string]$EnvironmentFile='data/live/hmc-app/environment.env',
    [string]$EvidenceDirectory='data/live/hmc-app',
    [string]$Image='hmc-publication:grib49',
    [string]$Clock='2026-10-19T05:00:00Z'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path -LiteralPath $EnvironmentFile)) {throw 'Existing stand environment file is required'}
if (-not (Test-Path config/grib-crs-defaults.json)) {throw 'Missing CRS defaults file'}
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$env:PUBLICATION_IMAGE=$Image
$env:PUBLICATION_EVIDENCE_DIR='./'+$EvidenceDirectory.Replace('\','/')
$env:PUBLICATION_INPUT_DIR='./data/grib'
$env:PUBLICATION_CLOCK=$Clock
$compose=@('compose','--env-file',$EnvironmentFile,'-p',$Project,'-f','compose.publication.yaml')
Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('run','--rm','--entrypoint','python','worker',
    '-m','publication.grib_batch','--clock',$Clock,'--report','/evidence/reload-grib.json')) -ReportDirectory $EvidenceDirectory -Name reload-grib
Write-Output 'Batch finished; verify the new revision before switching the serving runtime.'
