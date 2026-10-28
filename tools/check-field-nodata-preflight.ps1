param([string]$Path=(Join-Path $PSScriptRoot 'run-field-nodata.ps1'))
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $Path).Path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'NoData runner has syntax errors'}
$commands=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true))
function Find-Step([string]$Name){
    $found=@($commands | Where-Object {
        $elements=$_.CommandElements
        for($i=1;$i -lt $elements.Count-1;$i++){
            if($elements[$i] -is [Management.Automation.Language.CommandParameterAst] -and
               $elements[$i].ParameterName -eq 'Name' -and $elements[$i+1].Value -eq $Name){return $true}
        }
        return $false
    })
    if($found.Count -ne 1){throw "Expected one preflight step: $Name"}
    $command=$found[0]
    if($command.GetCommandName() -ne 'Invoke-CheckedProcess'){throw "Unchecked preflight: $Name"}
    for($parent=$command.Parent;$null -ne $parent;$parent=$parent.Parent){
        if($parent -is [Management.Automation.Language.FunctionDefinitionAst] -or
           $parent -is [Management.Automation.Language.LoopStatementAst] -or
           $parent -is [Management.Automation.Language.IfStatementAst]){throw "Conditional or deferred preflight: $Name"}
    }
    return $command
}
$types=Find-Step 'python-types';$tests=Find-Step 'python-tests';$freeze=Find-Step 'inputs-start'
$services=@($commands | Where-Object {$_.GetCommandName() -eq 'Check' -and $_.CommandElements[1].Value -eq 'services'})
if($services.Count -ne 1){throw 'Expected one services step'}
if($types.Extent.StartOffset -ge $tests.Extent.StartOffset -or $tests.Extent.StartOffset -ge $freeze.Extent.StartOffset -or
   $freeze.Extent.StartOffset -ge $services[0].Extent.StartOffset){throw 'Preflight must precede freeze and services'}
foreach($case in @(@{command=$types;required=@('docker','mypy','--check-untyped-defs','decoder','tests','trials','publication','tools')},
                   @{command=$tests;required=@('docker','T65_HTTP=0','python','unittest','discover','test_field_nodata.py')})){
    $values=@($case.command.FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst]},$true) | ForEach-Object {$_.Value})
    foreach($required in $case.required){if($values -notcontains $required){throw "Incomplete preflight: $required"}}
}
Write-Output 'NoData preflight order passed (types, unit tests, freeze, services; no runner or Docker executed).'
