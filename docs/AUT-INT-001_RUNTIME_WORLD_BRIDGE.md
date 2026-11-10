# AUT-INT-001 Runtime → FactoryWorld State Bridge

FactoryWorld is now driven by the single authoritative persistent session
(`LifecycleSessionCoordinator` → `GameRuntime` + `persistence/`). There is no
separate in-memory source of truth: presentation reads fresh snapshots and submits
commands; only the runtime changes state.

## What was built

- **`persistence/FileSaveStorage.ts`** (engine-free) — `SaveStorage` over an injected
  `FileSystemPort` (`exists/readText/writeText/move/remove`). Same observable semantics
  as `InMemorySaveStorage`: a missing file reads `undefined`; `copyText`/`replaceText`
  with a missing source throw `SaveStorageError`; `replaceText` moves source → destination
  and deletes the source. Port failures are wrapped in `SaveStorageError`.
- **`app/CocosFileSystemPort.ts`** (cc) — native builds store `save_main.json`,
  `save_backup.json`, `save_temp.json` directly under `native.fileUtils.getWritablePath()`
  (app-private; POSIX `rename` replaces the destination on Android, with a copy+delete
  fallback); non-native builds fall back to `sys.localStorage` keys `automata.<name>`.
- **`config/EmbeddedEconomyConfig.ts`** (generated, engine-free) — exact text of
  `data/economy/*.json` (line endings normalized to LF), exposed as fresh
  `ConfigFileSource[]` copies. Regenerate with:

  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_economy_config.ts`

  `tests/embedded_economy_config.test.ts` fails when the committed module drifts from
  `data/economy` and checks the embedded `contentVersion` equals the one loaded from disk.
- **`lifecycle/GameSessionBootstrap.ts`** (engine-free) — `bootstrapGameSession({ storage,
  timeService })`: embedded config → `AtomicSaveRepository(storage)` →
  `PersistenceCoordinator` (`gameVersion = GAME_SESSION_DEV_GAME_VERSION = '0.1.0-dev'`,
  single constant to be replaced by AUT-072; `contentVersion` from the config) →
  `LifecycleSessionCoordinator.startup`. Reports `fresh_game`, `loaded_main`,
  `recovered_backup` or `load_failed` (no writes on a read error).
- **`presentation/FactoryWorldStateBinding.ts`** (engine-free) — bridge over small
  interfaces (session port; automation/HUD/panel sinks):
  - `init()` syncs the loaded state through `syncAutomationState` (no events), so a save
    that already owns Auto Feeder rebuilds the automated Fabricator without a focus beat;
  - `submit(cmd)` = `session.execute(cmd, { requestOrdinarySave: true })`; accepted →
    events forwarded once to `consumeDomainEvents(snapshot, events)`, HUD view model and
    panel view model (current selection) refreshed; rejected → no fan-out;
  - `tick(dt)` = `advanceActiveSessionFromClock`, requesting an ordinary save at most once
    per second (the dirty-save policy still decides); same fan-out when events occur;
  - `onSelectionChanged(id)` → `createProducerPanelViewModel(repo, snapshot, producerId)`.
    World selection ids (`Fabricator`, `AssemblyStation`, …) map to producer config ids
    (`fabricator`, `assembly_station`, …) through `FACTORY_WORLD_SELECTION_PRODUCER_IDS`;
  - `suspend()`/`resume()` delegate; ticks are inert while suspended.
  It keeps no state copy between calls and never throws: failures go to an error reporter.
- **`presentation/FactoryWorldBootstrap.ts`** — after building the world, starts the session
  (`CocosFileSystemPort` → `FileSaveStorage` → `bootstrapGameSession` with
  `DefaultTimeService`). The binding is activated in the first `update()` after the load
  resolves (so every component built in `start()` has started), then: `binding.init()`,
  HUD/panel `commandEmitter` → `binding.submit`, `selection.onSelectionChanged` keeps
  `panel.replaceSelection` and also refreshes the binding selection, `update` → `binding.tick`,
  `game.on(Game.EVENT_HIDE/EVENT_SHOW)` → critical-save suspend / resume. Until ready, and
  forever on `load_failed`, inputs stay inert (emitters unset) and no fresh game is started.
  HUD/panel layout and visibility are unchanged (AUT-R-036).
- **`lifecycle/LifecycleSessionCoordinator.resume()`** — re-baselines the active clock
  through the existing `replaceRuntimeState`, so background time belongs to the offline
  preview and is never credited as active time. The new test failed first
  (`elapsedSeconds` 600 instead of 0). `GameRuntime` is unchanged.
- **DEBUG diagnostics** — new `session_state` event `{ phase: ready|suspended|resumed|load_failed,
  status, saveOk, autoFeederOwned, writablePath }`; session errors are reported as `error`
  events (`source: 'session'`). After the initial sync the bootstrap also emits
  `reveal_state { phase: 'synced', source: 'session', automated, focusRequested: false }` so the
  device harness can observe the restored automation state (the controller's own `idle` event
  is emitted at `start()`, before the asynchronous load completes). The C3 scenario is not
  modified: it never waits on `synced`; with no `started` reveal it takes its existing
  at-rest branch (`reveal_at_rest`).

## Device check (automated)

`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/device/cli.ts int001 --apk <FactoryWorld debug APK>`
(scenario `INT001-session-persistence`, artifacts under `temp/device/<run-id>/`):
`pm clear` (or, when an OEM build refuses it, `run-as rm` of the three save files in the
app's `files/` directory) → launch → `ready/fresh_game` → HOME → `suspended saveOk=true` and
`save_main.json` on disk → force-stop + relaunch → `ready/loaded_main` → force-stop,
push a seeded valid envelope that owns Auto Feeder (built in Node with the runtime/
SaveEnvelope helpers) to the reported `writablePath` via `run-as` → relaunch →
`loaded_main`, `autoFeederOwned=true`, `reveal_state automated:true`, no `reveal_state started`;
zero runtime/`error` events after `scene_ready` throughout. Session failures are classified
`RUNTIME_ERROR`, a replayed focus beat `CAMERA_FOCUS`, a missing device `ENVIRONMENT`
(BLOCKED). The driver gained `pressHome`, `clearAppData`, `listAppFiles`, `writeAppFile`,
`removeAppFiles`, `appDataDirectory` (`run-as`, debuggable APK only).

Device result (2026-11-10, OnePlus NE2215, Android 15, gate APK sha256 `ae234799…`), two consecutive passing runs per scenario on the same APK:
- `int001`: `…085749Z…` PASS 24/24 (install included; OEM refused `pm clear`, fallback used) and `…090211Z…` PASS 23/23 (`--skip-install`, so no `apk_installed` assertion).
- C3 regression: `…085838Z…` PASS 44/44 and `…090227Z…` PASS 43/43 (`--skip-install`); no `error` events.
- An earlier `int001` run (`…085700Z…`) was BLOCKED/ENVIRONMENT before the `pm clear` fallback existed.

Evidence: `temp/device/int001-session-persistence-20261110T{085749Z,090211Z}-ae234799/` and `temp/device/c3-producer-selection-20261110T{085838Z,090227Z}-ae234799/` (gitignored).

## Out of scope / pending

- The offline preview created at startup/resume stays pending: no offline report UI or
  collection (AUT-051).
- HUD/panel visibility, landscape layout and UI camera (AUT-R-036); load-failure UX;
  manual-produce and breakthrough-purchase inputs; localization; balancing; ads/IAP gating.
