$ErrorActionPreference='Stop'
Set-Location 'D:/OSOKIN/PROG/HydroMetCenter/hmc-app-prototype'
. ./publication/process.ps1
$project='hmc-publication-t23a-evidence2'
$directory="data/reports/t23a/$project"
if(Test-Path -LiteralPath $directory){throw 'Use fresh evidence report directory'}
New-Item -ItemType Directory $directory | Out-Null
try {
    Invoke-CheckedProcess -FilePath docker -ArgumentList @('run','--rm','--network','none','--label',"com.docker.compose.project=$project",'--volume',"${PWD}:/workspace:ro",'--volume',"${PWD}/${directory}:/evidence",'--entrypoint','python','hmc-publication:t12','/workspace/.scratch/hmc-meteo/t23a-negatives.py') -ReportDirectory $directory -Name evidence-positive-negative
} finally {
    & ./tools/retire-publication-project.ps1 -Project $project -ReportDirectory $directory
}
