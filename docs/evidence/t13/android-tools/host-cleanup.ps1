$ErrorActionPreference='Stop'
$root=(Resolve-Path '.').Path
$tools=(Resolve-Path 'data/tools/t13-android').Path
if(-not $tools.StartsWith($root+'\data\tools\')){throw 'Outside task tools'}
$profile='C:\Users\s.osokin\.android'
$ownership=Get-Content -Raw -Encoding UTF8 (Join-Path $tools 'ownership.json') | ConvertFrom-Json
if($ownership.directory_existed_before_task -or $ownership.initial_files.Count -ne 0){throw 'Not an owned empty profile'}
$files=@(Get-ChildItem -LiteralPath $profile -Force)
if(@($files | Where-Object Name -notin @('adbkey','adbkey.pub')).Count){throw 'Unexpected files: preserve profile'}
$before=@($files | ForEach-Object { @{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} })
& (Join-Path $tools 'platform-tools/adb.exe') -P 5041 kill-server
if($LASTEXITCODE -ne 0){throw 'ADB shutdown failed'}
Start-Sleep -Milliseconds 300
$listeners=@(Get-NetTCPConnection -LocalPort 5041 -State Listen -ErrorAction SilentlyContinue)
$processes=@(Get-CimInstance Win32_Process -Filter "Name='adb.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($tools) })
if($listeners.Count -or $processes.Count){throw 'Task ADB still running'}
foreach($file in $before){
 $absolute=Join-Path $profile $file.name
 if((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash -ne $file.sha256){throw 'Key changed: preserve it'}
 Remove-Item -LiteralPath $absolute -Force
}
if(@(Get-ChildItem -LiteralPath $profile -Force).Count){throw 'Preserve nonempty profile'}
Remove-Item -LiteralPath $profile
$report=@{observed_at=[DateTime]::UtcNow.ToString('o');server_port=5041;task_server_stopped=$true;remaining_task_processes=0;keys=$before;keys_removed=$true;owned_profile_removed=(-not(Test-Path -LiteralPath $profile));tools_directory=$tools}
Remove-Item -LiteralPath $tools -Recurse -Force
$report.tools_directory_removed=(-not(Test-Path -LiteralPath $tools))
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 'docs/evidence/t13/android-tools/host-cleanup.json'
Write-Output 'Task ADB stopped; owned keys/profile/tools removed and verified.'
