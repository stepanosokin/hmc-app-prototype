$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Get-Location).Path)
$archiveRoot=Join-Path $workspace 'docs/evidence/t25/attempts'
$projects=@()
foreach($attempt in Get-ChildItem -LiteralPath $archiveRoot -Directory){
    $project='hmc-publication-t13-t25-'+$attempt.Name
    $receipt=Get-Content -LiteralPath (Join-Path $attempt.FullName 'retirement.json') -Raw | ConvertFrom-Json
    if($receipt.status -ne 'retired' -or -not $receipt.archive_verified){throw "Not retired: $project"}
    $inventory=@{}
    foreach($kind in @('container','network','volume')){
        $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$project")
        if($kind -eq 'container'){$arguments+='--all'}
        $remaining=@(& docker @arguments)
        if($LASTEXITCODE -ne 0 -or $remaining.Count){throw "Remaining $kind for $project"}
        $inventory[$kind]=@()
    }
    $projects+=@{project=$project;status='retired';remaining=$inventory}
}
$ownership=Get-Content docs/evidence/t25/checks/android-tools.json -Raw | ConvertFrom-Json
$sdk=Join-Path $workspace 'data/tools/t25-android'
if([IO.Path]::GetFullPath($sdk) -ne ($workspace+'\data\tools\t25-android')){throw 'Unexpected SDK target'}
$adb=Join-Path $sdk 'platform-tools/adb.exe'
if((Get-FileHash -LiteralPath $adb -Algorithm SHA256).Hash -ne $ownership.adb_sha256){throw 'ADB changed'}
$forward=@(& $adb -P 5041 forward --list)
if($LASTEXITCODE -ne 0){throw 'ADB forward inventory failed'}
$reverse=@(& $adb -P 5041 -s RZGL30TZV3V reverse --list)
if($LASTEXITCODE -ne 0){throw 'ADB inventory failed'}
if(($forward -join '').Trim() -or ($reverse -join '').Trim()){throw 'ADB mappings remain; inspect before stopping server'}
& $adb -P 5041 kill-server
if($LASTEXITCODE -ne 0){throw 'ADB server stop failed'}
if(@(Get-Process adb -ErrorAction SilentlyContinue).Count){throw 'Other ADB process remains; preserve keys and inspect'}
$removedKeys=@()
foreach($entry in $ownership.keys){
    if($entry.path -notin @('C:\Users\s.osokin\.android\adbkey','C:\Users\s.osokin\.android\adbkey.pub')){throw 'Unexpected key target'}
    $key=Get-Item -LiteralPath $entry.path
    if((Get-FileHash -LiteralPath $key.FullName -Algorithm SHA256).Hash -ne $entry.sha256){throw 'ADB key changed; preserve'}
    if($key.CreationTimeUtc.ToString('o') -ne $entry.created_utc){throw 'ADB key ownership differs'}
    Remove-Item -LiteralPath $key.FullName
    if(Test-Path -LiteralPath $key.FullName){throw 'Key remains'}
    $removedKeys+=@{path=$entry.path;ownership_hash_verified=$true;removed=$true}
}
Remove-Item -LiteralPath $sdk -Recurse -Force
if(Test-Path -LiteralPath $sdk){throw 'SDK remains'}
$removedEnvironments=@()
foreach($project in $projects){
    $environmentPath=Join-Path $workspace ('data/reports/t13/'+$project.project+'/environment.env')
    if(Test-Path -LiteralPath $environmentPath){Remove-Item -LiteralPath $environmentPath; $removedEnvironments+=$project.project}
    if(Test-Path -LiteralPath $environmentPath){throw 'Environment file remains'}
}
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -In @(5041,8140,8141,8190,8191,8299) | Select-Object LocalAddress,LocalPort,OwningProcess)
if($listeners.Count){throw 'Test listener remains'}
$report=@{observed_at=(Get-Date).ToUniversalTime().ToString('o');status='passed';retired_projects=$projects;retired_count=$projects.Count;retained_live_stacks=@();adb_server_5041_stopped=$true;adb_mappings_before_stop=@();generated_keys=$removedKeys;sdk_removed=$true;environment_files_removed=$removedEnvironments;listeners=$listeners;shared_images_build_caches_and_unrelated_projects='preserved';user_chrome='preserved; test tabs closed by browser runners'}
$report | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 docs/evidence/t25/checks/final-cleanup.json
Write-Output "Cleanup passed: $($projects.Count) retired projects; ADB, SDK, generated keys and environment files removed."
