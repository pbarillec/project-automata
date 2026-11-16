# AUT-074 — CI Workflow Finalization

Status: implemented; workflow YAML validated structurally by `tests/ci_workflows.test.ts` and the gate passes locally. **The workflows have never run on GitHub** (nothing pushed, no remote runner registered) — first-run verification is pending the owner push. Cocos Creator 3.8.8 (the plan's Godot wording is obsolete).

## Workflows (`.github/workflows/`)

- `ci.yml` — on pull_request, push to `main`, manual. `windows-latest` (tools/ci scripts call `powershell.exe`), Node 24.x, runs `npm run check` (config validation, Android Ads/Billing config checks, all tests, pacing regression). Uploads `temp/ci/*.json` reports. Cancels superseded runs.
- `android-build.yml` — on push to `main`, manual (`release` boolean input). Targets a **self-hosted** Windows runner labelled `cocos`: Cocos Creator 3.8.8 is a local editor install absent from GitHub-hosted runners (it needs the editor at the default path or `COCOS_CREATOR_EXE`, Android SDK/NDK, JDK, Gradle cache). Full-history checkout (versionCode = commit count), reruns the gate, then `npm run android:build` (debug APK) or `npm run android:release -- --apk` (AAB + APK + release-safety checks). Uploads APK/AAB/R8 mapping plus logs. No `pull_request` trigger, so untrusted PR code never reaches the self-hosted runner.

## Secrets / runner setup (owner)

Optional repo secrets: `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`, `ADMOB_APP_ID`, `ADMOB_UNIT_OFFLINE_DOUBLE`, `ADMOB_UNIT_EXTENDED_OVERCLOCK`. `RELEASE_STORE_FILE` (keystore path) is a runner-local environment variable. Absent signing => unsigned release, reported by the checks; absent ad ids => ads not configured.

## Not verified

- Actual GitHub execution of either workflow; runner registration; secret wiring.
- Action versions (`checkout@v4`, `setup-node@v4`, `upload-artifact@v4`) not pinned to SHAs.
- Hosted-runner Android build is intentionally not attempted (would require installing Cocos Creator headlessly).
