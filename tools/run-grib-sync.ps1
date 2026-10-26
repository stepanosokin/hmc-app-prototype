param(
    [ValidatePattern('^hmc-publication-[a-z0-9-]+$')][string]$Project='hmc-publication-sync-dev1',
    [int]$Port=8156,
    [string]$Image='hmc-publication:checks',
    [switch]$WithBrowser,
    [int]$ViewerPort=8157
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. ./publication/process.ps1
$directory="data/reports/grib-sync/$Project"
if(Test-Path -LiteralPath $directory){throw 'Use a fresh report directory'}
if((Get-FileHash data/grib/ICON_EU_T_G_2026101500.grib2 -Algorithm SHA256).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a'){throw 'Actual sample checksum mismatch'}
foreach($kind in @('container','network','volume')){
    $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if($kind -eq 'container'){$arguments+='--all'}
    $resources=@(& docker @arguments)
    if($LASTEXITCODE -ne 0 -or $resources.Count){throw 'Docker unavailable or project already exists'}
}
$ports=@($Port)
if($WithBrowser){$ports+=$ViewerPort}
foreach($checkPort in $ports){
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$checkPort)
    try{$listener.Start()}finally{$listener.Stop()}
}
New-Item -ItemType Directory -Force "$directory/fixtures" | Out-Null
foreach($name in @('a.grib2','b.grib2','original.grib2')){Copy-Item data/grib/ICON_EU_T_G_2026101500.grib2 "$directory/fixtures/$name"}
Copy-Item data/grib/ICON_EU_T_G_2026101500.grib2 "$directory/sample.grib2"
$environmentFile="$directory/environment.env"
$lines=@('GEOSERVER_ADMIN_USER=syncoperator')
foreach($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')){$lines+=$name+'='+[guid]::NewGuid().ToString('N')}
$lines | Set-Content -Encoding ascii $environmentFile
$env:T4_PORT=[string]$Port;$env:PUBLICATION_IMAGE=$Image
$env:T13_PORT=[string]$ViewerPort
$env:PUBLICATION_EVIDENCE_DIR='./'+$directory;$env:PUBLICATION_INPUT_DIR='./'+$directory+'/fixtures'
$env:PUBLICATION_CLOCK='2026-10-19T05:00:00Z'
$compose=@('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
function Check{param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name}
foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path tests/fixtures/publication/tile-engine $name) $directory}
try{
    Check services @('up','--detach','db','api','gateway','geoserver')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    Check acceptance @('run','--rm','--env','T52_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_grib_sync.py','-v')
    # Real operator wrapper resolves the same running image/network/volume.
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/sync-grib.mjs','preview','--project',$Project,'--input-directory',"$directory/fixtures",'--plan',"$directory/operator-plan.json") -ReportDirectory $directory -Name operator-preview
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/sync-grib.mjs','apply','--project',$Project,'--input-directory',"$directory/fixtures",'--plan',"$directory/operator-plan.json") -ReportDirectory $directory -Name operator-apply
    if($WithBrowser){
        Invoke-CheckedProcess -FilePath node -ArgumentList @('viewer/build.mjs') -ReportDirectory $directory -Name viewer-build
        Check viewer @('up','--detach','viewer')
        $env:T13_VIEWER="http://127.0.0.1:$ViewerPort";$env:T52_WITHDRAWAL='1';$env:T52_PROJECT=$Project
        $env:T52_FIXTURES=(Resolve-Path "$directory/fixtures").Path
        foreach($browser in @('chrome','edge')){
            Check "seed-$browser" @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/seed-grib-sync-browser.py')
            $env:T13_REPORT_DIRECTORY="$directory/browser-$browser"
            $env:T13_BROWSER=if($browser -eq 'chrome'){'C:/Program Files/Google/Chrome/Application/chrome.exe'}else{'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}
            Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name "browser-$browser"
        }
    }
}catch{
    $failure=$_
    try{Check service-logs @('logs','--no-color','--timestamps')}catch{Write-Warning 'Could not capture service logs'}
    throw $failure
}finally{
    foreach($name in @('T52_WITHDRAWAL','T52_PROJECT','T52_FIXTURES','T13_BROWSER','T13_REPORT_DIRECTORY','T13_VIEWER')){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
    & ./tools/retire-publication-project.ps1 -Project $Project -ReportDirectory $directory
}
