param([string]$Image = 'hmc-publication:t6')
$ErrorActionPreference = 'Stop'
$retirementCheckRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $retirementCheckRoot
& docker image inspect $Image | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Build the locked $Image image before running retirement checks" }
$retirementCheckScript = Join-Path $PSScriptRoot 'retire-publication-project.ps1'
$retirementCheckId = [guid]::NewGuid().ToString('N')
$retirementCheckProject = 'hmc-publication-retirement-check-' + $retirementCheckId
$retirementCheckVolume = $retirementCheckProject + '_assets'
$retirementCheckNetwork = $retirementCheckProject + '_publication'
$retirementCheckSentinel = 'hmc-publication-retirement-sentinel-' + $retirementCheckId
$retirementCheckReport = Join-Path $retirementCheckRoot ('data/reports/retirement/' + $retirementCheckProject)
$retirementCheckBlocked = Join-Path $retirementCheckRoot ('data/archives/blocked-' + $retirementCheckId)
New-Item -ItemType Directory -Path $retirementCheckReport -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $retirementCheckBlocked -Parent) -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $retirementCheckReport 'probe.log'), 'retained evidence bytes')
[System.IO.File]::WriteAllText((Join-Path $retirementCheckReport 'environment.env'), 'PRIVATE_FIXTURE=not-for-archive')
[System.IO.File]::WriteAllText($retirementCheckBlocked, 'block archive creation')

try {
    & docker volume create --label "com.docker.compose.project=$retirementCheckProject" $retirementCheckVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture volume failed' }
    & docker volume create --label "com.docker.compose.project=$retirementCheckSentinel" $retirementCheckSentinel | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Sentinel volume failed' }
    & docker network create --label "com.docker.compose.project=$retirementCheckProject" $retirementCheckNetwork | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture network failed' }
    $retirementCheckContainer = & docker create --label "com.docker.compose.project=$retirementCheckProject" `
        --label "com.docker.compose.project.working_dir=$retirementCheckRoot" `
        --label "com.docker.compose.project.environment_file=$retirementCheckReport/environment.env" `
        --mount "type=volume,source=$retirementCheckVolume,target=/evidence" --volume /anonymous-retirement `
        --network $retirementCheckNetwork --entrypoint sleep $Image 300
    if ($LASTEXITCODE -ne 0) { throw 'Fixture container failed' }
    $retirementCheckAnonymous = @(& docker container inspect $retirementCheckContainer | ConvertFrom-Json)[0].Mounts |
        Where-Object { $_.Destination -eq '/anonymous-retirement' } | Select-Object -ExpandProperty Name
    & docker start $retirementCheckContainer | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture start failed' }
    $retirementCheckRejected = $false
    try { & $retirementCheckScript -Project $retirementCheckProject -ArchiveRoot ('data/archives/blocked-' + $retirementCheckId) }
    catch { $retirementCheckRejected = $true }
    if (-not $retirementCheckRejected) { throw 'Unwritable archive was accepted' }
    $retirementCheckStillRunning = & docker container inspect --format '{{.State.Running}}' $retirementCheckContainer
    if ($LASTEXITCODE -ne 0 -or $retirementCheckStillRunning -ne 'true') { throw 'Archive failure changed service state' }
    & $retirementCheckScript -Project $retirementCheckProject
    $retirementCheckArchive = Get-ChildItem -LiteralPath (Join-Path $retirementCheckRoot ('data/archives/publication/' + $retirementCheckProject)) -Directory | Select-Object -First 1
    $retirementCheckReceipt = Get-Content -LiteralPath (Join-Path $retirementCheckArchive.FullName 'retirement.json') -Raw | ConvertFrom-Json
    if ($retirementCheckReceipt.status -ne 'retired' -or -not $retirementCheckReceipt.archive_verified) { throw 'Retirement receipt is missing' }
    if ((Get-Content -LiteralPath (Join-Path $retirementCheckArchive.FullName 'reports/probe.log') -Raw) -ne 'retained evidence bytes') { throw 'Evidence bytes changed' }
    if (Test-Path -LiteralPath (Join-Path $retirementCheckArchive.FullName 'reports/environment.env')) { throw 'Secret fixture was archived' }
    $retirementCheckAnonymousLeft = @(& docker volume ls --quiet --filter "name=^$retirementCheckAnonymous$")
    if ($LASTEXITCODE -ne 0 -or $retirementCheckAnonymousLeft.Count) { throw 'Anonymous volume survived retirement' }
    & docker volume inspect $retirementCheckSentinel | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unrelated sentinel volume was removed' }
    # A failed one-off probe can leave a volume and reports but no container.
    & docker volume create --label "com.docker.compose.project=$retirementCheckProject" $retirementCheckVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Orphan fixture volume failed' }
    $retirementCheckPreviousArchives = @(Get-ChildItem -LiteralPath $retirementCheckArchive.Parent.FullName -Directory | Select-Object -ExpandProperty Name)
    & $retirementCheckScript -Project $retirementCheckProject -ReportDirectory ('data/reports/retirement/' + $retirementCheckProject)
    $retirementCheckOrphanArchive = Get-ChildItem -LiteralPath $retirementCheckArchive.Parent.FullName -Directory |
        Where-Object { $_.Name -notin $retirementCheckPreviousArchives } | Select-Object -First 1
    if ((Get-Content -LiteralPath (Join-Path $retirementCheckOrphanArchive.FullName 'reports/probe.log') -Raw) -ne 'retained evidence bytes') {
        throw 'Orphan-project report was not archived'
    }
    Write-Output 'Retirement checks passed: archive failure preserves live resources; verified evidence survives; project and anonymous resources removed; unrelated volume preserved.'
} finally {
    & $retirementCheckScript -Project $retirementCheckProject
    & docker volume rm $retirementCheckSentinel | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Sentinel cleanup failed' }
    Remove-Item -LiteralPath $retirementCheckBlocked
}
