# AUT-065 Consent / Privacy Bootstrap for Ads

## Purpose

Integrates Google's User Messaging Platform (UMP) so the pinned AdMob setup (AUT-057) can request ads legally, while ads stay optional (TECHNICAL_DESIGN 25).
Core rule: **fail-open for gameplay, fail-closed for ads.** The game starts and plays with consent absent, failing, timing out or offline; no ad request, SDK
init or ad load happens until `canRequestAds() == true`. No economy / monetization / design value changed, no save change (version stays 3), no new `GameCommand`,
no analytics event (see Decisions).

## What was built

### Native (`native/engine/android/app/src/com/cocos/game/`)

- `AutomataConsentController.java` (package-private); `AutomataPlatformBridge.java` delegates `initializeConsent(optionsJson)`, `getConsentState()`, `showPrivacyOptions()`.
- **Start-then-event** like ads / billing. Every UMP call runs on the UI thread, the getters read volatile snapshots. `initializeConsent` returns a snapshot at once
  (`{status, canRequestAds, privacyOptionsRequired, formVisible, settled, reason?}`); the slow results arrive as `automata.consent.state` (same shape) and
  `automata.consent.privacy_result` (`{status: dismissed|unavailable|failed, reason?}`), hopped to the game thread with `CocosHelper.runOnGameThread`.
- **Flow.** `requestConsentInfoUpdate` (15 s native watchdog; a late callback still applies) -> when `ConsentStatus.REQUIRED` and `isConsentFormAvailable()`:
  `UserMessagingPlatform.loadConsentForm` -> state event with `formVisible:true` -> the form is shown only AFTER that event reached the script -> on dismissal
  the final state (UMP's own `getConsentStatus`, `canRequestAds`, `getPrivacyOptionsRequirementStatus() == REQUIRED`). A form that loaded while the activity was paused is held
  and shown on resume. Failure paths (update error, timeout, form load / show error, no activity) publish `error` / `required` with a reason; `canRequestAds` keeps UMP's own answer
  (a previous session's stored consent still allows ads), otherwise false.
- **Why `loadConsentForm` + `show` and not `loadAndShowConsentFormIfRequired`.** The latter gives no "about to show" moment, so the script could not bracket the activity pause the form
  causes as an overlay (the gate needs the overlay active when the hide event arrives). Behaviour is otherwise the same (required + form available -> show; both use the
  same UMP dismissal listener).
- **Privacy options.** `showPrivacyOptions()` -> `{status:"started"}` or a terminal `unavailable` (`consent_not_ready`, `privacy_options_not_required`, `form_in_progress`,
  `no_activity`); then `UserMessagingPlatform.showPrivacyOptionsForm`; state first, then `privacy_result`.
- **Debug-only test settings.** `initializeConsent({"debugGeography":"eea|not_eea|us_state"})` builds `ConsentDebugSettings` (`setDebugGeography`, `setForceTesting(true)`) ONLY when
  `ApplicationInfo.FLAG_DEBUGGABLE` is set; a release build ignores the option. No hashed test-device id, no AdMob app id and no production id is committed or used by the consent code.
- **No production AdMob id needed in debug.** UMP is started only when `AutomataAdsController.isConfigured()` (debuggable = Google sample ids; release = injected ids). A release
  without injected ids reports consent `unavailable` / `ads_not_configured` and never starts UMP.
- **Ads wiring.** `AutomataAdsController.canRequestAds()` now returns `AutomataConsentController.canRequestAds()` (the AUT-057 hook, same signature). `initialize()` answers
  `{ok:false,status:"uninitialized",reason:"consent_pending"}` and does NOT initialise the SDK before consent allows it; `loadPlacement` is gated; `unavailableReason` returns
  `consent_pending` (an already loaded ad is not offered either once consent is withdrawn); `onConsentChanged()` loads the waiting placements when the SDK is ready.
  Requests stay **non-personalized** (`npa=1`).
- **Build.** `implementation 'com.google.android.ump:user-messaging-platform:4.0.0'`: the version `play-services-ads:25.4.0` already resolves (checked in the Gradle cache:
  `com.google.android.ump/user-messaging-platform/4.0.0` + its transformed API jar), so no second UMP version enters the build. No manifest change (UMP uses the existing
  `APPLICATION_ID` meta-data and the existing INTERNET permission).

### TypeScript (pure, no `cc`)

- `services/ConsentService.ts`: `ConsentState {status: unknown|not_required|required|obtained|unavailable|error, canRequestAds, privacyOptionsRequired, formVisible, personalization:'non_personalized', reason?}`,
  `ConsentService` / `ConsentGate` interfaces, fail-closed `INITIAL_CONSENT_STATE`.
- `services/ConsentCoordinator.ts`: injected `ConsentTransport {callString, subscribe}` (same shape as ads / billing). `start()` never rejects, is idempotent and non-blocking: a 20 s
  start timeout -> `error / consent_timeout` (never fires under a visible form; a late native answer still applies); a native throw, malformed JSON or unknown status -> `error`,
  `canRequestAds` only when the provider said so and never for `unknown` / `unavailable`. `formVisible` begins / ends a `consent_form` platform overlay on the ONE shared
  `PlatformOverlayTracker` (10 min backstop). `showPrivacyOptions()` begins the overlay BEFORE the native call and ends it BEFORE resolving (one in flight, 10 min timeout backstop).
- `services/ConsentGatedAdsService.ts`: wraps ANY `AdsService` (real, mock, no-op): until `canRequestAds()` nothing reaches the provider; availability is false (`consent_pending`), so the
  x2 / Extended actions stay hidden; `showRewarded` resolves `unavailable` without a call; withdrawing consent closes a ready provider again.
- `platform/mock/MockConsentTransport.ts` (scripted native protocol), `platform/noop/NoOpConsentService.ts` (release without the native bridge: `unavailable`, ads closed, no row),
  `platform/android/AndroidNativeBridge.ts` `createAndroidConsentTransport()`.
- `presentation/BuildPlatformServices.ts` `createBuildConsentService(debug, script, deps, adsScript)`; `createBuildAdsService` wraps every provider when `deps.consent` is given.
  Release: UMP over the native transport, else NoOp. DEBUG: mock `not_required` by default (every other capture unaffected), the script's mock state, or `provider:"ump_test"` = real UMP with the
  debug geography; the real AdMob test provider (`debug_ads.json` `admob_test`) implies the real UMP with the device's own geography (it needs a real consent state).
- `presentation/FactoryWorldBootstrap.ts`: consent is chosen BEFORE ads and gates them; the consent flow starts only AFTER the session `ready` event (fire and forget, never on the
  startup path, never awaited); the ads provider is initialised the first time `canRequestAds` is true (`startAdsProvider` is fail-closed on consent) and the x2 / Extended actions
  re-evaluate on every consent change; the existing `OverlayBackgroundGate` + shared tracker make a form-induced hide skip `suspend()` and the matching show skip the resume / offline report.
- **Settings "Privacy options" row** (the standard UMP requirement when `privacyOptionsRequirementStatus == REQUIRED`): `SettingsViewModel` gets an optional
  `{privacyOptionsRequired}` option (default off: the four existing rows are unchanged) and a fifth row `privacy` (label `settings.privacy` "Privacy options", pill `settings.privacy.open`
  "OPEN", tappable, `action:'privacy_options'`, no patch). `SettingsLayout` takes a row count (default 4 = unchanged; 5 grows the card by one row + gap, 556 design units, validated on the
  six standard screens incl. insets); `SettingsController` builds five row nodes and lays out the rows actually shown (the extra one is hidden by scale); a tap calls
  `onPrivacyOptionsRequested`, which the bootstrap forwards to `ConsentService.showPrivacyOptions()` (no command, no native call in the controller). Strings are in `localization/en.json`
  (+ regenerated `EmbeddedTextCatalogue.ts`).

### DEBUG scripting

`debug_consent.json` (read once, deleted, DEBUG + diagnostics only; release never reads it):
`{"state":"not_required|required_obtained|required_declined|error|timeout","privacyOptions":true}` (mock transport under the real coordinator; mock start timeout 4 s) or
`{"provider":"ump_test","geography":"eea|not_eea|us_state"}` (real UMP, geography default `eea`, honoured natively only when debuggable). Mock fields win over `provider`.
New DEBUG event `consent_state` (phases `script`, `init`, `state`, `timeout`, `form_backstop`, `privacy_options_started`, `privacy_options_result`); the form overlay is the existing
`ads_state` overlay begin / end with kind `consent_form`.

### Device tooling

`npm run device:seed-aut065 [-- --variant not_required|required_obtained|required_declined|error|timeout|privacy_row|no_privacy_row|ump_eea]` (writes the save + `debug_consent.json`, relaunches).
Scenarios (`npm run device:reveal-capture -- --scenario ...`): `aut065-not-required`, `aut065-required-obtained`, `aut065-required-declined`, `aut065-error`, `aut065-timeout`,
`aut065-privacy-row`, `aut065-no-privacy-row`, `aut065-ump-eea`. `tools/device/consent_checks.ts` (unit-tested; `expectConsent` is passed through `cli.ts` AND `reveal_capture.ts` to
`evaluateRevealTimeline`): session ready, consent started AFTER ready, overlay bracket + no session suspend / resume while the form is up, ads init only after `canRequestAds`, x2 offered only
when allowed, fail-closed for declined / error / timeout, privacy row present / absent, privacy options flow. The real UMP scenario (`aut065-ump-eea`) first checks the environment: no init,
no state, `error` / `unknown` (network, no UMP message) or `unavailable` yield ONE failing check whose detail starts with `ENVIRONMENT_BLOCKED:` (the CLI prints `ENVIRONMENT_BLOCKED`, never PASS,
never a code FAIL). The real form is observed, not driven through ADB.

## Decisions (as implemented)

- **Personalization: MVP stays `npa=1` (non-personalized) regardless of the consent status.** Consent only unlocks serving ads at all. No claim is made that personalized ads work; enabling
  personalization is an owner / monetization decision (it would also change the Play Data Safety answers) and would need its own task.
- Fail-open / fail-closed as above; consent never blocks the first frame or the session-ready event; the form appears over the game only when UMP says it is required.
- A player who dismisses the required form without choosing leaves UMP in `required` with `canRequestAds == false`: ads stay closed until the next launch or until they use Settings > Privacy options.
- `consent_state` analytics event: SKIPPED. The AUT-063 catalogue is closed and validated (pinned tests); adding an event is not trivial and consent status is not needed for the MVP funnel.
  The DEBUG `consent_state` diagnostics cover verification.
- Overlay: `loadConsentForm` + `show` (not `loadAndShowConsentFormIfRequired`), see above.
- `admob_test` debug ads now run behind a real UMP state: the AUT-057 captures need the same network they already needed for test ads; offline they now stop at `consent_pending` instead of `load_error`.

## Owner-supplied before a production build / release (not done here, not decidable by the Implementer)

- **AdMob console > Privacy & messaging** for the FINAL app (final package id): publish the GDPR consent message (EEA / UK) and the US states regulations message; enable the
  privacy-options entry point; choose the consent (TCF) configuration and the ad partner list. Without a published message UMP reports `NOT_REQUIRED` / no form even in the EEA.
- **Privacy policy URL** (Play Console + in-app reachability), covering ads and purchases.
- **Play Console Data safety + advertising ID (`AD_ID`) declaration** matching the exact release SDK set (AdMob, Billing, UMP). The merged `com.google.android.gms.permission.AD_ID`
  permission is left as the SDK merges it; with `npa=1` the declaration must still be made truthfully by the owner / QA-Release.
- **EEA / UK handling** decision (consent message wording, age-of-consent tagging: the code calls `setTagForUnderAgeOfConsent(false)` and never `setTagForChildDirectedTreatment`; the
  game is not child-directed per the product direction, owner to confirm with the Play Families policy).
- **iOS (later):** App Tracking Transparency prompt / `NSUserTrackingUsageDescription`, UMP iOS SDK and the iOS bridge; out of scope for this Android-only task.
- Production AdMob ids and the release signing config (unchanged from AUT-057).

## Verification status

- Automated: `npm run check` (consent coordinator states: not_required / required / obtained / declined / unavailable / error / timeout / thrown / malformed / unknown status, late answer,
  form never timing out, overlay gate use, privacy options flow + timeout, mock transport states, ads gating incl. withdrawal, build selection matrix, debug script parsing, Settings row
  visibility + localization + layout on six screens, bootstrap wiring pins (consent before ads, after ready, fail-closed), native config scan (UMP pin, debug-only settings, no ids, overlay-first,
  ads hook), no save / command / catalogue change, consent checks incl. ENVIRONMENT_BLOCKED, scenario / cli / package wiring, `.meta` files).
- Java: `AutomataConsentController.java` and the edited `AutomataAdsController.java` were compile-checked with `javac -source 8` against the REAL `user-messaging-platform-4.0.0` API jar, the real
  `play-services-ads-25.4.0` jars and `android-36` (the Cocos classes and the bridge were stubbed for that check); the full Cocos / Gradle build is left to the gate build.
- NOT verified (device / owner gate): the real UMP form on a device (it needs network, a published message for the app and, in debug, the sample app id answering EEA debug geography),
  that the form's activity pause arrives as `EVENT_HIDE` while the overlay is active, that `automata.consent.*` events reach the JS thread while the activity is paused, the form shown after a
  background load, the privacy options form from Settings, the visual layout of the five-row Settings card, that the mock `not_required` default does not shift the existing AUT-055 / 056 / 057
  captures (ads now become available a few microtasks after session ready and the offline card refreshes on the consent change), and anything about personalized ads.

## Capture commands (human / device step, USB adb)

```
npm run device:seed-aut065 -- --variant required_obtained
npm run device:reveal-capture -- --scenario aut065-required-obtained   # also: aut065-not-required | -required-declined | -error | -timeout | -privacy-row | -no-privacy-row
npm run device:reveal-capture -- --scenario aut065-ump-eea             # REAL UMP, needs network; ENVIRONMENT_BLOCKED otherwise
```
