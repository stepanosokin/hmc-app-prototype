param(
    [ValidatePattern('^hmc-publication-[a-z0-9-]+$')][string]$Project='hmc-publication-refresh59-dev1',
    [int]$Port=8156,
    [string]$Image='hmc-publication:grib52-live'
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. ./publication/process.ps1
$directory="data/reports/refresh-grib-service/$Project"
if(Test-Path -LiteralPath $directory){throw 'Use a fresh report/project'}
foreach($kind in @('container','network','volume')){
    $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if($kind -eq 'container'){$arguments+='--all'}
    $ids=@(& docker @arguments)
    if($LASTEXITCODE -ne 0 -or $ids.Count){throw 'Docker unavailable or project already exists'}
}
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
try{$listener.Start()}finally{$listener.Stop()}
if((Get-FileHash data/grib/ICON_EU_T_G_2026101500.grib2).Hash -ne 'DDDFD6C63BA73E5E7337C21E105F16417003429F8179A44CA58BB110CB43736A'){throw 'Actual sample mismatch'}
New-Item -ItemType Directory -Force "$directory/input" | Out-Null
Copy-Item data/grib/ICON_EU_T_G_2026101500.grib2 "$directory/sample.grib2"
[IO.File]::WriteAllText((Join-Path (Get-Location) "$directory/input/proj.txt"),'metadata')
$environmentFile="$directory/environment.env"
$lines=@('GEOSERVER_ADMIN_USER=refreshoperator')
foreach($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')){$lines+=$name+'='+[guid]::NewGuid().ToString('N')}
$lines | Set-Content -Encoding ascii $environmentFile
$env:T4_PORT=[string]$Port;$env:PUBLICATION_IMAGE=$Image
$env:PUBLICATION_INPUT_DIR='./'+$directory+'/input';$env:PUBLICATION_EVIDENCE_DIR='./'+$directory
$env:PUBLICATION_CLOCK='2026-10-19T05:00:00Z'
$compose=@('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
function Check{param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name}
function Probe{param([string]$Mode)
    Check $Mode @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/check_refresh_grib_service.py',$Mode)}
foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path tests/fixtures/publication/tile-engine $name) $directory}
try{
    Check services @('up','--detach','db','api','gateway','geoserver')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    Probe seed
    Remove-Item -LiteralPath "$directory/input/removed.grib2"
    Copy-Item "$directory/sample.grib2" "$directory/input/new-without-extension"
    Invoke-CheckedProcess -FilePath powershell -ArgumentList @('-NoProfile','-File','tools/refresh_grib.ps1','-Project',$Project,
        '-InputDirectory',"$directory/input",'-ReportRoot',"$directory/operations with spaces",'-Yes') -ReportDirectory $directory -Name refresh
    Probe verify
    Remove-Item -LiteralPath "$directory/input/new-without-extension"
    Invoke-CheckedProcess -FilePath powershell -ArgumentList @('-NoProfile','-File','tools/refresh_grib.ps1','-Project',$Project,
        '-InputDirectory',"$directory/input",'-ReportRoot',"$directory/operations-empty",'-Yes') -ReportDirectory $directory -Name refresh-empty
    Probe verify-empty
}catch{
    $failure=$_
    try{Check service-logs @('logs','--no-color','--timestamps')}catch{Write-Warning 'Could not capture service logs'}
    throw $failure
}finally{
    & ./tools/retire-publication-project.ps1 -Project $Project -ReportDirectory $directory
}
