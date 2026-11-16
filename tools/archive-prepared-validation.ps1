param(
    [Parameter(Mandatory=$true)][string]$PreparationScript,
    [Parameter(Mandatory=$true)][string]$ReportDirectory,
    [Parameter(Mandatory=$true)][string]$Archive
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
$preparation = (Resolve-Path -LiteralPath $PreparationScript).Path
$report = (Resolve-Path -LiteralPath $ReportDirectory).Path
$required = @('inputs.json', 'attempt-notes.json')
foreach ($name in $required) {
    if (Test-Path -LiteralPath (Join-Path $report $name)) {
        throw "Choose a fresh preparation attempt: $name already exists"
    }
}
Invoke-CheckedProcess -FilePath (Get-Process -Id $PID).Path `
    -ArgumentList @('-NoProfile','-NonInteractive','-File',$preparation,'-ReportDirectory',$report) `
    -ReportDirectory $report -Name preparation -OutputMode Summary
foreach ($name in $required) {
    $file = Join-Path $report $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing prepared evidence: $name" }
    try {
        $text = [IO.File]::ReadAllText($file)
        if ([string]::IsNullOrWhiteSpace($text)) { throw 'Empty JSON' }
        $null = $text | ConvertFrom-Json
    }
    catch { throw "Invalid prepared JSON: $name" }
}
Invoke-CheckedProcess -FilePath (Get-Command node -CommandType Application).Source `
    -ArgumentList @((Join-Path $PSScriptRoot 'archive-validation.mjs'),$report,$Archive) `
    -ReportDirectory $report -Name archive -OutputMode Summary
