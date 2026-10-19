$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')

# Exercise the same launcher used by T5, without Docker, credentials or samples.
$processCheckDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('hmc process check ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $processCheckDirectory | Out-Null
$processCheckFixture = Join-Path $processCheckDirectory 'child process.ps1'
@'
param([int]$ExitCode, [string]$Message)
[Console]::Out.WriteLine($Message)
[Console]::Error.WriteLine('child diagnostic')
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
Write-Output "Publication process checks passed (native exits 0/7, paths/arguments with spaces, stdout/stderr). Reports: $processCheckDirectory"
