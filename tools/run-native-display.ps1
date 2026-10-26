param(
    [ValidatePattern('^hmc-publication-t23a-[a-z0-9-]+$')][string]$Project = 'hmc-publication-t23a-probe1',
    [int]$Port = 8137,
    [string]$Image = 'hmc-publication:t12',
    [switch]$WithEdge,
    [switch]$Interaction,
    [switch]$EnforceBudgets,
    [switch]$ProfileServices,
    [string]$MobileHost
)
$ErrorActionPreference = 'Stop'
if ($env:T23_ANDROID_SERIAL -and ($WithEdge -or $MobileHost)) { throw 'Use separate Android, desktop and LAN attempts' }
. (Join-Path $PSScriptRoot '../publication/process.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$directory = Join-Path (Get-Location) "data/reports/t23a/$Project"
$environmentFile = Join-Path $directory 'environment.env'
if (Test-Path -LiteralPath $directory) { throw 'Use a fresh project/report directory' }
$expected = 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a'
if ((Get-FileHash -Algorithm SHA256 'data/grib/ICON_EU_T_G_2026101500.grib2').Hash -ne $expected) { throw 'Actual sample checksum mismatch' }
foreach ($kind in @('container','network','volume')) {
    $arguments = @($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if ($kind -eq 'container') { $arguments += '--all' }
    $resources = @(& docker @arguments)
    if ($LASTEXITCODE -ne 0 -or $resources.Count) { throw 'Docker unavailable or project already exists' }
}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$Port)
try { $listener.Start() } finally { $listener.Stop() }
New-Item -ItemType Directory -Force $directory | Out-Null
$lines = @('GEOSERVER_ADMIN_USER=t23operator')
foreach ($name in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')) {
    $lines += $name + '=' + [guid]::NewGuid().ToString('N')
}
$lines | Set-Content -Encoding ascii $environmentFile
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = $Image
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t23a/' + $Project
$env:PUBLICATION_CLOCK = '2026-10-19T05:00:00Z'
$env:T6_TEST_FAULTS = '1'
$env:TILE_CACHE_BYTES = '16777216'
$compose = @('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
function Check {
    param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose + $Arguments) -ReportDirectory $directory -Name $Name
}
function InputSnapshot {
    param([switch]$PathsOnly)
    $files = @(Get-ChildItem decoder,publication,tests,trials,tools,config -File -Recurse |
        Where-Object { $_.Extension -in @('.py','.ps1','.json','.sql','.sh','.sld','.js','.mjs','.html') })
    $files += @(Get-ChildItem -File | Where-Object { $_.Name.StartsWith('Dockerfile') -or $_.Name.StartsWith('compose') -or $_.Name.StartsWith('requirements') })
    $files += @(Get-Item AGENTS.md,docs/development-workflow.md,.gitattributes,.github/workflows/checks.yml,docs/prototypes/assets/land.js)
    if ($PathsOnly) {
        return @($files | Sort-Object FullName | ForEach-Object {
            $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\','/')
        })
    }
    $changedInputs = @(& git ls-files --modified --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate changed inputs' }
    return @($files | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\','/')
        $working = & git hash-object --no-filters -- $relative
        if ($LASTEXITCODE -ne 0) { throw 'Cannot hash working input' }
        if ($relative -in $changedInputs) {
            $stored = & git hash-object "--path=$relative" -- $relative
            if ($LASTEXITCODE -ne 0 -or $working -ne $stored) { throw "Resolve Git filters before probe: $relative" }
        }
        [ordered]@{path=$relative;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
    })
}
$script:t23ProfilesRecorded = $false
function Record-ServiceProfiles {
    if (-not $ProfileServices -or $script:t23ProfilesRecorded -or -not (Test-Path (Join-Path $directory 'native-reference.json'))) { return }
    $selection = (Get-Content -Raw -Encoding UTF8 (Join-Path $directory 'native-reference.json') | ConvertFrom-Json).selection.selection
    foreach ($service in @('api','gateway','transport')) {
        $container = if ($service -eq 'api') { 'api' } else { 'gateway' }
        Get-Content -Raw -Encoding UTF8 tools/diagnose-t23-service.py | & docker @compose exec -T $container python - $service $selection |
            Set-Content -Encoding UTF8 (Join-Path $directory "profile-$service.json")
        if ($LASTEXITCODE -ne 0) { throw "Profile $service failed" }
    }
    $script:t23ProfilesRecorded = $true
}
Start-Transcript -Path (Join-Path $directory 'console.log') | Out-Null
try {
    foreach ($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
        Copy-Item -LiteralPath (Join-Path 'tests/fixtures/publication/tile-engine' $name) -Destination $directory
    }
    $startInputs = InputSnapshot | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText((Join-Path $directory 'probe-inputs-start.json'),$startInputs)
    Check types @('run','--rm','typecheck')
    Check inputs @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '-m','publication.verify_recovery','--inputs','/workspace','--base-commit',(& git rev-parse HEAD).Trim())
    Check services @('up','--detach','db','api','gateway','geoserver')
    Check assets @('run','--rm','init-assets')
    Check readiness @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
    Check migrate @('run','--rm','worker','once','--migrate')
    Check seed @('run','--rm','worker','submit','--clock',$env:PUBLICATION_CLOCK,'--hours','1')
    Check publish @('run','--rm','worker','once')
    Check native-http @('run','--rm','--env','T23A_HTTP=1','--entrypoint','python','check','-m','unittest','discover','-s','tests','-p','test_native_display.py','-v')
    Check restart-api @('restart','api','gateway')
    Check native-reference @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '/workspace/tools/native-display/native_reference.py','prepare')
    $env:T23A_NATIVE = '1'
    $env:T23_INTERACTION = if ($Interaction) { '1' } else { '0' }
    $env:T23_MOBILE_HOST = $MobileHost
    $env:T23_REFERENCE = Join-Path $directory 'native-reference.json'
    $env:T23_REPORT_DIRECTORY = Join-Path $directory 'browser'
    $env:T23_GATEWAY = "http://127.0.0.1:$Port"
    Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-display-projections.mjs') -ReportDirectory $directory -Name native-browser
    Check native-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
        '/workspace/tools/native-display/native_reference.py','compare')
    if ($EnforceBudgets) {
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/native-display/budgets.mjs',(Join-Path $directory 'browser/browser.json')) -ReportDirectory $directory -Name native-budgets
    }
    if ($WithEdge) {
        $env:T23_CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
        if (-not (Test-Path -LiteralPath $env:T23_CHROME)) { throw 'Required Microsoft Edge is unavailable' }
        $env:T23_REPORT_DIRECTORY = Join-Path $directory 'browser-edge'
        Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/check-display-projections.mjs') -ReportDirectory $directory -Name native-edge
        Check native-edge-comparison @('run','--rm','--env','PYTHONPATH=/app','--volume',"$((Get-Location).Path):/workspace:ro",'--entrypoint','python','check',
            '/workspace/tools/native-display/native_reference.py','compare','browser-edge')
        if ($EnforceBudgets) {
            Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/native-display/budgets.mjs',(Join-Path $directory 'browser-edge/browser.json')) -ReportDirectory $directory -Name native-edge-budgets
        }
    }
    Record-ServiceProfiles
    Check native-usage @('run','--rm','--entrypoint','python','check','-m','publication.budgets','usage','--public','--limit','1000')
    $endInputs = InputSnapshot | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText((Join-Path $directory 'probe-inputs-end.json'),$endInputs)
    if ($startInputs -ne $endInputs) { throw 'Probe inputs changed during validation' }
} catch {
    $failure = $_
    try { Record-ServiceProfiles } catch { Write-Warning 'Additional service profile failed; original failure preserved' }
    try { Check service-logs @('logs','--no-color','--timestamps') } catch { Write-Warning 'Could not capture service logs' }
    throw $failure
} finally {
    Stop-Transcript | Out-Null
    & (Join-Path $PSScriptRoot 'retire-publication-project.ps1') -Project $Project -ReportDirectory "data/reports/t23a/$Project"
}
