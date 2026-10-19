param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Project = 'hmc-publication-t5-check',
    [int]$Port = 8098,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$t5ExistingVolumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --quiet)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable' }
if ($t5ExistingVolumes.Count -ne 0) { throw 'Use a fresh Compose project; existing volumes are preserved.' }
$t5Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $t5Listener.Start() } finally { $t5Listener.Stop() }
$t5Directory = Join-Path (Get-Location) "data/reports/t5/$Project"
if (Test-Path -LiteralPath $t5Directory) { throw 'Use a fresh project/report directory; previous evidence is retained.' }
New-Item -ItemType Directory -Force $t5Directory | Out-Null
$t5Environment = Join-Path $t5Directory 'environment.env'
$t5Lines = @('GEOSERVER_ADMIN_USER=t5operator')
foreach ($t5Key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD')) {
    $t5Lines += $t5Key + '=' + [guid]::NewGuid().ToString('N')
}
$t5Lines | Set-Content -Encoding ascii -LiteralPath $t5Environment
$env:T4_PORT = [string]$Port
$env:PUBLICATION_IMAGE = 'hmc-publication:t5'
$env:PUBLICATION_EVIDENCE_DIR = './data/reports/t5/' + $Project
$t5Compose = @('compose','--env-file',$t5Environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Invoke-T5Compose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ComposeArguments)
    & docker @t5Compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($ComposeArguments -join ' ')" }
}
function Invoke-T5Check {
    param([string]$Name,[string[]]$Arguments)
    $t5Stdout = Join-Path $t5Directory ($Name + '.stdout.log')
    $t5Stderr = Join-Path $t5Directory ($Name + '.stderr.log')
    # ArgumentList quotes paths containing spaces explicitly for Windows native launch.
    $t5NativeArguments = @($t5Compose + $Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    $t5Process = Start-Process -FilePath docker -WindowStyle Hidden -ArgumentList $t5NativeArguments `
        -Wait -PassThru -RedirectStandardOutput $t5Stdout -RedirectStandardError $t5Stderr
    Get-Content -LiteralPath $t5Stdout
    Get-Content -LiteralPath $t5Stderr
    @{check=$Name;native_exit_code=$t5Process.ExitCode} | ConvertTo-Json -Compress | Add-Content (Join-Path $t5Directory 'process-results.jsonl')
    if ($t5Process.ExitCode -ne 0) { throw "$Name failed with native exit $($t5Process.ExitCode)" }
}
# Reuse the exact immutable, successful T4 engine decision and its bound probes.
# No new encoding/CRS/dependency decision is made by T5.
foreach ($t5Evidence in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')) {
    Copy-Item -LiteralPath (Join-Path 'docs/evidence/t4' $t5Evidence) -Destination $t5Directory
}
if (-not $SkipBuild) { Invoke-T5Compose build worker }
Invoke-T5Check -Name runtime -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.runtime')
Invoke-T5Compose up --detach db api gateway geoserver
Invoke-T5Compose run --rm init-assets
Invoke-T5Check -Name readiness -Arguments @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
Invoke-T5Compose run --rm worker once --migrate
Invoke-T5Check -Name types -Arguments @('run','--rm','typecheck')
Invoke-T5Check -Name acceptance -Arguments @('run','--rm','--env','T5_HTTP=1','--entrypoint','python','check',
    '-m','unittest','discover','-s','tests','-p','test_publication_revisions.py','-v')
Invoke-T5Compose run --rm worker submit --clock 2026-10-19T06:00:00Z --legacy-one-time
Invoke-T5Check -Name legacy-publication -Arguments @('run','--rm','worker','once')
# Snapshot the public surface and verify restart keeps every immutable URL eligible.
$t5Before = (Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/catalogue").selections
$t5Before | ConvertTo-Json -Depth 10 | Set-Content -Encoding ascii (Join-Path $t5Directory 'catalogue.json')
Invoke-T5Compose restart db api geoserver
$t5Ready = $false
for ($t5Attempt=0; $t5Attempt -lt 90; $t5Attempt++) {
    try {
        $t5After = (Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/catalogue").selections
        if (($t5Before.selection -join ',') -ne ($t5After.selection -join ',')) { throw 'Restart changed catalogue' }
        $t5Ready = $true
        break
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $t5Ready) { throw 'Published catalogue did not recover after restart' }
Invoke-T5Check -Name retained-after-restart -Arguments @('run','--rm','--entrypoint','python','check',
    '-m','publication.verify_revisions')
Invoke-T5Check -Name full-suite -Arguments @('run','--rm','--env','T4_HTTP=1','check')
Invoke-T5Check -Name archived-evidence -Arguments @('run','--rm','--volume',"$((Get-Location).Path):/workspace:ro",'--workdir','/workspace',
    '--entrypoint','python','check','tools/check_evidence.py')
Write-Output "T5 checks passed. Gateway: http://127.0.0.1:$Port ; evidence: $t5Directory"
