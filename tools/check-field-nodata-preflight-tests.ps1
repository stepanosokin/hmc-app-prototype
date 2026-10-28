$ErrorActionPreference='Stop'
$checker=Join-Path $PSScriptRoot 'check-field-nodata-preflight.ps1'
$runner=Join-Path $PSScriptRoot 'run-field-nodata.ps1'
& $checker -Path $runner
$original=[IO.File]::ReadAllText($runner)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($original,[ref]$tokens,[ref]$errors)
$step=$ast.Find({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.Extent.Text.Contains('-Name python-types')},$true)
if(-not $step){throw 'Missing preflight fixture source'}
$text=$step.Extent.Text
$directory=Join-Path ([IO.Path]::GetTempPath()) ('hmc-preflight-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $directory | Out-Null
try{
    $late=$original.Replace($text,'').Replace("    Check services",$text+"`n    Check services")
    $cases=@(
        @{name='missing';text=$original.Replace($text,'');error='Expected one preflight'},
        @{name='conditional';text=$original.Replace($text,'if($Final){'+$text+'}');error='Conditional or deferred'},
        @{name='deferred';text=$original.Replace($text,'function Unused {'+$text+'}');error='Conditional or deferred'},
        @{name='late';text=$late;error='Preflight must precede'},
        @{name='narrow';text=$original.Replace("'trials','publication','tools'","'trials','publication'");error='Incomplete preflight'},
        @{name='live-http';text=$original.Replace('T65_HTTP=0','T65_HTTP=1');error='Incomplete preflight'},
        @{name='unchecked';text=$original.Replace($text,$text.Replace('Invoke-CheckedProcess','Write-Output'));error='Unchecked preflight'}
    )
    foreach($case in $cases){
        $file=Join-Path $directory ($case.name+'.ps1')
        [IO.File]::WriteAllText($file,$case.text)
        $failure=$null
        try{& $checker -Path $file | Out-Null}catch{$failure=$_.Exception.Message}
        if(-not $failure -or -not $failure.Contains($case.error)){throw "Wrong rejection: $($case.name): $failure"}
    }
    Write-Output 'NoData preflight: current runner and 7 negative cases passed.'
}finally{
    $resolved=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
       [IO.Path]::GetFileName($resolved) -notlike 'hmc-preflight-*'){throw 'Unexpected fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if(Test-Path -LiteralPath $resolved){throw 'Preflight fixture remains'}
}
