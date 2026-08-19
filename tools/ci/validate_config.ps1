$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ValidateScript = Join-Path $RepoRoot 'tools\config\validate_config.ts'
$ConfigRoot = if ($args.Count -gt 0) { $args[0] } else { Join-Path $RepoRoot 'data' }

Push-Location $RepoRoot
try {
    & node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON $ValidateScript $ConfigRoot
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
