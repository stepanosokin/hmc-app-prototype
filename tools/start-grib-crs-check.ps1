param(
    [ValidatePattern('^hmc-publication-grib49-[a-z0-9-]+$')][string]$Project = 'hmc-publication-grib49-dev1',
    [int]$Port = 8188,
    [int]$ViewerPort = 8189,
    [string]$Image = 'hmc-publication:grib49'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$directory = Join-Path (Get-Location) "data/reports/grib-crs-metadata/$Project"
if (Test-Path -LiteralPath $directory) { throw 'Use a fresh report directory and project' }
foreach ($kind in @('container','volume','network')) {
    $arguments = @($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if ($kind -eq 'container') { $arguments += '--all' }
    $existing = @(& docker @arguments)
    if ($LASTEXITCODE -ne 0 -or $existing.Count) { throw 'Project resources already exist or Docker is unavailable' }
}
foreach ($checkPort in @($Port,$ViewerPort)) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$checkPort)
    try { $listener.Start() } finally { $listener.Stop() }
}
New-Item -ItemType Directory -Force $directory | Out-Null
$lines = @('GEOSERVER_ADMIN_USER=grib49operator')
foreach ($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $lines += $name+'='+[guid]::NewGuid().ToString('N')
}
$environmentFile = Join-Path $directory 'environment.env'
$lines | Set-Content -Encoding ascii $environmentFile
$env:PUBLICATION_IMAGE=$Image
$env:PUBLICATION_EVIDENCE_DIR='./data/reports/grib-crs-metadata/'+$Project
$env:PUBLICATION_INPUT_DIR='./data/grib'
$env:PUBLICATION_CLOCK='2026-10-19T05:00:00Z'
$env:T4_PORT=[string]$Port
$env:T13_PORT=[string]$ViewerPort
$env:T6_TEST_FAULTS='1'
$compose=@('compose','--env-file',$environmentFile,'-p',$Project,'-f','compose.publication.yaml')
function Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name
}
foreach ($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
    Copy-Item (Join-Path 'tests/fixtures/publication/tile-engine' $name) $directory
}
Check services @('up','-d','--no-build','db','geoserver','api','gateway','viewer')
Check assets @('run','--rm','init-assets')
Check ready @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
Check migrate @('run','--rm','worker','once','--migrate')
Check seed @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours','1')
Check publish @('run','--rm','worker','once')
Write-Output "Prepared isolated $Project at viewer:$ViewerPort gateway:$Port; archive and retire after validation."
