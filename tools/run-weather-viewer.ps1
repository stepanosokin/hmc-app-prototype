param(
    [ValidatePattern('^hmc-publication-t13-[a-z0-9-]+$')][string]$Project='hmc-publication-t13-dev1',
    [int]$Port=8141,
    [int]$ViewerPort=8140,
    [switch]$WithEdge,
    [switch]$Final,
    [switch]$Navigation,
    [switch]$NavigationOnly,
    [switch]$Updates,
    [switch]$UpdatesOnly,
    [switch]$Offline,
    [switch]$TimeSwitch,
    [switch]$TimeSwitchOnly,
    [switch]$PointSeries,
    [ValidateRange(0,10)][int]$InitialLoadRepeats=0,
    [switch]$TimeStatusOnly
)
$ErrorActionPreference='Stop'
if($InitialLoadRepeats -and ($Final -or -not $PointSeries)){throw 'InitialLoadRepeats requires PointSeries and Development scope'}
if($TimeSwitchOnly -and (-not $TimeSwitch -or $Final)){throw 'TimeSwitchOnly requires TimeSwitch and Development scope'}
if($TimeStatusOnly -and -not $TimeSwitchOnly){throw 'TimeStatusOnly requires TimeSwitchOnly'}
if($UpdatesOnly -and -not $Updates){throw 'UpdatesOnly requires Updates'}
if($Final -and $UpdatesOnly){throw 'Final requires complete matrix'}
if($NavigationOnly -and -not $Navigation){throw 'NavigationOnly requires Navigation'}
if($Final -and ($NavigationOnly -or $env:T13_FOCUSED -eq '1')){throw 'Final acceptance requires the complete browser matrix'}
$originalFocused=$env:T13_FOCUSED
$originalOffline=$env:T16_OFFLINE
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
    if($InitialLoadRepeats){$env:T27_INITIAL_REPEATS=[string]$InitialLoadRepeats;$env:T13_FOCUSED='1'}
    if($Offline){$env:T16_OFFLINE='1'}
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'start') -ReportDirectory $directory -Name inputs-start
    Check services @('up','--detach','db','api','gateway','geoserver','viewer')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path docs/evidence/t4 $name) $directory}
    if($Final){
        Check types @('run','--rm','typecheck')
    }
    $seedHours=if($PointSeries){(1..24)-join ','}else{'1,3'}
    Check seed @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours',$seedHours)
    Check publish @('run','--rm','worker','once')
    Check restart @('restart','api','gateway')
    if($Navigation){
        Check overlap-seed @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours','1,3','--fixture','overlap')
        Check overlap-publish @('run','--rm','worker','once')
        Check overlap-restart @('restart','api','gateway')
        $env:T14_NAVIGATION='1'
        if($NavigationOnly){$env:T14_NAVIGATION_ONLY='1';$env:T13_FOCUSED='1'}
    }
    $env:T13_VIEWER="http://127.0.0.1:$ViewerPort"
    if($PointSeries){$env:T27_POINT_SERIES='1'}
    if($TimeSwitch){$env:T25_TIME_SWITCH='1'}
    if($TimeSwitchOnly){$env:T25_TIME_SWITCH_ONLY='1';$env:T13_FOCUSED='1'}
    if($TimeStatusOnly){$env:T25_TIME_STATUS_ONLY='1'}
    if($Updates){$env:T15_UPDATES='1';$env:T15_PROJECT=$Project}
    if($UpdatesOnly){$env:T15_UPDATES_ONLY='1';$env:T13_FOCUSED='1'}
    $env:T13_REPORT_DIRECTORY=Join-Path $directory 'browser'
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name browser
    if($PointSeries -and -not $InitialLoadRepeats){Check series-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-series-reference.py','browser')}
    if($TimeSwitch -and -not $TimeStatusOnly){Check time-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-time-reference.py','browser')}
    if($Updates){Check update-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-update-reference.py','browser')}
    if(-not $PointSeries -and -not $NavigationOnly -and -not $UpdatesOnly -and -not $TimeSwitchOnly){
        Check comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-reference.py','compare')
    }
    if($WithEdge){
        $env:T13_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
        $env:T13_REPORT_DIRECTORY=Join-Path $directory 'browser-edge'
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name edge
        if($PointSeries -and -not $InitialLoadRepeats){Check edge-series-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-series-reference.py','browser-edge')}
        if($TimeSwitch -and -not $TimeStatusOnly){Check edge-time-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-time-reference.py','browser-edge')}
        if($Updates){Check edge-update-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-update-reference.py','browser-edge')}
        if(-not $PointSeries -and -not $NavigationOnly -and -not $UpdatesOnly -and -not $TimeSwitchOnly){
            Check edge-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check','/workspace/tools/viewer-reference.py','compare','browser-edge')
        }
    }
    if(-not $env:T13_ANDROID_SERIAL -and -not $TimeSwitchOnly){
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
    Remove-Item Env:T14_NAVIGATION -ErrorAction SilentlyContinue
    Remove-Item Env:T14_NAVIGATION_ONLY -ErrorAction SilentlyContinue
    Remove-Item Env:T15_UPDATES -ErrorAction SilentlyContinue
    Remove-Item Env:T15_UPDATES_ONLY -ErrorAction SilentlyContinue
    Remove-Item Env:T15_PROJECT -ErrorAction SilentlyContinue
    Remove-Item Env:T25_TIME_SWITCH -ErrorAction SilentlyContinue
    Remove-Item Env:T25_TIME_SWITCH_ONLY -ErrorAction SilentlyContinue
    Remove-Item Env:T27_POINT_SERIES -ErrorAction SilentlyContinue
    Remove-Item Env:T27_INITIAL_REPEATS -ErrorAction SilentlyContinue
    Remove-Item Env:T25_TIME_STATUS_ONLY -ErrorAction SilentlyContinue
    if($null -eq $originalFocused){Remove-Item Env:T13_FOCUSED -ErrorAction SilentlyContinue}else{$env:T13_FOCUSED=$originalFocused}
    if($null -eq $originalOffline){Remove-Item Env:T16_OFFLINE -ErrorAction SilentlyContinue}else{$env:T16_OFFLINE=$originalOffline}
    & (Join-Path $PSScriptRoot 'retire-publication-project.ps1') -Project $Project -ReportDirectory "data/reports/t13/$Project"
}
