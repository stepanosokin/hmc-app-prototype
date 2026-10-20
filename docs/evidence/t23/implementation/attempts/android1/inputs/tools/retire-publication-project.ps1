param(
    [Parameter(Mandatory=$true)][ValidatePattern('^hmc-publication-[a-z0-9-]+$')][string[]]$Project,
    [string]$ArchiveRoot = 'data/archives/publication',
    [string]$ReportDirectory
)
$ErrorActionPreference = 'Stop'
$retirementRepository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $retirementRepository
$retirementArchiveRoot = [System.IO.Path]::GetFullPath((Join-Path $retirementRepository $ArchiveRoot))
$retirementAllowedRoot = Join-Path $retirementRepository 'data/archives'
if (-not $retirementArchiveRoot.StartsWith($retirementAllowedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Retirement archives must be inside this repository data/archives directory'
}

function Get-ProjectResources {
    param([string]$Name)
    $retirementResources = @{}
    foreach ($retirementKind in @('container','network','volume')) {
        $retirementArguments = @($retirementKind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Name")
        if ($retirementKind -eq 'container') { $retirementArguments += '--all' }
        $retirementResources[$retirementKind] = @(& docker @retirementArguments)
        if ($LASTEXITCODE -ne 0) { throw "Cannot inventory $Name $retirementKind resources" }
    }
    return $retirementResources
}

function Write-RetirementJson {
    param([string]$Path, $Value)
    [System.IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 20) + "`n"))
}

foreach ($retirementProject in $Project) {
    $retirementBefore = Get-ProjectResources $retirementProject
    $retirementContainers = @()
    $retirementReports = @()
    foreach ($retirementId in $retirementBefore.container) {
        $retirementInspection = @(& docker container inspect $retirementId | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -ne 0) { throw "Cannot inspect $retirementId" }
        $retirementLabels = $retirementInspection.Config.Labels
        $retirementWorkingDirectory = $retirementLabels.'com.docker.compose.project.working_dir'
        if (-not $retirementWorkingDirectory -or
            [System.IO.Path]::GetFullPath($retirementWorkingDirectory).TrimEnd('\','/') -ne $retirementRepository.TrimEnd('\','/')) {
            throw "Container $retirementId does not belong to this repository"
        }
        $retirementContainers += [ordered]@{
            id=$retirementInspection.Id; name=$retirementInspection.Name; image=$retirementInspection.Image
            state=$retirementInspection.State.Status; project=$retirementProject
        }
        $retirementEnvironmentFile = $retirementLabels.'com.docker.compose.project.environment_file'
        if ($retirementEnvironmentFile) {
            $retirementReportPath = [System.IO.Path]::GetFullPath((Split-Path $retirementEnvironmentFile -Parent))
            $retirementReportsRoot = Join-Path $retirementRepository 'data/reports'
            if (-not $retirementReportPath.StartsWith($retirementReportsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw 'Report source is outside this repository data/reports directory'
            }
            $retirementReports += $retirementReportPath
        }
    }
    # A failed probe may have removed its one-off container before retirement.
    # Recover the conventional report path, or accept an explicit relative path.
    if ($ReportDirectory) {
        $retirementReports += [System.IO.Path]::GetFullPath((Join-Path $retirementRepository $ReportDirectory))
    } elseif (-not $retirementReports.Count -and $retirementProject -match '^hmc-publication-(t[0-9]+)(?:-|$)') {
        $retirementReportCandidate = Join-Path $retirementRepository ('data/reports/' + $Matches[1])
        if ($Matches[1] -ne 't4') { $retirementReportCandidate = Join-Path $retirementReportCandidate $retirementProject }
        if (Test-Path -LiteralPath $retirementReportCandidate -PathType Container) { $retirementReports += $retirementReportCandidate }
    }
    foreach ($retirementReportPath in $retirementReports) {
        if (-not $retirementReportPath.StartsWith((Join-Path $retirementRepository 'data/reports') + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Report source is outside this repository data/reports directory'
        }
    }
    $retirementArchive = Join-Path $retirementArchiveRoot ($retirementProject + '/' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $retirementArchive -Force | Out-Null
    Write-RetirementJson (Join-Path $retirementArchive 'resources-before.json') ([ordered]@{
        project=$retirementProject; repository=$retirementRepository; containers=$retirementContainers
        networks=$retirementBefore.network; volumes=$retirementBefore.volume
    })
    # Preserve report bytes before deleting service state. Config.Env, secrets
    # and source/derivative fixtures are outside this portable report archive.
    foreach ($retirementReport in @($retirementReports | Sort-Object -Unique)) {
        foreach ($retirementFile in Get-ChildItem -LiteralPath $retirementReport -File -Recurse) {
            if ($retirementFile.Extension -notin @('.json','.jsonl','.log','.txt','.md','.png','.html')) { continue }
            $retirementRelative = $retirementFile.FullName.Substring($retirementReport.Length).TrimStart('\','/')
            $retirementDestination = Join-Path $retirementArchive ('reports/' + $retirementRelative)
            New-Item -ItemType Directory -Path (Split-Path $retirementDestination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $retirementFile.FullName -Destination $retirementDestination
        }
    }
    $retirementFiles = @(Get-ChildItem -LiteralPath $retirementArchive -File -Recurse | ForEach-Object {
        [ordered]@{ name=$_.FullName.Substring($retirementArchive.Length).TrimStart('\','/')
            bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
    Write-RetirementJson (Join-Path $retirementArchive 'artifact-index.json') @{artifacts=$retirementFiles}
    $retirementIndex = Get-Content -LiteralPath (Join-Path $retirementArchive 'artifact-index.json') -Raw | ConvertFrom-Json
    foreach ($retirementArtifact in $retirementIndex.artifacts) {
        $retirementArchivedFile = Join-Path $retirementArchive $retirementArtifact.name
        if ((Get-Item -LiteralPath $retirementArchivedFile).Length -ne $retirementArtifact.bytes -or
            (Get-FileHash -LiteralPath $retirementArchivedFile -Algorithm SHA256).Hash -ne $retirementArtifact.sha256) {
            throw 'Archive verification failed; project has not been retired'
        }
    }
    foreach ($retirementContainer in $retirementContainers) {
        if ($retirementContainer.state -eq 'running') {
            & docker container stop --time 10 $retirementContainer.id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Container stop failed' }
        }
        & docker container rm --volumes $retirementContainer.id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Container retirement failed' }
    }
    foreach ($retirementKind in @('network','volume')) {
        foreach ($retirementId in $retirementBefore[$retirementKind]) {
            & docker $retirementKind rm $retirementId | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "$retirementKind retirement failed" }
        }
    }
    $retirementAfter = Get-ProjectResources $retirementProject
    if ($retirementAfter.container.Count -or $retirementAfter.network.Count -or $retirementAfter.volume.Count) {
        throw 'Project resources remain; retirement is incomplete'
    }
    Write-RetirementJson (Join-Path $retirementArchive 'retirement.json') ([ordered]@{
        project=$retirementProject; status='retired'; observed_at=[DateTime]::UtcNow.ToString('o')
        removed=@{containers=$retirementBefore.container.Count; networks=$retirementBefore.network.Count; volumes=$retirementBefore.volume.Count}
        remaining=$retirementAfter; archive_verified=$true
    })
    Write-Output "Retired $retirementProject (containers, networks, volumes). Verified archive: $retirementArchive"
}
