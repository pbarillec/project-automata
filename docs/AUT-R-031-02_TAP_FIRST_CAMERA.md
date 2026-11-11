# AUT-R-031-02 Tap-First Camera Input

**Human gate result (2026-11-11): PASS.** The owner passed the combined portrait / tap-first gate on the NE2215 (gate APK `05f75b1a`): HUD and panel usable, producer selection, Manual Produce and tap-first camera behaviour correct. The provisional values are kept. The debug FPS overlay over the bottom panel is debug-only, not a product blocker. The PENDING notes below are historical.

FactoryWorld camera input now follows the owner's tap-first model (decision 2026-11-10):

- a tap selects a producer;
- a one-finger drag pans the camera, clamped to the unlocked zones, and is never a tap;
- the player cannot rotate, zoom or use multi-touch;
- automatic focus and reveal beats stay.

**Camera feel human gate: PENDING.** It is judged at the AUT-R-036-02 combined gate (portrait
orientation, layout and framing). This includes pan speed and direction, the bounds margin, the
eased distance changes and multi-touch rejection. The automated checks below do not validate any
of these. The device is still in landscape in this task.

## What was built

- **Capability flags** on `MobileCameraController`:
  - `oneFingerMode: 'orbit' | 'pan' | 'none'`, default `'orbit'`;
  - `multiTouchEnabled`, default `true`.

  The defaults keep the AUT-031 CameraSpike gesture set, and `CameraSpikeBootstrap` sets neither
  flag.
- **Gesture routing** goes through `applyCameraGestureInput` in `CameraMath` (pure and
  unit-tested).
  - `'orbit'`: a one-finger drag calls `applyOrbitDelta`.
  - `'pan'`: a one-finger drag calls `applyCameraRelativePan` at the existing pan speed. Yaw,
    pitch and distance never change.
  - `'none'`: a one-finger drag does nothing.
  - `panZoom` (pinch + two-finger pan) applies only when `multiTouchEnabled` is true.
  - A switched-off gesture is a no-op: the camera does not move, and a running focus beat keeps
    running. An applied gesture still interrupts the beat and emits `camera_focus cancelled`
    (with reason `orbit`, `pan` or `panZoom`).
- **Pan bounds**:
  - `setFocusBounds(bounds | null)` sets the bounds that clamp the player's pan.
  - A pan clamps to those bounds, grown just enough to contain the current focus
    (`expandCameraBoundsToInclude`). So when a focus beat has left the focus outside the bounds,
    for example a selection focus on a locked zone, a pan never snaps the camera and never moves
    the focus further out.
  - Focus beats, the initial view and snaps keep the global serialized bounds (`focusMin/Max*`).
    Selection and reveal targets are unchanged.
  - Setting the bounds never moves the camera.
- **Distance policy** (TECHNICAL_DESIGN §13.3):
  - `focusOnWorldTarget` (selection, still called by `ProducerSelectionController`) eases back
    to `defaultDistance`.
  - The new `focusOnRevealTarget` (reveal beat) eases to `focusDistance`, or to `defaultDistance`
    when `focusDistance` is 0.
  - In both cases the distance eases with the same smoothstep and duration as the focus
    transition (`resolveFocusBeatDistance` / `easeFocusDistance`).
  - Before this task, every focus snapped the distance to `focusDistance` (9.5 in FactoryWorld)
    and never came back.
  - `camera_focus started` now reports `kind`, the `distance` used, `fromDistance` and
    `defaultDistance`.
- **`presentation/FactoryZoneLayout.ts`** (new, engine-free):
  - `ZONE_LAYOUT`, moved unchanged from the bootstrap;
  - the `FactoryZoneId` type;
  - `producerIdForZone`, which reuses `FACTORY_WORLD_SELECTION_PRODUCER_IDS` (no copy).

  `FACTORY_ZONE_IDS` stays exported from the bootstrap: the existing scene tests read it there.
- **`presentation/CameraPanBounds.ts`** (new, engine-free):
  - A zone is unlocked for the camera when `evaluateProducerBuildProgression` reports
    `available` or `already_built`. The Fabricator zone is always included. There is no new
    progression rule.
  - `resolveCameraPanBounds(repository, state, layout, margin, globalBounds)` returns the union
    of the unlocked zone footprints, grown by `margin` and intersected with the global focus
    bounds.
  - `CAMERA_PAN_BOUNDS_MARGIN = 1` world unit. This is a small constant, not tuning.
  - With a fresh save the bounds are `x -9..-2.5, z -6..0`. They contain the default focus
    `(-3.8, -1.8)`.
- **`FactoryWorldStateBinding`**: an optional `camera?: { syncPanBounds(state) }` sink. It
  receives the same snapshots as the automation sink, in `init()` and in each fan-out, after the
  view refresh.
- **`FactoryWorldBootstrap`**:
  - imports `ZONE_LAYOUT`;
  - sets `oneFingerMode = 'pan'` and `multiTouchEnabled = false` on the FactoryWorld rig;
  - wires the camera sink:
    `setFocusBounds(resolveCameraPanBounds(..., controller.getGlobalFocusBounds()))`.

  The framing values are unchanged.
- **DEBUG-only `camera_state`** (new `DeviceDiagnostics` type). It is emitted two frames after a
  camera gesture ends (the controller's `onCameraGestureEnded` hook is wired only when
  diagnostics are enabled). It carries:
  - `{ yaw, pitch, distance, focus, bounds, input, screen, zones }`;
  - `zones`: each zone's `SelectableTarget` projected through the WorldCamera, so the harness
    can tap the Fabricator after a pan, since `zones_projected` is only emitted after a focus
    settles.
- **`FirstAutomationPresentationController`**: the reveal calls `focusOnRevealTarget` (one line).
- **Device harness**:
  - `tools/device/scenarios/r031_tap_first_camera.ts` and the CLI entry `r031`.
  - The scenario clears saves and launches. It takes the baseline pose from the `scene_ready`
    projection.
  - It makes a short one-finger swipe outside the UI: the pose is unchanged, the focus moves
    and stays inside the bounds, there is no selection, and the swipe is not a tap.
  - It makes long swipes left, right, up and down: the focus is clamped on a bounds edge
    (±0.01) and the pose is unchanged.
  - It taps the Fabricator, projected from the latest `camera_state`: the C3 chain runs, and
    `camera_focus started` has `kind = selection` and `distance = defaultDistance`.
  - It checks for zero `error` events.

## Tests

- New tests:
  - `camera_input_flags`: the defaults equal the AUT-031 behaviour; pan, none and multi-touch
    off; beat interruption; the pan from outside the bounds; the controller wiring text.
  - `camera_pan_bounds`: a fresh state gives the Fabricator only; Assembly is included once
    buildable; built producers stay included; the bounds stay inside the global bounds and are
    deterministic; the layout is moved unchanged.
  - `camera_focus_distance`: the reveal pushes in; a selection after the reveal eases back to
    12.5; the easing helpers.
  - `tap_first_camera_wiring`: FactoryWorld sets pan / false and CameraSpike sets neither; the
    reveal uses `focusOnRevealTarget` and selection uses `focusOnWorldTarget`; the bootstrap
    imports the layout; the binding's camera sink; no `cc` in the new modules; the metas.
  - `device_r031_scenario`: simulated PASS, the run-as fallback, and five FAIL classes.
- Existing test changed: `first_automation_presentation.test.ts` pinned `focusOnWorldTarget`
  in the reveal. Only the call name changed, to `focusOnRevealTarget`, as the task allows.
- `npm run check`: green (526 tests, config, Ads config and pacing).

## Device evidence

The device was a OnePlus NE2215 (landscape), APK
`temp/gate/ProjectAutomata-r031b-c9bc1cf-dirty-factoryworld.apk` (sha256 `2cb9eb94…`). Each
scenario ran twice: the first run installed the APK, the second used `--skip-install`.

- r031: PASS ×2.
- C3: PASS ×2.
- INT-001: PASS ×2.
- R-036: PASS ×2.
- UI-001: PASS ×2.

The first gate APK (`r031`, sha `437cb4d9…`) clamped selection focus beats to the pan bounds.
C3 then failed twice at `tap_4_AdvancedRoboticsComplex`, because that zone projected under the
HUD. The fix limits the bounds to player pans, so focus targets are unchanged.

`tools/ci/cocos_android_debug_build.json` was restored byte-identical after each gate build.

## Not covered / pending

- Multi-touch (pinch, two-finger pan) cannot be driven through adb. It is covered by unit tests
  and by the AUT-R-036-02 human gate.
- Camera feel, pan speed (unchanged `panUnitsPerPixelAtDistance`) and the size of the margin
  are pending at the AUT-R-036-02 combined gate. On the NE2215, a 193 px swipe moves the focus
  about 4.4 world units.
- The CameraSpike scene also gets the new selection distance policy. Its `focusDistance` is 0,
  so a focus now eases back to its default distance (15) after a pinch. Its gesture set is
  unchanged.
- Portrait orientation, framing values and UI layout belong to AUT-R-036-02.
