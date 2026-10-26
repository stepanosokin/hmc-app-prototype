param(
    [ValidatePattern('^hmc-publication-t8-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t8-check',
    [int]$Port = 8100,
    [switch]$Development,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
# Verify private prerequisites before allocating resources or pulling images.
$t8Sample = 'data/grib/ICON_EU_T_G_2026101500.grib2'
if (-not (Test-Path -LiteralPath $t8Sample -PathType Leaf) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $t8Sample).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') {
    throw 'Required actual sample is missing or has an unexpected checksum'
}
$t8Volumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --quiet)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable' }
if ($t8Volumes.Count) { throw 'Use a fresh project with no existing volumes' }
$t8Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $t8Listener.Start() } finally { $t8Listener.Stop() }
$t8Directory = Join-Path (Get-Location) "data/reports/t8/$Project"
if (Test-Path -LiteralPath $t8Directory) { throw 'Use a fresh report directory' }
New-Item -ItemType Directory -Force $t8Directory | Out-Null
$t8Environment = Join-Path $t8Directory 'environment.env'
$t8Lines = @('GEOSERVER_ADMIN_USER=t8operator')
foreach ($t8Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $t8Lines += $t8Key + '=' + [guid]::NewGuid().ToString('N')
}
$t8Lines | Set-Content -Encoding ascii -LiteralPath $t8Environment
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = 'hmc-publication:t8'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t8/' + $Project
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$env:T6_TEST_FAULTS = '1'
$t8Compose = @('compose','--env-file',$t8Environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Invoke-T8Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t8Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Invoke-T8Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($t8Compose + $Arguments) -ReportDirectory $t8Directory -Name $Name
}
Start-Transcript -Path (Join-Path $t8Directory 'console.log') | Out-Null
try {
    foreach ($t8Evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
        Copy-Item -LiteralPath (Join-Path 'tests/fixtures/publication/tile-engine' $t8Evidence) -Destination $t8Directory
    }
    if (-not $SkipBuild) { Invoke-T8Check -Name build -Arguments @('build','worker') }
    Invoke-T8Check -Name types -Arguments @('run','--rm','typecheck')
    Invoke-T8Check -Name boundary -Arguments @('run','--rm','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_publication_access.py','-v')
    Invoke-T8Check -Name runtime -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
    $t8Base = (& git rev-parse HEAD).Trim()
    Invoke-T8Check -Name inputs-start -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t8Base,'--clock',$env:PUBLICATION_CLOCK)
    Copy-Item -LiteralPath (Join-Path $t8Directory 'inputs.json') -Destination (Join-Path $t8Directory 'inputs-start.json')
    Invoke-T8Compose up --detach db api gateway geoserver
    Invoke-T8Compose run --rm init-assets
    Invoke-T8Check -Name readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Invoke-T8Check -Name migrate -Arguments @('run','--rm','worker','once')
    Invoke-T8Check -Name access-migrate -Arguments @('run','--rm','--entrypoint','python','worker','-m','publication.access','migrate')
    Invoke-T8Compose run --rm worker submit --clock 2026-10-19T05:00:00Z --hours 1
    Invoke-T8Check -Name initial-publication -Arguments @('run','--rm','worker','once')
    # Existing public error contract first, before expensive final acceptance.
    Invoke-T8Check -Name sanitized-service-failure -Arguments @('run','--rm','--env','T4_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_http.py','-k','sanitized_service_failure','-v')
    if (-not $Development) {
        Invoke-T8Check -Name t5-regression -Arguments @('run','--rm','--env','T5_HTTP=1','--entrypoint','python','check',
            '-m','unittest','discover','-s','tests','-p','test_publication_revisions.py','-v')
        Invoke-T8Compose run --rm worker submit --clock 2026-10-19T06:00:00Z --legacy-one-time
        Invoke-T8Check -Name legacy-publication -Arguments @('run','--rm','worker','once')
    }
    Invoke-T8Check -Name access-acceptance -Arguments @('run','--rm','--env','T8_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','policies','-v')
    # Exercise the documented existing-volume command, outside entrypoint's
    # inherited environment; repeated schema provisioning preserves live keys.
    Invoke-T8Check -Name access-upgrade -Arguments @('exec','--no-TTY','db','sh','/docker-entrypoint-initdb.d/020-access.sh')
    Invoke-T8Check -Name access-remigrate -Arguments @('run','--rm','--entrypoint','python','worker','-m','publication.access','migrate')
    # A container on the external network can reach only the gateway.
    Invoke-CheckedProcess -FilePath docker -ArgumentList @('run','--rm','--network',"${Project}_edge",'--entrypoint','python',
        'hmc-publication:t8','-m','publication.verify_access','--edge-only') -ReportDirectory $t8Directory -Name edge-isolation
    $t8Containers = @(& docker ps --all --quiet --filter "label=com.docker.compose.project=$Project")
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inventory containers' }
    $t8Inspected = & docker inspect @t8Containers | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect service isolation' }
    $t8Inventory = @($t8Inspected | ForEach-Object {
        @{name=$_.Name; image=$_.Image; ports=$_.HostConfig.PortBindings; networks=@($_.NetworkSettings.Networks.PSObject.Properties.Name)}
    })
    foreach ($t8Container in $t8Inventory) {
        if ($t8Container.name -notmatch '-gateway-1$' -and $null -ne $t8Container.ports -and @($t8Container.ports.PSObject.Properties).Count) {
            throw 'Backend publishes a host port'
        }
    }
    $t8Inventory | ConvertTo-Json -Depth 10 | Set-Content -Encoding ascii (Join-Path $t8Directory 'service-isolation.json')
    Invoke-T8Compose stop db
    Invoke-T8Check -Name auth-store-failure -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_access')
    Invoke-T8Compose start db
    Invoke-T8Compose restart api gateway geoserver
    Invoke-T8Check -Name restart-readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    if (-not $Development) {
        Invoke-T8Check -Name t5-restart -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions')
        Invoke-T8Check -Name full-suite -Arguments @('run','--rm','--env','T4_HTTP=1','check')
    }
    Invoke-T8Check -Name service-logs -Arguments @('logs','--no-color','db','api','gateway','geoserver')
    Invoke-T8Check -Name access-restart -Arguments @('run','--rm','--env','T8_HTTP=1','--env','T8_RESTART=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_access.py','-k','restart','-v')
    Invoke-T8Check -Name inputs-end -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t8Base,'--clock',$env:PUBLICATION_CLOCK)
    if ((Get-FileHash -Algorithm SHA256 (Join-Path $t8Directory 'inputs-start.json')).Hash -ne
        (Get-FileHash -Algorithm SHA256 (Join-Path $t8Directory 'inputs.json')).Hash) { throw 'Validation inputs changed' }
    @{status='passed';development=[bool]$Development;scope='T8 organization access; partial A7; no desktop QGIS or capacity claim'} |
        ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $t8Directory 'gate.json')
} catch {
    @{status='failed';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $t8Directory 'gate.json')
    throw
} finally {
    Stop-Transcript | Out-Null
    & (Join-Path (Get-Location) 'tools/retire-publication-project.ps1') -Project $Project
}
