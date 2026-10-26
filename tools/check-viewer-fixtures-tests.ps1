$ErrorActionPreference='Stop'
$checker=Join-Path $PSScriptRoot 'check-viewer-fixtures.ps1'
& $checker
$temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$directory=Join-Path $temporaryRoot ('hmc-viewer-fixtures-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$template=@'
if (CONDITION) {
    Check overlap-seed @()
    Check overlap-publish @()
    Check overlap-restart @()
}
Invoke-CheckedProcess -ArgumentList @('tools/check-weather-viewer.mjs')
'@
$cases=@(
    @{name='valid';guard='$Navigation -or $Updates';error=''},
    @{name='parentheses';guard='-not (-not $Navigation -and -not $Updates)';error=''},
    @{name='navigation-only';guard='$Navigation';error='Updates=True'},
    @{name='both-required';guard='$Navigation -and $Updates';error='Updates=True'},
    @{name='unconditional';guard='$true';error='Updates=False'},
    @{name='unrelated-flag';guard='$Navigation -or ($Updates -and $Final)';error='Unsupported fixture flag'},
    @{name='side-effect';guard="(New-Item -ItemType File -Path '$directory/side-effect.txt')";error='Unsupported fixture condition'}
)
try{
    foreach($case in $cases){
        $path=Join-Path $directory ($case.name+'.ps1')
        [IO.File]::WriteAllText($path,$template.Replace('CONDITION',$case.guard))
        $failure=$null
        try{& $checker -Path $path | Out-Null}catch{$failure=$_.Exception.Message}
        if($case.error){if(-not $failure -or -not $failure.Contains($case.error)){throw "Wrong rejection for $($case.name): $failure"}}
        elseif($failure){throw "$($case.name): $failure"}
    }
    foreach($case in @(
        @{name='missing-publish';text=$template.Replace('CONDITION','$Navigation -or $Updates').Replace('Check overlap-publish @()','');error='Expected one fixture step'},
        @{name='wrong-order';text=$template.Replace('CONDITION','$Navigation -or $Updates').Replace('overlap-seed','temporary').Replace('overlap-publish','overlap-seed').Replace('temporary','overlap-publish');error='Invalid fixture order'},
        @{name='after-browser';text="Invoke-CheckedProcess -ArgumentList @('tools/check-weather-viewer.mjs')`n"+$template.Replace('CONDITION','$Navigation -or $Updates');error='Fixture must precede browser'}
    )){
        $path=Join-Path $directory ($case.name+'.ps1')
        [IO.File]::WriteAllText($path,$case.text)
        $failure=$null
        try{& $checker -Path $path | Out-Null}catch{$failure=$_.Exception.Message}
        if(-not $failure -or -not $failure.Contains($case.error)){throw "Wrong rejection for $($case.name): $failure"}
    }
    if(Test-Path -LiteralPath (Join-Path $directory 'side-effect.txt')){throw 'Checker executed a fixture condition'}
}finally{
    $resolved=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\','/') -ne $temporaryRoot.TrimEnd('\','/') -or
        (Split-Path $resolved -Leaf) -notmatch '^hmc-viewer-fixtures-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse
    if(Test-Path -LiteralPath $resolved){throw 'Fixture files remain'}
}
Write-Output 'Viewer fixture regressions passed (10 cases; temporary files removed).'
