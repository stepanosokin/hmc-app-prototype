$ErrorActionPreference='Stop'
Set-Location 'D:/OSOKIN/PROG/HydroMetCenter/hmc-app-prototype'
. ./publication/process.ps1
$project='hmc-publication-t5-t13-final1'
$directory=Join-Path (Get-Location) 'data/reports/t13/t5-launch1'
New-Item -ItemType Directory -Force $directory|Out-Null
foreach($kind in @('container','network','volume')){
    $arguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$project")
    if($kind -eq 'container'){$arguments+='--all'}
    $resources=@(& docker @arguments)
    if($LASTEXITCODE -ne 0 -or $resources.Count){throw 'T5 project already exists or Docker unavailable'}
}
try{
    Invoke-CheckedProcess -FilePath powershell -ArgumentList @('-NoProfile','-File','publication/run-revisions.ps1','-Project',$project,'-Port','8143') -ReportDirectory $directory -Name t5
}finally{
    & ./tools/retire-publication-project.ps1 -Project $project -ReportDirectory "data/reports/t5/$project"
}
