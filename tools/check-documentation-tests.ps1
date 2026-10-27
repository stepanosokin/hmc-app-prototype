$ErrorActionPreference = 'Stop'
$checker = Join-Path $PSScriptRoot 'check-documentation.ps1'
$defaultOutput = @(& $checker)
if (-not ($defaultOutput -match '^PowerShell examples parsed: [0-9]+ ')) {
    throw 'Default documentation check must report administrator syntax checks'
}
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixtures = Join-Path $temporaryRoot ('hmc documentation ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtures | Out-Null
$cases = @(
    @{name='valid';error='';text=@'
[Existing target](target.md)
```powershell
throw 'Examples must never execute'
```
'@},
    @{name='invalid-powershell';error='PowerShell example:';text=@'
```powershell
Write-Output 'unclosed
```
'@},
    @{name='unclosed-fence';error='Unclosed PowerShell fence';text=@'
```powershell
Write-Output 'valid statement but missing fence'
'@},
    @{name='other-language';error='';text=@'
```bash
echo 'not PowerShell, deliberately unclosed quote
```
'@},
    @{name='missing-link';error='missing local target';text='[Absent](missing.md)'}
)
try {
    [IO.File]::WriteAllText((Join-Path $fixtures 'target.md'), 'Existing target')
    foreach ($case in $cases) {
        $document = Join-Path $fixtures ($case.name + '.md')
        [IO.File]::WriteAllText($document, $case.text)
        $failure = $null
        try { & $checker -Path @($document) -ParsePowerShell | Out-Null }
        catch { $failure = $_.Exception.Message }
        if ($case.error) {
            if (-not $failure -or -not $failure.Contains($case.error)) { throw ('Expected rejection: ' + $case.name) }
        } elseif ($failure) { throw ($case.name + ': ' + $failure) }
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtures)
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolved -Leaf) -notmatch '^hmc documentation [a-f0-9]{32}$') { throw 'Unexpected fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse
    if (Test-Path -LiteralPath $resolved) { throw 'Documentation test fixtures remain' }
}
Write-Output "Documentation regressions passed (default recipe and $($cases.Count) fixtures; temporary files removed)."
