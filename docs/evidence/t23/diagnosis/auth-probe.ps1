$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '../../../..')
$project = 'hmc-publication-t23a-diag-auth1'
$directory = Join-Path (Get-Location) "data/reports/t23a/$project"
if (Test-Path -LiteralPath $directory) { throw 'Use fresh project' }
foreach ($kind in @('container','network','volume')) {
    $arguments = @($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$project")
    if ($kind -eq 'container') { $arguments += '--all' }
    $resources = @(& docker @arguments)
    if ($LASTEXITCODE -ne 0 -or $resources.Count) { throw 'Project not empty or Docker unavailable' }
}
New-Item -ItemType Directory $directory | Out-Null
$environmentFile = Join-Path $directory 'environment.env'
$lines = @('GEOSERVER_ADMIN_USER=t23operator')
foreach ($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $lines += $name + '=' + [guid]::NewGuid().ToString('N')
}
$lines | Set-Content -Encoding ascii $environmentFile
$env:PUBLICATION_IMAGE = 'hmc-publication:t23'
$env:PUBLICATION_EVIDENCE_DIR = "./data/reports/t23a/$project"
$compose = @('compose','--env-file',$environmentFile,'--project-name',$project,'--file','compose.publication.yaml')
try {
    & docker @compose up --detach db
    if ($LASTEXITCODE -ne 0) { throw 'DB startup failed' }
    & docker @compose run --rm --no-deps --volume "$((Get-Location).Path):/workspace:ro" --entrypoint python check /workspace/docs/evidence/t23/diagnosis/auth-probe.py |
        Set-Content -Encoding UTF8 (Join-Path $directory 'auth-profile.json')
    if ($LASTEXITCODE -ne 0) { throw 'Auth probe failed' }
} finally {
    & ./tools/retire-publication-project.ps1 -Project $project -ReportDirectory "data/reports/t23a/$project"
}
