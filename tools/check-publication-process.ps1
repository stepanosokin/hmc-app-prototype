$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
& (Join-Path $PSScriptRoot 'check-powershell.ps1')

# Exercise the same launcher used by T5, without Docker, credentials or samples.
$processCheckDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('hmc process check ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $processCheckDirectory | Out-Null
$processSyntaxFixture = Join-Path $processCheckDirectory 'parse only.ps1'
"throw 'Parsing must not execute this fixture'" | Set-Content -Encoding ascii -LiteralPath $processSyntaxFixture
& (Join-Path $PSScriptRoot 'check-powershell.ps1') -Path @($processSyntaxFixture)
$processBrokenFixture = Join-Path $processCheckDirectory 'broken quote.ps1'
"Write-Output 'unterminated" | Set-Content -Encoding ascii -LiteralPath $processBrokenFixture
$processSyntaxRejected = $false
try {
    & (Join-Path $PSScriptRoot 'check-powershell.ps1') -Path @($processBrokenFixture)
} catch {
    if (-not $_.Exception.Message.StartsWith('PowerShell syntax errors: ')) { throw }
    $processSyntaxRejected = $true
}
if (-not $processSyntaxRejected) { throw 'Malformed PowerShell was accepted' }
$processCheckFixture = Join-Path $processCheckDirectory 'child process.ps1'
@'
param([int]$ExitCode, [string]$Message)
[Console]::Out.WriteLine($Message)
[Console]::Error.WriteLine('child diagnostic')
if ($Message -eq 'huge') {
    [Console]::Out.WriteLine(('private-raster-marker' * 10000))
    [Console]::Error.WriteLine(('private-stderr-marker' * 10000))
}
exit $ExitCode
'@ | Set-Content -Encoding ascii -LiteralPath $processCheckFixture
$processCheckExecutable = Join-Path $PSHOME 'powershell.exe'
$processCheckArguments = @('-NoProfile','-NonInteractive','-File',$processCheckFixture)
Invoke-CheckedProcess -FilePath $processCheckExecutable -ArgumentList ($processCheckArguments + @('0','value with spaces')) `
    -ReportDirectory $processCheckDirectory -Name success
$processCheckRejected = $false
try {
    Invoke-CheckedProcess -FilePath $processCheckExecutable -ArgumentList ($processCheckArguments + @('7','failure with spaces')) `
        -ReportDirectory $processCheckDirectory -Name failure
} catch {
    if ($_.Exception.Message -ne 'failure failed with native exit 7') { throw }
    $processCheckRejected = $true
}
if (-not $processCheckRejected) { throw 'Nonzero child exit was accepted' }
$processCheckResults = @(Get-Content -LiteralPath (Join-Path $processCheckDirectory 'process-results.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
if ($processCheckResults.Count -ne 2 -or $processCheckResults[0].native_exit_code -ne 0 -or $processCheckResults[1].native_exit_code -ne 7) {
    throw 'Native exit codes were not preserved in process results'
}
foreach ($processCheckCase in @(@{name='success';message='value with spaces'},@{name='failure';message='failure with spaces'})) {
    if ((Get-Content -Raw -LiteralPath (Join-Path $processCheckDirectory ($processCheckCase.name + '.stdout.log'))).Trim() -ne $processCheckCase.message) {
        throw 'Child arguments/stdout were not preserved'
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $processCheckDirectory ($processCheckCase.name + '.stderr.log'))).Trim() -ne 'child diagnostic') {
        throw 'Child stderr was not preserved'
    }
}
$summary = Invoke-CheckedProcess -FilePath $processCheckExecutable -ArgumentList ($processCheckArguments + @('0','huge')) `
    -ReportDirectory $processCheckDirectory -Name summary -OutputMode Summary
if ([Text.Encoding]::UTF8.GetByteCount(($summary -join "`n")) -gt 2048 -or ($summary -join '') -match 'private-raster-marker|private-stderr-marker') {
    throw 'Summary leaked unbounded child output'
}
$record = $summary | ConvertFrom-Json
if ($record.native_exit_code -ne 0 -or $record.stdout_bytes -lt 100000 -or $record.stderr_bytes -lt 100000) {
    throw 'Summary lost native exit or full log sizes'
}
$summaryRejected=$false
try {
    Invoke-CheckedProcess -FilePath $processCheckExecutable -ArgumentList ($processCheckArguments + @('7','huge')) `
        -ReportDirectory $processCheckDirectory -Name summary-failure -OutputMode Summary | Out-Null
} catch {
    if ($_.Exception.Message -ne 'summary-failure failed with native exit 7') { throw }
    $summaryRejected=$true
}
if (-not $summaryRejected) { throw 'Summary accepted a failed child process' }
Write-Output "Publication process checks passed (native exits 0/7, spaced paths, full logs and bounded summaries). Reports: $processCheckDirectory"
