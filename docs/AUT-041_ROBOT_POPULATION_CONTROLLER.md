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
- Device benchmark 1/8/14/20/30 (frame time, memory) and the visual check are not done; they need a gate build and a seeded save with the matching Robots Built.
  The benchmark cap is available as `RobotPopulationViewModel({ maxVisible })` but is not wired to a DEBUG switch yet.
- Pooled robots reuse the Assembly <-> Storage loop only. Robot Line / Cell / Complex routes, background fakes and the Founder Robot come with later tasks (AUT-042+).
- Spacing/clutter, loop crowding at 12-14 robots and the lateral offsets are implementer values for Scene Presentation / the human gate.
