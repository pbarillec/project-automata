$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TestScript = Join-Path $RepoRoot 'tools\ci\test.ps1'
$ValidateConfigScript = Join-Path $RepoRoot 'tools\ci\validate_config.ps1'
$SimulationScript = Join-Path $RepoRoot 'tools\ci\simulate.ps1'

Push-Location $RepoRoot
try {
    Write-Host 'AUT-CX-003 check: Config validation'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ValidateConfigScript
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Write-Host 'AUT-CX-002 check: TypeScript tests'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TestScript
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Write-Host 'AUT-020 check: Headless reference simulation'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SimulationScript
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
