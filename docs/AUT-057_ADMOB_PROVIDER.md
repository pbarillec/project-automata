# AUT-057 Android AdMob Production Provider

## Purpose

Integrates the pinned AdMob SDK (`play-services-ads:25.4.0`, AUT-005 / AUT-CX-005) behind `AdsService` for the two MVP rewarded placements
(`rewarded.offline_double`, `rewarded.extended_overclock`). The AUT-055 / AUT-056 flows are unchanged: they only consume `AdsService`.
No interstitials, no analytics (AUT-063/064), no billing (AUT-060), no consent flow (AUT-065).

## What was built

### Native (Java, `native/engine/android/app/src/com/cocos/game/`)

- `AutomataAdsController.java` (package-private) holds the provider; `AutomataPlatformBridge.java` delegates `initializeAds`, `getAdsStatus`,
  `getRewardedAvailability`, `preloadRewarded`, `showRewarded` to it (purchase / entitlement stubs are untouched).
- **Debug vs release IDs.** A debuggable build (`ApplicationInfo.FLAG_DEBUGGABLE`) ALWAYS uses Google's public sample IDs (app
  `ca-app-pub-3940256099942544~3347511713`, rewarded unit `ca-app-pub-3940256099942544/5224354917`), ignoring any injected value. A non-debuggable
  build reads the App ID and the two unit IDs from manifest `<meta-data>`; an empty, malformed or sample value means "not configured":
  `{"ok":false,"status":"unavailable","reason":"ads_not_configured"}`, the SDK is never initialised and nothing crashes.
- **Threading.** Every Ads SDK call runs on the UI thread (`GlobalObject.runOnUiThread`). The synchronous getters read volatile snapshots and
  never block.
- **Init.** `MobileAds.initialize(activity, listener)` once (idempotent), never at app start (the SDK's auto-init provider stays removed in the
  manifest); TypeScript calls `initialize()` after the session is ready. The init listener sets status `ready` and preloads both placements. An
  init failure sets status `failed`; gameplay is unaffected.
- **Placements.** One `RewardedAd` each, states idle / loading / ready / failed / showing. A failed load retries with bounded exponential
  backoff (15 s, 30 s, 60 s, 120 s, 240 s, cap 300 s) and only while the activity is foregrounded (resume restarts a pending retry). `preloadRewarded` is a no-op while
  loading / ready. A ready ad is stale after 50 min and is reloaded. Availability is `true` only when ready and not stale; reasons: `loading`,
  `no_fill`, `network`, `load_error_<code>`, `not_configured` (`ads_not_configured`), `not_initialized`, `show_in_progress`, `unknown_placement`.
  After any show finishes the next ad is preloaded.
- **Show = START-THEN-EVENT.** `native.reflection.callStaticMethod` is synchronous but an ad completes later, so `showRewarded` returns at once
  `{"status":"started",...}` or a terminal immediate failure (`unavailable` / `failed`, `rewardVerified:false`, with a reason: unknown placement,
  empty or reused requestId, not ready, show in progress, not configured). The single final result JSON
  (`status, placementId, requestId, rewardVerified, reason?, message?`) is delivered later through
  `JsbBridgeWrapper.dispatchEventToScript("automata.ads.rewarded_result", json)` (hopped onto the game thread with `CocosHelper.runOnGameThread`).
- **Per-request state machine.** One `AtomicBoolean completed`; `onUserEarnedReward` only sets `earned = true`; the ONE final result is emitted at
  `onAdDismissedFullScreenContent` (`rewarded` + `rewardVerified:true` if earned, else `closed` + `false`), so the grant never runs under the
  overlay. `onAdFailedToShowFullScreenContent` -> `failed` + `show_error_<code>`. An 8 s show-start watchdog (no `onAdShowedFullScreenContent` and
  no failure) -> `timeout` / `show_timeout`; the request is then completed, so a late dismiss or reward is ignored (a late reward is never granted).
  No timeout once the ad is showing. Every emission goes through `completed.compareAndSet(false, true)`. The ad object is consumed immediately.
  `automata.platform.overlay {phase, kind:"rewarded_ad", requestId}` is also dispatched (belt and braces; the authoritative begin / end is TS-side).
- **Consent minimum (until AUT-065).** Every `AdRequest` is non-personalized (`npa=1` through `AdMobAdapter` extras), carries no user data and
  `setTagForChildDirectedTreatment` is not called. A single private `canRequestAds()` hook returns `true` today; AUT-065 wires UMP there.

### Build (`app/build.gradle`, `AndroidManifest.xml`)

- Manifest placeholders `ADMOB_APP_ID`, `ADMOB_UNIT_OFFLINE_DOUBLE`, `ADMOB_UNIT_EXTENDED_OVERCLOCK` feed `com.google.android.gms.ads.APPLICATION_ID`,
  `com.projectautomata.ads.unit.offline_double`, `com.projectautomata.ads.unit.extended_overclock`. Debug defaults to the sample IDs; release
  defaults to empty strings and reads `-P<NAME>` or the `<NAME>` environment variable. Nothing production is committed, no `BuildConfig`, no new dependency.
- `MobileAdsInitProvider` removal is kept (the comment now says why).

### TypeScript

- `platform/android/AndroidAdsService.ts` (pure, no `cc`, no native names): takes an injected `AndroidAdsTransport {callString, subscribe}`.
  `showRewarded` returns a Promise: it begins the platform overlay BEFORE the native call, waits for the matching `automata.ads.rewarded_result`
  event (by `requestId`), ends the overlay and only then resolves. Single-use `requestId` (later = `duplicate:true`, `rewardVerified:false`); an unknown
  status -> `failed`; `rewardVerified` is true ONLY when `status === 'rewarded'` AND the native flag is `true`; a JS backstop (120 s after `started`)
  resolves `timeout`, ends the overlay and ignores later events for that id; parse / native errors resolve `failed` and never throw into the flows.
  `AndroidPlatformProviders.ts` re-exports it; `AndroidNativeBridge.ts` (the only `cc` file) provides `createAndroidAdsTransport()` over
  `native.reflection` + `native.jsbBridgeWrapper.addNativeEventListener` (a missing `jsbBridgeWrapper` is tolerated).
- `presentation/BuildPlatformServices.ts` `createBuildAdsService(debug, script?, deps?)`: release -> the Android provider when a transport exists, else
  `NoOpAdsService` (an unconfigured release build answers `unavailable` natively, so x2 / Extended stay hidden); DEBUG -> the mock stays the default;
  the per-launch `debug_ads.json` key `"provider":"admob_test"` selects the real Android provider with test IDs (accepted alone, any other value
  -> null). No build flag.
- Overlay vs absence: `FactoryWorldBootstrap` owns ONE `PlatformOverlayTracker`; the pure `OverlayBackgroundGate` makes an overlay-induced hide skip
  `suspend()`, the boost-look stop and `session_state suspended`, and its one-shot flag makes the matching show skip `resume()`, the offline report
  and the Extended refresh (it does not rely on the tracker being active at show time). A genuine Home press without an overlay behaves as before.
- Init and availability: `startAdsProvider` initialises the provider once the session binding is active (never on the startup path) and re-reads
  the availability every 3 s for up to 2 min (stops when both are available) so the x2 card action appears when an ad becomes ready; the Extended chip
  already polls on its own.
- DEBUG diagnostics: new `ads_state` device event (`initialized`, `availability`, `native_started`, `ad_result`, `overlay` begin/end,
  `overlay_hide_skipped`, `overlay_show_skipped`).

### Device tooling

`npm run device:seed-aut057 [-- --variant offline_double|extended]` writes `debug_ads.json {"provider":"admob_test"}` and the AUT-055 `ready` /
AUT-056 `eligible` save, then relaunches. Scenarios `aut057-offline-double`, `aut057-extended`, `aut057-no-fill`
(`npm run device:reveal-capture -- --scenario ...`; no-fill switches Wi-Fi and data off first and restores them, USB adb required).
Real Google test ads cannot be tapped closed reliably through ADB, so the drive waits up to ~30 s for `ads_state ad_result`, presses BACK, waits ~15 s
more. The ad outcome checks are BEST-EFFORT (always ok, the detail records what happened); the structural checks are hard: init ready, availability
true after init, flow `ad_started` before overlay begin, `native_started`, order overlay begin -> `ad_result` -> overlay end, a single result per
requestId, grant exactly once for a verified reward (or none otherwise), game responsive after, NO `session_state` suspended / resumed and NO new
offline report card created by the overlay; no-fill: never available, no x2 / chip, no ad, free COLLECT saves.

## Decisions (as implemented)

- Debug / test builds always use Google sample IDs (forced natively when debuggable). The mock stays the DEBUG default; real test ads are opt-in per launch.
- Release = Android provider with config-injected IDs; unconfigured = NoOp behaviour (x2 / Extended hidden). Production IDs are never in the repo.
- The reward is emitted at dismissal; only `onUserEarnedReward` sets `rewardVerified`.
- Crash / kill between a verified reward and the grant is DEFERRED and fail-closed: `monetization.pendingAdRequests` stays unused (no schema change).
  The result is emitted at dismissal so the window is milliseconds; a kill during the ad records no claim and leaves the free reward intact.
- Failure never blocks gameplay: every native failure resolves `unavailable` / `failed` / `timeout`; init failure or no fill hides x2 / Extended through
  availability `false`; nothing awaits ads on the startup path.

## Deferred / out of scope

- AUT-065: UMP consent flow and privacy options, personalized-ads state, ATT, consent copy, EEA / UK handling (only npa=1 and the `canRequestAds()` hook exist now).
- The merged `com.google.android.gms.permission.AD_ID` permission is left as the SDK merges it (record for AUT-065 / Play Data Safety).
- Interstitials, analytics events (AUT-063/064), billing (AUT-060).

## Owner-supplied before a production build

AdMob account and app for the FINAL package id (the current `com.projectautomata.androidbaseline` is a baseline name, TECHNICAL_DESIGN 26.1), the
production App ID and the two rewarded unit IDs (`ADMOB_APP_ID`, `ADMOB_UNIT_OFFLINE_DOUBLE`, `ADMOB_UNIT_EXTENDED_OVERCLOCK` via env / `-P`), the release
signing config, and consent / legal (AUT-065, privacy policy URL, Play Data Safety / AD_ID). Do not ship production IDs to real users before AUT-065.

## Verification status

- Automated: `npm run check`, plus the native code compiling in `npm run android:build` (see the implementation report for results).
- NOT verified here (device, human / device gate): real test-ad loading and show, that the `automata.ads.rewarded_result` event reaches the JS thread
  while the activity is paused (the Java side hops through `CocosHelper.runOnGameThread`), that Cocos reports the ad's activity pause as `EVENT_HIDE`
  (the gate handles both orders), BACK dismissal of the test ad, and the no-fill scenario on a real network-off device.

## Device verification (2026-11-14) — PARTIAL, real test-ad show/reward still pending

DEBUG APK from 41398e9 (gate label aut057; capture wiring fix: `expectAdmob` was not passed to the evaluator in reveal_capture.ts, same class of omission as AUT-050). `npm run check` PASS (1158 tests); the gate build compiled the native Java, 16 KB check PASS.

On the phone (`aut057-offline-double`, `temp/reveal/aut057-admob-offline-double-2026-11-14T145304/`): the real native path ran end to end up to ad load — SDK init, `ads_state` init/availability events, both placements load attempts with bounded retry/backoff (`load_error_0` = internal error), availability reporting `loading` -> `load_error_0`, 0 error events, gameplay unaffected. The test device had NO working internet during the run (mobile data attached but DNS resolution failed: `ping googleads.g.doubleclick.net` = unknown host; Wi-Fi off), so no test ad could load: the show / reward / dismiss / overlay-vs-absence checks are NOT verified. The capture FAILs on those checks reflect the offline device, not a code defect; the failing checks are listed as environment-blocked.

Regression with the default mock provider after the change (all PASS): `aut055-success`, `aut056-success`, `aut051`.

PENDING (human step, no code change expected): put the test phone online (Wi-Fi), then run `npm run device:seed-aut057 -- --variant offline_double` and `npm run device:reveal-capture -- --scenario aut057-offline-double` (and `aut057-extended`); watch the Google test ad, close it after the countdown, confirm the reward arrives once. Verify on device: the JS listener receives `automata.ads.rewarded_result` while the activity is paused behind the ad, the overlay gate prevents an offline report/suspend, and no-fill behaviour (`aut057-no-fill` toggles device network and restores it).
