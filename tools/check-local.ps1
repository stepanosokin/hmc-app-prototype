param(
    [ValidateSet('All', 'Viewer', 'Windows', 'Runtime')]
    [string]$Scope = 'All'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
function Invoke-Check {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Проверка завершилась с кодом ${LASTEXITCODE}: $Command $Arguments" }
}
$image = 'hmc-publication:checks'
$report = Join-Path $root ('data/reports/local-checks/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $report -Force | Out-Null
Start-Transcript -Path (Join-Path $report 'checks.log') | Out-Null
try {
    Invoke-Check git @('rev-parse', 'HEAD')
    Invoke-Check git @('status', '--short')
    if ($Scope -in @('All', 'Viewer')) {
        Invoke-Check npm.cmd @('--prefix', 'viewer', 'ci', '--ignore-scripts', '--no-audit', '--no-fund')
        Invoke-Check npm.cmd @('--prefix', 'viewer', 'run', 'check')
        Invoke-Check npm.cmd @('--prefix', 'viewer', 'test')
        Invoke-Check node @('--test', 'tools/test-viewer-network.mjs')
        Invoke-Check node @('--test', 'tools/test-archive-paths.mjs')
        Invoke-Check node @('--test', 'tools/test-validation-summary.mjs')
    }
    if ($Scope -in @('All', 'Windows')) {
        foreach ($script in @('check-publication-process', 'check-documentation', 'check-documentation-tests', 'check-native-display-inputs', 'check-viewer-fixtures-tests')) {
            Invoke-Check powershell @('-NoProfile', '-File', "tools/$script.ps1")
        }
        Invoke-Check node @('--test', 'tools/test-weather-check-options.mjs')
        Invoke-Check node @('--test', 'tools/test-publication-ops.mjs')
        Invoke-Check node @('--test', 'tools/test-sync-grib.mjs')
    }
    if ($Scope -in @('All', 'Runtime')) {
        Invoke-Check docker @('build', '-f', 'Dockerfile.publication', '-t', $image, '.')
        $mounted = @('run', '--rm', '--network', 'none', '--volume', "${root}:/workspace:ro", '--workdir', '/workspace')
        Invoke-Check docker ($mounted + @('--entrypoint', 'python', $image, '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_grib_crs.py', '-v'))
        Invoke-Check docker ($mounted + @('--entrypoint', 'mypy', $image, '--ignore-missing-imports', '--check-untyped-defs', '--cache-dir=/tmp/mypy', 'decoder', 'tests', 'trials', 'publication', 'tools'))
        foreach ($test in @('tiles', 'access', 'retention')) {
            Invoke-Check docker @('run', '--rm', '--network', 'none', '--entrypoint', 'python', $image, '-m', 'unittest', 'discover', '-s', 'tests', '-p', "test_publication_$test.py", '-v')
        }
        Invoke-Check docker ($mounted + @('--entrypoint', 'python', $image, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_grib_sync.py', '-v'))
        Invoke-Check docker @('run', '--rm', '--network', 'none', '--tmpfs', '/evidence:mode=1777', '--entrypoint', 'python', $image, '-m', 'publication.runtime')
        Invoke-Check docker ($mounted + @('--entrypoint', 'python', $image, '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_evidence*.py', '-v'))
        Invoke-Check powershell @('-NoProfile', '-File', 'tools/check-publication-retirement.ps1', '-Image', $image)
    }
} finally {
    Stop-Transcript | Out-Null
    Pop-Location
    Write-Host "Журнал проверки: $report"
}
