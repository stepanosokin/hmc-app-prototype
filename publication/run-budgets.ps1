param(
    [ValidatePattern('^hmc-publication-t9-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t9-check',
    [int]$Port = 8100,
    [switch]$Development,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
# Verify private prerequisites before allocating resources or pulling images.
$t9Sample = 'data/grib/ICON_EU_T_G_2026101500.grib2'
if (-not (Test-Path -LiteralPath $t9Sample -PathType Leaf) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $t9Sample).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') {
    throw 'Required actual sample is missing or has an unexpected checksum'
}
$t9Volumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --quiet)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable' }
if ($t9Volumes.Count) { throw 'Use a fresh project with no existing volumes' }
$t9Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $t9Listener.Start() } finally { $t9Listener.Stop() }
$t9Directory = Join-Path (Get-Location) "data/reports/t9/$Project"
if (Test-Path -LiteralPath $t9Directory) { throw 'Use a fresh report directory' }
New-Item -ItemType Directory -Force $t9Directory | Out-Null
$t9Environment = Join-Path $t9Directory 'environment.env'
$t9Lines = @('GEOSERVER_ADMIN_USER=t9operator')
foreach ($t9Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $t9Lines += $t9Key + '=' + [guid]::NewGuid().ToString('N')
}
$t9Lines | Set-Content -Encoding ascii -LiteralPath $t9Environment
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = 'hmc-publication:t9'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t9/' + $Project
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$env:T6_TEST_FAULTS = '1'
$env:TILE_CACHE_BYTES = '665640'
$t9Compose = @('compose','--env-file',$t9Environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Invoke-T9Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t9Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Invoke-T9Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($t9Compose + $Arguments) -ReportDirectory $t9Directory -Name $Name
}
Start-Transcript -Path (Join-Path $t9Directory 'console.log') | Out-Null
try {
    foreach ($t9Evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
        Copy-Item -LiteralPath (Join-Path 'tests/fixtures/publication/tile-engine' $t9Evidence) -Destination $t9Directory
    }
    if (-not $SkipBuild) { Invoke-T9Check -Name build -Arguments @('build','worker') }
    Invoke-T9Check -Name types -Arguments @('run','--rm','typecheck')
    Invoke-T9Check -Name boundary -Arguments @('run','--rm','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_access.py','-v')
    Invoke-T9Check -Name runtime -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
    $t9Base = (& git rev-parse HEAD).Trim()
    Invoke-T9Check -Name inputs-start -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t9Base,'--clock',$env:PUBLICATION_CLOCK)
    Copy-Item -LiteralPath (Join-Path $t9Directory 'inputs.json') -Destination (Join-Path $t9Directory 'inputs-start.json')
    Invoke-T9Compose up --detach db api gateway geoserver
    Invoke-T9Compose run --rm init-assets
    Invoke-T9Check -Name readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Invoke-T9Check -Name migrate -Arguments @('run','--rm','worker','once')
    Invoke-T9Check -Name access-migrate -Arguments @('run','--rm','--entrypoint','python','worker','-m','publication.access','migrate')
    Invoke-T9Compose run --rm worker submit --clock 2026-10-19T05:00:00Z --hours 1
    Invoke-T9Check -Name initial-publication -Arguments @('run','--rm','worker','once')
    # Existing public error contract first, before expensive final acceptance.
    Invoke-T9Check -Name sanitized-service-failure -Arguments @('run','--rm','--env','T4_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_http.py','-k','sanitized_service_failure','-v')
    if (-not $Development) {
        Invoke-T9Check -Name t5-regression -Arguments @('run','--rm','--env','T5_HTTP=1','--entrypoint','python','check',
            '-m','unittest','discover','-s','tests','-p','test_publication_revisions.py','-v')
        Invoke-T9Compose run --rm worker submit --clock 2026-10-19T06:00:00Z --legacy-one-time
        Invoke-T9Check -Name legacy-publication -Arguments @('run','--rm','worker','once')
    }
    Invoke-T9Check -Name budgets-acceptance -Arguments @('run','--rm','--env','T9_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_budgets.py','-v')
    Invoke-T9Check -Name access-acceptance -Arguments @('run','--rm','--env','T8_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','policies','-v')
    # Exercise the documented existing-volume command, outside entrypoint's
    # inherited environment; repeated schema provisioning preserves live keys.
    Invoke-T9Check -Name access-upgrade -Arguments @('exec','--no-TTY','db','sh','/docker-entrypoint-initdb.d/020-access.sh')
    Invoke-T9Check -Name access-remigrate -Arguments @('run','--rm','--entrypoint','python','worker','-m','publication.access','migrate')
    # A container on the external network can reach only the gateway.
    Invoke-CheckedProcess -FilePath docker -ArgumentList @('run','--rm','--network',"${Project}_edge",'--entrypoint','python',
        'hmc-publication:t9','-m','publication.verify_access','--edge-only') -ReportDirectory $t9Directory -Name edge-isolation
    $t9Containers = @(& docker ps --all --quiet --filter "label=com.docker.compose.project=$Project")
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inventory containers' }
    $t9Inspected = & docker inspect @t9Containers | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect service isolation' }
    $t9Inventory = @($t9Inspected | ForEach-Object {
        @{name=$_.Name; image=$_.Image; ports=$_.HostConfig.PortBindings; networks=@($_.NetworkSettings.Networks.PSObject.Properties.Name)}
    })
    foreach ($t9Container in $t9Inventory) {
        if ($t9Container.name -notmatch '-gateway-1$' -and $null -ne $t9Container.ports -and @($t9Container.ports.PSObject.Properties).Count) {
            throw 'Backend publishes a host port'
        }
    }
    $t9Inventory | ConvertTo-Json -Depth 10 | Set-Content -Encoding ascii (Join-Path $t9Directory 'service-isolation.json')
    Invoke-T9Compose stop db
    Invoke-T9Check -Name auth-store-failure -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_access')
    Invoke-T9Compose start db
    Invoke-T9Compose restart api gateway geoserver
    Invoke-T9Check -Name restart-readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    if (-not $Development) {
        Invoke-T9Check -Name t5-restart -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions')
        Invoke-T9Check -Name full-suite -Arguments @('run','--rm','--env','T4_HTTP=1','check')
    }
    Invoke-T9Check -Name service-logs -Arguments @('logs','--no-color','db','api','gateway','geoserver') | Out-Null
    Invoke-T9Check -Name access-restart -Arguments @('run','--rm','--env','T8_HTTP=1','--env','T8_RESTART=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','restart','-v')
    Invoke-T9Check -Name inputs-end -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t9Base,'--clock',$env:PUBLICATION_CLOCK)
    if ((Get-FileHash -Algorithm SHA256 (Join-Path $t9Directory 'inputs-start.json')).Hash -ne
        (Get-FileHash -Algorithm SHA256 (Join-Path $t9Directory 'inputs.json')).Hash) { throw 'Validation inputs changed' }
    @{status='passed';development=[bool]$Development;scope='T9 request budgets and accounting; no desktop QGIS or capacity claim'} |
        ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $t9Directory 'gate.json')
} catch {
    $t9Failure = $_
    @{status='failed';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $t9Directory 'gate.json')
    try {
        Invoke-T9Check -Name failure-service-logs -Arguments @('logs','--no-color','db','api','gateway','geoserver') | Out-Null
    } catch {
        Write-Warning 'Service logs unavailable; original validation failure is preserved.'
    }
    throw $t9Failure
} finally {
    Stop-Transcript | Out-Null
    & (Join-Path (Get-Location) 'tools/retire-publication-project.ps1') -Project $Project
}
