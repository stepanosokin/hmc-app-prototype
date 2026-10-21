param(
    [ValidatePattern('^hmc-publication-t13-[a-z0-9-]+$')][string]$Project='hmc-publication-t13-dev1',
    [int]$Port=8141,
    [int]$ViewerPort=8140,
    [switch]$WithEdge,
    [switch]$Final
)
$ErrorActionPreference='Stop'
if($env:T13_ANDROID_SERIAL -and $WithEdge){throw 'Use separate physical Android and desktop attempts'}
. (Join-Path $PSScriptRoot '../publication/process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$directory=Join-Path (Get-Location) "data/reports/t13/$Project"
if(Test-Path -LiteralPath $directory){throw 'Use a fresh project/report directory'}
if((Get-FileHash data/grib/ICON_EU_T_G_2026101500.grib2 -Algorithm SHA256).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a'){throw 'Actual sample checksum mismatch'}
foreach($kind in @('container','network','volume')){
    $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if($kind -eq 'container'){$arguments+='--all'}
    $resources=@(& docker @arguments)
    if($LASTEXITCODE -ne 0 -or $resources.Count){throw 'Docker unavailable or project already exists'}
}
foreach($testPort in @($Port,$ViewerPort)){
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$testPort)
    try{$listener.Start()}finally{$listener.Stop()}
}
New-Item -ItemType Directory -Force $directory | Out-Null
$environmentFile=Join-Path $directory 'environment.env'
$lines=@('GEOSERVER_ADMIN_USER=t13operator')
foreach($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')){$lines+=$name+'='+[guid]::NewGuid().ToString('N')}
$lines | Set-Content -Encoding ascii $environmentFile
$env:T4_PORT=[string]$Port;$env:T13_PORT=[string]$ViewerPort
$env:PUBLICATION_IMAGE='hmc-publication:t12';$env:PUBLICATION_EVIDENCE_DIR='./data/reports/t13/'+$Project
$env:PUBLICATION_CLOCK='2026-10-19T05:00:00Z'
$compose=@('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
function Check{param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name}
Start-Transcript -Path (Join-Path $directory 'console.log') | Out-Null
try{
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'start') -ReportDirectory $directory -Name inputs-start
    Check services @('up','--detach','db','api','gateway','geoserver','viewer')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path docs/evidence/t4 $name) $directory}
    if($Final){
        Check types @('run','--rm','typecheck')
    }
    Check seed @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours','1,3')
    Check publish @('run','--rm','worker','once')
    Check restart @('restart','api','gateway')
    $env:T13_VIEWER="http://127.0.0.1:$ViewerPort"
    $env:T13_REPORT_DIRECTORY=Join-Path $directory 'browser'
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name browser
    Check comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-reference.py','compare')
    if($WithEdge){
        $env:T13_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
        $env:T13_REPORT_DIRECTORY=Join-Path $directory 'browser-edge'
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name edge
        Check edge-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-reference.py','compare','browser-edge')
    }
    if(-not $env:T13_ANDROID_SERIAL){
        $env:T13_DISABLE_GPU='1'
        $env:T13_REPORT_DIRECTORY=Join-Path $directory 'browser-unavailable'
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name unavailable
        Remove-Item Env:T13_DISABLE_GPU
    }
    if($Final){
        Check full-suite @('run','--rm','--env','T4_HTTP=1','check')
    }
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'end') -ReportDirectory $directory -Name inputs-end
}catch{
    $failure=$_
    try{Check service-logs @('logs','--no-color','--timestamps')}catch{Write-Warning 'Could not capture service logs'}
    throw $failure
}finally{
    Stop-Transcript | Out-Null
    Remove-Item Env:T13_BROWSER -ErrorAction SilentlyContinue
    Remove-Item Env:T13_DISABLE_GPU -ErrorAction SilentlyContinue
    & (Join-Path $PSScriptRoot 'retire-publication-project.ps1') -Project $Project -ReportDirectory "data/reports/t13/$Project"
}
