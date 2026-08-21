param(
    [string]$CocosCreatorPath = $env:COCOS_CREATOR_EXE,
    [int]$CocosTimeoutSeconds = 1200,
    [int]$GradleTimeoutSeconds = 1200,
    [switch]$GradleOffline,
    [switch]$IsolatedGradleUserHome,
    [switch]$StandardGradleUserHome,
    [switch]$SkipGeneration
)

$ErrorActionPreference = 'Stop'

$Script = Join-Path $PSScriptRoot 'build_android.js'
$NodeArgs = @(
    $Script,
    '--cocos-timeout-seconds', "$CocosTimeoutSeconds",
    '--gradle-timeout-seconds', "$GradleTimeoutSeconds"
)

if (-not [string]::IsNullOrWhiteSpace($CocosCreatorPath)) {
    $NodeArgs += @('--cocos-creator-path', $CocosCreatorPath)
}

if ($SkipGeneration) {
    $NodeArgs += '--skip-generation'
}

if ($GradleOffline) {
    $NodeArgs += '--gradle-offline'
}

if ($IsolatedGradleUserHome) {
    $NodeArgs += '--isolated-gradle-user-home'
}

if ($StandardGradleUserHome) {
    $NodeArgs += '--standard-gradle-user-home'
}

& node @NodeArgs
exit $LASTEXITCODE
