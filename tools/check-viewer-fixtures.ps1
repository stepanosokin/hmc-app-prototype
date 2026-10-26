param([string]$Path=(Join-Path $PSScriptRoot 'run-weather-viewer.ps1'))
$ErrorActionPreference='Stop'
$tokens=$null
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $Path).Path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Viewer runner has syntax errors'}

function Test-FixtureCondition {
    param([Management.Automation.Language.Ast]$Expression,[hashtable]$Flags)
    if($Expression -is [Management.Automation.Language.PipelineAst] -and $Expression.PipelineElements.Count -eq 1){
        return Test-FixtureCondition $Expression.PipelineElements[0] $Flags
    }
    if($Expression -is [Management.Automation.Language.CommandExpressionAst]){
        return Test-FixtureCondition $Expression.Expression $Flags
    }
    if($Expression -is [Management.Automation.Language.ParenExpressionAst]){
        return Test-FixtureCondition $Expression.Pipeline $Flags
    }
    if($Expression -is [Management.Automation.Language.VariableExpressionAst]){
        $name=$Expression.VariablePath.UserPath
        if($name -eq 'true'){return $true}
        if($name -eq 'false'){return $false}
        if(-not $Flags.ContainsKey($name)){throw "Unsupported fixture flag: $name"}
        return $Flags[$name]
    }
    if($Expression -is [Management.Automation.Language.BinaryExpressionAst]){
        $left=Test-FixtureCondition $Expression.Left $Flags
        $right=Test-FixtureCondition $Expression.Right $Flags
        if($Expression.Operator -eq 'Or'){return $left -or $right}
        if($Expression.Operator -eq 'And'){return $left -and $right}
    }
    if($Expression -is [Management.Automation.Language.UnaryExpressionAst] -and $Expression.TokenKind -eq 'Not'){
        return -not (Test-FixtureCondition $Expression.Child $Flags)
    }
    throw 'Unsupported fixture condition; no runner code was executed'
}

$commands=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true))
$browser=@($commands | Where-Object {$_.GetCommandName() -eq 'Invoke-CheckedProcess' -and $_.Extent.Text.Contains('tools/check-weather-viewer.mjs')} | Sort-Object {$_.Extent.StartOffset})
if(-not $browser.Count){throw 'Viewer browser invocation was not found'}
$steps=@()
foreach($name in @('overlap-seed','overlap-publish','overlap-restart')){
    $fixtureCommands=@($commands | Where-Object {$_.GetCommandName() -eq 'Check' -and $_.CommandElements.Count -gt 1 -and $_.CommandElements[1].Value -eq $name})
    if($fixtureCommands.Count -ne 1){throw "Expected one fixture step: $name"}
    $command=$fixtureCommands[0]
    if($command.Extent.StartOffset -ge $browser[0].Extent.StartOffset){throw "Fixture must precede browser: $name"}
    foreach($flags in @(@{Navigation=$false;Updates=$false},@{Navigation=$false;Updates=$true},@{Navigation=$true;Updates=$false},@{Navigation=$true;Updates=$true})){
        $enabled=$true
        for($parent=$command.Parent;$null -ne $parent;$parent=$parent.Parent){
            if($parent -is [Management.Automation.Language.FunctionDefinitionAst] -or $parent -is [Management.Automation.Language.LoopStatementAst]){
                throw "Unsupported deferred fixture step: $name"
            }
            if($parent -is [Management.Automation.Language.IfStatementAst]){
                if($parent.Clauses.Count -ne 1 -or $parent.Else -or
                    $command.Extent.StartOffset -lt $parent.Clauses[0].Item2.Extent.StartOffset -or
                    $command.Extent.EndOffset -gt $parent.Clauses[0].Item2.Extent.EndOffset){throw "Unsupported fixture branch: $name"}
                $condition=Test-FixtureCondition $parent.Clauses[0].Item1 $flags
                $enabled=$enabled -and $condition
            }
        }
        if($enabled -ne ($flags.Navigation -or $flags.Updates)){
            throw "$name does not prepare overlap for Navigation=$($flags.Navigation) Updates=$($flags.Updates)"
        }
    }
    $steps+=$command.Extent.StartOffset
}
if($steps[0] -ge $steps[1] -or $steps[1] -ge $steps[2]){throw 'Invalid fixture order: seed, publish, restart required'}
Write-Output 'Viewer fixture checks passed (4 flag combinations; no runner code or Docker executed).'
