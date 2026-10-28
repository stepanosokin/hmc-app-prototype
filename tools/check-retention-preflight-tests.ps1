$ErrorActionPreference='Stop'
$checker=Join-Path $PSScriptRoot 'check-retention-preflight.ps1'
$runner=Join-Path $PSScriptRoot '../publication/run-retention.ps1'
& $checker -Path $runner
$original=[IO.File]::ReadAllText($runner)
$directory=Join-Path ([IO.Path]::GetTempPath()) ('hmc-retention-preflight-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $directory | Out-Null
try{
    $cases=@(
        @{name='no-guard';text=$original.Replace("& (Join-Path `$PSScriptRoot '../tools/check-retention-preflight.ps1')",'');error='Expected one retention guard'},
        @{name='conditional-guard';text=$original.Replace("& (Join-Path `$PSScriptRoot '../tools/check-retention-preflight.ps1')","if (`$Development) { & (Join-Path `$PSScriptRoot '../tools/check-retention-preflight.ps1') }");error='conditional or deferred'},
        @{name='late-guard';text=$original.Replace("& (Join-Path `$PSScriptRoot '../tools/check-retention-preflight.ps1')",'')+"`n& (Join-Path `$PSScriptRoot '../tools/check-retention-preflight.ps1')";error='must precede Docker'},
        @{name='one-scenario';text=$original.Replace("'-k','test_policy_cleanup_and_warm_cache_expiry',",'');error='must select one-off'},
        @{name='package-loader';text=$original.Replace("'unittest','discover'","'unittest','tests.test_publication_retention'");error='Incomplete Development discovery'},
        @{name='http-disabled';text=$original.Replace('T7_HTTP=1','T7_HTTP=0');error='Incomplete Development discovery'},
        @{name='wrong-file';text=$original.Replace("'-p','test_publication_retention.py'","'-p','test_publication_tiles.py'");error='Incomplete Development discovery'},
        @{name='unchecked';text=$original.Replace('Invoke-T7Check -Name development','Write-Output -Name development');error='checked T7 launcher'},
        @{name='conditional';text=$original.Replace('if ($Development) {','if ($Development -and $RevisionsCli) {');error='extra condition'},
        @{name='no-step';text=$original.Replace('-Name development','-Name renamed-development');error='Expected one Development step'}
    )
    foreach($case in $cases){
        if($case.text -eq $original){throw "Fixture did not change: $($case.name)"}
        $file=Join-Path $directory ($case.name+'.ps1');[IO.File]::WriteAllText($file,$case.text)
        $failure=$null
        try{& $checker -Path $file|Out-Null}catch{$failure=$_.Exception.Message}
        if(-not $failure -or -not $failure.Contains($case.error)){throw "Wrong rejection: $($case.name): $failure"}
    }
    $renamed=Join-Path $directory 'renamed-tests.py'
    $testPath=Join-Path $PSScriptRoot '../tests/test_publication_retention.py'
    [IO.File]::WriteAllText($renamed,[IO.File]::ReadAllText($testPath).Replace('def test_policy_cleanup_and_warm_cache_expiry(', 'def test_renamed_lifecycle('))
    $failure=$null
    try{& $checker -Path $runner -TestPath $renamed|Out-Null}catch{$failure=$_.Exception.Message}
    if(-not $failure -or -not $failure.Contains('match one test method')){throw "Renamed test was accepted: $failure"}
    Write-Output 'Retention preflight: current runner and 11 negative cases passed; no service resources created.'
}finally{
    $resolved=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
       [IO.Path]::GetFileName($resolved) -notlike 'hmc-retention-preflight-*'){throw 'Unexpected fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if(Test-Path -LiteralPath $resolved){throw 'Retention preflight fixture remains'}
}
