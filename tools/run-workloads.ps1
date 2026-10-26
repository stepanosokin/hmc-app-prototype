param(
    [ValidatePattern('^hmc-publication-t19-[a-z0-9-]+$')][string]$Project='hmc-publication-t19-dev1',
    [string]$Image='hmc-publication:t19-dev1',
    [string]$Inventory,
    [int]$Port=0,
    [int]$ViewerPort=0,
    [switch]$Development
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$directory=Join-Path (Get-Location) "data/reports/t19/$Project"
if(Test-Path -LiteralPath $directory){throw 'Use a fresh T19 report/project'}
if (-not $Inventory) {
    . (Join-Path $PSScriptRoot 'evidence-paths.ps1')
    $Inventory = Join-Path (Get-HmcEvidenceRoot) 't19/final-inventory/inventory.json'
}
$inventoryPath=(Resolve-Path -LiteralPath $Inventory).Path
$validated=[IO.File]::ReadAllText($inventoryPath)|ConvertFrom-Json
if($validated.state -ne 'completed'){throw 'Completed actual-input inventory is required'}
foreach($kind in @('container','network','volume')){
    $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if($kind -eq 'container'){$arguments+='--all'}
    $resources=@(& docker @arguments)
    if($LASTEXITCODE -ne 0 -or $resources.Count){throw 'Docker unavailable or project already exists'}
}
function FreePort{
    $candidate=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    try{$candidate.Start();return ([Net.IPEndPoint]$candidate.LocalEndpoint).Port}finally{$candidate.Stop()}
}
if($Port -eq 0){$Port=FreePort}
if($ViewerPort -eq 0){do{$ViewerPort=FreePort}while($ViewerPort -eq $Port)}
if($Port -eq $ViewerPort){throw 'Gateway and viewer ports must differ'}
foreach($testPort in @($Port,$ViewerPort)){
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$testPort)
    try{$listener.Start()}finally{$listener.Stop()}
}
$workloadImageId=(& docker image inspect $Image --format '{{.Id}}').Trim()
if($LASTEXITCODE -ne 0 -or $workloadImageId -notmatch '^sha256:[0-9a-f]{64}$'){throw 'Build the dedicated publication image before running workloads'}
New-Item -ItemType Directory -Force $directory | Out-Null
$environmentFile=Join-Path $directory 'environment.env'
$lines=@('GEOSERVER_ADMIN_USER=t19operator')
foreach($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')){$lines+=$name+'='+[guid]::NewGuid().ToString('N')}
$lines|Set-Content -Encoding ascii $environmentFile
Copy-Item -LiteralPath $inventoryPath -Destination (Join-Path $directory 'inventory.json')
$env:T4_PORT=[string]$Port;$env:T13_PORT=[string]$ViewerPort
$env:PUBLICATION_IMAGE=$workloadImageId;$env:PUBLICATION_EVIDENCE_DIR='./data/reports/t19/'+$Project
$env:PUBLICATION_CLOCK='2026-10-21T07:00:00Z'
$compose=@('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml','--file','compose.workloads.yaml')
function Check{param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name}
function MeasureState{param([string]$Name)
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/workload-cgroups.mjs',$Project,(Join-Path $directory ($Name+'-cgroups.json'))) -ReportDirectory $directory -Name ($Name+'-cgroups')
    Check ($Name+'-storage') @('run','--rm','--entrypoint','python','check','-m','publication.workload','snapshot','--output',('/evidence/'+$Name+'-storage.json'))
}
function ScalarReference{param([string]$Name)
    $env:T19_REFERENCE_ONLY='1';$env:T13_REPORT_DIRECTORY=Join-Path $directory $Name
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name $Name
    Check ($Name+'-check') @('run','--rm','--entrypoint','python','check','tools/check-scalar-reference.py',('/evidence/'+$Name+'/browser.json'),'/evidence/corpus.json','/evidence/inventory.json',('/evidence/'+$Name+'/reference.json'))
    Remove-Item Env:T19_REFERENCE_ONLY
}
$loadProcess=$null;$loadStop=$null
Start-Transcript -Path (Join-Path $directory 'console.log')|Out-Null
try{
    @{observed_at=[DateTime]::UtcNow.ToString('o');scope='Owner-approved local workstation; not an operational Linux-host result';
      os=[Environment]::OSVersion.VersionString;cpu=@(Get-CimInstance Win32_Processor|Select-Object Name,NumberOfCores,NumberOfLogicalProcessors);
      publication_image=$env:PUBLICATION_IMAGE;free_workspace_bytes=[IO.DriveInfo]::new((Get-Location).Drive.Root).AvailableFreeSpace;
      gateway_port=$Port;viewer_port=$ViewerPort;port_scope='Fresh ephemeral loopback ports by default, to exclude traffic from old tabs on previous test ports';
      clock=$env:PUBLICATION_CLOCK;development=[bool]$Development}|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 (Join-Path $directory 'host.json')
    Invoke-CheckedProcess -FilePath node -ArgumentList @('viewer/build.mjs') -ReportDirectory $directory -Name build-viewer
    Invoke-CheckedProcess -FilePath node -ArgumentList @('viewer/prepare.mjs') -ReportDirectory $directory -Name prepare-viewer
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'start') -ReportDirectory $directory -Name inputs-start
    Check services @('up','--detach','db','api','gateway','geoserver','viewer')
    Check images @('images','--format','json')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    # Hold exact comparison revisions for this isolated experiment only. The
    # production defaults and expiry semantics are unchanged.
    Check retention-fixture @('run','--rm','--entrypoint','python','check','-m','publication.retention','configure','--clock',$env:PUBLICATION_CLOCK,'--superseded-count','1024','--superseded-bytes','1099511627776')
    foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path tests/fixtures/publication/tile-engine $name) $directory}
    $seedHours=if($Development){'1,3'}else{(1..24)-join ','}
    Check seed @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours',$seedHours)
    Check publish @('run','--rm','worker','once')
    if($Development){Check mixed-fields-regression @('run','--rm','--env','GRIB_CRS_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_grib_crs.py','-k','new_field_followed','-v')}
    Check restart @('restart','api','gateway')
    Check access @('run','--rm','--entrypoint','python','check','-m','publication.access','create','--organization','t19-load','--profile','all','--out','/evidence/load.key')
    Check portrayal-regression @('run','--rm','--env','T19_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_diagnostics.py','-v')
    $prepare=@('run','--rm','--entrypoint','python','check','-m','publication.workload','prepare','--input','/evidence/inventory.json','--output','/evidence/jobs.json','--clock',$env:PUBLICATION_CLOCK)
    if($Development){$prepare+=@('--limit','3')}
    Check queue $prepare
    MeasureState start
    Check start-worker @('up','--detach','worker')
    # Two distinct real ENA times are required for wind navigation.
    for($attempt=0;$attempt -lt 240;$attempt++){
        Check ('wait-'+$attempt) @('run','--rm','--entrypoint','python','check','-m','publication.workload','snapshot','--output',('/evidence/wait-'+$attempt+'.json'))
        $state=[IO.File]::ReadAllText((Join-Path $directory ('wait-'+$attempt+'.json')))|ConvertFrom-Json
        $complete=@($state.jobs|Where-Object {$_.state -eq 'published'}).Count
        $planned=[IO.File]::ReadAllText((Join-Path $directory 'jobs.json'))|ConvertFrom-Json
        $done=@($state.jobs|Where-Object {$_.state -eq 'published' -and $_.id -in @($planned.jobs.job)}).Count
        $failed=@($state.jobs|Where-Object {$_.state -eq 'failed' -and $_.id -in @($planned.jobs.job) -and $_.history[-1].attempt -ge 3}).Count
        if($failed){throw 'Representative ingestion exhausted retries; inspect archived job history'}
        if($done -ge 2){break}
        if($attempt -eq 239){throw 'Two real ENA times were not published within the bounded preparation wait'}
        Start-Sleep -Seconds 5
    }
    Check corpus @('run','--rm','--entrypoint','python','check','-m','publication.workload','corpus','--output','/evidence/corpus.json')
    $env:T19_WORKLOAD='1';$env:T19_FIELD_UI_ONLY='1';$env:T19_PORTRAYAL='0';$env:T13_FOCUSED='1';$env:T13_VIEWER="http://127.0.0.1:$ViewerPort"
    $env:T19_CORPUS=Join-Path $directory 'corpus.json'
    $uiBrowsers=if($Development){@('chrome')}else{@('chrome','edge')}
    foreach($browser in $uiBrowsers){
        $env:T13_BROWSER=if($browser -eq 'edge'){'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}else{'C:/Program Files/Google/Chrome/Application/chrome.exe'}
        $env:T13_REPORT_DIRECTORY=Join-Path $directory ('fields-'+$browser)
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name ('fields-'+$browser)
    }
    Remove-Item Env:T19_FIELD_UI_ONLY
    if($Development){ScalarReference 'scalar-precheck-chrome'}
    $clients=if($Development){@(1)}else{@(1,10,50,100)}
    $repetitions=if($Development){1}else{3}
    $seconds=if($Development){10}else{60}
    for($repetition=1;$repetition -le $repetitions;$repetition++){
        foreach($count in $clients){foreach($phase in @('cold','warm')){foreach($representation in @('numeric','image')){
            $prefix="load-$repetition-$count-$phase-$representation"
            if($phase -eq 'cold'){Check ($prefix+'-restart') @('restart','api')}
            else{Check ($prefix+'-prime') @('run','--rm','--entrypoint','python','check','-m','publication.workload','warm','--input','/evidence/corpus.json','--representation',$representation,'--output',('/evidence/'+$prefix+'-prime.json'))}
            MeasureState ($prefix+'-start')
            $loadStop=Join-Path $directory ($prefix+'.stop.json')
            $loadProcess=Start-Process -FilePath node -WindowStyle Hidden -PassThru -ArgumentList @('tools/workload-load.mjs',$Project,$environmentFile,$directory,[string]$count,[string]$seconds,$phase,[string]$repetition,$representation)
            $env:T19_WORKLOAD='1';$env:T19_ROUNDS=if($Development){'1'}else{'3'}
            $env:T19_CORPUS=Join-Path $directory 'corpus.json'
            $env:T13_FOCUSED='1';$env:T13_VIEWER="http://127.0.0.1:$ViewerPort"
            $env:T19_PORTRAYAL=if($representation -eq 'image'){'1'}else{'0'}
            $env:T13_BROWSER=if($repetition -eq 2){'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}else{'C:/Program Files/Google/Chrome/Application/chrome.exe'}
            $env:T13_REPORT_DIRECTORY=Join-Path $directory ($prefix+'-browser')
            $browserCompleted=$true
            try{
                Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name ($prefix+'-browser')
            }catch{
                $browserPath=Join-Path $env:T13_REPORT_DIRECTORY 'browser.json'
                if($Development -or -not (Test-Path -LiteralPath $browserPath)){throw}
                $failedBrowser=[IO.File]::ReadAllText($browserPath)|ConvertFrom-Json
                $clean=$failedBrowser.cleanup
                $serviceFailures=@($failedBrowser.responses|Where-Object {$_.status -in @(429,503,504) -and $_.url -match '/(api|ogc)/'})
                $loadWait=$failedBrowser.failure -match '^Error: (Timed out: first GPU field|T19: browser operation exceeded 120 seconds:)'
                $boundedAbort=$failedBrowser.failure_state.time_error -eq 'AbortError: signal is aborted without reason' -and
                    -not $failedBrowser.failure_state.context_lost -and -not $failedBrowser.failure_state.renderer_error
                if(-not ($clean.page_released -and $clean.browser_stopped -and $clean.profile_removed -and $clean.browser_processes_remaining -eq 0) -or
                   -not $loadWait -or $failedBrowser.failure_state.time_state -ne 'error' -or ($serviceFailures.Count -eq 0 -and -not $boundedAbort)){throw}
                $browserCompleted=$false
                # A measured unavailable service is a failed profile, not proof
                # of capacity or readiness. Identity/numeric/resource/runner
                # assertions do not enter this narrow continuation branch.
                # A bounded browser cancellation is also an unavailable result;
                # it does not establish overload or a server-side cause.
                @{status='failed';classification='observed load unavailability; cause not inferred';
                  browser_time_error=$failedBrowser.failure_state.time_error;
                  failure=$failedBrowser.failure;responses=$serviceFailures;cleanup=$clean;
                  missing_metrics='Unavailable, never zero or successful';readiness=$false}|ConvertTo-Json -Depth 8|
                    Set-Content -Encoding UTF8 (Join-Path $directory ($prefix+'-browser-service-failure.json'))
                Check ($prefix+'-service-logs') @('logs','--tail','200','--no-color','--timestamps','api','gateway')
            }
            [IO.File]::WriteAllText($loadStop,(@{browser_completed=$browserCompleted}|ConvertTo-Json -Compress))
            $loadProcess.WaitForExit();$loadProcess=$null;$loadStop=$null
            $receipt=[IO.File]::ReadAllText((Join-Path $directory ($prefix+'-exit.json')))|ConvertFrom-Json
            if($receipt.native_exit_code -ne 0){throw 'HTTP workload process failed'}
            MeasureState ($prefix+'-end')
        }}}
    }
    for($attempt=0;$attempt -lt 2880;$attempt++){
        Check ('drain-'+$attempt) @('run','--rm','--entrypoint','python','check','-m','publication.workload','snapshot','--output',('/evidence/drain-'+$attempt+'.json'))
        $state=[IO.File]::ReadAllText((Join-Path $directory ('drain-'+$attempt+'.json')))|ConvertFrom-Json
        $done=@($state.jobs|Where-Object {$_.state -eq 'published' -and $_.id -in @($planned.jobs.job)}).Count
        if($done -eq @($planned.jobs).Count){break}
        $failed=@($state.jobs|Where-Object {$_.state -eq 'failed' -and $_.id -in @($planned.jobs.job) -and $_.history[-1].attempt -ge 3}).Count
        if($failed){throw 'Ingestion exhausted retries during the bounded tail wait'}
        if($attempt -eq 2879){throw 'Ingestion did not drain within the declared 24-hour tail wait'}
        Start-Sleep -Seconds 30
    }
    MeasureState final
    $env:T19_FIELD_UI_ONLY='1';$env:T19_PORTRAYAL='0'
    $env:T19_COMPLETE_DATASET='1'
    foreach($browser in $uiBrowsers){
        $env:T13_BROWSER=if($browser -eq 'edge'){'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}else{'C:/Program Files/Google/Chrome/Application/chrome.exe'}
        $env:T13_REPORT_DIRECTORY=Join-Path $directory ('fields-final-'+$browser)
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-weather-viewer.mjs') -ReportDirectory $directory -Name ('fields-final-'+$browser)
        Remove-Item Env:T19_FIELD_UI_ONLY
        ScalarReference ('scalar-reference-'+$browser)
        $env:T19_FIELD_UI_ONLY='1'
    }
    Remove-Item Env:T19_FIELD_UI_ONLY
    foreach($browserReport in @(Get-ChildItem -LiteralPath $directory -Directory | Where-Object {$_.Name -match '^(fields-(final-)?(chrome|edge)|load-\d+-\d+-(cold|warm)-numeric-browser)$'})){
        $relative='/evidence/'+$browserReport.Name
        $windArguments=@('run','--rm','--entrypoint','python','check','tools/check-wind-reference.py',($relative+'/browser.json'),'/evidence/inventory.json',($relative+'/wind-reference.json'))
        $failedProfile=$browserReport.Name -replace '-browser$','-browser-service-failure.json'
        if(Test-Path -LiteralPath (Join-Path $directory $failedProfile)){$windArguments+='--allow-unavailable'}
        Check ($browserReport.Name+'-wind-reference') $windArguments
    }
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/weather-viewer-inputs.mjs',$directory,'end') -ReportDirectory $directory -Name inputs-end
}catch{
    $failure=$_
    try{Check failure-state @('run','--rm','--entrypoint','python','check','-m','publication.workload','snapshot','--output','/evidence/failure-storage.json')}catch{Write-Warning 'Could not capture full failure job history'}
    try{Check failure-logs @('logs','--no-color','--timestamps')}catch{Write-Warning 'Could not capture service logs'}
    throw $failure
}finally{
    if($loadProcess){[IO.File]::WriteAllText($loadStop,'{"browser_completed":false}');$loadProcess.WaitForExit()}
    foreach($name in @('T19_WORKLOAD','T19_FIELD_UI_ONLY','T19_REFERENCE_ONLY','T19_COMPLETE_DATASET','T19_ROUNDS','T19_CORPUS','T19_PORTRAYAL','T13_FOCUSED','T13_VIEWER','T13_BROWSER','T13_REPORT_DIRECTORY')){Remove-Item ('Env:'+$name) -ErrorAction SilentlyContinue}
    Stop-Transcript|Out-Null
    & (Join-Path $PSScriptRoot 'retire-publication-project.ps1') -Project $Project -ReportDirectory "data/reports/t19/$Project"
    Remove-Item -LiteralPath (Join-Path $directory 'load.key'),$environmentFile -ErrorAction SilentlyContinue
}
