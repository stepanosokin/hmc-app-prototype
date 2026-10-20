$ErrorActionPreference = 'Stop'
Set-Location 'D:/OSOKIN/PROG/HydroMetCenter/hmc-app-prototype'
. ./publication/process.ps1
$project = 'hmc-publication-t6-t23a-final1'
$directory = "data/reports/t6/$project"
$capture = 'data/reports/t23a/t6-final-wrapper'
New-Item -ItemType Directory -Force $capture | Out-Null
if ((Get-FileHash data/grib/ICON_EU_T_G_2026101500.grib2 -Algorithm SHA256).Hash -ne 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a') { throw 'Source checksum mismatch' }
try {
    Invoke-CheckedProcess -FilePath powershell -ArgumentList @('-NoProfile','-File','publication/run-recovery.ps1','-Project',$project,'-Port','8141','-SkipBuild') -ReportDirectory $capture -Name t6
    @{status='passed';development=$false;native_exit_code=0;command='publication/run-recovery.ps1 -Project hmc-publication-t6-t23a-final1 -Port 8141 -SkipBuild'} | ConvertTo-Json | Set-Content -Encoding ascii "$directory/gate.json"
} catch {
    if (Test-Path -LiteralPath "$directory/environment.env") {
        & docker compose --env-file "$directory/environment.env" --project-name $project --file compose.publication.yaml logs --no-color --timestamps | Set-Content "$directory/failure-services.log"
    }
    throw
} finally {
    if (Test-Path -LiteralPath $directory) {
        Copy-Item "$capture/*" -Destination $directory
        & ./tools/retire-publication-project.ps1 -Project $project -ReportDirectory $directory
    }
}
