param([string]$Image='hmc-publication:t12')
$ErrorActionPreference='Stop'
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $repository 'publication/process.ps1')
. (Join-Path $PSScriptRoot 'hmc-demo-purge.ps1')
$token=[guid]::NewGuid().ToString('N')
$project='hmc-publication-demo-purge-'+$token
$report=Join-Path $repository ('data/reports/demo-purge/'+$token)
$imageTag='hmc-demo-purge-check:'+$token
$orphanTag=$imageTag+'-orphan'
$volume=$project+'_data'
$network=$project+'_network'
$sentinel=$project+'-sentinel'
New-Item -ItemType Directory -Path $report -Force | Out-Null
$script:checkStep=0
function Run-Docker {
    param([string[]]$Arguments)
    $script:checkStep++
    $name='check-{0:D3}' -f $script:checkStep
    Invoke-CheckedProcess -FilePath docker -ArgumentList $Arguments -ReportDirectory $report -Name $name | Out-Null
    Get-Content -LiteralPath (Join-Path $report ($name+'.stdout.log')) | Where-Object { $_ }
}
try {
    # Metadata-only child image has a unique ID; the cached base is preserved.
    [IO.File]::WriteAllText((Join-Path $report 'Dockerfile'),"FROM $Image`nLABEL hmc.demo.purge.check=$token`n")
    Run-Docker -Arguments @('build','--pull=false','--tag',$imageTag,$report) | Out-Null
    $imageId=[string](Run-Docker -Arguments @('image','inspect','--format','{{.Id}}',$imageTag))
    [IO.File]::WriteAllText((Join-Path $report 'Dockerfile'),"FROM $Image`nLABEL hmc.demo.purge.check=$token-orphan`n")
    Run-Docker -Arguments @('build','--pull=false','--tag',$orphanTag,$report) | Out-Null
    $orphanImageId=[string](Run-Docker -Arguments @('image','inspect','--format','{{.Id}}',$orphanTag))
    Run-Docker -Arguments @('volume','create','--label',"com.docker.compose.project=$project",$volume) | Out-Null
    Run-Docker -Arguments @('network','create','--label',"com.docker.compose.project=$project",$network) | Out-Null
    $labels=@('--label',"com.docker.compose.project=$project",'--label',"com.docker.compose.project.working_dir=$repository")
    Run-Docker -Arguments (@('run','--detach','--name',($project+'-running'),'--network',$network,'--volume',($volume+':/probe'))+$labels+@('--entrypoint','python',$imageTag,'-c','import time; time.sleep(600)')) | Out-Null
    Run-Docker -Arguments (@('create','--name',($project+'-stopped'))+$labels+@('--entrypoint','python',$imageTag,'-c','pass')) | Out-Null
    Run-Docker -Arguments (@('create','--name',($project+'-orphan'),'--label','com.docker.compose.service=old-service')+$labels+@('--entrypoint','python',$orphanTag,'-c','pass')) | Out-Null
    Run-Docker -Arguments @('create','--name',$sentinel,'--label',('com.docker.compose.project=sentinel-'+$token),'--entrypoint','python',$imageTag,'-c','pass') | Out-Null
    # A write failure must leave all containers alive/present.
    $blockedReport=Join-Path $report 'blocked'
    New-Item -ItemType Directory -Path (Join-Path $blockedReport 'resources-before.json') -Force | Out-Null
    $rejected=$false
    try { Invoke-HmcDemoPurge -Project $project -Repository $repository -Directory $report -ReportDirectory $blockedReport | Out-Null } catch { $rejected=$true }
    if (-not $rejected) { throw 'Archive failure was accepted' }
    $present=@(Run-Docker -Arguments @('container','ls','--all','--quiet','--filter',"label=com.docker.compose.project=$project"))
    if ($present.Count -ne 3) { throw 'Archive failure deleted containers' }
    Write-Output 'PASS archive failure preserves all three containers'
    $sharedReport=Join-Path $report 'shared'
    New-Item -ItemType Directory -Path $sharedReport | Out-Null
    $rejected=$false
    try { Invoke-HmcDemoPurge -Project $project -Repository $repository -Directory $report -ReportDirectory $sharedReport | Out-Null } catch {
        if ($_.Exception.Message -notmatch 'Общие образы сохранены') { throw }
        $rejected=$true
    }
    if (-not $rejected) { throw 'Shared image was accepted as purged' }
    $receipt=Get-Content -Raw (Join-Path $sharedReport 'purge-result.json') | ConvertFrom-Json
    if ($receipt.complete -or @($receipt.remaining_containers).Count -or @($receipt.remaining_networks).Count -or $imageId -notin $receipt.remaining_images) { throw 'Incorrect shared-image receipt' }
    $remainingImages=@(Run-Docker -Arguments @('image','ls','--all','--quiet','--no-trunc'))
    if ($orphanImageId -in $remainingImages) { throw 'Exclusive orphan image survived purge' }
    Run-Docker -Arguments @('container','inspect','--format','{{.Id}}',$sentinel) | Out-Null
    Run-Docker -Arguments @('volume','inspect','--format','{{.Name}}',$volume) | Out-Null
    Write-Output 'PASS running/stopped/orphan containers removed; shared image, unrelated container and data volume preserved'
    Run-Docker -Arguments @('container','rm',$sentinel) | Out-Null
    $retryReport=Join-Path $report 'retry'
    New-Item -ItemType Directory -Path $retryReport | Out-Null
    Invoke-HmcDemoPurge -Project $project -Repository $repository -Directory $report -ReportDirectory $retryReport | Out-Null
    $receipt=Get-Content -Raw (Join-Path $retryReport 'purge-result.json') | ConvertFrom-Json
    if (-not $receipt.complete) { throw 'Retry failed' }
    $images=@(Run-Docker -Arguments @('image','ls','--all','--quiet','--no-trunc'))
    if ($imageId -in $images) { throw 'Image survives successful purge' }
    Run-Docker -Arguments @('image','inspect','--format','{{.Id}}',$Image) | Out-Null
    Write-Output 'PASS retry with no containers removes saved image target; cached base preserved'
    $repeatReport=Join-Path $report 'repeat'
    New-Item -ItemType Directory -Path $repeatReport | Out-Null
    Invoke-HmcDemoPurge -Project $project -Repository $repository -Directory $report -ReportDirectory $repeatReport | Out-Null
    Write-Output 'PASS repeated purge succeeds'
} finally {
    # Exact task-owned names only. Preserve report bytes before fixture retirement.
    foreach ($name in @($sentinel,($project+'-running'),($project+'-stopped'),($project+'-orphan'))) {
        $found=@(Run-Docker -Arguments @('container','ls','--all','--quiet','--filter',"name=^/$name$"))
        if ($found.Count) { Run-Docker -Arguments @('container','rm','--force',$name) | Out-Null }
    }
    & (Join-Path $PSScriptRoot 'retire-publication-project.ps1') -Project $project -ReportDirectory ('data/reports/demo-purge/'+$token)
    foreach ($tag in @($imageTag,$orphanTag)) {
        $left=@(Run-Docker -Arguments @('image','ls','--quiet','--no-trunc',$tag))
        if ($left.Count) { Run-Docker -Arguments @('image','rm','--no-prune',$tag) | Out-Null }
    }
    $left=@(Run-Docker -Arguments @('container','ls','--all','--quiet','--filter',"name=^/$project"))
    if ($left.Count) { throw 'Fixture containers remain' }
    'Test containers, networks, volumes and unique child image absent; cached base preserved.' | Set-Content (Join-Path $report 'cleanup.txt')
    Write-Output "Verified fixture cleanup. Reports: $report"
}
