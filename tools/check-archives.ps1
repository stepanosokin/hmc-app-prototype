param([string]$ArchiveRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'evidence-paths.ps1')
if (-not $ArchiveRoot) { $ArchiveRoot = Get-HmcEvidenceRoot }
$ArchiveRoot = [IO.Path]::GetFullPath($ArchiveRoot)
if (-not (Test-Path -LiteralPath $ArchiveRoot -PathType Container)) {
    Write-Warning 'Historical archive unavailable: verification NOT PERFORMED.'
    exit 2
}
$previousRoot = $env:HMC_EVIDENCE_ROOT
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $env:HMC_EVIDENCE_ROOT = $ArchiveRoot
    foreach ($ticket in @('t13','t25','wms-compat','t19')) {
        & node "tools/archive-checks/$ticket.mjs"
        if ($LASTEXITCODE -ne 0) { throw "Historical verifier failed: $ticket" }
    }
    foreach ($flag in @('', '--native-display', '--t23', '--t24', '--t14', '--t15', '--t16')) {
        $arguments = @('-B','tools/check_evidence.py','--archive-root',$ArchiveRoot)
        if ($flag) { $arguments += $flag }
        & python @arguments
        if ($LASTEXITCODE -ne 0) { throw "Historical Python verifier failed: $flag" }
    }
    foreach ($attempt in @('desktop1/reports/browser','desktop1/reports/browser-edge','android6/reports/browser')) {
        & node tools/native-display/budgets.mjs (Join-Path $ArchiveRoot "t23/implementation/attempts/$attempt/browser.json")
        if ($LASTEXITCODE -ne 0) { throw 'Historical browser budget failed' }
    }
} finally {
    $env:HMC_EVIDENCE_ROOT = $previousRoot
    Pop-Location
}
