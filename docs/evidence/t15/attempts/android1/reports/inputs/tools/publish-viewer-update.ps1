param(
    [Parameter(Mandatory=$true)][ValidatePattern('^hmc-publication-t13-[a-z0-9-]+$')][string]$Project,
    [ValidateSet('correction','overlap','actual')][string]$Fixture='correction',
    [ValidateSet('publish','outage','recover')][string]$Operation='publish'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
$directory=Join-Path (Split-Path $PSScriptRoot -Parent) "data/reports/t13/$Project"
$environmentFile=Join-Path $directory 'environment.env'
if(-not (Test-Path -LiteralPath $environmentFile)){throw 'No owned test project environment'}
$compose=@('compose','--env-file',$environmentFile,'--project-name',$Project,'--file','compose.publication.yaml')
if($Operation -ne 'publish'){
    $action=if($Operation -eq 'outage'){'stop'}else{'start'}
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@($action,'api')) -ReportDirectory $directory -Name "update-$Operation"
    exit
}
foreach($phase in @('submit','once')){
    $arguments=$compose+@('run','--rm','worker',$phase)
    if($phase -eq 'submit'){
        $hours=if($Fixture -eq 'overlap'){'1,3'}else{'1,2,3'}
        $arguments+=@('--clock','2026-10-19T05:00:00Z','--hours',$hours,'--fixture',$Fixture)
    }
    Invoke-CheckedProcess -FilePath docker -ArgumentList $arguments -ReportDirectory $directory -Name "update-$Fixture-$phase"
}
