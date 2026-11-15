# AUT-072 Logging and Build Metadata

Engine note: CODEX_PLAN says "Godot version"; the engine is Cocos Creator, so the engine field is `cocos-creator 3.8.8`.

## Build identity (`BuildInfo`)

Pure, engine-free modules in `assets/scripts/logging/`:

| Field | Source |
|---|---|
| `gameVersion` | `BuildInfoData.gameVersion` (default `0.1.0-dev`; also written into save envelopes via `GAME_SESSION_DEV_GAME_VERSION`) |
| `buildNumber` | `BuildInfoData.buildNumber` (git commit count at build time, `0` unstamped) |
| `saveVersion` | `CURRENT_SAVE_VERSION` |
| `contentVersion` | loaded config `GameConfigRepository.contentVersion` |
| `engine` | `cocos-creator 3.8.8` |
| `gitSha`, `gitDirty` | `BuildInfoData` (`unknown`/`false` unstamped; `gitDirty` = uncommitted changes under `assets/` at build time) |
| `buildType` | `DEBUG` or `RELEASE`, from the Cocos `DEBUG` flag at runtime |
| `platform` | runtime `sys.os` (lower case) or `web` |

Source of truth: `assets/scripts/logging/BuildInfoData.ts`. The committed file always holds the safe defaults, so tests and Node need no build step and the tree never carries a per-commit generated file. `tools/ci/write_build_info.js` is called by `tools/ci/build_android.js` (so `npm run android:build` and `npm run device:gate-build`): it stamps the file immediately before Cocos compiles scripts and restores the original bytes in a `finally` (and on process exit) right after generation. `node tools/ci/write_build_info.js` prints what would be stamped. `AUTOMATA_GAME_VERSION` overrides the game version for a build (validated).

## Logging facade (`Log`)

`assets/scripts/logging/Log.ts`: categories `game build save time economy ads purchase consent analytics presentation perf debug`, levels `debug info warn error`, injected sink (default: console). It is the only code in `assets/scripts` that calls `console.*`, except the pre-facade spike scenes (`AssetRobotSpike`, `CameraSpikeBootstrap`, `AppStartup`); a source-scan test enforces this allow-list.

Release policy: `RELEASE` logs only `warn` and `error`; `DEBUG` logs everything. Before `FactoryWorldBootstrap.onLoad` configures it from `DEBUG`, the logger follows the RELEASE policy. Every line is sanitized: bearer tokens, `token/receipt/playerId/userId/advertisingId/price/...=value`, e-mails, currency amounts and 32+ char opaque runs become `[redacted]`/`[price]`. Message text is otherwise verbatim, so the pinned `[AUT-0xx]` prefixes are unchanged (the category is sink metadata, not part of the line). `[AUT-DEVICE]` diagnostics still require DEBUG (`emitDeviceEvent` is a no-op unless enabled) and are written via `Log.rawLine` unfiltered.

## How QA identifies a build

- DEBUG builds emit one `build_info` device event after the session config loads (`[AUT-DEVICE] {"evt":"build_info","gitSha":...}`), included in the default reveal event set, so every `timeline.json`, `logcat.txt` and `summary.md` (`build: <sha>[+] DEBUG (version, save, content, engine)`) names the exact build and config baseline. The AUT-067 perf `baseline.json` carries it as `build.appBuildInfo`.
- No new player-visible UI in any build. `+` after the sha means the build was made from a dirty `assets/` tree.
- A summary line `build: unknown (no build_info event)` means the APK predates AUT-072.
- `build_info_present` is not wired as a generic objective check (it would require touching every pinned scenario expectation); it is summary/baseline only.

## Device verification (2026-11-15)

Gate APK `aut072-37f1854`; `npm run check` 1560 tests green; `git status` clean after `device:gate-build` (BuildInfoData restored). Captures PASS: aut049, aut052, aut059-available, aut066-factory. `summary.md` now begins `build: 37f1854e DEBUG (version 0.1.0-dev #189, save v3, content 0.1.0-aut-010, cocos-creator 3.8.8)`, matching `git rev-parse --short=8 HEAD`. Release-build log reduction is only unit-tested (no release build yet; see AUT-073).
