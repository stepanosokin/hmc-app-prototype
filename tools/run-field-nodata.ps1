param(
    [ValidatePattern('^hmc-publication-nodata65-[a-z0-9-]+$')][string]$Project='hmc-publication-nodata65-dev1',
    [string]$Image='hmc-publication:nodata65',
    [int]$Port=8196,
    [int]$ViewerPort=8197,
    [switch]$WithBrowser,
    [switch]$Final
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& ./tools/check-field-nodata-preflight.ps1
. ./publication/process.ps1
$directory="data/reports/t13/$Project"
if(Test-Path -LiteralPath $directory){throw 'Use a fresh report directory'}
foreach($kind in @('container','network','volume')){
    $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if($kind -eq 'container'){$arguments+='--all'}
    $resources=@(& docker @arguments)
    if($LASTEXITCODE -ne 0 -or $resources.Count){throw 'Docker unavailable or project already exists'}
}
foreach($checkPort in @($Port,$ViewerPort)){
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$checkPort)
    try{$listener.Start()}finally{$listener.Stop()}
}
New-Item -ItemType Directory -Force $directory | Out-Null
$environmentFile="$directory/environment.env"
$lines=@('GEOSERVER_ADMIN_USER=nodataoperator')
foreach($key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')){$lines+=$key+'='+[guid]::NewGuid().ToString('N')}
$lines | Set-Content -Encoding ascii $environmentFile
$env:T4_PORT=[string]$Port;$env:T13_PORT=[string]$ViewerPort
$env:PUBLICATION_IMAGE=$Image;$env:PUBLICATION_EVIDENCE_DIR='./'+$directory
$compose=@('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
function Check{param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name -OutputMode Summary}
foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path tests/fixtures/publication/tile-engine $name) $directory}
try{
    $mounted=@('run','--rm','--network','none','--volume',"$((Get-Location).Path):/workspace:ro",'--workdir','/workspace')
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($mounted+@('--entrypoint','mypy',$Image,'--ignore-missing-imports','--check-untyped-defs','--cache-dir=/tmp/mypy','decoder','tests','trials','publication','tools')) -ReportDirectory $directory -Name python-types -OutputMode Summary
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($mounted+@('--env','T65_HTTP=0','--entrypoint','python',$Image,'-B','-m','unittest','discover','-s','tests','-p','test_field_nodata.py','-v')) -ReportDirectory $directory -Name python-tests -OutputMode Summary
    Invoke-CheckedProcess -FilePath node -ArgumentList @('viewer/build.mjs') -ReportDirectory $directory -Name viewer-build -OutputMode Summary
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'start') -ReportDirectory $directory -Name inputs-start -OutputMode Summary
    Check services @('up','--detach','db','api','gateway','geoserver','viewer')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    Check acceptance @('run','--rm','--env','T65_HTTP=1','--entrypoint','python','check','-B','-m','unittest','discover','-s','tests','-p','test_field_nodata.py','-v')
    Check operator-seed @('run','--rm','--env','PYTHONPATH=/app:/app/tests','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','-B','/workspace/tools/seed-field-nodata.py')
    foreach($operation in @('preview','apply')){
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/revalidate-fields.mjs',$operation,'--project',$Project,'--plan',"$directory/operator-plan.json") -ReportDirectory $directory -Name "operator-$operation" -OutputMode Summary
    }
    if($WithBrowser){
        $env:T13_VIEWER="http://127.0.0.1:$ViewerPort";$env:T65_NODATA='1'
        $env:T13_FOCUSED=if($Final){'0'}else{'1'}
        foreach($browser in @('chrome','edge')){
            $env:T13_REPORT_DIRECTORY="$directory/browser-$browser"
            $env:T13_BROWSER=if($browser -eq 'chrome'){'C:/Program Files/Google/Chrome/Application/chrome.exe'}else{'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}
            Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name "browser-$browser" -OutputMode Summary
        }
    }
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'end') -ReportDirectory $directory -Name inputs-end -OutputMode Summary
}catch{
    $failure=$_
    try{Check service-logs @('logs','--no-color','--timestamps')}catch{Write-Warning 'Could not capture service logs'}
    throw $failure
}finally{
    foreach($key in @('T13_VIEWER','T65_NODATA','T13_FOCUSED','T13_REPORT_DIRECTORY','T13_BROWSER')){Remove-Item "Env:$key" -ErrorAction SilentlyContinue}
    & ./tools/retire-publication-project.ps1 -Project $Project -ReportDirectory $directory
}
