$ErrorActionPreference='Stop'
$directory='D:\PROG\HMC\hmc-app-prototype\.scratch\hmc-meteo'
$statePath=Join-Path $directory 't23-firewall3-state.json'
$stopPath=Join-Path $directory 't23-stop-firewall3'
$ruleName='HMC-T23-phone3-8138'
$created=$false
try {
    if(Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue){throw 'Rule already exists'}
    New-NetFirewallRule -Name $ruleName -DisplayName 'HMC T23 temporary Galaxy check' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 192.168.2.119 -LocalPort 8138 -RemoteAddress LocalSubnet -Program 'C:\Program Files\nodejs\node.exe' -Profile Any | Out-Null
    $created=$true
    @{status='active';name=$ruleName;local_address='192.168.2.119';port=8138;remote='LocalSubnet'} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
    $deadline=[DateTime]::UtcNow.AddMinutes(25)
    while([DateTime]::UtcNow -lt $deadline -and -not(Test-Path -LiteralPath $stopPath)){Start-Sleep -Seconds 1}
} catch {
    @{status='failed';error=$_.Exception.Message;created=$created} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
} finally {
    if($created){
        Remove-NetFirewallRule -Name $ruleName
        if(Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue){throw 'Temporary rule remains'}
        @{status='removed';name=$ruleName;remaining=0} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
    }
}
