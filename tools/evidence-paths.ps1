function Get-HmcEvidenceRoot {
    $repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if ($env:HMC_EVIDENCE_ROOT) {
        $configured = $env:HMC_EVIDENCE_ROOT
        if (-not [IO.Path]::IsPathRooted($configured)) { $configured = Join-Path $repository $configured }
        return [IO.Path]::GetFullPath($configured)
    }
    return [IO.Path]::GetFullPath((Join-Path $repository '../hmc-app-evidence'))
}
