param(
    [string[]]$Path = @(
        'README.md',
        'AGENTS.md',
        'docs/development-workflow.md',
        'docs/access.md',
        '.scratch/hmc-meteo/spec.md',
        '.scratch/hmc-meteo/spec.ru.md',
        '.scratch/hmc-meteo/implementation-spec.md'
    )
)

$ErrorActionPreference = 'Stop'
$documentationRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$documentationFailures = @()
foreach ($documentPath in $Path) {
    $documentAbsolute = if ([System.IO.Path]::IsPathRooted($documentPath)) {
        [System.IO.Path]::GetFullPath($documentPath)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $documentationRoot $documentPath))
    }
    $documentText = [System.IO.File]::ReadAllText($documentAbsolute)
    # Check inline Markdown link targets; remote URLs and fragment contents are outside this check.
    foreach ($documentLink in [regex]::Matches($documentText, '\]\((<[^>]+>|[^\s)]+)\)')) {
        $documentTarget = $documentLink.Groups[1].Value.Trim('<', '>')
        if ($documentTarget -match '^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|//|#)') { continue }
        $documentTarget = [System.Uri]::UnescapeDataString(($documentTarget -split '#', 2)[0])
        $documentResolved = Join-Path ([System.IO.Path]::GetDirectoryName($documentAbsolute)) $documentTarget
        if (-not (Test-Path -LiteralPath $documentResolved)) {
            $documentationFailures += "${documentPath}: missing local target $documentTarget"
        }
    }
}
if ($documentationFailures.Count -gt 0) { throw ($documentationFailures -join [Environment]::NewLine) }
Write-Output "Documentation links passed ($($Path.Count) files)."
