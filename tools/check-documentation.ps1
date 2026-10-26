param(
    [string[]]$Path = @(
        'README.md',
        'docs/validation/README.md',
        'docs/validation/archives.md',
        'docs/validation/evidence-storage.md',
        'docs/validation/evidence-migration.md',
        'docs/validation/t19.md',
        'docs/adr/0005-external-validation-evidence.md',
        'tests/fixtures/publication/README.md',
        'ADMIN.md',
        'AGENTS.md',
        'viewer/README.md',
        'docs/development-workflow.md',
        'docs/development/browser.md',
        'docs/development/services.md',
        'docs/development/qgis.md',
        'docs/development/acceptance.md',
        'docs/development/cleanup.md',
        'docs/development/scientific.md',
        'docs/development/tracking.md',
        'docs/development/specification.md',
        'docs/validation/retrospectives/workflow-retrospectives.md',
        'docs/validation/retrospectives/retro-t13.md',
        'docs/validation/retrospectives/retro-t14.md',
        'docs/validation/retrospectives/retro-t15.md',
        'docs/validation/retrospectives/retro-t16.md',
        'docs/validation/retrospectives/retro-t25.md',
        'docs/validation/retrospectives/retro-wms-compat.md',
        'docs/validation/retrospectives/retro-grib-crs.md',
        'docs/prototypes/weather-map.README.md',
        'docs/access.md',
        'docs/stack-recovery.md',
        '.scratch/hmc-meteo/spec.md',
        '.scratch/hmc-meteo/spec.ru.md',
        '.scratch/hmc-meteo/implementation-spec.md'
    ),
    [switch]$ParsePowerShell
)

$ErrorActionPreference = 'Stop'
$documentationRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$documentationFailures = @()
$parsedExamples = 0
foreach ($documentPath in $Path) {
    $documentAbsolute = if ([System.IO.Path]::IsPathRooted($documentPath)) {
        [System.IO.Path]::GetFullPath($documentPath)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $documentationRoot $documentPath))
    }
    $documentText = [System.IO.File]::ReadAllText($documentAbsolute)
    # ADMIN is a runnable recipe; other documents can contain command templates.
    if ($ParsePowerShell -or $documentAbsolute -eq (Join-Path $documentationRoot 'ADMIN.md')) {
        $openings = [regex]::Matches($documentText, '(?m)^[ \t]*```powershell[ \t]*\r?$')
        $examples = [regex]::Matches($documentText, '(?ms)^[ \t]*```powershell[ \t]*\r?\n(.*?)^[ \t]*```[ \t]*\r?$')
        if ($openings.Count -ne $examples.Count) {
            $documentationFailures += "${documentPath}: Unclosed PowerShell fence"
        }
        foreach ($example in $examples) {
            $tokens = $null
            $errors = $null
            [Management.Automation.Language.Parser]::ParseInput($example.Groups[1].Value, [ref]$tokens, [ref]$errors) | Out-Null
            foreach ($parseError in $errors) {
                $documentationFailures += "${documentPath}: PowerShell example: $($parseError.Message)"
            }
            $parsedExamples++
        }
    }
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
Write-Output "PowerShell examples parsed: $parsedExamples (syntax only; never executed)."
