param([string[]]$Path)
$ErrorActionPreference = 'Stop'
$syntaxRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Path) {
    $Path = @(foreach ($directory in @('publication', 'tools', 'trials')) {
        Get-ChildItem -LiteralPath (Join-Path $syntaxRoot $directory) -Filter '*.ps1' -File -Recurse |
            Select-Object -ExpandProperty FullName
    })
}
$syntaxFailures = @()
foreach ($scriptPath in $Path) {
    $resolvedScript = (Resolve-Path -LiteralPath $scriptPath).Path
    $syntaxTokens = $null
    $syntaxErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($resolvedScript, [ref]$syntaxTokens, [ref]$syntaxErrors) | Out-Null
    foreach ($syntaxError in $syntaxErrors) {
        $syntaxFailures += "${resolvedScript}:$($syntaxError.Extent.StartLineNumber): $($syntaxError.Message)"
    }
}
if ($syntaxFailures.Count) { throw ('PowerShell syntax errors: ' + ($syntaxFailures -join '; ')) }
Write-Output "PowerShell syntax checks passed ($($Path.Count) files; no scripts executed)."
