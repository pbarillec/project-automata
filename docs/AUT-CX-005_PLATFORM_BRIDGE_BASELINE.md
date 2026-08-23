# AUT-CX-005 Platform Bridge Baseline

## Purpose

AUT-CX-005 establishes Project Automata's Cocos platform-service boundary and a minimal project-owned Android native bridge skeleton.

This is a compile-only commercial stack baseline. It does not implement production AdMob rewarded ads, Google Play Billing transactions, entitlement grants, purchase acknowledgement, restore reconciliation, monetization UI, analytics, product IDs, ad unit IDs, credentials, or signing secrets.

## TypeScript Boundary

Pure service contracts live under:

```text
assets/scripts/services/
```

The current service boundaries are:

- `AdsService`
- `PurchaseService`
- `EntitlementService`

Deterministic editor/headless providers live under:

```text
assets/scripts/platform/mock/
assets/scripts/platform/noop/
```

The only TypeScript layer that imports the Cocos runtime for native reflection is:

```text
assets/scripts/platform/android/AndroidNativeBridge.ts
```

Gameplay and domain modules must depend on service interfaces, not Android classes, Java class names, Google SDK types, or `native.reflection`.

## Android Bridge

The project-owned Java bridge skeleton is:

```text
native/engine/android/app/src/com/cocos/game/AutomataPlatformBridge.java
```

TypeScript calls Java through the Cocos pattern:

```ts
native.reflection.callStaticMethod(
    'com/cocos/game/AutomataPlatformBridge',
    methodName,
    methodSignature,
    ...args,
);
```

Bridge method arguments and return values are intentionally primitive/serializable strings. Current Java responses are explicit `unavailable` / `compile_only_bridge` results.

## Commercial SDK Baseline

The Android app module pins official Google SDK dependencies:

```gradle
implementation 'com.google.android.gms:play-services-ads:25.4.0'
implementation 'com.android.billingclient:billing:9.1.0'
```

These dependencies are used only as compile-time baseline references in `AutomataPlatformBridge.getCommercialSdkBaselineJson()`.

Dependency notes:

- `com.google.android.gms:play-services-ads:25.4.0`
  - Provider: Google
  - License: governed by Google's SDK terms and Maven artifact notices
  - Purpose in AUT-CX-005: compile baseline for future AUT-057 Android AdMob provider
- `com.android.billingclient:billing:9.1.0`
  - Provider: Google
  - License: governed by Google's SDK terms and Maven artifact notices
  - Purpose in AUT-CX-005: compile baseline for future AUT-060 Google Play Billing provider

No third-party monetization plugin is used.

Because this baseline is compile-only and `AutomataPlatformBridge` intentionally returns Ads as unavailable, the app manifest removes the Ads SDK's automatic `MobileAdsInitProvider`. This keeps debug/baseline startup independent of production credentials while retaining the SDK dependency for the future AUT-057 provider. A production provider may later replace that removal with `com.google.android.gms.ads.APPLICATION_ID` supplied by a real App ID configuration; no production App ID belongs in this baseline.

## Android Dependency Resolution

AUT-CX-005 intentionally adds new official Google Maven dependencies to the Android compile baseline. The AUT-CX-004 Android build wrapper must therefore run Gradle with dependency resolution enabled by default so missing transitive artifacts can be fetched from the generated project's configured repositories (`google()` and `mavenCentral()`).

Normal builds use workspace-local `build/android/gradle-user` by default, even if the shell has an ambient `GRADLE_USER_HOME` override. This keeps automated validation writable under the repository while the generated Gradle wrapper continues to pin the Gradle version and dependency resolution remains enabled.

The cache remains generated state under `build/android/gradle-user`; Google and AndroidX binaries must not be committed to the repository.

When `temp/ci/android-sdk` exists with API 36 and NDK 25.2.9519653, the Android build wrapper prefers that workspace SDK mirror so restricted automation does not need to execute Android SDK or NDK tools from the user profile. If the mirror is absent, the wrapper falls back to the configured local Android SDK.

The legacy isolated flag is still accepted and matches the default:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\build_android.ps1 -IsolatedGradleUserHome
```

Host Gradle state is explicit:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\build_android.ps1 -StandardGradleUserHome
```

Offline Gradle verification remains available only as an explicit cache-only mode:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\build_android.ps1 -GradleOffline
```

Do not use offline mode as the default for AUT-CX-005 validation unless the repository-local Gradle cache already contains all Ads, Billing, and transitive AndroidX artifacts.

## Explicitly Deferred

The following remain later tasks:

- rewarded ad load/show/reward callback implementation
- rewarded eligibility rules
- offline double or extended overclock grant logic
- product metadata from Google Play
- purchase launch, pending/cancel/success handling
- acknowledgement and entitlement reconciliation
- Founder entitlement grant-once logic
- production IDs, secrets, signing, consent, analytics, or store flows
- real-device AdMob/Billing validation

## Validation Intent

Automated tests cover deterministic mock/no-op behavior and verify that testable TypeScript service layers do not import Cocos runtime, native bridge names, or Google SDK types.

Factory owns authoritative post-implementation validation:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\check.ps1
cmd.exe /d /c node tools\ci\build_android.js
```
