$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$SimulationScript = Join-Path $RepoRoot 'tools\simulation\run_pacing_regression.ts'

Push-Location $RepoRoot
try {
    $nodeVersion = (& node -p "process.versions.node") 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Node.js is required to run the headless reference simulation. $nodeVersion"
        exit 127
    }

    $nodeMajor = [int](($nodeVersion.Trim() -split '\.')[0])
    if ($nodeMajor -lt 24) {
        Write-Error "Node.js 24.x is required for deterministic built-in TypeScript execution. Found $nodeVersion."
        exit 1
    }

    & node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON $SimulationScript @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
