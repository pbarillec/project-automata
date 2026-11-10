# AUT-038 First Automation Presentation

`AutomationPayoffViewModel` is a pure projection over the authoritative Fabricator
automation state and `automationStateChanged`/Auto Feeder event evidence. It never
executes a command or changes `GameState`. A save with Auto Feeder already owned
reconstructs the final feeder, input-conveyor, and autonomous-indicator composition
without replaying a payoff.

`FirstAutomationPresentationController` applies that projection to the existing
AUT-034 `FabricatorVisualController`, pulses the existing autonomous-cycle indicator,
and requests a short focus through the existing bounded
`MobileCameraController.focusOnWorldTarget` API. Camera gesture input remains the
owner of interruption; interruption cannot remove the authoritative automated
composition.

Identical event delivery is deduplicated. The breakthrough purchase and its related
automation event can arrive together but produce at most one first-automation focus
beat. No economy, progression, persistence, or simulation implementation is changed.

Presentation/wiring changes made for the Android device pass:

- `FabricatorVisualController` instantiates the approved AUT-032 Factory Kit modules
  from prefab references serialized on `FactoryWorldBootstrap` (`factoryPrefabs`,
  index-aligned with `SERIALIZED_PREFAB_MODULES`) instead of loading them at runtime,
  and toggles module visibility by scale so Android native never deactivates imported
  3D nodes.
- `MobileCameraController` gains scene-configurable `defaultFocusX`/`defaultFocusZ`,
  an optional `focusDistance` used by `focusOnWorldTarget`, and
  `applyConfiguredInitialView()`. Gesture handling, clamping and focus-transition
  logic are unchanged; `FactoryWorldBootstrap` sets the FactoryWorld framing values.

Remaining visual composition/polish is out of scope for AUT-038 and tracked
separately as `AUT-VIS-001`.

Visual correction (post device review): the automated state read as loose
assets because the modules ignored the measured AUT-032 geometry. All pivots
are bottom-centre, yet the press, hopper and product block were placed as if
centred (~0.5 above the floor). The conveyor travels along local X, but it was
lengthened on Z and rotated 71° off the press tunnel axis (also local X). The
output tray sat beside the press rather than at a tunnel mouth, and both status
panels were buried inside the press body. The Fabricator line is now composed
on one axis (rotation Y 90): feeder hopper resting on the upstream end of a
1.8-long input belt → input belt entering the press's input mouth → press on
the floor → output tray leaving the opposite mouth carrying the product block,
with both indicators on the press roof. The hopper is scaled to 0.9 so the
press stays the dominant silhouette. The reveal focus anchor targets the line
centre, and `focusDistance` pushes in to 9.5 (previously zoomed out to 16.5). A
stray `FactoryWorldRoot` offset (-0.35, 0, -0.1), introduced with AUT-038, was
restored to the AUT-033 origin. `tests/fabricator_composition_geometry.test.ts`
guards floor contact, axis alignment, mouth entry, hopper-on-belt and roof
placement against the real GLB bounds. Later-milestone module transforms
(Lv25+) still use the previous layout and need their own AUT-VIS pass. Device
readability remains a human gate.

## Closure

- The temporary human-gate (HG) showcase is removed: no `HUMAN_GATE_*` flags,
  timer-driven reveal, `debugSetVisibleModules`, `[AUT-038-HG]` logs or selection
  debug line remain. `FirstAutomationPresentationController.start()` schedules
  nothing and, in DEBUG builds only, reports `reveal_state` `idle`; the reveal is
  driven solely by the runtime focus beat (`started`/`complete` with source
  `runtime`). The AUT-034 debug-state API (`forceDebugState`/`clearDebugState`/
  `applyCurrentDebugState`) is kept.
- Limitation: FactoryWorld now shows the coherent empty starting state, because no
  runtime→FactoryWorld state connection exists yet. That wiring is pending in a
  bridge task to be queued before AUT-039.
- The automation payoff is proven by unit/scene tests
  (`automation_payoff_view_model`, `first_automation_presentation`,
  `first_automation_scene`, `fabricator_composition_geometry`) plus the HG-era
  device gate. The closure tests also guard the prefab index alignment (G1) and
  the FactoryWorld camera defaults (G2).
- Prerequisites: AUT-INFRA-001 / AUT-INFRA-001a (device harness, reveal signal)
  and AUT-R-033 (FactoryWorld scene globals). Commit `6f4cde6` is an approved
  camera prerequisite (`camera/**` is not ordinary AUT-038 scope); `63bd892` is
  repo hygiene, not AUT-038 scope.
- The yellow selection disc refinement is a separate AUT-VIS follow-up.
- Device result (post-closure build): gate APK
  `temp/gate/ProjectAutomata-aut038b-618607a-dirty-factoryworld.apk` (sha256
  `d525e6e3…`), NE2215 Android 15, 2412×1080. C3 PASS on 2 consecutive Device
  Validator runs (`c3-producer-selection-20261105T100019Z-d525e6e3`,
  `…100049Z…`), 44/44 assertions each. Only `reveal_state` `idle`/`none` is
  emitted (no `started`/`complete`/`pending`); the harness took the at-rest
  branch. No runtime error after `scene_ready` (targets 5), calibration passes,
  zero `[AUT-038-HG]` logcat lines. Harness `task_id` still records the CLI
  default `AUT-INFRA-001`.
- Empty-state screenshot: `…100019Z…/screenshots/01-ready.png` (initial view)
  and `02-tap_1_Fabricator.png` (Fabricator selected and focused). Coherence of
  the empty state is an owner visual check; pending.
- Factory scope note: step B also edits `ProducerSelectionController.ts`,
  `SelectionInput.ts`, `tests/selection_input.test.ts` (removing AUT-038's own
  temporary `eed2a80` diagnostics) and `tests/device_c3_scenario.test.ts`. These
  are outside the Factory task's current `allowedPaths` and need owner approval
  together with the prerequisite-baseline change before the final attempt.
