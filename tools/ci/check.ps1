[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = Resolve-Path -LiteralPath (Join-Path $ScriptDir "..\..")
$TestScript = Join-Path $ScriptDir "test.ps1"

Write-Host "Running Project Automata baseline checks..."
& $TestScript
$testExit = $LASTEXITCODE

if ($testExit -ne 0) {
    Write-Error "Test check failed with exit code $testExit."
    exit $testExit
}

Write-Host "Baseline checks passed for $($RepoRoot.Path)."
exit 0

