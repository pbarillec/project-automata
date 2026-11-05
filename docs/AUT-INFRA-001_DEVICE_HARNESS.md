# AUT-INFRA-001 Android Device Validation Harness

A reusable, engine-free harness drives a FactoryWorld debug APK on a real Android
device through ADB. It reads structured `[AUT-DEVICE]` events from logcat, runs the
deterministic C3 producer-selection scenario, and writes a machine-readable result
with the failure class, the first failed assertion and evidence paths. Human testers
only connect and authorize the phone; the harness performs every interaction.

Branch `feat/aut-infra-001-device-harness` is based on the AUT-038 tip `eed2a80`,
not `main`, because the hooks instrument R-035/AUT-038 selection code that is not on
`main` (Technical Lead decision). It is a single commit so it can be fast-forwarded
into or cherry-picked onto AUT-038.

## Structured diagnostics (debug builds only)

- `assets/scripts/presentation/DeviceDiagnostics.ts` (engine-free) defines the protocol.
  It writes one line per event: `[AUT-DEVICE] {"v":1,"seq":n,"evt":"...",...}`.
  Numbers are rounded to 2 decimals, and `seq` increases monotonically.
  - Emitting is a no-op until `configureDeviceDiagnostics({ enabled: true })` is called.
  - The sink never throws into its caller.
  - `installDeviceErrorHook` chains the Cocos native `__errorHandler` and the `error` event, and emits `error` events.
- `FactoryWorldBootstrap.onLoad` is the only enabling call site:
  `configureDeviceDiagnostics({ enabled: DEBUG === true })`, with `DEBUG` from `cc/env`.
  Release builds never emit, and nothing reads the emit result.
- Events, all emit-only:

| Event | Emitted by | Content |
|---|---|---|
| `scene_ready` | `ProducerSelectionController`, two frames after `start()` | window size, DPR, slop, indexed target count, projected zone centres (`camera.worldToScreen`), camera state |
| `reveal_state` | `FirstAutomationPresentationController` | `manual` / `automated` on each Auto Feeder indicator visibility transition |
| `touch_start` | selection controller | raw Cocos coordinates (bottom-left origin), UI-blocked flag |
| `touch_end` | selection controller | coordinates, start point, distance moved, slop, tap/drag classification, UI-blocked flag |
| `selection_raycast` | selection controller | ray origin/direction, per-zone plane hit, dx/dz, half extents, local and world scale, hit id |
| `selection_state` | selection controller | requested, prev → next, changed, `rejected` |
| `marker_state` | selection controller | the `ProducerSelectionMarker` child read by name: exists, active, activeInHierarchy, layer, mesh, world position/scale. `ProducerHighlight.ts` is untouched. |
| `camera_focus` | selection controller and `MobileCameraController` | `requested`/`skipped` from the selection controller; `started`/`settled`/`cancelled` from the camera controller |
| `zones_projected` | selection controller | fresh projections two frames after each focus settles |
| `error` | error hook | uncaught JS exceptions |

- The AUT-035 hit test moved unchanged into `SelectionRaycast.pickSelectionTarget`, which is engine-free.
  - The plane is y = target world y, with half extent `max(0.5, local scale / 2)`, `distance >= 0`, and the nearest hit wins.
  - `tests/selection_raycast.test.ts` checks it against a verbatim copy of the old loop on 500+ rays.
- `MobileCameraController.isFocusTransitionActive()` is a new read-only getter.
- The existing `[AUT-038-HG]` lines and the human-gate code are untouched. AUT-038 closure still removes them.

## Tooling (`tools/device/`, Node 24, no `cc`)

| File | Role |
|---|---|
| `adb.ts` | adb resolution (`ADB_PATH` → SDK → PATH). Injectable executor with a timeout on every call. Device discovery and explicit selection; missing or unauthorized devices map to "connect and authorize the Android device". Operations: install, launch, force-stop, `pidof`, tap, swipe, screencap (PNG checked), logcat clear and stream args, meminfo, gfxinfo, command log. |
| `events.ts` | Logcat → ordered `EventStream`: parsed `[AUT-DEVICE]` events plus runtime-error detection (uncaught exceptions, `JS: *Error:`, fatal crashes). `waitFor` takes a cursor and a timeout. |
| `classification.ts` | The 8 failure classes, owner routing, and pure evaluators for the tap chain, the swipe and the calibration. Also the Cocos ↔ adb coordinate conversion (y-flip plus scale). |
| `result.ts` + `schema/device_result.schema.json` | Result contract `aut-device-result/1`, the status → review-decision mapping, and a dependency-free schema validator with cross-field rules. |
| `artifacts.ts` | Run IDs `<scenario>-<UTC stamp>-<apk sha8>` and fixed layout under `temp/device/<run-id>/`. |
| `driver.ts` | `DeviceDriver` boundary (real: AdbClient + live logcat; tests: a simulated device). |
| `scenarios/c3_producer_selection.ts` | The C3 scenario. |
| `gate_build.ts` | FactoryWorld gate build: refuses a dirty config, backs up the config with a checksum, switches the start scene, builds, restores the bytes in `finally`, and verifies with SHA-256 and `git diff --exit-code`. Copies the APK to `temp/gate/`. |
| `cli.ts` | `devices`, `c3`, `gate-build`, `restore-build-config`. |

npm scripts: `device:devices`, `device:c3 -- --apk <apk> [--serial <id>]`, `device:gate-build -- --label <l>`, `device:restore-build-config`.
`device:c3` exit codes: 0 PASS, 1 FAIL, 2 BLOCKED, 3 invalid result.

Artifacts in `temp/device/<run-id>/`: `result.json`, `summary.md`, `logcat.txt`, `events.jsonl`, `screenshots/NN-<label>.png`, `meminfo.txt`, `gfxinfo.txt`, `device.json`, `commands.json`.

## C3 scenario

1. **Environment.** The APK must be present; adb must respond; one ready device (or `--serial`). Then `install -r`, `force-stop`, `logcat -c`, start the logcat stream, and `am start -W`.
2. **Wait for `scene_ready`.**
   - If a `zones_projected` event arrives first, `start()` never completed. The scenario fails fast: `RUNTIME_ERROR` when exceptions are present, otherwise `ENVIRONMENT`.
   - Then it asserts `selection_targets_indexed` (5 targets).
3. **Wait for the reveal.** Wait for `reveal_state=automated`, then the reveal focus `started → settled`, then a fresh `zones_projected`. Errors logged before `scene_ready` are recorded as warnings.
4. **Calibration self-check.** Tap the top-left at (4% w, 8% h). `touch_start` must land within 3 px of the converted point, and the orientation must match. A failure is classed `ENVIRONMENT` (a harness defect).
5. **Producer taps.** Tap up to 5 zones in producer order, using the latest projection. Each projected centre must lie inside a safe area with a 10% margin, to avoid system overlays. Per tap, the chain is asserted in order:
   - `touch_end` received at the injected position;
   - not UI-blocked, and classified as a tap;
   - `selection_raycast.hit` equals the zone;
   - `selection_state` prev → next and `changed`;
   - `marker_state`: the new marker is active with a mesh, and the previous marker is cleared;
   - `camera_focus` requested → started → settled;
   - no runtime error and the app still alive.

   At least 2 zones must be tapped.
6. **Swipe.** Swipe from 35% to 60% of the width over 400 ms. It must produce a `touch_end` with `tap=false`, no `selection_raycast`, and no selection change.
7. **Evidence.** Always captured: final screenshot, meminfo, gfxinfo, events and the command log.
8. **Post-failure probe.** If the launch fails while a projection exists, the scenario also runs the calibration and one centre tap. These steps are marked `secondary: true` in `steps[]` and never change the primary class.

**Classification.** The first failed assertion decides the class. A runtime error seen in the same window as a missing link turns the class into `RUNTIME_ERROR`. Owners:
- `MARKER_PRESENTATION` → Scene Presentation;
- `ENVIRONMENT` → human or Technical Lead;
- all other classes → Implementer.

Only `ENVIRONMENT` allows a retry without a code change. A missing or unauthorized device gives `BLOCKED` / `HUMAN_REVIEW_REQUIRED`, and the only human action requested is "connect and authorize the Android device".

## Device Validator agent

`.claude/agents/device-validator.md` + `agents_specs/device_validator.md`.
- Runs the harness on a provided APK and accepts a FAIL class only after two consecutive runs agree, with at most 3 runs.
- Routes by `next_owner`.
- Never edits code, never builds or touches the build config, and never judges look or feel.
- Decisions: PASS, CHANGES_REQUESTED, HUMAN_REVIEW_REQUIRED, BLOCKED.

## Real-device result (CPH2747, Android 16, 2772×1272 landscape)

**C3 = FAIL / RUNTIME_ERROR.** The class was identical on 4 consecutive runs; APK `temp/gate/ProjectAutomata-infra001-eed2a80-dirty-factoryworld.apk`, sha256 `1ff8f60f…`.

**Root cause, proven by the logcat stack.** `ProducerSelectionController.start()` → `rebuildTargetIndex()` → `addComponent(ProducerHighlight)` → `ensureMarker()` → `addComponent(MeshRenderer)` → `MeshRenderer.onLoad` → `_updateReceiveDirLight` throws `TypeError: Cannot read properties of null (reading 'lightProbeInfo')`.
- The scene has no globals: `Scene._activate` already threw `_globals.activate` (AUT-R-033).
- The exception aborts `start()`, so the target index stays empty (`targets: 0`) and every tap raycasts against nothing. That is the device-observed "no disc and no focus".

**Secondary probe on the device.**
- The calibration passes: the injected tap arrives exactly at the converted point.
- The centre tap arrives as a tap (`moved=0`, slop 38.16).
- `selection_raycast` reports `hit=null` with `targets: 0`.
- The logged ray crosses the target plane at about (−5.87, −2.98), inside the Fabricator rectangle. Input, tap classification and hit-test geometry are therefore not the cause.

The fix belongs to AUT-038 / AUT-R-033 (scene globals, or marker creation that does not depend on them). It is outside this task, and this task does not change it.

## Validation

- `npm run check` passes. The existing tests are unmodified.
- 39 new harness tests:
  - protocol;
  - raycast equivalence;
  - every class, PASS, calibration and precedence;
  - adb parsing, selection, timeouts and typed errors;
  - schema and cross-field rules;
  - gate build: byte restore on success, failure and exception, dirty refusal, recovery;
  - simulated-device C3: PASS, three broken builds, the runtime-error case, no device, install failure, missing APK.
- The gate build and the standard CameraSpike `npm run android:build` both succeed. The tracked build config is clean afterwards.

## Pending / not validated here

- **Residual risk (TL):** the main-path calibration self-check and the full happy chain
  have not yet run on a device. The only device calibration so far came from the
  secondary probe, where it matched exactly. The first C3 run after AUT-R-033 is their
  proof. If the main-path self-check fails then, that is an AUT-INFRA defect (follow-up
  AUT-INFRA-001a), not a C3 class.

- C3 PASS needs the AUT-038 fix and a device re-run with this harness.
- The `[AUT-038-HG]` cleanup stays with the AUT-038 closure.
- Subjective gates (visual, camera feel, game feel) remain human.
- The `device-validator` agent registers after a session restart.
