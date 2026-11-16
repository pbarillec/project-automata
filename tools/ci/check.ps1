# AUT-075 — authoritative automated pre-merge gate.
# Runs every stage (no fail-fast, so one run reports all regressions), prints a summary, writes
# temp/ci/check_report.json and exits 0 only if every stage passed. Exit code on failure is the
# first failing stage's code (never 0). Subjective/manual gates are NOT covered (see docs/AUT-075_REGRESSION_GATE.md).
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$CiDir = Join-Path $RepoRoot 'temp\ci'
$ReportPath = Join-Path $CiDir 'check_report.json'
$PacingReportPath = Join-Path $CiDir 'pacing_regression_check_report.json'

$Stages = @(
    @{ Id = 'config';  Title = 'AUT-CX-003 Config validation';               Script = 'validate_config.ps1';            Args = @() },
    @{ Id = 'ads';     Title = 'AUT-CX-005 Android Ads startup configuration'; Script = 'check_android_ads_config.ps1'; Args = @() },
    @{ Id = 'billing'; Title = 'AUT-060 Android Play Billing configuration';  Script = 'check_android_billing_config.ps1'; Args = @() },
    @{ Id = 'tests';   Title = 'AUT-CX-002 TypeScript tests (unit/integration/scene)'; Script = 'test.ps1';              Args = @() },
    @{ Id = 'pacing';  Title = 'AUT-022 Pacing regression';                   Script = 'simulate.ps1';                   Args = @('--out', $PacingReportPath) }
)

New-Item -ItemType Directory -Force -Path $CiDir | Out-Null
$results = @()
$firstFailure = 0
$started = Get-Date

Push-Location $RepoRoot
try {
    foreach ($stage in $Stages) {
        Write-Host "==> [$($stage.Id)] $($stage.Title)"
        $t0 = Get-Date
        $scriptPath = Join-Path $RepoRoot ('tools\ci\' + $stage.Script)
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath @($stage.Args)
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 1 }
        $results += [ordered]@{
            id = $stage.Id
            title = $stage.Title
            exitCode = $code
            status = $(if ($code -eq 0) { 'PASS' } else { 'FAIL' })
            seconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        }
        if ($code -ne 0 -and $firstFailure -eq 0) { $firstFailure = $code }
    }
}
finally {
    Pop-Location
}

$report = [ordered]@{
    gate = 'AUT-075'
    status = $(if ($firstFailure -eq 0) { 'PASS' } else { 'FAIL' })
    startedAt = $started.ToUniversalTime().ToString('o')
    totalSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    stages = $results
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding utf8

Write-Host ''
Write-Host 'Gate summary:'
foreach ($r in $results) { Write-Host ('  {0,-4} {1,-8} {2}' -f $r.status, $r.id, $r.title) }
Write-Host "Report: $ReportPath"
if ($firstFailure -ne 0) {
    Write-Host 'GATE FAIL'
    exit $firstFailure
}
Write-Host 'GATE PASS'
exit 0
