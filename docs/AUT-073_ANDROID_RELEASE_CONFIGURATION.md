# AUT-073 — Android Release Configuration

Status: implemented and locally verified (signed release AAB + APK built, release-safety checks PASS). Play-side verification is pending owner-supplied items (below). Cocos Creator 3.8.8 (the plan's Godot wording is obsolete).

## Commands

| Command | Purpose |
|---|---|
| `npm run android:release -- [--apk] [--gradle-offline]` | Cocos release generation + Gradle `bundleRelease` (and `assembleRelease` with `--apk`) using `tools/ci/cocos_android_release_build.json`; then runs the safety checks. Artifacts: `build/android/proj/build/ProjectAutomata/outputs/{bundle,apk}/release/`. |
| `npm run android:release:check -- <aab\|apk>... --version-code <n> [--package <id>] [--require-production-ids] [--allow-sample-ids] [--require-signing]` | Stand-alone release-safety report (pure parts unit-tested in `tests/android_release_config.test.ts`). |

## Inputs (environment only; nothing secret is committed)

- Signing: `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. Without them an UNSIGNED bundle is produced and reported (`--require-signing` makes that an error). The Cocos debug keystore is rejected for release signing.
- Identity: `AUTOMATA_PACKAGE_NAME` (default: the baseline placeholder `com.projectautomata.androidbaseline`), `AUTOMATA_GAME_VERSION` (default from BuildInfo), versionCode = git commit count (override `AUTOMATA_VERSION_CODE`; `AUTOMATA_PREVIOUS_VERSION_CODE` enforces monotonic increase).
- Ads: `ADMOB_APP_ID`, `ADMOB_UNIT_OFFLINE_DOUBLE`, `ADMOB_UNIT_EXTENDED_OVERCLOCK` (AUT-057). Missing => ads not configured, x2 / Extended Overclock hidden. Play product id: `founder_pack` (AUT-060).
- targetSdk 36, minSdk 23 (recorded from the pinned dependencies), arm64-v8a only.

## Build-script decisions

- Release Gradle runs exclude `lintVitalAnalyzeRelease` / `lintVitalReportRelease` / `lintVitalRelease`: `com.android.tools.lint:lint-gradle:31.10.1` is not in the offline Gradle cache (first release attempt failed with "No cached version ... available for offline mode"). Lint is an analysis step, not part of the artifact; the release-safety checks cover the shipped output. Re-enable when building with network access if desired.
- `native/engine/android/app/proguard-rules.pro` keeps `AutomataPlatformBridge` (JS calls it by name through JNI) and the Ads/Billing/Consent controllers; the check verifies that all 19 bridge entry points survive under their original names in R8's `mapping.txt`.
- `USES_CLEARTEXT_TRAFFIC` manifest placeholder: `false` in release, `true` in debug.

## Local verification (2026-11-15)

Throwaway upload keystore under gitignored `temp/release/` (never committed), versionCode 190, package = baseline placeholder, sample/no ad ids (ads not configured). `release_checks` on the AAB and APK: **PASS** — not debuggable, targetSdk 36, minSdk 23, version code, no cleartext, 16 KB aligned native libs (arm64-v8a), signed (AAB JAR signature, APK apksigner), no local endpoints, no debug scripts/keystores packed, R8 kept the bridge (19 entry points) and controllers. WARN: ads not configured; INFO: `allowBackup=true` (baseline value, product/privacy decision).
Checker bugs found and fixed during verification: the `aapt2 dump xmltree` parser did not strip the `http://schemas.android.com/apk/res/android:` attribute namespace (SDK/version fields read `undefined`), and the R8 mapping scan stopped at the first `# {...}` metadata comment line (bridge methods reported missing). `npm run check` green (1577 tests).
Known weak check: `debug_flag_off` is a placeholder pass (the debuggable flag itself is covered by `not_debuggable`).

## Not verified here

- Device install/launch of the release build: the release APK is signed with the throwaway key while the connected test phone holds the debug-signed app under the same package id, so installing requires uninstalling it (wipes test data) or building under another `AUTOMATA_PACKAGE_NAME`. Not done; confirm non-debuggable (`run-as` must fail) and no DEBUG diagnostics when doing it.
- Install via a Play testing track (needs owner items), real AdMob/Billing/consent behaviour, release-build performance (the AUT-067 baseline is a DEBUG build).

## Owner-supplied before the first Play upload

1. **Final package id (chosen once; irreversible after store setup)** — currently the baseline placeholder `com.projectautomata.androidbaseline`.
2. Play Console app + in-app product `founder_pack`; upload keystore or Play App Signing enrolment (real keystore + passwords supplied via the env variables above).
3. Production AdMob app id and two rewarded unit ids; UMP messages (AUT-065); privacy policy URL; Data Safety / AD_ID; `allowBackup` decision.
4. Upload the signed AAB to an internal testing track and install through the opt-in link.
