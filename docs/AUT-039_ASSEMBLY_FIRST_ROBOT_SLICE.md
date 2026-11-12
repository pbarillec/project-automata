# AUT-039 Assembly + First Worker Bot Vertical Slice

**Product human gate: PASS (2026-11-12)**, combined with the AUT-GP-001 batch feel (comprehension, automation
relief, Next Goal clarity, first visual growth, First Robot payoff). The automated checks below do not
validate any of these, nor visual quality, readability, camera feel or felt pacing.

Presentation only. No economy, runtime, data, save, camera-API/framing, progression, HUD-text or art-direction
change. Civilization 1 slice; Civilization 2+ keeps working (no focus beat, see below).

## What was built

Pattern: pure resolver / view model / route (engine-free, unit-tested) + thin `cc` controllers.

- **`AssemblySliceLayout.ts`** (pure): world layout of the slice inside the Art Director intent of
  2026-11-11. Module → asset mapping (all AUT-032 imports, nothing new), module transforms, grey slab, bay
  lamp, Worker Bot scale (0.24 → 1.08 tall), reveal target, shell floor heights.

  | Module | Asset | World position, rot Y, scale | When |
  |---|---|---|---|
  | `foundation_slab` | primitive box (WorkshopFoundation grey) | x −3.3..−1.0, z −2.8..−0.65, top 0.16 | built |
  | `workstation_bed` | `machine-bed` | (−2.9, 0.16, −1.45), 90, 0.5: inlet faces the spine, outlet faces the station | built |
  | `input_corner` | `conveyor-corner` | (−2.9, 0.16, −0.9), 0, 0.5: bed inlet → spine edge | built |
  | `assembly_arm` | `robot-arm-b` | (−1.85, 0.16, −2.35), 0, 0.4 (top 1.36) | Lv10 |
  | `status_panel` | `screen-panel-wide` | on the bed inlet roof (−2.9, 0.785, −1.45), −90, 0.3; pulses while automated ("panel lit") | Lv10 or automated |
  | `robot_bay` | `structure-high` | (−3.4, 0, 0.7), 27 (opening toward the first entry leg), 1 | Lv10 or robot |
  | `storage_crate` | `box-large` | (−0.8, 0, 0.95), 0, 0.8 | Lv10 or robot |
  | bay lamp | primitive boxes (off: shell graphite; on: cyan 82/206/224, the CameraSpike cyan) | on the frame top (−3.4, 1.54, 0.7) | lit while the robot exists |

  Every Lv10 module stays shorter than the Fabricator press (1.505). The slice is clear of the Fabricator
  zone (including its Lv25–Lv100 expansion), the spine and Robot Line (x ≥ 0.5).
- **`AssemblyVisualStateResolver.ts`** (pure): `unbuilt` (AUT-033 inactive shell kept) → `workstation` (Lv1)
  → `worker_bot_frontier` (Lv10) → `automated` (Worker Bot owned / `first_robot` flag, or Assembly automated).
  Building the station swaps the shell for the built model (no construction sequence until AUT-040). Lv25+
  keep the Lv10 composition (out of scope). Worker Templates (Worker Bot below Lv10) shows the robot, bay and
  storage; A3 Inherited Automation (automated without Worker Bot) lights the panel but shows no robot.
- **`WorkerBotRoute.ts`** (pure, deterministic): one robot, predefined waypoints, no pool/AI/pathfinding.
  Reveal: `Robot_ThumbsUp` once at the bay (1.6 s), then `Robot_Walking` bay (−3.4, 0.7) → (−2.6, 0.3) →
  station (−1.8, −1.3); the reveal beat is 3.0 s (`WORKER_BOT_REVEAL_SECONDS`); the robot reaches the station
  at ~4.6 s and the loop starts. Loop: station (`Robot_Idle` 2.5 s, facing the bed) → spine crossing
  (−1.4, −0.3) → storage pick (−0.8, 0.45; `Robot_Idle` 1.0 s) → return (−1.2, −0.3) → station; ~7.8 s/lap.
  `Robot_Running` is never used. Feet follow the shell floor heights. Walk speed 0.9 u/s and the dwell times
  are implementer tuning values (Scene Presentation).
- **`FirstRobotPresentationViewModel.ts`** (pure): the live Worker Bot unlock in Civilization 1 (the robot
  appears in a fanned-out runtime snapshot; `firstRobotProduced` is deduplicated) requests one reveal;
  `syncFromState` (save load) rebuilds the robot directly in its loop and never reveals; Civilization 2+ puts the robot in its loop with no focus beat (the short acknowledgement is
  deferred); a state without Worker Bot (Reboot) hides it. Read-only: no command, no state write.
- **`AssemblyVisualController`** / **`FirstRobotPresentationController`** (`cc`, thin): modules from the
  prefabs serialized on `FactoryWorldBootstrap` (`assemblyPrefabs`, index-aligned with
  `ASSEMBLY_SERIALIZED_PREFAB_MODULES`; `robotPrefab` = `Robot.glb`), visibility by scale (AUT-038 Android
  rule), one Robot instance whose clips cross-fade, the bay lamp, and one bounded focus through the existing
  `MobileCameraController.focusOnRevealTarget` (focus distance 9.5) on `FirstRobot_RevealAnchor`
  (−2.6, 0.2, −0.3), the middle of the entry path. Camera gestures keep ownership of interruption.
- **Wiring:** `FactoryWorldBootstrap.createAssemblySlice` / `connectFirstRobotPresentation`;
  `PresentationController.firstRobotPresentation` receives the same `syncAutomationState` /
  `consumeDomainEvents` fan-out as the AUT-038 payoff. `FactoryWorldStateBinding`, the runtime and the HUD are
  unchanged. The scene file gains the two serialized prefab properties only.
- **DEBUG diagnostics:** new `robot_state` event (`synced`, `reveal_started`, `reveal_complete`,
  `loop_started`, `waypoint`). Release builds never emit.
- **Device harness:** scenario `aut039` (`npm run device:aut039 -- --apk <apk>`): seeded save (Fabricator
  Lv15 automated, Assembly Lv10, Output = Worker Bot cost) → Next Goal tap → `purchaseBreakthrough worker_bot`
  ok with `firstRobotProduced` → `reveal_started` (Civ 1, focus on the reveal anchor) → `reveal_complete` →
  `loop_started` → ≥5 loop waypoints in route order → HOME (suspend save) → force-stop → relaunch →
  `synced` present/loop, no reveal replay, waypoints continue; zero `error` events.

## Tests

- `tests/first_robot_slice.test.ts`: resolver states (incl. Worker Templates, A3, Lv25+); view-model
  load-without-replay, one reveal, Civ 2+, Reboot; runtime smoke (Worker Bot purchase → `firstRobotProduced`
  → reveal; presentation leaves the state untouched, no robots-built or producer change = no economic worker
  entity; save round-trip → loop, no replay); seeded Next Goal = Worker Bot; route entry/loop/clips/player;
  pure modules engine-free and command-free.
- `tests/assembly_slice_scene.test.ts`: scene prefab alignment and resolution; only AUT-032 assets; bootstrap
  and registry wiring; reveal API reuse; no `active = false`; `robot_state` declared; GLB-bounds geometry
  (floor contact, on the slab, below the press, no interpenetration, clear of Fabricator/spine/Robot Line);
  route clearance; everything on screen at the default portrait view and in the reveal focus.
- `tests/device_aut039_scenario.test.ts`: seeded save, loop evaluation, reveal-target check, CLI registration.

## Validation

- `npm run check`: PASS (600 tests, config, Android Ads config, pacing regression 4/4 PASS).

## Device (NE2215, Android 15, 1080 × 2412 portrait)

Gate APK `temp/gate/ProjectAutomata-aut039b-1c2c5f6-dirty-factoryworld.apk` (sha256 `a279405c…`), built
with `device:gate-build`; the tracked build config was restored byte-identical (SHA-256 checked, `git status`
clean for it).

| Scenario | Result |
|---|---|
| aut039 | PASS `aut039-first-robot-20261111T162921Z-a279405c` (51/51, installs) and `…T163243Z…` (50/50, `--skip-install`) |
| c3 | PASS `…T163035Z…` (89/89) |
| int001 | PASS `…T163051Z…` (23/23) |
| r036 | PASS `…T163109Z…` (70/70) |
| ui001 | PASS `…T163124Z…` (152/152) |
| r031 | PASS `…T163154Z…` (82/82) |
| gp001 | PASS `…T163210Z…` (44/44) |

Regressions used `--skip-install` on the same APK. The first aut039 run (`…T162702Z-f89fdb74`, previous APK)
failed `robot_reveal_started`: the binding's tick fan-out delivered the post-purchase snapshot (Worker Bot
owned) before the purchase batch carrying `firstRobotProduced`, because `submit` awaits its save request; the
view model took the no-event branch and put the robot straight into its loop. Fixed in the view model (the
live hidden → present transition starts the reveal; the event is deduplicated) with a regression test; the
rebuilt APK passes.

Portrait screenshots (copied to `temp/aut039/`): `02-worker_bot_frontier.png` (Lv10, dark bay),
`03-reveal_activation.png` (bay lamp on, robot activating in the frame, reveal push-in),
`04-reveal_complete.png`, `05-robot_loop_1.png` / `06-robot_loop_2.png` (robot at the station / on route),
`07-relaunch_loop.png` (relaunch, default view, robot on route, no replay). Presence evidence only, not a
readability or feel verdict. The DEBUG FPS overlay covers the bottom panel (debug-only, as in earlier gates).

## Pending / for other owners

- **Human gate (product, combined with GP-001):** comprehension, automation relief, Next Goal clarity, first
  visual growth, First Robot payoff; also robot scale/facing, route readability and reveal timing.
- **Scene Presentation:** the exact composition (bed/corner/arm placement, `conveyor-corner` orientation,
  robot scale 0.24, walk speed, dwell times, the robot stopping 0.1 from the crate face at the storage pick)
  is an implementer proposal inside the art intent; polish goes to an `AUT-VIS-xxx` follow-up.
- **Art Director:** the bay lamp colours (graphite off / existing cyan on) and "panel lit" as a pulse of the
  existing panel are implementer readings of "light switching on" / "panel lit"; the custom robot bay door
  remains a SHOULD_CREATE gap. Robot.glb is assumed to face +Z.
- Deferred by plan: the Civilization 2+ short acknowledgement, AUT-040 construction sequence, AUT-041
  population/pool, Assembly Lv25+ states.

## Human gate result (2026-11-12): PASS

Combined AUT-GP-001 / AUT-039 product gate: progression clear, Assembly batch feels fine, Worker Bot reveal
works as a reward, automation relief clear, factory growth visible, relaunch behavior correct.

Non-blocking UI follow-ups (do not block AUT-GP-001 or AUT-039):
- hide the grey FPS/debug overlay in gate/product builds;
- current actions are mostly text-only clickable labels; replace later with clearly styled buttons / stronger affordance.
