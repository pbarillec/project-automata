# AUT-041 RobotPopulationController

**Human gate: PENDING** (population readability, density and clutter on a real device) and the **device benchmark (1/8/14/20/30 robots) is NOT run yet**.
Automated checks prove mapping, pooling and wiring only. Presentation only: no economy, runtime, save, camera, scene-file or HUD change.

## What was built
- `RobotPopulation.ts` (pure): Robots Built -> visible robots from the approved ART_DIRECTION 15.2 anchors (1 -> 1, 10 -> 3, 100 -> 7, 1,000 -> 12, 10,000 -> 14),
  interpolated on log10, monotone, saturating at 14 (never 1:1). `maxVisible` (hard limit 30) stretches the curve for the device benchmark.
  Deterministic per-slot variation (golden-ratio loop phase, speed 0.92-1.08, lateral offset up to 0.12, scale 0.96-1.04), pose sampling on the existing
  AUT-039 loop (no new routes, no pathfinding/AI), and `RobotPopulationPool` bookkeeping (instantiate once, hide on shrink, reuse).
- `RobotPopulationViewModel.ts` (pure, read-only): projects `run.robotsBuilt` + the first-Worker-Bot fact into visible/pooled counts. No population without the
  first Worker Bot. The first sync (save load) is instant; only live growth scales in (0.6 s).
- `RobotPopulationController.ts` (`cc`, thin): rank 0 stays the AUT-039 Worker Bot; the others are pooled `Robot.glb` instances (lazy, never destroyed, scale-hidden
  per the AUT-038 Android rule), cross-faded `Robot_Walking` / `Robot_Idle` clips. DEBUG event `robot_population` (`synced` / `changed`).
- Wiring (runtime, no scene change): `FactoryWorldBootstrap` adds the controller on the Assembly composition anchor, `PresentationController.robotPopulation` feeds it
  from `syncAutomationState` / `consumeDomainEvents`.
- Tests: `tests/robot_population.test.ts` (10). `tests/factory_world_shell.test.ts` no longer forbids the name `RobotPopulationController` in the bootstrap (that guard
  predated this task). `npm run check`: PASS (621 tests, pacing 4/4).

## Pending / limits
- Visual/crowding check at 12-14 robots is the pending human gate; the 1/8/14/20/30 benchmark evidence is below.
- Pooled robots reuse the Assembly <-> Storage loop only. Robot Line / Cell / Complex routes, background fakes and the Founder Robot come with later tasks (AUT-042+).
- Spacing/clutter, loop crowding at 12-14 robots and the lateral offsets are implementer values for Scene Presentation / the human gate.

## Device benchmark (2026-11-12, device 1100a155, portrait 1080x2412, DEBUG APK `ProjectAutomata-aut041-0694d57-factoryworld.apk`)

DEBUG-only switch: the override file `population_benchmark.json` (`{ "maxVisible": N }`) is read only when `DEBUG` (`RobotPopulationController.onLoad`);
the app samples frame time (`FramePerfSampler`, 6 s warm-up then 3 x 5 s windows) and emits `robot_perf` / `robot_benchmark`. Run: `npm run device:bench-aut041`
(seeded save: Worker Bot owned, Assembly Lv10, Robots Built 1,000,000 so the cap decides). Evidence: `temp/aut041/benchmark-2026-11-12T1122/`
(summary.md, results.json, per-size logcat, meminfo, screenshot).

| robots | fps | avg ms | worst p95 ms | max ms | PSS MB | errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 57.8 | 17.30 | 21.47 | 34.55 | 250 | 0 |
| 8 | 57.5 | 17.39 | 21.18 | 29.13 | 278 | 0 |
| 14 | 56.5 | 17.70 | 22.31 | 32.09 | 302 | 0 |
| 20 | 56.0 | 17.86 | 22.75 | 28.36 | 313 | 0 |
| 30 | 52.8 | 18.95 | 24.94 | 29.86 | 346 | 0 |

Frame time stays near the ~60 Hz cap up to 20 robots and drops to ~53 fps at 30 (above the 14 baseline). Memory grows ~3-4 MB per robot. This is one DEBUG device and
evidence only; it is not a performance verdict or a device-class guarantee. Observation from the 14-robot screenshot (not a verdict): robots cluster around the
station/storage dwell points instead of spreading along the loop, because the loop spends most of its time dwelling there.
**Visual/crowding human gate at 12-14 robots: PENDING.**
