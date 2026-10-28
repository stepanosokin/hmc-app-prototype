param(
    [string]$Path=(Join-Path $PSScriptRoot '../publication/run-retention.ps1'),
    [string]$TestPath=(Join-Path $PSScriptRoot '../tests/test_publication_retention.py')
)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $Path).Path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Retention runner has syntax errors'}
$commands=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true))
$guards=@($commands|Where-Object {
    $_.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Ampersand -and
    @($_.FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and
        $node.Value -eq '../tools/check-retention-preflight.ps1'},$true)).Count -eq 1
})
if($guards.Count -ne 1){throw 'Expected one retention guard before Docker'}
for($parent=$guards[0].Parent;$null -ne $parent;$parent=$parent.Parent){
    if($parent -is [Management.Automation.Language.FunctionDefinitionAst] -or
       $parent -is [Management.Automation.Language.LoopStatementAst] -or
       $parent -is [Management.Automation.Language.IfStatementAst]){throw 'Retention guard is conditional or deferred'}
}
$docker=@($commands|Where-Object {$_.GetCommandName() -eq 'docker'}|Sort-Object {$_.Extent.StartOffset})
if(-not $docker.Count -or $guards[0].Extent.StartOffset -ge $docker[0].Extent.StartOffset){throw 'Retention guard must precede Docker'}
$steps=@($ast.FindAll({param($node)
    if($node -isnot [Management.Automation.Language.CommandAst]){return $false}
    $elements=$node.CommandElements
    for($i=1;$i -lt $elements.Count-1;$i++){
        if($elements[$i] -is [Management.Automation.Language.CommandParameterAst] -and
           $elements[$i].ParameterName -eq 'Name' -and $elements[$i+1].Value -eq 'development'){return $true}
    }
    return $false
},$true))
if($steps.Count -ne 1){throw 'Expected one Development step'}
$step=$steps[0]
if($step.GetCommandName() -ne 'Invoke-T7Check'){throw 'Development must use the checked T7 launcher'}
$development=$false
for($parent=$step.Parent;$null -ne $parent;$parent=$parent.Parent){
    if($parent -is [Management.Automation.Language.FunctionDefinitionAst] -or $parent -is [Management.Automation.Language.LoopStatementAst]){
        throw 'Development step is deferred'
    }
    if($parent -is [Management.Automation.Language.IfStatementAst]){
        if($parent.Clauses.Count -ne 1 -or $parent.Clauses[0].Item1.Extent.Text -ne '$Development'){
            throw 'Development step has an extra condition'
        }
        $development=$true
    }
}
if(-not $development){throw 'Development step must belong to the Development branch'}
$values=@($step.FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst]},$true)|ForEach-Object {$_.Value})
foreach($required in @('run','--rm','T7_HTTP=1','python','-m','unittest','discover','-s','tests','-p','test_publication_retention.py')){
    if($values -notcontains $required){throw "Incomplete Development discovery: $required"}
}
$selectors=@()
for($i=0;$i -lt $values.Count;$i++){
    if($values[$i] -eq '-k'){
        if($i+1 -ge $values.Count){throw 'Missing unittest selector'}
        $selectors+=$values[$i+1]
    }
}
$expected=@('test_01_one_off_keep_latest','test_policy_cleanup_and_warm_cache_expiry')
if(($selectors -join ',') -ne ($expected -join ',')){throw 'Development must select one-off and ordinary lifecycle'}
$testText=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $TestPath).Path)
$methods=@([regex]::Matches($testText,'(?m)^    def (test_\w+)\(')|ForEach-Object {$_.Groups[1].Value})
foreach($selector in $selectors){
    if(@($methods|Where-Object {$_.Contains($selector)}).Count -ne 1){throw "Selector must match one test method: $selector"}
}
Write-Output 'Retention Development discovery selects both lifecycle scenarios; no runner or Docker executed.'
