# AUT-R-074-01 Android CI Runner Activation (readiness checkpoint)

Follow-up to AUT-074: `android-build.yml` targets a self-hosted runner labelled `[self-hosted, windows, cocos]` that has never been registered, so the Android build has never run on GitHub. This checkpoint adds the **local, read-only** part. Runner registration itself is an owner action and is **not done**.

## What was built

- `tools/ci/runner_preflight.js` (`npm run runner:preflight`, `--json` for machine output): checks Node 24.x, Windows, git, Cocos Creator 3.8.8 (exe plus engine `package.json` version, default path or `COCOS_CREATOR_EXE`), Android SDK `android-36`, an NDK, Java, and that `android-build.yml` still uses the `cocos` labels and has no `pull_request` trigger. Resolution rules mirror `tools/ci/build_android.js`. Exit 0 = READY, 1 = NOT READY, with a hint per failed check. It registers nothing and writes nothing.
- `tests/runner_preflight.test.ts`: pure evaluator tests (ready, each prerequisite failing alone) and the pins against the real workflow.
- Result on the developer machine (2026-11-16): READY (Cocos 3.8.8, SDK `temp/ci/android-sdk`, NDK 25.2.9519653, Android Studio JBR).

## Owner steps still required (not done here)

1. GitHub repo, Settings, Actions, Runners, New self-hosted runner (Windows x64): follow GitHub's download/`config.cmd` steps with the one-time registration token, adding the label `cocos` (`windows` and `self-hosted` are automatic).
2. Install it as a service or run it interactively under a dedicated low-privilege Windows account that owns the Cocos install, SDK and Gradle cache. Run `npm run runner:preflight` as that account.
3. Set `RELEASE_STORE_FILE` as a runner-local environment variable (release builds only), and add the optional repository secrets listed in `AUT-074_CI_WORKFLOWS.md`.
4. Trigger the workflow once manually (`workflow_dispatch`, debug) and review the run and the uploaded APK.

## Security note

A self-hosted runner executes repository code on the owner's machine. The workflow runs only on `push` to `main` and manual dispatch (never `pull_request`), and the preflight test pins that. Keep branch protection on `main` and do not enable fork-PR workflows on this runner.

## Not verified

- No runner is registered and no GitHub run of `android-build.yml` has happened.
- The preflight cannot see the runner's registered labels from GitHub; it checks the workflow file and the local toolchain only.
- Action versions remain unpinned to SHAs (as in AUT-074).
