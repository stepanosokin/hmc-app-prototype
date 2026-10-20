$ErrorActionPreference='Stop'
$directory='D:\PROG\HMC\hmc-app-prototype\.scratch\hmc-meteo'
$statePath=Join-Path $directory 't23-bridge-state.json'
$stopPath=Join-Path $directory 't23-stop-firewall'
$ruleName='HMC-T23-phone2-ethernet-8138'
$created=$false
$bridged=$false
try {
    if(Get-NetTCPConnection -LocalAddress 192.168.2.119 -LocalPort 8138 -ErrorAction SilentlyContinue){throw 'Port already occupied'}
    New-NetFirewallRule -Name $ruleName -DisplayName 'HMC T23 temporary Ethernet bridge' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 192.168.2.119 -LocalPort 8138 -RemoteAddress LocalSubnet -Profile Any | Out-Null
    $created=$true
    & netsh interface portproxy add v4tov4 listenaddress=192.168.2.119 listenport=8138 connectaddress=192.168.2.186 connectport=8138
    if($LASTEXITCODE -ne 0){throw 'Cannot add exact port proxy'}
    $bridged=$true
    @{status='active';listen='192.168.2.119:8138';target='192.168.2.186:8138'} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
    $deadline=[DateTime]::UtcNow.AddMinutes(10)
    while([DateTime]::UtcNow -lt $deadline -and -not(Test-Path -LiteralPath $stopPath)){Start-Sleep -Seconds 1}
} catch {
    @{status='failed';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
} finally {
    if($bridged){
        & netsh interface portproxy delete v4tov4 listenaddress=192.168.2.119 listenport=8138
        if($LASTEXITCODE -ne 0){throw 'Cannot remove exact port proxy'}
    }
    if($created){Remove-NetFirewallRule -Name $ruleName}
    if($created -or $bridged){@{status='removed';name=$ruleName;portproxy_removed=$true} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath}
}
