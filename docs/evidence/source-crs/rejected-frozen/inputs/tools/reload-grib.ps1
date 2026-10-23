param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Project,
    [Parameter(Mandatory=$true)][string]$EnvironmentFile,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [Parameter(Mandatory=$true)][string]$Clock,
    [string]$InputDirectory='data/grib',
    [string]$Image='hmc-publication:crs48'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../publication/process.ps1')
if($Clock -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'){throw 'Требуется явное время UTC с суффиксом Z.'}
$inputPath=(Resolve-Path -LiteralPath $InputDirectory).Path
$environmentPath=(Resolve-Path -LiteralPath $EnvironmentFile).Path
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$evidencePath=(Resolve-Path -LiteralPath $EvidenceDirectory).Path
$sources=@(Get-ChildItem -LiteralPath $inputPath -File | Where-Object {$_.Extension.ToLowerInvariant() -in '.grib','.grib2','.grb','.grb2'} | Sort-Object Name)
if(-not $sources.Count){throw 'В исходной папке нет GRIB.'}
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfff')
$inventory=@($sources | ForEach-Object {@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
$inventory | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $evidencePath "reload-$stamp-inputs.json")
$previous=@{}
foreach($name in @('PUBLICATION_INPUT_DIR','PUBLICATION_EVIDENCE_DIR','PUBLICATION_IMAGE')){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
    $env:PUBLICATION_INPUT_DIR=$inputPath;$env:PUBLICATION_EVIDENCE_DIR=$evidencePath;$env:PUBLICATION_IMAGE=$Image
    $compose=@('compose','--env-file',$environmentPath,'--project-name',$Project,'--file','compose.publication.yaml')
    # Services keep their existing volumes; reader processes must use the new image/code.
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('up','--detach','db','api','gateway','geoserver','viewer')) -ReportDirectory $evidencePath -Name "reload-$stamp-services"
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('run','--rm','--entrypoint','python','check','-m','publication.verify_revisions','--ready-only')) -ReportDirectory $evidencePath -Name "reload-$stamp-ready"
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('run','--rm','worker','once','--migrate')) -ReportDirectory $evidencePath -Name "reload-$stamp-migrate"
    $jobs=@()
    for($i=0;$i -lt $sources.Count;$i++){
        $entry=$inventory[$i]
        $name="reload-$stamp-$i-submit"
        Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('run','--rm','worker','submit','--recoverable','--clock',$Clock,'--source-name',$entry.name,'--delivery-sha256',$entry.sha256)) -ReportDirectory $evidencePath -Name $name
        $job=([IO.File]::ReadAllText((Join-Path $evidencePath "$name.stdout.log"))).Trim()
        if($job -notmatch '^[0-9a-f-]{36}$'){throw 'Обработчик не вернул идентификатор задания.'}
        Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('run','--rm','worker','once')) -ReportDirectory $evidencePath -Name "reload-$stamp-$i-process"
        $jobs+=@{source=$entry;job=$job}
    }
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('restart','api','gateway','viewer')) -ReportDirectory $evidencePath -Name "reload-$stamp-restart"
    # Submission/worker exit alone does not prove publication. Verify durable job state.
    $jobs | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $evidencePath "reload-$stamp-jobs.json")
    Invoke-CheckedProcess -FilePath docker -ArgumentList ($compose+@('run','--rm','--entrypoint','python','check','-m','publication.verify_source_crs',"reload-$stamp-jobs.json")) -ReportDirectory $evidencePath -Name "reload-$stamp-verify"
}finally{
    foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
