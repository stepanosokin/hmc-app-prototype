param(
    [Parameter(Mandatory=$true)][ValidatePattern('^hmc-publication-crs48-[a-z0-9-]+$')][string]$Project,
    [int]$Port=8181,[int]$ViewerPort=8180
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../publication/process.ps1')
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$directory=Join-Path (Get-Location) "data/reports/source-crs/$Project"
if(Test-Path -LiteralPath $directory){throw 'Use a fresh project/report directory'}
foreach($kind in @('container','network','volume')){
    $inventoryArguments=@($kind,'ls','--quiet','--filter',"label=com.docker.compose.project=$Project")
    if($kind -eq 'container'){$inventoryArguments+='--all'}
    $resources=@(& docker @inventoryArguments)
    if($LASTEXITCODE -ne 0 -or $resources.Count){throw 'Docker unavailable or project exists'}
}
foreach($testPort in @($Port,$ViewerPort)){$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$testPort);try{$listener.Start()}finally{$listener.Stop()}}
New-Item -ItemType Directory -Force "$directory/input" | Out-Null
Copy-Item data/grib/ICON_EU_T_G_2026101500.grib2 "$directory/input/"
$environment=Join-Path $directory 'environment.env'
$lines=@('GEOSERVER_ADMIN_USER=crsoperator',"T4_PORT=$Port","T13_PORT=$ViewerPort",'PUBLICATION_CLOCK=2026-10-19T05:00:00Z')
foreach($key in @('POSTGRES_PASSWORD','WORKER_PASSWORD','API_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_PASSWORD','GATEWAY_PASSWORD')){$lines+=$key+'='+[guid]::NewGuid().ToString('N')}
$lines | Set-Content -Encoding ascii $environment
$env:PUBLICATION_INPUT_DIR="$directory/input";$env:PUBLICATION_EVIDENCE_DIR=$directory;$env:PUBLICATION_IMAGE='hmc-publication:crs48'
$env:T4_PORT=[string]$Port;$env:T13_PORT=[string]$ViewerPort
$compose=@('compose','--env-file',$environment,'--project-name',$Project,'--file','compose.publication.yaml')
function Check{param([string]$Name,[string[]]$Arguments)
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+$Arguments) -ReportDirectory $directory -Name $Name}
Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/source-crs/inputs.mjs',$directory,'start') -ReportDirectory $directory -Name inputs-start
foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){Copy-Item (Join-Path docs/evidence/t4 $name) $directory}
Check services @('up','--detach','db','api','gateway','geoserver','viewer')
Check assets @('run','--rm','init-assets')
Check ready @('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')
Check migrate @('run','--rm','worker','once','--migrate')
Check legacy-submit @('run','--rm','worker','submit','--clock','2026-10-19T05:00:00Z','--hours','1')
Check legacy-process @('run','--rm','worker','once')
$old=(Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/catalogue").selections[0]
$query="selection=$($old.selection)&run=$($old.run)&revision=$($old.revision)&valid_time=$($old.valid_time)&layer=$($old.field)&lon=20&lat=50"
$before=Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/point?$query"
$old | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $directory 'legacy-selection.json')
Copy-Item data/grib/proj.txt "$directory/input/proj.txt"
& ./tools/reload-grib.ps1 -Project $Project -EnvironmentFile $environment -EvidenceDirectory $directory -InputDirectory "$directory/input" -Clock '2026-10-19T05:00:00Z'
$after=Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/point?$query"
if($before.value -ne $after.value -or $before.crs -ne $after.crs -or $before.cell.row -ne $after.cell.row -or $before.cell.column -ne $after.cell.column){throw 'Legacy publication changed'}
@{status='passed';old_selection=$old.selection;old_crs=$after.crs;old_value=$after.value;project=$Project;gateway="http://127.0.0.1:$Port";viewer="http://127.0.0.1:$ViewerPort"} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $directory 'retained-legacy.json')
Invoke-CheckedProcess -FilePath node -ArgumentList @('tools/source-crs/inputs.mjs',$directory,'end') -ReportDirectory $directory -Name inputs-end
Write-Output "Source CRS service checks passed: $directory"
