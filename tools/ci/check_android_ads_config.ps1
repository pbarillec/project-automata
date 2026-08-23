$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ManifestPath = Join-Path $RepoRoot 'native\engine\android\app\AndroidManifest.xml'
$GradlePath = Join-Path $RepoRoot 'native\engine\android\app\build.gradle'

function Fail-AdsCheck([string]$Message) {
    throw "Android Ads startup configuration check failed: $Message"
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath
$gradle = Get-Content -Raw -LiteralPath $GradlePath

if ($gradle -notmatch "com\.google\.android\.gms:play-services-ads:25\.4\.0") {
    Fail-AdsCheck 'the AUT-CX-005 Google Mobile Ads dependency is missing from the native app module.'
}

$providerRemoval = '<provider\s+android:name="com\.google\.android\.gms\.ads\.MobileAdsInitProvider"\s+tools:node="remove"\s*/>'
$hasAppId = $manifest -match 'com\.google\.android\.gms\.ads\.APPLICATION_ID'
if (($manifest -notmatch 'xmlns:tools="http://schemas\.android\.com/tools"') -or (($manifest -notmatch $providerRemoval) -and -not $hasAppId)) {
    Fail-AdsCheck 'the source manifest neither disables MobileAdsInitProvider nor declares an App ID strategy.'
}

# If a generated final manifest is current, validate the artifact that would be installed.
$generatedManifest = Join-Path $RepoRoot 'build\android\proj\build\ProjectAutomata\intermediates\packaged_manifests\debug\processDebugManifestForPackage\AndroidManifest.xml'
if (Test-Path -LiteralPath $generatedManifest) {
    $sourceTime = (Get-Item -LiteralPath $ManifestPath).LastWriteTimeUtc
    $generatedTime = (Get-Item -LiteralPath $generatedManifest).LastWriteTimeUtc
    if ($generatedTime -ge $sourceTime) {
        $packaged = Get-Content -Raw -LiteralPath $generatedManifest
        if ($packaged -match 'com\.google\.android\.gms\.ads\.MobileAdsInitProvider') {
            $appIdMatch = [regex]::Match($packaged, '(?s)android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID".*?android:value="([^"]+)"')
            $appId = if ($appIdMatch.Success) { $appIdMatch.Groups[1].Value } else { '' }
            if ($appId -notmatch '^ca-app-pub-\d{16}~\d{10}$') {
                Fail-AdsCheck "the current packaged manifest includes MobileAdsInitProvider without a valid App ID (found '$appId')."
            }
        }
    }
}

Write-Host 'Android Ads startup configuration: PASS (compile-only provider removal or valid App ID strategy).'
