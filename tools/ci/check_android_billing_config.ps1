$ErrorActionPreference = 'Stop'

# AUT-060 static configuration scan for Google Play Billing. Billing needs NO secret: the only configuration is the in-app product id,
# which must match between the native controller and PRODUCTS.founderPack in TypeScript. No license key, service account or price may be committed.
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$GradlePath = Join-Path $RepoRoot 'native\engine\android\app\build.gradle'
$ControllerPath = Join-Path $RepoRoot 'native\engine\android\app\src\com\cocos\game\AutomataBillingController.java'
$BridgePath = Join-Path $RepoRoot 'native\engine\android\app\src\com\cocos\game\AutomataPlatformBridge.java'
$TypesPath = Join-Path $RepoRoot 'assets\scripts\services\PlatformServiceTypes.ts'

function Fail-BillingCheck([string]$Message) {
    throw "Android Billing configuration check failed: $Message"
}

$gradle = Get-Content -Raw -LiteralPath $GradlePath
$controller = Get-Content -Raw -LiteralPath $ControllerPath
$bridge = Get-Content -Raw -LiteralPath $BridgePath
$types = Get-Content -Raw -LiteralPath $TypesPath

if ($gradle -notmatch "com\.android\.billingclient:billing:9\.1\.0") {
    Fail-BillingCheck 'the pinned Google Play Billing dependency (9.1.0) is missing from the native app module.'
}

$nativeProduct = [regex]::Match($controller, 'PRODUCT_FOUNDER_PACK = "([a-z0-9_]+)";')
$tsProduct = [regex]::Match($types, "founderPack:\s*'([a-z0-9_]+)'")
if (-not $nativeProduct.Success -or -not $tsProduct.Success) {
    Fail-BillingCheck 'could not read the product id from AutomataBillingController.java or PlatformServiceTypes.ts.'
}
if ($nativeProduct.Groups[1].Value -ne $tsProduct.Groups[1].Value) {
    Fail-BillingCheck "the native product id '$($nativeProduct.Groups[1].Value)' differs from PRODUCTS.founderPack '$($tsProduct.Groups[1].Value)'."
}

# The pack is a non-consumable: no consume call. Acknowledge happens at exactly one call site, reachable only from the script bridge.
if ($controller -match 'consumeAsync|ConsumeParams') {
    Fail-BillingCheck 'the founder pack is non-consumable: consumeAsync must not be used.'
}
if (([regex]::Matches($controller, 'client\.acknowledgePurchase\(')).Count -ne 1) {
    Fail-BillingCheck 'there must be exactly one client.acknowledgePurchase call site (after-grant acknowledge only).'
}
$listener = [regex]::Match($controller, '(?s)private static final PurchasesUpdatedListener PURCHASES_LISTENER.*?\n    \};')
if (-not $listener.Success -or $listener.Value -match '(?i)acknowledge') {
    Fail-BillingCheck 'the PurchasesUpdatedListener must never acknowledge (the grant flow acknowledges after the durable grant).'
}
if ($bridge -notmatch 'AutomataBillingController\.acknowledge\(') {
    Fail-BillingCheck 'the bridge must expose acknowledgePurchase to the script.'
}

# Tracked-source scan: no license key material, service account or billing credential.
$scanExtensions = @('.ts', '.java', '.xml', '.gradle', '.json', '.ps1', '.js', '.properties')
foreach ($relativeRoot in @('native\engine\android', 'assets\scripts', 'tools')) {
    $root = Join-Path $RepoRoot $relativeRoot
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $files = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { ($scanExtensions -contains $_.Extension) -and ($_.FullName -notmatch '[\\/](node_modules|temp|build|library)[\\/]') -and ($_.Name -ne 'check_android_billing_config.ps1') }
    foreach ($file in $files) {
        $text = Get-Content -Raw -LiteralPath $file.FullName
        if ($text -match 'MIIB[A-Za-z0-9+/]{40,}') {
            Fail-BillingCheck "$($file.FullName) contains what looks like a Play licensing public key; none is needed and none may be committed."
        }
        if ($text -match '(?i)billing_?api_?key|play_?service_?account') {
            Fail-BillingCheck "$($file.FullName) references a billing credential; Google Play Billing needs no secret in the app."
        }
    }
}

Write-Host 'Android Billing configuration check passed (pinned 9.1.0, product id matches, one acknowledge call site, no secrets).'
