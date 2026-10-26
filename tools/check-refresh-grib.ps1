param([string]$ReportDirectory)
$ErrorActionPreference='Stop'
$repository=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repository
. ./tools/refresh_grib.ps1
if(-not $ReportDirectory){$ReportDirectory=Join-Path $repository ('data/reports/refresh-grib-unit/'+[guid]::NewGuid().ToString('N'))}
$ReportDirectory=[IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Force $ReportDirectory | Out-Null
$fixtures=Join-Path $ReportDirectory ('fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force (Join-Path $fixtures 'input with spaces') | Out-Null
foreach($name in @('environment.env','compose.yaml','override.yaml')){[IO.File]::WriteAllText((Join-Path $fixtures $name),'fixture')}
$inputPath=Join-Path $fixtures 'input with spaces'
[IO.File]::WriteAllText((Join-Path $inputPath 'alias-without-extension'),'GRIBfixture')
[IO.File]::WriteAllText((Join-Path $inputPath 'proj.txt'),'metadata')

function Assert-Refresh {param($Condition,[string]$Message) if(-not $Condition){throw $Message}}
function Read-Host {param($Prompt) $script:prompts++; $script:answer}
function Invoke-CheckedProcess {
    param($FilePath,[string[]]$ArgumentList,$ReportDirectory,$Name)
    $script:calls+=@{name=$Name;program=$FilePath;arguments=$ArgumentList}
    $stdout=''
    $stderr=''
    if($Name -eq $script:failure){$stderr='fixture native failure'}
    switch($Name){
        'find-api' {$stdout=if($script:mode -eq 'no-api'){''}else{'fixture-api'}}
        'api-running' {$stdout=if($script:mode -eq 'stopped'){'false'}else{'true'}}
        'api-labels' {
            $working=if($script:mode -eq 'foreign-repo'){Split-Path $repository -Parent}else{$repository}
            $environment=if($script:mode -eq 'missing-env'){Join-Path $fixtures 'missing.env'}else{Join-Path $fixtures 'environment.env'}
            $stdout=@{'com.docker.compose.project.working_dir'=$working;
                'com.docker.compose.project.environment_file'=$environment;
                'com.docker.compose.project.config_files'=(Join-Path $fixtures 'compose.yaml')+','+(Join-Path $fixtures 'override.yaml')} | ConvertTo-Json -Compress
        }
        'api-image' {$stdout='sha256:locked-fixture-image'}
        'preview' {
            $plan=$ArgumentList[[Array]::IndexOf($ArgumentList,'--plan')+1]
            @{actions=@(@{root='old-root';missing=@('gone.grib2');keep=@()});unchecked=@()} |
                ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $plan -Encoding UTF8
        }
        'load' {
            $label=$ArgumentList[[Array]::IndexOf($ArgumentList,'--label')+1]
            $script:owner=($label -split '=',2)[1]
            $state=if($script:mode -eq 'bad-report'){'failed'}else{'passed'}
            @{state=$state;files=@(@{source='alias-without-extension';state='published'})} |
                ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ReportDirectory 'reload-grib.json') -Encoding UTF8
        }
        'cleanup-list' {if($script:mode -in @('owned-leftover','foreign-leftover')){$stdout='leftover-id'}}
        'cleanup-owner' {$stdout=@{'hmc.refresh-grib.owner'=$(if($script:mode -eq 'foreign-leftover'){'foreign'}else{$script:owner})} | ConvertTo-Json -Compress}
    }
    [IO.File]::WriteAllText((Join-Path $ReportDirectory "$Name.stdout.log"),$stdout)
    [IO.File]::WriteAllText((Join-Path $ReportDirectory "$Name.stderr.log"),$stderr)
    if($Name -eq $script:failure){throw 'fixture native exit 1'}
}

$environmentNames=@('PUBLICATION_IMAGE','PUBLICATION_INPUT_DIR','PUBLICATION_EVIDENCE_DIR','PUBLICATION_CLOCK')
$saved=@{}
foreach($name in $environmentNames){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,'parent-fixture','Process')}
$results=@()
try {
    $cases=@(
        @{name='success';mode='';failure='';yes=$true;state='completed'},
        @{name='confirm';mode='';failure='';yes=$false;confirm=$true;state='completed'},
        @{name='plan-only';mode='';failure='';yes=$true;plan=$true;state='planned'},
        @{name='cancel';mode='';failure='';yes=$false;state='cancelled'},
        @{name='preview-fails';mode='';failure='preview';yes=$true;state='failed'},
        @{name='apply-fails';mode='';failure='apply';yes=$true;state='failed'},
        @{name='load-fails';mode='';failure='load';yes=$true;state='failed'},
        @{name='bad-report';mode='bad-report';failure='';yes=$true;state='failed'},
        @{name='restart-fails';mode='';failure='restart';yes=$true;state='failed'},
        @{name='empty';mode='empty';failure='';yes=$true;state='completed'},
        @{name='stopped';mode='stopped';failure='';yes=$true;state='failed'},
        @{name='foreign-repo';mode='foreign-repo';failure='';yes=$true;state='failed'},
        @{name='missing-env';mode='missing-env';failure='';yes=$true;state='failed'},
        @{name='no-api';mode='no-api';failure='';yes=$true;state='failed'},
        @{name='missing-input';mode='missing-input';failure='';yes=$true;state='failed'},
        @{name='owned-leftover';mode='owned-leftover';failure='load';yes=$true;state='failed'},
        @{name='foreign-leftover';mode='foreign-leftover';failure='load';yes=$true;state='failed'}
    )
    foreach($case in $cases){
        $script:calls=@();$script:mode=$case.mode;$script:failure=$case.failure;$script:prompts=0
        $script:answer=if($case.confirm){[string][char]0x414+[char]0x410}else{'no'}
        $caseRoot=Join-Path $ReportDirectory $case.name
        if($case.mode -eq 'empty'){Remove-Item -LiteralPath (Join-Path $inputPath 'alias-without-extension')}
        else{[IO.File]::WriteAllText((Join-Path $inputPath 'alias-without-extension'),'GRIBfixture')}
        $location=(Get-Location).Path
        $caught=$false
        $source=if($case.mode -eq 'missing-input'){Join-Path $fixtures 'absent-input'}else{$inputPath}
        try {Invoke-GribRefresh -Project hmc-publication-unit -InputDirectory $source -ReportRoot $caseRoot -PlanOnly:([bool]$case.plan) -Yes:([bool]$case.yes) | Out-Null}
        catch {$caught=$true}
        if($case.mode -eq 'missing-input'){
            Assert-Refresh ($caught -and -not $script:calls.Count) 'Missing input was treated as empty'
            Assert-Refresh ((Get-Location).Path -eq $location) 'Caller directory changed'
            foreach($name in $environmentNames){Assert-Refresh ([Environment]::GetEnvironmentVariable($name,'Process') -eq 'parent-fixture') 'Caller environment changed'}
            $results+=@{case=$case.name;state='failed';stages=@();passed=$true}
            continue
        }
        $run=Get-ChildItem -LiteralPath $caseRoot -Directory | Select-Object -First 1
        $status=Get-Content -LiteralPath (Join-Path $run.FullName 'refresh.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-Refresh ($status.state -eq $case.state) "$($case.name): unexpected state $($status.state)"
        Assert-Refresh ($caught -eq ($case.state -eq 'failed')) "$($case.name): wrong failure propagation"
        Assert-Refresh ((Get-Location).Path -eq $location) 'Caller directory changed'
        foreach($name in $environmentNames){Assert-Refresh ([Environment]::GetEnvironmentVariable($name,'Process') -eq 'parent-fixture') 'Caller environment changed'}
        $stages=@($script:calls | ForEach-Object {$_.name})
        if($case.name -in @('confirm','cancel')){Assert-Refresh ($script:prompts -eq 1) 'Confirmation was skipped'}
        else{Assert-Refresh ($script:prompts -eq 0) 'Unexpected confirmation prompt'}
        if($case.name -in @('plan-only','cancel','preview-fails','stopped','foreign-repo','missing-env','no-api')){
            Assert-Refresh ('apply' -notin $stages -and 'load' -notin $stages -and 'restart' -notin $stages) 'Mutation happened before consent/preflight'
        }
        if($case.name -eq 'apply-fails'){Assert-Refresh ('load' -notin $stages -and 'restart' -notin $stages) 'Work continued after apply failure'}
        if($case.name -in @('load-fails','bad-report','owned-leftover','foreign-leftover')){Assert-Refresh ('restart' -notin $stages) 'Restart happened after failed load'}
        if($case.name -eq 'empty'){Assert-Refresh ('load' -notin $stages -and 'restart' -in $stages) 'Empty source flow incorrect'}
        if($case.name -eq 'owned-leftover'){Assert-Refresh ('cleanup-remove' -in $stages -and 'cleanup-verify' -in $stages) 'Owned leftover not retired'}
        if($case.name -eq 'foreign-leftover'){Assert-Refresh ('cleanup-remove' -notin $stages) 'Foreign container removed'}
        if($case.name -eq 'success'){
            foreach($name in @('selection.json','browser.json','comparison.json','geoserver-numeric.json')){
                $copied=Join-Path $run.FullName $name
                Assert-Refresh (Test-Path -LiteralPath $copied) "Missing publication prerequisite $name"
                Assert-Refresh ((Get-FileHash -LiteralPath $copied).Hash -eq (Get-FileHash -LiteralPath (Join-Path tests/fixtures/publication/tile-engine $name)).Hash) 'Publication prerequisite changed'
            }
            Assert-Refresh (($stages -join ',') -match 'preview,apply,load,restart') 'Stage order changed'
            $load=@($script:calls | Where-Object name -eq 'load')[0]
            Assert-Refresh ('--all-fields' -in $load.arguments -and '--no-deps' -in $load.arguments) 'Loader profile/start behavior changed'
            Assert-Refresh ('PUBLICATION_STORAGE_BYTES=68719476736' -in $load.arguments) 'Budget not forwarded'
            Assert-Refresh (@($load.arguments | Where-Object {$_ -eq '--file'}).Count -eq 2) 'Compose override lost'
            Assert-Refresh ($status.grib_files -eq 1) 'Extensionless GRIB was skipped'
        }
        $results+=@{case=$case.name;state=$status.state;stages=$stages;passed=$true}
    }
    $results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $ReportDirectory 'checks.json') -Encoding UTF8
} finally {
    foreach($name in $environmentNames){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
    $absolute=[IO.Path]::GetFullPath($fixtures)
    if(-not $absolute.StartsWith($ReportDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path $absolute -Leaf).StartsWith('fixture-')){throw 'Unsafe fixture cleanup path'}
    Remove-Item -LiteralPath $absolute -Recurse -Force
    if(Test-Path -LiteralPath $absolute){throw 'Fixture cleanup failed'}
}
Write-Output "refresh_grib checks passed ($($results.Count)); fixture removed; no Docker resources allocated. Reports: $ReportDirectory"
