# Loaded by hmc-demo.ps1 and the disposable Docker check.
function Invoke-HmcDemoPurge {
    param(
        [Parameter(Mandatory=$true)][ValidatePattern('^hmc-(app-live|publication-demo-purge-[a-z0-9-]+)$')][string]$Project,
        [Parameter(Mandatory=$true)][string]$Repository,
        [Parameter(Mandatory=$true)][string]$Directory,
        [Parameter(Mandatory=$true)][string]$ReportDirectory
    )
    $script:purgeStep = 0
    function Invoke-PurgeDocker {
        param([string[]]$Arguments)
        $script:purgeStep++
        $name = 'purge-{0:D3}' -f $script:purgeStep
        Invoke-CheckedProcess -FilePath docker -ArgumentList $Arguments -ReportDirectory $ReportDirectory -Name $name | Out-Null
        Get-Content -Encoding utf8 -LiteralPath (Join-Path $ReportDirectory ($name + '.stdout.log')) |
            ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
    }
    function Write-PurgeJson {
        param([string]$Path,$Value)
        $json = ConvertTo-Json -InputObject $Value -Depth 10
        [IO.File]::WriteAllText($Path,$json)
        if ([IO.File]::ReadAllText($Path) -cne $json) { throw 'Не удалось проверить архив; удаление отменено.' }
    }
    $repositoryPath = [IO.Path]::GetFullPath($Repository).TrimEnd('\','/')
    $targetsPath = Join-Path $Directory 'purge-targets.json'
    $images = @()
    if (Test-Path -LiteralPath $targetsPath) {
        $previous = Get-Content -LiteralPath $targetsPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($previous.project -ne $Project -or $previous.repository -ne $repositoryPath) { throw 'Чужой реестр очистки.' }
        $images = @($previous.images)
    }
    $containers = @(Invoke-PurgeDocker -Arguments @('container','ls','--all','--quiet','--filter',"label=com.docker.compose.project=$Project"))
    $inventory = @()
    foreach ($id in $containers) {
        $labels = (Invoke-PurgeDocker -Arguments @('container','inspect','--format','{{json .Config.Labels}}',$id)) | ConvertFrom-Json
        if ($labels.'com.docker.compose.project' -ne $Project -or
            -not $labels.'com.docker.compose.project.working_dir' -or
            [IO.Path]::GetFullPath($labels.'com.docker.compose.project.working_dir').TrimEnd('\','/') -ne $repositoryPath) {
            throw "Контейнер $id не принадлежит этому репозиторию; удаление отменено."
        }
        $image = [string](Invoke-PurgeDocker -Arguments @('container','inspect','--format','{{.Image}}',$id))
        $reference = [string](Invoke-PurgeDocker -Arguments @('container','inspect','--format','{{.Config.Image}}',$id))
        $images += @{id=$image;reference=$reference}
        $inventory += @{id=$id;image=$image;reference=$reference}
    }
    $images = @($images | ForEach-Object { [pscustomobject]@{id=$_.id;reference=$_.reference} } |
        Sort-Object -Property id,reference -Unique)
    foreach ($image in $images) {
        if ($image.id -notmatch '^sha256:[a-f0-9]{64}$' -or -not $image.reference -or $image.reference.StartsWith('-')) {
            throw 'Недопустимая запись образа; удаление отменено.'
        }
    }
    $networks = @(Invoke-PurgeDocker -Arguments @('network','ls','--quiet','--filter',"label=com.docker.compose.project=$Project"))
    # Persist before deletion so a retry still knows the images after containers disappear.
    Write-PurgeJson -Path $targetsPath -Value @{project=$Project;repository=$repositoryPath;images=$images}
    Write-PurgeJson -Path (Join-Path $ReportDirectory 'resources-before.json') -Value @{project=$Project;containers=$inventory;images=$images;networks=$networks;volumes_preserved=$true}
    foreach ($id in $containers) {
        Invoke-PurgeDocker -Arguments @('container','rm','--force',$id) | Out-Null
    }
    $remaining = @(Invoke-PurgeDocker -Arguments @('container','ls','--all','--quiet','--filter',"label=com.docker.compose.project=$Project"))
    if ($remaining.Count) { throw 'В проекте остались контейнеры; очистка не завершена.' }
    foreach ($network in $networks) { Invoke-PurgeDocker -Arguments @('network','rm',$network) | Out-Null }
    $blocked = @()
    foreach ($imageId in @($images | ForEach-Object { $_.id } | Sort-Object -Unique)) {
        $existing = @(Invoke-PurgeDocker -Arguments @('image','ls','--all','--quiet','--no-trunc'))
        if ($imageId -notin $existing) { continue }
        $users = @(Invoke-PurgeDocker -Arguments @('container','ls','--all','--quiet','--filter',"ancestor=$imageId"))
        if ($users.Count) { $blocked += @{id=$imageId;containers=$users}; continue }
        # Remove only captured references still pointing at the captured ID.
        # No --force and no parent pruning: Docker protects races and other tags.
        foreach ($image in @($images | Where-Object { $_.id -eq $imageId })) {
            $references = @(Invoke-PurgeDocker -Arguments @('image','ls','--quiet','--no-trunc',$image.reference))
            if ($imageId -in $references) {
                Invoke-PurgeDocker -Arguments @('image','rm','--no-prune',$image.reference) | Out-Null
            }
        }
        $existing = @(Invoke-PurgeDocker -Arguments @('image','ls','--all','--quiet','--no-trunc'))
        if ($imageId -in $existing) {
            # Multiple unrelated tags cause a nonzero Docker exit, never a forced deletion.
            Invoke-PurgeDocker -Arguments @('image','rm','--no-prune',$imageId) | Out-Null
        }
    }
    $remainingContainers = @(Invoke-PurgeDocker -Arguments @('container','ls','--all','--quiet','--filter',"label=com.docker.compose.project=$Project"))
    $remainingNetworks = @(Invoke-PurgeDocker -Arguments @('network','ls','--quiet','--filter',"label=com.docker.compose.project=$Project"))
    $existing = @(Invoke-PurgeDocker -Arguments @('image','ls','--all','--quiet','--no-trunc'))
    $remainingImages = @($images | ForEach-Object { $_.id } | Sort-Object -Unique | Where-Object { $_ -in $existing })
    $complete = -not ($remainingContainers.Count -or $remainingNetworks.Count -or $remainingImages.Count)
    Write-PurgeJson -Path (Join-Path $ReportDirectory 'purge-result.json') -Value @{
        project=$Project;complete=$complete;remaining_containers=$remainingContainers;remaining_networks=$remainingNetworks
        remaining_images=$remainingImages;shared_images=$blocked;volumes_preserved=$true;observed_at=[DateTime]::UtcNow.ToString('o')
    }
    if (-not $complete) { throw "Очистка не завершена: осталось образов $($remainingImages.Count). Общие образы сохранены; см. purge-result.json. Повторный stop продолжит очистку." }
    return @{removed_containers=$containers.Count;removed_images=@($images | ForEach-Object { $_.id } | Sort-Object -Unique).Count;volumes_preserved=$true}
}
