param(
    [ValidatePattern('^hmc-publication-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t7-check',
    [int]$Port = 8099,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$t7Volumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --quiet)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable' }
if ($t7Volumes.Count) { throw 'Use a fresh Compose project; existing volumes are preserved.' }
$t7Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $t7Listener.Start() } finally { $t7Listener.Stop() }
$t7Directory = Join-Path (Get-Location) "data/reports/t7/$Project"
if (Test-Path -LiteralPath $t7Directory) { throw 'Use a fresh project/report directory.' }
New-Item -ItemType Directory -Force $t7Directory | Out-Null
$t7Environment = Join-Path $t7Directory 'environment.env'
$t7Lines = @('GEOSERVER_ADMIN_USER=t7operator')
foreach ($t7Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $t7Lines += $t7Key + '=' + [guid]::NewGuid().ToString('N')
}
$t7Lines | Set-Content -Encoding ascii -LiteralPath $t7Environment
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = 'hmc-publication:t7'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t7/' + $Project
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$t7Compose = @('compose','--env-file',$t7Environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Invoke-T7Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t7Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Invoke-T7Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($t7Compose + $Arguments) -ReportDirectory $t7Directory -Name $Name
}
function Get-T7LegacyInventory {
    @{
        base_commit='8efe1fc5d48d172b775cd27642abe32964fd36bd'
        files=@(Get-ChildItem -LiteralPath (Join-Path $t7Directory 'legacy-source') -File -Recurse |
            Sort-Object FullName | ForEach-Object {
                @{path=$_.FullName.Substring($t7Directory.Length + 1);bytes=$_.Length;
                    sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash}
            })
    } | ConvertTo-Json -Depth 10 -Compress
}
try {
    foreach ($t7Evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
        Copy-Item -LiteralPath (Join-Path 'tests/fixtures/publication/tile-engine' $t7Evidence) -Destination $t7Directory
    }
    if (-not $SkipBuild) { Invoke-T7Compose build worker }
    Invoke-T7Check -Name runtime -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
    Invoke-T7Check -Name types -Arguments @('run','--rm','typecheck')
    Invoke-T7Check -Name boundaries -Arguments @('run','--rm','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_retention.py','-v')
    Invoke-T7Compose up --detach db api gateway geoserver
    Invoke-T7Compose run --rm init-assets
    Invoke-T7Check -Name readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Invoke-T7Check -Name migrate -Arguments @('run','--rm','worker','once')
    Invoke-T7Check -Name empty-report -Arguments @('run','--rm','--entrypoint','python','worker','-m','publication.retention','report')
    $t7Catalogue = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/catalogue"
    if ($t7Catalogue.selections.Count -ne 0) { throw 'Fresh project catalogue is not empty' }
    if (-not (Test-Path -LiteralPath 'data/grib/ICON_EU_T_G_2026101500.grib2' -PathType Leaf)) {
        throw 'Required private actual sample is missing: data/grib/ICON_EU_T_G_2026101500.grib2; actual-sample M2/A9 gate is blocked.'
    }
    $t7Legacy = Join-Path $t7Directory 'legacy-source'
    New-Item -ItemType Directory -Force $t7Legacy | Out-Null
    $t7Tar = Join-Path $t7Directory 'legacy-source.tar'
    & git archive --format=tar --output $t7Tar 8efe1fc5d48d172b775cd27642abe32964fd36bd publication
    if ($LASTEXITCODE -ne 0) { throw 'Could not capture frozen pre-T7 upgrade fixture from Git history' }
    & tar -xf $t7Tar -C $t7Legacy
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract frozen pre-T7 upgrade fixture' }
    $t7LegacyInputs = Get-T7LegacyInventory
    $t7LegacyInputs | Set-Content -Encoding ascii (Join-Path $t7Directory 'legacy-inputs.json')
    $t7Base = (& git rev-parse HEAD).Trim()
    Invoke-T7Check -Name inputs-start -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python',
        'check','-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t7Base)
    Copy-Item -LiteralPath (Join-Path $t7Directory 'inputs.json') -Destination (Join-Path $t7Directory 'inputs-start.json')
    Invoke-T7Check -Name acceptance -Arguments @('run','--rm','--env','T7_HTTP=1','--entrypoint','python','check',
        '-m','unittest','discover','-s','tests','-p','test_publication_retention.py','-v')
    Invoke-T7Compose restart db api gateway geoserver
    Invoke-T7Check -Name restart-readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Invoke-T7Check -Name restart-expiry -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_retention')
    Invoke-T7Check -Name inputs-end -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python',
        'check','-m','publication.verify_recovery','--inputs','/workspace','--base-commit',$t7Base)
    if ((Get-FileHash -Algorithm SHA256 (Join-Path $t7Directory 'inputs-start.json')).Hash -ne
        (Get-FileHash -Algorithm SHA256 (Join-Path $t7Directory 'inputs.json')).Hash) { throw 'Validation inputs changed during the run' }
    if ((Get-T7LegacyInventory) -ne $t7LegacyInputs) { throw 'Upgrade fixture inputs changed during the run' }
    @{status='passed';scope='T7 local actual-sample retention; M2 also requires current T5/T6 regressions'} |
        ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $t7Directory 'gate.json')
} catch {
    @{status='failed';error=$_.Exception.Message;scope='No M2/A9 completion claim'} |
        ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $t7Directory 'gate.json')
    throw
} finally {
    & (Join-Path (Get-Location) 'tools/retire-publication-project.ps1') -Project $Project
}
