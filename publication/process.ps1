function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory=$true)][string]$ReportDirectory,
        [Parameter(Mandatory=$true)][string]$Name,
        [ValidateSet('Full','Summary')][string]$OutputMode='Full'
    )
    $processStdout = Join-Path $ReportDirectory ($Name + '.stdout.log')
    $processStderr = Join-Path $ReportDirectory ($Name + '.stderr.log')
    $processArguments = @($ArgumentList | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    $checkedProcess = Start-Process -FilePath $FilePath -WindowStyle Hidden -ArgumentList $processArguments `
        -Wait -PassThru -RedirectStandardOutput $processStdout -RedirectStandardError $processStderr
    if ($OutputMode -eq 'Full') {
        Get-Content -LiteralPath $processStdout
        Get-Content -LiteralPath $processStderr
    } else {
        @{check=$Name;native_exit_code=$checkedProcess.ExitCode;stdout=$processStdout;stderr=$processStderr;
          stdout_bytes=(Get-Item -LiteralPath $processStdout).Length;
          stderr_bytes=(Get-Item -LiteralPath $processStderr).Length} | ConvertTo-Json -Compress
    }
    @{check=$Name;native_exit_code=$checkedProcess.ExitCode} | ConvertTo-Json -Compress | Add-Content (Join-Path $ReportDirectory 'process-results.jsonl')
    if ($null -eq $checkedProcess.ExitCode -or $checkedProcess.ExitCode -ne 0) {
        throw "$Name failed with native exit $($checkedProcess.ExitCode)"
    }
}
