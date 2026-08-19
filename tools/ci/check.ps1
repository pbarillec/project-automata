$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TestScript = Join-Path $RepoRoot 'tools\ci\test.ps1'

Push-Location $RepoRoot
try {
    Write-Host 'AUT-CX-002 check: TypeScript tests'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TestScript
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
