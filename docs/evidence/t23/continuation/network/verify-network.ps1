$ErrorActionPreference='Stop'
$path='D:\PROG\HMC\hmc-app-prototype\docs\evidence\t23\continuation\network\verified-network-cleanup.json'
try {
    $rules=@(Get-NetFirewallRule -PolicyStore ActiveStore -ErrorAction Stop)
    if(-not $rules.Count){throw 'No firewall inventory'}
    $names=@('HMC-T23-phone2-8138','HMC-T23-phone2-ethernet-8138','HMC-T23-phone3-8138')
    $remaining=@($rules | Where-Object Name -In $names | Select-Object -ExpandProperty Name)
    if($remaining.Count){throw 'Temporary firewall rules remain'}
    $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {
        $_.LocalPort -eq 8138 -and $_.LocalAddress -in @('192.168.2.119','192.168.2.186')
    })
    if($listeners.Count){throw 'LAN listener remains'}
    $proxy=@(& netsh interface portproxy show v4tov4)
    if($LASTEXITCODE -ne 0){throw 'Cannot read portproxy'}
    if(@($proxy | Where-Object {$_ -match '^\s*192\.168\.2\.119\s+8138\s'}).Count){throw 'Portproxy remains'}
    [ordered]@{status='passed';observed_at=[DateTime]::UtcNow.ToString('o');firewall_rules_enumerated=$rules.Count;
        temporary_rules_remaining=$remaining;lan_listeners_remaining=0;portproxy_remaining=0} |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $path
} catch {
    @{status='failed';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding UTF8 $path
    throw
}
