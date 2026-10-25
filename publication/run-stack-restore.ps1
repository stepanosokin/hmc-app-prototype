param(
    [ValidatePattern('^hmc-publication-t18-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t18-check',
    [int]$Port = 8138,
    [string]$Image = 'hmc-publication:t18',
    [switch]$Development,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$restoreProject = $Project + '-restored'
$report = Join-Path (Get-Location) "data/reports/t6/$Project"
$backup = Join-Path (Get-Location) "data/backups/$Project"
$sample = 'data/grib/ICON_EU_T_G_2026101500.grib2'
if (-not (Test-Path $sample) -or (Get-FileHash $sample -Algorithm SHA256).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') {
    throw 'Required actual sample missing or changed'
}
foreach ($name in @($Project, $restoreProject)) {
    foreach ($kind in @('container','volume','network')) {
        $inventory = @(& docker $kind ls --quiet --filter "label=com.docker.compose.project=$name")
        if ($LASTEXITCODE -ne 0 -or $inventory.Count) { throw 'Need Docker and fresh isolated project names' }
    }
}
if ((Test-Path $report) -or (Test-Path $backup)) { throw 'Preserve previous evidence: choose a fresh project' }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } finally { $listener.Stop() }
New-Item -ItemType Directory -Force $report | Out-Null
$secret = Join-Path $report 'environment.env'
$lines = @('GEOSERVER_ADMIN_USER=t18operator')
foreach ($key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $lines += $key + '=' + [guid]::NewGuid().ToString('N')
}
$lines | Set-Content -Encoding ascii $secret
function Save-Inputs {
    param([string]$Name)
    $files = @(foreach ($directory in @('publication','decoder','tests','trials','tools','config')) {
        Get-ChildItem -LiteralPath $directory -File -Recurse | Where-Object { $_.Extension -in @('.py','.ps1','.mjs','.json','.sql','.sh','.sld') }
    })
    $files += @(Get-ChildItem -File | Where-Object { $_.Name -match '^(compose|Dockerfile|requirements)' })
    $records = @($files | Sort-Object FullName | ForEach-Object {
        @{path=$_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
    $snapshot = @{base_commit=(& git rev-parse HEAD).Trim();inputs=$records} | ConvertTo-Json -Depth 5
    if ($Name) { $snapshot | Set-Content -Encoding utf8 (Join-Path $report $Name) }
    else { return $snapshot }
}
$env:PUBLICATION_IMAGE = $Image
$env:PUBLICATION_EVIDENCE_DIR = "./data/reports/t6/$Project"
$env:T4_PORT = [string]$Port
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$env:T6_TEST_FAULTS = '1'
$compose = @('compose','--project-name',$Project,'--env-file',$secret,'--file','compose.publication.yaml')
function Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose + $Arguments) -ReportDirectory $report -Name $Name
    if ($Arguments[0] -eq 'run') { Wait-TestRemoval $compose[2] }
}
function Wait-TestRemoval {
    param([string]$Name)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $removing = @(& docker container ls --all --quiet --filter "label=com.docker.compose.project=$Name" --filter status=removing)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot observe Docker removal' }
        $oneoffs = @(& docker container ls --all --quiet --filter "label=com.docker.compose.project=$Name" --filter label=com.docker.compose.oneoff=True)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot observe one-off test completion' }
        if (-not $removing.Count -and -not $oneoffs.Count) { return }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Docker is still removing a completed test container' }
        Start-Sleep -Milliseconds 200
    } while ($true)
}
function Ops {
    param([string]$Name,[string]$Command,[string]$Target)
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/publication-ops.mjs',$Command,'--project',$Target,'--env-file',$secret,'--directory',$backup) -ReportDirectory $report -Name $Name
}
function RejectOps {
    param([string]$Name,[string]$Command,[string]$Target,[string]$Reason)
    $arguments = @('tools/publication-ops.mjs',$Command,'--project',$Target,'--env-file',$secret,'--directory',$backup)
    $quoted = @($arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    $process = Start-Process -FilePath node -WindowStyle Hidden -Wait -PassThru -ArgumentList $quoted `
        -RedirectStandardOutput (Join-Path $report "$Name.stdout.log") -RedirectStandardError (Join-Path $report "$Name.stderr.log")
    if ($process.ExitCode -ne 1) { throw "$Name should have refused the operation" }
    $errorText = [System.IO.File]::ReadAllText((Join-Path $report "$Name.stderr.log"))
    if (-not $errorText.Contains($Reason)) { throw "$Name refused for an unexpected reason" }
    @{check=$Name;expected_refusal=$true;native_exit_code=$process.ExitCode} | ConvertTo-Json -Compress |
        Add-Content (Join-Path $report 'expected-refusals.jsonl')
}
$attemptError = $null
$cleanupErrors = @()
try {
    $startInputs = Save-Inputs ''
    if (-not $Development) {
        # Existing T6 already runs full suite, real crashes, retained readers and restart.
        # It creates its own report, so remove only our unused secret/directory first.
        Remove-Item -LiteralPath $secret
        Remove-Item -LiteralPath $report
        $t6Args = @{Project=$Project;Port=$Port;Image=$Image;SkipBuild=$SkipBuild}
        & ./publication/run-recovery.ps1 @t6Args
    } else {
        foreach ($evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
            Copy-Item -LiteralPath (Join-Path 'docs/evidence/t4' $evidence) -Destination $report
        }
        if (-not $SkipBuild) { Check build @('build','worker') }
        Check services @('up','--detach','db','api','gateway','geoserver')
        Check assets @('run','--rm','init-assets')
        Check ready @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
        Check migrate @('run','--rm','worker','once')
        Check submit @('run','--rm','worker','submit','--recoverable','--clock','2026-10-19T05:00:00Z','--hours','1')
        Check publish @('run','--rm','worker','once')
    }
    $startInputs | Set-Content -Encoding utf8 (Join-Path $report 'inputs-t18-start.json')
    Check access @('run','--rm','--env','T8_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','policies','-v')
    Check before @('run','--rm','--entrypoint','python','check','-m','publication.verify_stack_restore','before')
    # Capture a durable queued delivery; processing must resume from its managed original.
    Check queued @('run','--rm','worker','submit','--recoverable','--clock','2026-10-19T07:00:00Z','--hours','21')
    Ops backup backup $Project
    Ops verify verify $Project
    Ops source-health health $Project
    RejectOps existing-project restore $Project '[ExistingProject]'
    $dump = Join-Path $backup 'database.dump'
    $dumpLength = (Get-Item -LiteralPath $dump).Length
    $stream = [System.IO.File]::Open($dump, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write)
    try { $stream.Position = $dumpLength; $stream.WriteByte(0) } finally { $stream.Dispose() }
    try { RejectOps corrupted-backup restore $restoreProject '[BackupIntegrity]' }
    finally {
        $stream = [System.IO.File]::Open($dump, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write)
        try { $stream.SetLength($dumpLength) } finally { $stream.Dispose() }
    }
    foreach ($kind in @('container','volume','network')) {
        $remaining = @(& docker $kind ls --quiet --filter "label=com.docker.compose.project=$restoreProject")
        if ($LASTEXITCODE -ne 0 -or $remaining.Count) { throw 'Rejected restore allocated resources' }
    }
    Ops restore restore $restoreProject
    # Do not open a second gateway on the same host port.
    Check stop-source @('stop')
    $compose = @('compose','--project-name',$restoreProject,'--env-file',$secret,'--file','compose.publication.yaml')
    Check start-restored @('up','--detach','geoserver','api','gateway')
    Ops restored-health health $restoreProject
    Check after @('run','--rm','--entrypoint','python','check','-m','publication.verify_stack_restore','after')
    Check resume @('run','--rm','worker','once')
    Check resume-again @('run','--rm','worker','once')
    Ops restart restart $restoreProject
    Check resumed-readers @('run','--rm','--entrypoint','python','check','-m','publication.verify_stack_restore','resumed')
    Check expiry-and-usage @('run','--rm','--entrypoint','python','check','-m','publication.verify_stack_restore','expired')
    if ((Get-FileHash $sample -Algorithm SHA256).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') {
        throw 'Source mount bytes changed'
    }
    Save-Inputs inputs-t18-end.json
    if ((Get-FileHash (Join-Path $report 'inputs-t18-start.json')).Hash -ne (Get-FileHash (Join-Path $report 'inputs-t18-end.json')).Hash) {
        throw 'T18 validation inputs changed'
    }
    @{status='passed';development=[bool]$Development;host='local Docker Desktop; organization Linux gate pending';backup='protected data/backups; excluded from evidence'} |
        ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $report 't18-gate.json')
} catch {
    $attemptError = $_
    @{status='failed';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $report 't18-gate.json')
} finally {
    foreach ($name in @($Project,$restoreProject)) {
        $compose = @('compose','--project-name',$name,'--env-file',$secret,'--file','compose.publication.yaml')
        try { Check ($name + '-service-logs') @('logs','--no-color','--tail','250','db','api','gateway','geoserver') | Out-Null }
        catch { Write-Warning "Service-log capture failed for $name; keep the original failure and retirement evidence" }
    }
    foreach ($name in @($Project,$restoreProject)) {
        try { Wait-TestRemoval $name }
        catch { $cleanupErrors += @{project=$name;phase='wait';error=$_.Exception.Message} }
        try { & ./tools/retire-publication-project.ps1 -Project $name -ReportDirectory "data/reports/t6/$Project" }
        catch { $cleanupErrors += @{project=$name;phase='retirement';error=$_.Exception.Message} }
    }
    if ($cleanupErrors.Count) {
        $cleanupErrors | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $report 'cleanup-errors.json')
    }
}
if ($attemptError) { throw $attemptError }
if ($cleanupErrors.Count) { throw 'Cleanup incomplete; inspect cleanup-errors.json and retry retirement for the named projects' }
