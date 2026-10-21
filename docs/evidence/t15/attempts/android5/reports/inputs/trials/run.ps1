param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'

function Invoke-TrialCompose {
    & docker compose -f compose.adapters.yaml @args
    if ($LASTEXITCODE -ne 0) { throw "Trial Compose failed: $args" }
}

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    $reportsPath = Join-Path (Get-Location) 'data/reports/t3'
    New-Item -ItemType Directory -Path $reportsPath -Force | Out-Null
    if (-not $SkipBuild) { Invoke-TrialCompose build preflight }
    Invoke-TrialCompose run --rm preflight
    Invoke-TrialCompose run --rm fixture
    Invoke-TrialCompose up -d --wait narrow pygeoapi gateway
    foreach ($failureCandidate in @('narrow', 'pygeoapi')) {
        Invoke-TrialCompose stop $failureCandidate
        Invoke-TrialCompose run --rm validate --unavailable-candidate $failureCandidate
        Invoke-TrialCompose up -d --wait $failureCandidate
    }
    Invoke-TrialCompose run --rm validate
    $trialImage = (& docker image inspect hmc-adapters:t3 | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify trial image' }
    $hostInfo = & docker info --format '{{json .}}' | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Docker host' }
    $configJson = & docker compose -f compose.adapters.yaml config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot freeze Compose configuration' }
    [IO.File]::WriteAllText((Join-Path $reportsPath 'compose-config.json'), ($configJson -join "`n"))
    $hostRecord = @{
        recorded_at = [DateTime]::UtcNow.ToString('o')
        docker_host = $hostInfo.Name
        os = $hostInfo.OperatingSystem
        kernel = $hostInfo.KernelVersion
        architecture = $hostInfo.Architecture
        logical_cpus = $hostInfo.NCPU
        available_memory_bytes = $hostInfo.MemTotal
        engine = $hostInfo.ServerVersion
        storage_driver = $hostInfo.Driver
        image_id = $trialImage.Id
        image_rootfs_layers = $trialImage.RootFS.Layers
        processor = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
        workload = '1000 requests/repetition; seed 15; 40% domain point, 40% EDR position, 20% metadata; 50 warmups; concurrency 4; no response cache'
        cache_scope = 'process restarts; host page cache uncontrolled; no host caches dropped'
    }
    [IO.File]::WriteAllText((Join-Path $reportsPath 'host.json'), ($hostRecord | ConvertTo-Json -Depth 8))
    # Alternating order; only the measured candidate runs during its repetition.
    for ($repetition = 1; $repetition -le 3; $repetition++) {
        $order = if ($repetition % 2 -eq 1) { @('narrow', 'pygeoapi') } else { @('pygeoapi', 'narrow') }
        foreach ($candidate in $order) {
            Invoke-TrialCompose stop narrow pygeoapi
            $startup = [Diagnostics.Stopwatch]::StartNew()
            Invoke-TrialCompose up -d --force-recreate --wait $candidate gateway
            $startup.Stop()
            $startupSeconds = $startup.Elapsed.TotalSeconds.ToString('R', [Globalization.CultureInfo]::InvariantCulture)
            Invoke-TrialCompose run --rm -e "TRIAL_IMAGE_ID=$($trialImage.Id)" measure $candidate --repetition $repetition --startup-seconds $startupSeconds
        }
    }
    Invoke-TrialCompose up -d --wait narrow pygeoapi gateway
    Invoke-TrialCompose run --rm validate --include-storage
} finally {
    Pop-Location
}
