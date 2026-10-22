param(
    [ValidatePattern('^hmc-publication-t12-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t12-check',
    [int]$Port = 8112,
    [ValidateSet('Prepare','Complete')][string]$Phase = 'Prepare',
    [switch]$Development,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$directory = Join-Path (Get-Location) "data/reports/t12/$Project"
$environmentFile = Join-Path $directory 'environment.env'
$secretDirectory = Join-Path (Get-Location) ".scratch/hmc-meteo/$Project"
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = 'hmc-publication:t12'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t12/' + $Project
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$env:T6_TEST_FAULTS = '1'
$env:TILE_CACHE_BYTES = '665640'
$compose = @('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
function Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose + $Arguments) -ReportDirectory $directory -Name $Name
}
$ownsProject = $false
$retire = $false
$transcript = $false
try {
if ($Phase -eq 'Prepare') {
    $sample = 'data/grib/ICON_EU_T_G_2026101500.grib2'
    if (-not (Test-Path -LiteralPath $sample) -or
        (Get-FileHash -Algorithm SHA256 -LiteralPath $sample).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') {
        throw 'Required actual sample is unavailable or changed'
    }
    $m1Directory = Join-Path (Get-Location) 'docs/evidence/t3'
    $m1Index = Get-Content -Raw -Encoding UTF8 (Join-Path $m1Directory 'artifact-index.json') | ConvertFrom-Json
    foreach ($artifact in $m1Index.artifacts) {
        $path = Join-Path $m1Directory $artifact.name
        if ((Get-Item -LiteralPath $path).Length -ne $artifact.bytes -or
            (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -ne $artifact.sha256) {
            throw 'M1 comparison evidence changed'
        }
    }
    $m1Summary = Get-Content -Raw -Encoding UTF8 (Join-Path $m1Directory 'summary.json') | ConvertFrom-Json
    $decision = 'docs/adr/0001-numerical-http-adapter.md'
    if ($m1Summary.status -ne 'passed' -or
        @($m1Summary.repetitions | Where-Object { $_.candidate -eq 'narrow' -and $_.status -eq 'passed' }).Count -ne 3 -or
        @($m1Summary.repetitions | Where-Object { $_.candidate -eq 'pygeoapi' -and $_.status -eq 'passed' }).Count -ne 3 -or
        (Get-Content -Raw -Encoding UTF8 $decision) -notmatch 'select the narrow HTTP adapter') {
        throw 'M3 requires equivalent-adapter comparison and explicit M1 selection'
    }
    foreach ($kind in @('container','volume','network')) {
        $arguments = @($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
        if ($kind -eq 'container') { $arguments += '--all' }
        $resources = @(& docker @arguments)
        if ($LASTEXITCODE -ne 0) { throw 'Docker unavailable' }
        if ($resources.Count) { throw 'Use a fresh project with no existing resources' }
    }
    if (Test-Path -LiteralPath $directory) { throw 'Use a fresh report directory' }
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } finally { $listener.Stop() }
    New-Item -ItemType Directory -Force $directory,$secretDirectory | Out-Null
    $ownsProject = $true
    Start-Transcript -Path (Join-Path $directory 'console-prepare.log') | Out-Null
    $transcript = $true
    @{project=$Project;port=$Port;development=[bool]$Development;tile_cache_bytes=[int]$env:TILE_CACHE_BYTES} | ConvertTo-Json |
        Set-Content -Encoding ascii (Join-Path $directory 'run-state.json')
    @{status='verified';adapter='narrow HTTP over shared manifest-backed Zarr sampler';
      summary_sha256=(Get-FileHash (Join-Path $m1Directory 'summary.json')).Hash;
      comparison_index_sha256=(Get-FileHash (Join-Path $m1Directory 'artifact-index.json')).Hash;
      decision=$decision;decision_sha256=(Get-FileHash $decision).Hash;
      scope='Historical M1 point/metadata comparison; no browser/GPU claim'} | ConvertTo-Json |
        Set-Content -Encoding ascii (Join-Path $directory 'm1-reference.json')
    $lines = @('GEOSERVER_ADMIN_USER=t11operator')
    foreach ($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
        $lines += $name + '=' + [guid]::NewGuid().ToString('N')
    }
    $lines | Set-Content -Encoding ascii -LiteralPath $environmentFile
    foreach ($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
        Copy-Item -LiteralPath (Join-Path 'docs/evidence/t4' $name) -Destination $directory
    }
    if (-not $SkipBuild) { Check build @('build','worker') }
    Check types @('run','--rm','typecheck')
    Check inputs-start @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',(& git rev-parse HEAD).Trim(),'--clock',$env:PUBLICATION_CLOCK)
    Copy-Item (Join-Path $directory 'inputs.json') (Join-Path $directory 'inputs-start.json')
    Check services @('up','--detach','db','api','gateway','geoserver')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    Check access-migrate @('run','--rm','--entrypoint','python','worker','-m','publication.access','migrate')
    Check seed-submit @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours','1')
    Check seed-publish @('run','--rm','worker','once')
    Check sanitized-service-failure @('run','--rm','--env','T4_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_http.py','-k','sanitized_service_failure','-v')
    if ($Development) {
        Check submit @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours','1,3')
        Check publish @('run','--rm','worker','once')
    } else {
        Check t5 @('run','--rm','--env','T5_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_revisions.py','-v')
    }
    Check integrated @('run','--rm','--env','T12_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_integrated.py','-v')
    Check budgets @('run','--rm','--env','T9_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_budgets.py','-v')
    Check wms @('run','--rm','--env','T11_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_qgis.py','-v')
    Check access-regression @('run','--rm','--env','T8_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','policies','-v')
    Check desktop-key @('run','--rm','--volume',"${secretDirectory}:/secrets",'--entrypoint','python','worker',
        '-m','publication.access','create','--organization','t12-desktop','--profile','all','--out','/secrets/key')
    @{base="http://127.0.0.1:$Port"; key_file=(Join-Path $secretDirectory 'key'); report_directory=$directory} |
        ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $secretDirectory 'desktop.json')
    Write-Output "Desktop gate pending. Run publication/qgis_desktop.py in QGIS with config: $secretDirectory/desktop.json"
} else {
    $state = Get-Content -Raw (Join-Path $directory 'run-state.json') | ConvertFrom-Json
    if ($state.project -ne $Project -or $state.port -ne $Port -or $state.development -ne [bool]$Development -or
        $state.tile_cache_bytes -ne [int]$env:TILE_CACHE_BYTES) {
        throw 'Complete must use the original project, port, mode and cache budget'
    }
    $ownsProject = $true
    Start-Transcript -Path (Join-Path $directory 'console-complete.log') | Out-Null
    $transcript = $true
    $desktop = Get-Content -Raw -Encoding UTF8 (Join-Path $directory 't11-desktop.json') | ConvertFrom-Json
    if ($desktop.status -ne 'passed' -or $desktop.qgis_version -ne '3.44.11-Solothurn') { throw 'Desktop gate has not passed on pinned QGIS' }
    if ($desktop.input_inventory_sha256 -ne (Get-FileHash -Algorithm SHA256 (Join-Path $directory 'inputs-start.json')).Hash) {
        throw 'Desktop evidence belongs to different validated inputs'
    }
    $http = Get-Content -Raw -Encoding UTF8 (Join-Path $directory 't11-http.json') | ConvertFrom-Json
    if ($desktop.selected.selection -ne $http.selection.selection) { throw 'Desktop evidence belongs to another selection' }
    Check access-upgrade @('exec','--no-TTY','db','sh','/docker-entrypoint-initdb.d/020-access.sh')
    Check access-remigrate @('run','--rm','--entrypoint','python','worker','-m','publication.access','migrate')
    Invoke-CheckedProcess -FilePath docker -ArgumentList @('run','--rm','--network',"${Project}_edge",'--entrypoint','python',
        'hmc-publication:t12','-m','publication.verify_access','--edge-only') -ReportDirectory $directory -Name edge-isolation
    $containerIds = @(& docker ps --all --quiet --filter "label=com.docker.compose.project=$Project")
    if ($LASTEXITCODE -ne 0 -or -not $containerIds.Count) { throw 'Cannot inventory services' }
    $containers = & docker inspect @containerIds | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect services' }
    $inventory = @($containers | ForEach-Object {
        @{name=$_.Name; image=$_.Image; ports=$_.HostConfig.PortBindings;
          networks=@($_.NetworkSettings.Networks.PSObject.Properties.Name)}
    })
    foreach ($container in $inventory) {
        if ($container.name -notmatch '-gateway-1$' -and $null -ne $container.ports -and @($container.ports.PSObject.Properties).Count) {
            throw 'Backend publishes a host port'
        }
    }
    $inventory | ConvertTo-Json -Depth 10 | Set-Content -Encoding ascii (Join-Path $directory 'service-isolation.json')
    Check stop-store @('stop','db')
    try { Check store-failure @('run','--rm','--entrypoint','python','check','-m','publication.verify_access') }
    finally { Check start-store @('start','db') }
    Check restart @('restart','api','gateway','geoserver')
    Check restart-readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    if (-not $Development) {
        Check t5-restart @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions')
    }
    Check wms-restart @('run','--rm','--env','T11_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_qgis.py','-v')
    Check access-restart @('run','--rm','--env','T8_HTTP=1','--env','T8_RESTART=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','restart','-v')
    Check full-suite @('run','--rm','--env','T4_HTTP=1','check')
    Check runtime @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
    Check service-logs @('logs','--no-color','api','gateway','geoserver','db') | Out-Null
    $base = (Get-Content -Raw (Join-Path $directory 'inputs-start.json') | ConvertFrom-Json).base_commit
    Check inputs-end @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$base,'--clock',$env:PUBLICATION_CLOCK)
    if ((Get-FileHash (Join-Path $directory 'inputs-start.json')).Hash -ne (Get-FileHash (Join-Path $directory 'inputs.json')).Hash) {
        throw 'Validated inputs changed; archive as development and rerun in a fresh project'
    }
    @{status='passed';development=[bool]$Development;m3_passed=(-not [bool]$Development);
      tile_cache_bytes=[int]$env:TILE_CACHE_BYTES;scope='M3 protected service integration; browser A2/A3/A8 deferred'} | ConvertTo-Json |
        Set-Content -Encoding ascii (Join-Path $directory 'gate.json')
    $retire = $true
    Write-Output 'T12 integrated service and desktop checks passed.'
}
} catch {
    $originalFailure = $_
    if ($ownsProject) {
        @{status='failed';error=$_.Exception.Message} | ConvertTo-Json |
            Set-Content -Encoding ascii (Join-Path $directory 'gate.json')
        try { Check failure-service-logs @('logs','--no-color','api','gateway','geoserver','db') | Out-Null }
        catch { Write-Warning 'Cannot collect service logs; preserving original failure.' }
        $retire = $true
    }
    throw $originalFailure
} finally {
    if ($transcript) { Stop-Transcript | Out-Null }
    if ($retire) {
        & (Join-Path (Get-Location) 'tools/retire-publication-project.ps1') -Project $Project -ReportDirectory "data/reports/t12/$Project"
        if (Test-Path -LiteralPath (Join-Path $secretDirectory 'key')) {
            Remove-Item -LiteralPath (Join-Path $secretDirectory 'key')
        }
    }
}
