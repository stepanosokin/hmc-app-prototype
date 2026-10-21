function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory=$true)][string]$ReportDirectory,
        [Parameter(Mandatory=$true)][string]$Name
    )
    $processStdout = Join-Path $ReportDirectory ($Name + '.stdout.log')
    $processStderr = Join-Path $ReportDirectory ($Name + '.stderr.log')
    $processArguments = @($ArgumentList | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    $checkedProcess = Start-Process -FilePath $FilePath -WindowStyle Hidden -ArgumentList $processArguments `
        -Wait -PassThru -RedirectStandardOutput $processStdout -RedirectStandardError $processStderr
    Get-Content -LiteralPath $processStdout
    Get-Content -LiteralPath $processStderr
    @{check=$Name;native_exit_code=$checkedProcess.ExitCode} | ConvertTo-Json -Compress | Add-Content (Join-Path $ReportDirectory 'process-results.jsonl')
    if ($null -eq $checkedProcess.ExitCode -or $checkedProcess.ExitCode -ne 0) {
        throw "$Name failed with native exit $($checkedProcess.ExitCode)"
    }
}
