$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$runner = Join-Path (Get-Location) 'tools/run-native-display.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($runner, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Native runner has syntax errors' }
$functions = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'InputSnapshot'
}, $true))
if ($functions.Count -ne 1) { throw 'Expected one native InputSnapshot function' }
# Execute only the repository's inventory function, never runner provisioning.
. ([scriptblock]::Create($functions[0].Extent.Text))
$paths = @(InputSnapshot -PathsOnly)
$expected = [IO.File]::ReadAllText((Join-Path (Get-Location) 'tests/fixtures/native-browser-inputs.json')) | ConvertFrom-Json
if (-not $expected.Count -or -not $paths.Count) { throw 'Expected nonempty browser and runner input sets' }
$missing = @($expected | Where-Object { $_ -notin $paths })
if ($missing.Count) { throw "Browser inputs absent from runner inventory: $($missing -join ', ')" }
Write-Output "Native input capture covers $($expected.Count) recorded browser paths; no Compose resources created."
