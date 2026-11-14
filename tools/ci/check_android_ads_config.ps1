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

# AUT-057: the AdMob App ID and the two rewarded unit IDs are injected at build time. The source manifest declares them as ${...}
# placeholders and keeps the automatic init provider removed (the Ads SDK is initialised manually once the session is ready).
if ($manifest -notmatch 'android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value="\$\{[A-Z_]+\}"') {
    Fail-AdsCheck 'the source manifest must declare com.google.android.gms.ads.APPLICATION_ID with a ${...} placeholder (AUT-057).'
}
if ($manifest -notmatch $providerRemoval) {
    Fail-AdsCheck 'the source manifest must keep removing MobileAdsInitProvider (AUT-057 initialises the Ads SDK manually).'
}
foreach ($unitKey in @('com.projectautomata.ads.unit.offline_double', 'com.projectautomata.ads.unit.extended_overclock')) {
    $unitPattern = 'android:name="' + [regex]::Escape($unitKey) + '"\s+android:value="\$\{[A-Z_]+\}"'
    if ($manifest -notmatch $unitPattern) {
        Fail-AdsCheck "the source manifest must declare $unitKey with a placeholder value (AUT-057)."
    }
}

# build.gradle: a placeholder per ID, Google sample defaults for the debug build, empty defaults for release (= ads not configured).
foreach ($placeholder in @('ADMOB_APP_ID', 'ADMOB_UNIT_OFFLINE_DOUBLE', 'ADMOB_UNIT_EXTENDED_OVERCLOCK')) {
    if ($gradle -notmatch ($placeholder + "\s*:\s*automataAdProperty\('" + $placeholder + "',\s*''\)")) {
        Fail-AdsCheck "build.gradle must give the release build an empty default for $placeholder."
    }
    if ($gradle -notmatch ($placeholder + "\s*:\s*'ca-app-pub-3940256099942544[~/]\d{10}'")) {
        Fail-AdsCheck "build.gradle must give the debug build the Google sample default for $placeholder."
    }
}

# Tracked-source scan: only Google's public sample publisher id may appear (production IDs are never committed; docs/, temp/ and build/ are excluded).
$idPattern = 'ca-app-pub-\d{16}[~/]\d{10}'
$scanExtensions = @('.ts', '.java', '.xml', '.gradle', '.json', '.ps1', '.js', '.pro', '.properties', '.kt', '.cmake')
foreach ($relativeRoot in @('native\engine\android', 'assets\scripts', 'tools', 'tests')) {
    $root = Join-Path $RepoRoot $relativeRoot
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $files = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { ($scanExtensions -contains $_.Extension) -and ($_.FullName -notmatch '[\\/](node_modules|temp|build|library)[\\/]') }
    foreach ($file in $files) {
        foreach ($match in [regex]::Matches((Get-Content -Raw -LiteralPath $file.FullName), $idPattern)) {
            if (-not $match.Value.StartsWith('ca-app-pub-3940256099942544')) {
                Fail-AdsCheck "$($file.FullName) contains a non-sample AdMob ID ($($match.Value)); production IDs must be injected at build time (AUT-057)."
            }
        }
    }
}

# If a generated final manifest is current, validate the artifact that would be installed (the debug build must carry the Google sample App ID).
$generatedManifest = Join-Path $RepoRoot 'build\android\proj\build\ProjectAutomata\intermediates\packaged_manifests\debug\processDebugManifestForPackage\AndroidManifest.xml'
if (Test-Path -LiteralPath $generatedManifest) {
    $sourceTime = (Get-Item -LiteralPath $ManifestPath).LastWriteTimeUtc
    $generatedTime = (Get-Item -LiteralPath $generatedManifest).LastWriteTimeUtc
    if ($generatedTime -ge $sourceTime) {
        $packaged = Get-Content -Raw -LiteralPath $generatedManifest
        $appIdMatch = [regex]::Match($packaged, '(?s)android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID".*?android:value="([^"]*)"')
        $appId = if ($appIdMatch.Success) { $appIdMatch.Groups[1].Value } else { '' }
        if ($appId -notmatch '^ca-app-pub-\d{16}~\d{10}$') {
            Fail-AdsCheck "the current packaged manifest does not carry a valid App ID (found '$appId')."
        }
        if (-not $appId.StartsWith('ca-app-pub-3940256099942544~')) {
            Fail-AdsCheck "the current packaged DEBUG manifest must carry the Google sample App ID (found '$appId')."
        }
    }
}

Write-Host 'Android Ads startup configuration: PASS (placeholders, provider removal, no production AdMob IDs, sample App ID in the debug build).'
