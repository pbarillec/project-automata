$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TestScript = Join-Path $RepoRoot 'tools\ci\test.ps1'
$ValidateConfigScript = Join-Path $RepoRoot 'tools\ci\validate_config.ps1'
$SimulationScript = Join-Path $RepoRoot 'tools\ci\simulate.ps1'
$AndroidAdsConfigScript = Join-Path $RepoRoot 'tools\ci\check_android_ads_config.ps1'

Push-Location $RepoRoot
try {
    Write-Host 'AUT-CX-003 check: Config validation'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ValidateConfigScript
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Write-Host 'AUT-CX-005 check: Android Ads startup configuration'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $AndroidAdsConfigScript
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Write-Host 'AUT-CX-002 check: TypeScript tests'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TestScript
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Write-Host 'AUT-022 check: Pacing regression'
    $PacingReportPath = Join-Path $RepoRoot 'temp\ci\pacing_regression_check_report.json'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SimulationScript --out $PacingReportPath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
