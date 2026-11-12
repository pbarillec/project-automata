# AUT-042 Robot Line Visual & Era II Reveal

**Human gate: PENDING** (device screenshots at Lv1 and Lv10, reveal feel, line readability, population on the Line route).
Automated checks prove layout geometry, state resolution, wiring and determinism only. Presentation only: no economy, runtime, data,
save, camera-API/framing, HUD-text or art-direction change; existing AUT-032 Kenney assets only (no new asset file).

## What was built

Pattern as AUT-039/040/041: pure engine-free modules (explicit `.ts` imports) + thin `cc` controller, wired at runtime.

- `RobotLineLayout.ts` (pure): world layout, module -> asset mapping (`ROBOT_LINE_PREFAB_SLOTS`, index-aligned with the serialized
  `robotLinePrefabs`), transforms, slab, lip plate, lamps, belt tiling, reveal target, `robotLineLocal`.
- `RobotLineVisualStateResolver.ts` (pure): `unbuilt` (AUT-033 inactive shell kept) -> `line_lv1` -> `line_lv10` (level >= 10; Lv25+ keep it).
- `RobotLineProduction.ts` (pure): belt clock -> pooled fake items (2 at Lv1 / 4 at Lv10), golden-ratio phases, 0.5 u/s (x1.2 at Lv10),
  chassis -> Robot swap under machine 1, Lv10 second machine as a tunnel, scale-hide at entry/lip, recycle counter; arm timer cycle (yaw +/-12, nod 3 deg).
- `RobotLineExitRoute.ts` (pure): Line -> Exit -> Storage loop (lip stop (5.3,-1.9) -> over the slab edge -> spine crossing (4.3,-0.3) -> south lane ->
  storage stop (-0.25,0.7) beside the crate face -> return), 17.7 s lap, `Robot_Walking` / `Robot_Idle` only.
- `RobotLineRevealViewModel.ts` (pure, read-only): remembers whether the Era II change (`eraChanged` -> `automated_factory`) was seen live (event or snapshot
  transition), reports it once on the construction beat; a load never counts. No title/door/light sweep (AUT-048).
- `RobotLineVisualController.ts` (`cc`): modules from `robotLinePrefabs`, belt group of 6 conveyor instances, 8 lamp primitives (graphite off / cyan 82,206,224 on,
  construction `lightLevel` flickers them at activation, no dynamic light), 4 pooled chassis + 4 pooled Robot instances, arms, ConstructionTarget
  (`getConstructionModuleIds`, `setConstructionSample`, `onConstructionActivated`), one bounded focus beat through the existing
  `MobileCameraController.focusOnRevealTarget` (target (3.0, 0.3, -1.7), reveal anchor `RobotLine_RevealAnchor`), DEBUG `robot_line_state`
  (`synced`, `construction_started`, `focus_requested`, `activated`, `item_cycle`). Visibility by scale, never `node.active`.
- Population (AUT-041 extension): `resolvePoolRobotRoute` sends pooled slots 1, 4, 7, ... (ranks 2, 5, 8, ...; about one third) to the Line loop once the line is built;
  `RobotPopulationSnapshot.robotLineBuilt`; no new instances, Robots Built mapping unchanged; a live route change re-scales the robot in, a load starts on its route.
- Floors: `floorHeightAt` gains the Robot Line slab (0.16) and the RobotLine zone foundation (0.12).
- Wiring: `FactoryWorldBootstrap.createRobotLineSlice` / `connectRobotLinePresentation` (slab, lip, lamps, reveal anchor), second ConstructionTarget
  `robot_line` (sparks anchored on the line), `PresentationController.robotLineVisual`. Scene file: one new serialized array `robotLinePrefabs` (8 refs).
- Device helper: `npm run device:seed-aut042 -- --variant unbuilt|lv1|lv10` (`tools/device/seed_aut042.ts`; default `unbuilt` = affordable Era II build at
  2x 500,000 Output, Era still Manual Workshop so the Era II change is seen live; `lv1` / `lv10` = built, Automated Factory era). Not run on a device.

## Final layout (world)

| Module | Asset | Position, rotY, scale | Extent / top |
|---|---|---|---|
| `foundation_slab` | primitive grey box | centre (3.0, 0.14, -1.9), 4.8 x 0.04 x 2.0 | x 0.6..5.4, z -2.9..-0.9, top 0.16 |
| `entry_gate` | `structure-high` | (0.75, 0.16, -1.9), 0, 0.78 | z -2.33..-1.47, top 1.33 |
| `feed_corner` | `conveyor-corner` | (0.9, 0.16, -1.2), 0, 0.5 | x 0.65..1.15, z -1.45..-0.95 |
| `belt` | 6 x `conveyor` | tiles x 1.5..4.5 step 0.6, 0.6 | x 1.2..4.8, top 0.40 |
| `machine_a` / `machine_b` (Lv10) | `machine` | x 2.4 / 3.9, 0.5 | top 0.81 |
| `arm_a` / `arm_b` (Lv10) | `robot-arm-a` / `-b` | (3.2 / 4.6, 0.16, -2.45), 0.36 | tops 1.312 / 1.24 |
| `status_panel` (Lv10) | `screen-panel-wide` | machine_a roof (2.4, 0.81, -1.9), -90, 0.3 | top 1.107 |
| `output_lip` | primitive box | (5.0, 0.28, -1.9), 0.4 x 0.24 x 0.5 | x 4.8..5.2, top 0.40 |
| items | `box-large` 0.25 / `Robot.glb` 0.15 | belt top 0.40 | robot top 1.08 |

Highest element 1.33 (below the intent's 1.35 and the Fabricator press 1.505).

## Measured AUT-032 GLB facts (POSITION bounds, unit scale)

conveyor 1.0 x 0.4 x 1.0; conveyor-corner 1.0 x 0.45 x 1.0; machine x -0.6..0.6, y 0..1.3, z -0.75..0.75 (single solid mesh, so the belt runs inside it and
the block hides the chassis -> robot swap); robot-arm-a 1.0 x 3.2 x 1.0; robot-arm-b 1.0 x 3.0 x 1.0; structure-high 0.3 x 1.5 x 1.1; screen-panel-wide 1.2 x 0.991 x 0.658;
box-large 1.1 x 0.55 x 1.0; all pivots are bottom-centre. Robot.glb bind height 4.513 (skinned, not measured via POSITION).

## Deviations from the Art Director intent (reasons)

1. **Shortened line** (slab x 0.6..5.4, six 0.6 conveyors x 1.2..4.8, lip x 4.8..5.2, item travel 1.2..5.2) instead of x 0.5..6.5 / 7 conveyors / lip 6.0. The intent
   asked for this fallback: at the default portrait view the slab corner at x 6.5 projects to screen x -0.98 (the camera is untouched). Machine 2 / arm-b sit at 3.9 / 4.6.
2. Arm scale 0.36 (not 0.4): robot-arm-a is 3.2 tall, 0.4 would reach 1.44 > 1.35.
3. Gate frame at x 0.75, y 0.16, scale 0.78 (not (0.6, 0, -1.9) at ~0.9): it stands on the slab (the slab starts at 0.6) and stays <= 1.35.
4. Lamps: machine lamps on the camera-side face, arm lamps on the slab beside each base, so nothing sits on the panel roof or above 1.35.
5. Exit route pulled in for the default view: lip stop (5.3,-1.9) not (6.0,-1.9); spine crossing at x ~4.3, south lane z 0.3..0.7, not z 0.8 / x 5.9; the storage stop is
   (-0.25, 0.7) because (-0.4, 0.95) is inside the crate (x -1.24..-0.36). Robots at the lip stop sit ~2% inside the screen edge (route test bound 1.0 vs 0.98 for structures).
6. Population share: slots `% 3 == 1` (about one third of the pool) instead of "ranks >= 2 alternating" (which is about one half).
7. `feed_corner` is a stub at the slab's north-west corner (intent position, rotY 0) rather than a connected turn to the belt axis z -1.9; its orientation is a guess.
   The GLB inlet/outlet orientation of conveyor-corner and the belt flow axis were not verified visually.

## Tests (`npm run check`: PASS, 646 tests; pacing regression 4/4 PASS)

- `tests/robot_line_visual.test.ts` (19): scene prefab alignment (8 refs, AUT-032 only, forbidden assets absent); measured GLB bounds; modules on the slab,
  <= 1.35 and below the press, no interpenetration (declared contacts: belt under machines, panel on machine 1), contiguous belt; lamps, arm swing and items fit;
  footprint inside the build area and clear of Assembly, storage crate, Fabricator, spine; `floorHeightAt`; everything on screen at the default and reveal views;
  resolver (unbuilt / Lv1 / Lv10 / Lv25+ / Reboot, deterministic, read-only); production periodicity, recycle, swap, tunnel, stagger, cadence; arm cycle; exit route
  (periodic, clips, floor, clearance of line + crate, on screen, spine crossing, crate approach); population allocation + view model + controller wiring; ConstructionViewModel
  order, no replay on load, one activation, Reboot replay; Era II reveal view model (load never, live once, dedupe, Reboot); engine-free / command-free / no ctor parameter
  properties; bootstrap, registry, ConstructionTarget registration, reveal API reuse, no `.active = false`, no lights, `robot_line_state` declared and emitted, metas.
- `tests/device_aut042_seed.test.ts` (2): seeded unbuilt/Lv1/Lv10 saves round-trip; command registered.
- No existing test needed changing (the population tests pass untouched; `RobotSlotVariation` gained `phaseFraction`, `RobotPopulationSnapshot` gained `robotLineBuilt`).

## Pending / open risks

- **Human gate (pending):** device screenshots at unbuilt / Lv1 / Lv10 (`npm run device:seed-aut042 -- --variant ...`), the live reveal (build from the Producer Panel: sequence
  order, one focus beat, lamps on, belt starting), readability of the line and the Line-route robots, camera feel of the focus beat. A gate APK (FactoryWorld start scene) must be built
  for this; none was built here.
- Unverified visually: conveyor flow axis and conveyor-corner orientation, machine.glb being a solid block, robot-arm yaw/nod pivot (bottom-centre), Robot.glb facing +Z (so heading 90
  faces +X), belt-item sizes, lamp visibility, pooled-robot lateral offsets near the lip plate and spine.
- A pooled robot switches to the Line route the moment the state shows the line built, i.e. at the start of the 2.2 s construction (it scales in at the lip before the belt starts).
- The AUT-040 sparks are the six shared nodes under the Assembly composition (anchored on the line); the line's own `lightLevel` use is limited to lamp flicker.
- Android: 4 extra Robot instances + 4 box instances + 1 belt/arm/machine set; the AUT-041 benchmark (30 robots ~53 fps on one DEBUG device) was not re-run with the line.
- Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`). Out of scope by plan: Automated Cell, Era II title/door/light sweep (AUT-048).

## Real-device gate prepared (2026-11-12, device 1100a155, portrait 1080x2412)

Gate APK (FactoryWorld DEBUG, built from `5968288`, tracked build config restored): `temp/gate/ProjectAutomata-aut042-5968288-factoryworld.apk`,
sha256 `8b52f1e0684da1d8ffcf7825c19c4cdbd59b106760fffb167812c4cce79b8100`; installed. Presence screenshots only (not a verdict): `temp/aut042/lv1.png`, `temp/aut042/lv10.png`
(Robot Line visible south-west of the Assembly slice at both levels, Lv10 adds the second machine/arm and more belt items, robots walk the Line route, no errors in the
seeded launches). Seeds: `npm run device:seed-aut042 -- --variant unbuilt|lv1|lv10`.

Human gate checklist: (1) `unbuilt` seed: select the Robot Line and build it: ~2.2 s construction, one bounded camera focus, lamps/belt start, chassis -> robot items on the belt;
(2) Lv1 and Lv10 read as a long, low line and a more convincing one at Lv10; (3) Workshop stays visible, no separate map; (4) robots on the Line -> Exit -> Storage route are
readable and relieve the station clustering; (5) relaunch shows the built line instantly, no replay. Result: **PENDING**.
