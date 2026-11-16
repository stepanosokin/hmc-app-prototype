$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture=Join-Path $root ('data/reports/prepared-check-'+[guid]::NewGuid().ToString('N'))
$archiveRoot=Join-Path $fixture 'external'
$previousEvidence=$env:HMC_EVIDENCE_ROOT
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $env:HMC_EVIDENCE_ROOT=$archiveRoot
    $prepare=Join-Path $fixture 'prepare fixture.ps1'
    @'
param([string]$ReportDirectory)
[Console]::Error.WriteLine('successful diagnostic')
$mode=Split-Path $ReportDirectory -Leaf
if ($mode -eq 'missing') { exit 0 }
$json=if ($mode -eq 'invalid') {'not-json'} else {'{}'}
if ($mode -eq 'empty') { $json=' ' }
[IO.File]::WriteAllText((Join-Path $ReportDirectory 'inputs.json'),$json)
[IO.File]::WriteAllText((Join-Path $ReportDirectory 'attempt-notes.json'),'{}')
if ($mode -eq 'failed') { exit 7 }
'@ | Set-Content -LiteralPath $prepare -Encoding ascii
    foreach ($mode in @('failed','missing','invalid','empty','passed')) {
        $report=Join-Path $fixture $mode
        New-Item -ItemType Directory -Path $report | Out-Null
        $rejected=$false
        try {
            & (Join-Path $PSScriptRoot 'archive-prepared-validation.ps1') -PreparationScript $prepare -ReportDirectory $report -Archive $mode | Out-Null
        } catch {
            if ($mode -eq 'passed') { throw }
            if ($mode -eq 'failed' -and $_.Exception.Message -ne 'preparation failed with native exit 7') { throw }
            if ($mode -eq 'missing' -and $_.Exception.Message -ne 'Missing prepared evidence: inputs.json') { throw }
            if ($mode -in @('invalid','empty') -and $_.Exception.Message -ne 'Invalid prepared JSON: inputs.json') { throw }
            $rejected=$true
        }
        if ($mode -ne 'passed') {
            if (-not $rejected -or (Test-Path -LiteralPath (Join-Path $archiveRoot $mode))) { throw "Archive followed $mode preparation" }
            if (Test-Path -LiteralPath (Join-Path $report 'archive.stdout.log')) { throw 'Archiver was launched after preparation failure' }
        } else {
            $index=Get-Content -LiteralPath (Join-Path $archiveRoot 'passed/archive-index.json') -Raw | ConvertFrom-Json
            foreach ($name in @('inputs.json','attempt-notes.json')) {
                if ($name -notin $index.files.path) { throw "Archive lost $name" }
            }
            $staleRejected=$false
            try {
                & (Join-Path $PSScriptRoot 'archive-prepared-validation.ps1') -PreparationScript $prepare -ReportDirectory $report -Archive stale | Out-Null
            } catch {
                if ($_.Exception.Message -notlike 'Choose a fresh preparation attempt:*') { throw }
                $staleRejected=$true
            }
            if (-not $staleRejected -or (Test-Path -LiteralPath (Join-Path $archiveRoot 'stale'))) { throw 'Stale evidence was accepted' }
        }
    }
    Write-Output 'Prepared archive checks passed: exit 7, missing/invalid/empty JSON, successful stderr, stale evidence.'
} finally {
    $env:HMC_EVIDENCE_ROOT=$previousEvidence
    $resolved=[IO.Path]::GetFullPath($fixture)
    $expectedParent=[IO.Path]::GetFullPath((Join-Path $root 'data/reports'))
    if ((Split-Path $resolved -Parent) -ne $expectedParent -or (Split-Path $resolved -Leaf) -notlike 'prepared-check-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if (Test-Path -LiteralPath $resolved) { throw 'Fixture cleanup failed' }
}
