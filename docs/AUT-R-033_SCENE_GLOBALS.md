# AUT-R-033 FactoryWorld Scene Globals

`FactoryWorld.scene` was serialized with `"_globals": null`. On device this broke two things:

1. `Scene._activate` threw `TypeError … (reading 'activate')`, so ambient, shadow and skybox settings were never activated.
2. Every `MeshRenderer` created at runtime after scene load threw `TypeError … (reading 'lightProbeInfo')` in `_updateReceiveDirLight`.

The AUT-INFRA-001 device harness showed the second error aborting `ProducerSelectionController.start()`. The call chain was `rebuildTargetIndex` → `ProducerHighlight.ensureMarker` → `addComponent(MeshRenderer)`. The selection target index stayed empty (`targets: 0`), so taps never selected a producer. That was C3 "no disc, no focus".

## Fix

- The scene now references a `cc.SceneGlobals` object. Seven objects were appended at indices 16–22: `SceneGlobals`, `AmbientInfo`, `ShadowsInfo`, `SkyboxInfo`, `FogInfo`, `OctreeInfo` and `SkinInfo`.
  - Every value is copied from `CameraSpike.scene`. `Main.scene` and `AssetRobotSpike.scene` use the same project-standard set.
  - Ambient: sky illumination 20000, LDR sky (0.2, 0.5, 0.8), ground albedo 0.2.
  - Shadows, skybox, fog, octree and skin are all disabled.
  - No new lighting values or tuning were introduced.
- The edit was made by hand, not through the editor:
  - Objects 0–15 are byte-identical apart from the `_globals` line.
  - No existing `__id__` shifted.
  - CRLF line endings and 2-space indentation are preserved.
- No script, prefab, camera, composition, gameplay, economy or progression change. There is no `ProducerHighlight` workaround: the scene defect is fixed at its source.
- Test: `tests/factory_world_scene_globals.test.ts` checks two things:
  - `_globals` resolves to a `SceneGlobals` object whose six info blocks resolve to the correct types;
  - their values deep-equal CameraSpike's (shadows, skybox and fog disabled).

## Expected visual impact

The shell boxes use `builtin-unlit` and are unaffected. The imported Fabricator modules use `builtin-standard` and now receive the project-standard ambient light, so their shading may change. The owner must re-check this visually on the approved AUT-038 composition.

## Validation

- `npm run check` passes (350/350); existing tests are unmodified.
- Gate build: `npm run device:gate-build -- --label r033` produced APK `temp/gate/ProjectAutomata-r033-f04876c-dirty-factoryworld.apk` (sha256 `d147e5c1…`). The tracked build config is clean afterwards.
- Operational note: do not run `npm run check` while a gate build is running. `camera_scene_smoke` reads the temporarily switched start scene and fails.

## Device result (NE2215, Android 15, 2412×1080)

The owner swapped phones between tasks. The CPH2747 used for AUT-INFRA-001 was not attached.

**C3 PASS on 2 consecutive Device Validator runs** (`temp/device/c3-producer-selection-20261105T091141Z-d147e5c1`, `…091213Z…`). All 44 assertions held in each run.

- No `_globals` or `lightProbeInfo` TypeError appears in logcat. `scene_ready` reports `targets: 5`.
- The **main-path calibration self-check passes**: adb (96, 86) → Cocos (96, 994). This closes the AUT-INFRA-001 residual risk.
- **Tap Fabricator:**
  - the tap registers;
  - the raycast hits Fabricator;
  - selection goes null → Fabricator;
  - the marker becomes active;
  - camera focus goes requested → started → settled.
- **Tap AssemblyStation:**
  - the raycast hits AssemblyStation;
  - selection goes Fabricator → AssemblyStation;
  - the previous marker is cleared and the new one is active;
  - camera focus settles.
- **Swipe:** 603 px; classified as a drag, with no raycast and no selection change.
- Only two zones were tapped. On this screen the other zones' projected centres fall outside the 10% safe area. The harness requires at least two zones.
- Same-device control: the pre-fix APK (`eed2a80`) on the NE2215 still fails with `RUNTIME_ERROR` (`temp/device/before-r033-ne2215`). So the root cause and the fix are confirmed on two devices.
- The harness records `task_id: AUT-INFRA-001` because it is the CLI default. A `--task` flag is a small follow-up for `tools/device`, which is protected in this task.

## Human visual gate: PASS (owner, 2026-11-05)

Before and after on the same phone:

- `temp/device/before-r033-ne2215/screenshots/01-post_failure_ready.png` (no globals);
- `temp/device/c3-producer-selection-20261105T091141Z-d147e5c1/screenshots/01-ready.png` (with globals);
- selected marker: `…/03-tap_2_AssemblyStation.png`.

The owner tested on the phone and accepted the change. Producer selection works: a tap selects the producer, the camera focuses, and the marker appears. The yellow selection disc looks rough. That is not a blocker for AUT-R-033 and becomes a separate presentation/UX follow-up. C3 no longer blocks AUT-038.
