# AUT-CX-004 Android Build Baseline

## Scope

This task establishes the Cocos Creator 3.8.8 Android native generation and debug APK build path only. It does not add gameplay, Ads, Billing, Play Games, analytics, production signing, assets, camera work, or economy systems.

## Build Entry Point

Run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\build_android.ps1
```

The wrapper:

- verifies the Cocos engine package metadata reports version 3.8.8;
- verifies Android SDK Platform 36 is installed;
- asks Cocos Creator to generate/update `build/android` and writes the Cocos CLI build log through `logDest`;
- logs every major phase, child PID, periodic wait status, child exit, and timeout diagnostics;
- launches Creator through `tools/ci/build_android.js`; the PowerShell script is only a compatibility shim;
- runs Creator with an isolated `--home` profile and a writable mirrored JavaScript engine cache under `temp/ci`;
- writes a temporary resolved Cocos build config under `temp/ci` with SDK, NDK, and Java paths filled in;
- normalizes the generated Gradle `PROP_MIN_SDK_VERSION` to `23`;
- removes older generated APKs so Gradle must leave a fresh artifact;
- invokes the generated Gradle wrapper for `:ProjectAutomata:assembleDebug` offline with `GRADLE_USER_HOME=build/android/gradle-user`;
- fails non-zero on generation failure, Gradle failure, missing APK, stale APK, empty APK, or failed 16 KB native-library inspection;
- prints the produced debug APK path.

## Cocos Build Profile

The checked-in Android settings live in:

- `profiles/v2/packages/android.json`
- `profiles/v2/packages/native.json`
- `tools/ci/cocos_android_debug_build.json`

Important values:

- Cocos Creator: `3.8.8`
- Platform: `android`
- Build output: `build/android`
- App name/module: `ProjectAutomata`
- Placeholder application ID: `com.projectautomata.androidbaseline`
- Target/compile SDK: `36`
- Minimum SDK: `23`
- ABI: `arm64-v8a`
- Build type: debug APK
- Signing: Cocos debug keystore only
- App Bundle: disabled for this baseline
- Commercial SDKs: none

`minSdk` remains at 23 because AUT-CX-004 requires `minSdk >=23` and no higher dependency is present. Cocos 3.8.8's stock Android Gradle template defaults lower, so `tools/ci/build_android.ps1` enforces `PROP_MIN_SDK_VERSION=23` in generated output before Gradle runs.

## Native Ownership Policy

Generated build output remains ignored:

- `build/`
- `temp/`
- `library/`
- generated `native/*` outside `native/engine/`

Project-owned native template/build hooks under `native/engine/**` are intentionally trackable. The Android template currently mirrors the Cocos 3.8.8 baseline template, with the Automata-specific 16 KB linker hook in `native/engine/android/CMakeLists.txt`.

## 16 KB Compatibility

The project native Android library target is linked with:

```cmake
target_link_options(${CC_LIB_NAME} PRIVATE "-Wl,-z,max-page-size=16384")
```

After Gradle builds the APK, `tools/ci/build_android.js` extracts `lib/arm64-v8a/*.so` from the APK and parses ELF program headers directly in Node. Every `PT_LOAD` segment must report `p_align` of at least `0x4000`; otherwise the wrapper fails. This keeps the check deterministic even when this Windows host denies execution of `llvm-readelf.exe`.

## Observed Tool Assumptions

Observed locally during implementation:

- Cocos Creator executable exists at `C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`.
- Cocos engine package metadata at `resources\resources\3d\engine\package.json` reports version `3.8.8`.
- The Cocos 3.8.8 Android template uses Android Gradle Plugin `8.10.1`.
- The generated Gradle wrapper uses Gradle `8.11.1`.
- The generated Android properties use CMake `3.22.1` and NDK `25.2.9519653`.
- Android SDK Platform 36 is required by the wrapper.

The wrapper re-checks the generated SDK/API/ABI/CMake properties on every run and reports the actual generated values.

## Cocos Creator 3.8.8 CLI Behavior

Observed for AUT-CX-004:

- The direct Cocos CLI build can print `build Task (AUT-CX-004 Android Debug) Finished` and generate a valid Android project, then remain alive instead of exiting promptly.
- After successful generation, Creator can also throw a non-fatal post-build metrics exception containing `Missing class` and `Cannot read properties of null (reading 'constructor')`.
- Redirected stdout/stderr from `CocosCreator.exe` may remain empty, so the wrapper passes `logDest` in the `--build` argument and treats that file as the authoritative Cocos build log.
- Copied Cocos Android template files can preserve old timestamps. In particular, `gradlew.bat` is required to exist, but it must not be used as freshness evidence.
- The wrapper should not rewrite Windows `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, or `HOME` for Creator. Doing so can make Electron fail early with `Failed to get 'appData' path`. Use Creator's `--home` argument for the isolated Cocos profile instead.
- A clean isolated Cocos profile has no External Programs preferences, so the wrapper must populate a temporary build config with the resolved Android SDK, NDK, Java home, and Java executable paths. Keep Android `inputSDK` disabled; that option enables Google Play input mapping dependencies and is not the switch for SDK path injection.
- Creator may try to use the installed engine cache under `C:\ProgramData\cocos\editors\Creator\3.8.8`. The wrapper mirrors the JavaScript engine under `temp/ci/cocos-engine-3.8.8` and writes the isolated engine profile so cache writes stay in the repository workspace. Native engine registration still points at the installed Creator engine as expected for Cocos 3.8.8.
- Long process control should not depend on nested PowerShell on this machine. `tools/ci/build_android.ps1` is only a compatibility launcher; `tools/ci/build_android.js` owns Creator, Gradle, APK, and ELF validation.
- Creator and Gradle child stdout/stderr are teed live to the console and written under `temp/ci`. Cocos `logDest` is also printed and included in timeout diagnostics.
- Creator generation and Gradle each have hard timeouts. On timeout, the wrapper prints the phase, child PID, elapsed time, and tail log lines, then terminates only the spawned process tree.
- Gradle is invoked with `--offline`, `--no-problems-report`, and the generated local Gradle user home. This avoids network access and avoids stale locked generated `build/reports/problems` files from failing an otherwise successful debug APK build.

The wrapper therefore proves generation with deterministic Cocos output from `build/android` and/or the fresh `logDest` completion marker. If success evidence is present and the spawned Creator process is still alive, the wrapper terminates only that spawned Creator process before continuing to Gradle. If success evidence is missing, the same hang, exit code, or log exception is treated as a generation failure.

## Artifact

The expected debug APK is generated under:

```text
build/android/proj/build/ProjectAutomata/outputs/apk/debug/
```

The wrapper searches under `build/android/proj/build` and reports the exact fresh APK path it verifies.

## Manual Device Check

AUT-CX-004 still requires a one-time Android device install/launch before final task acceptance. After the wrapper succeeds:

```powershell
adb install -r <printed-apk-path>
adb shell monkey -p com.projectautomata.androidbaseline 1
```

On device, confirm the app launches to the existing startup screen showing `Automata` and `Runtime OK`.
