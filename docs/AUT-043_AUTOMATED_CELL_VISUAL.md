# AUT-043 Automated Cell Visual

**Human gate: ACCEPTED (2026-11-12)** (device screenshots at unbuilt / Lv1 / Lv10, the live reveal, contrast with the Robot Line).
Automated checks prove layout geometry, state resolution, wiring and determinism only. Presentation only: no economy, runtime, data,
save, camera-API/framing, HUD-text or art-direction change; existing AUT-032 Kenney assets only (no new asset file).

## What was built

Pattern as AUT-042, file for file: pure engine-free modules (explicit `.ts` imports, no constructor parameter properties) + a thin `cc` controller, wired at runtime.

- `AutomatedCellLayout.ts` (pure): world layout, module -> asset mapping (`AUTOMATED_CELL_PREFAB_SLOTS`, index-aligned with the serialized `automatedCellPrefabs`),
  transforms, slab, lamps, one-flow guide strip, item scales, reveal target, spark anchor, `automatedCellLocal`.
- `AutomatedCellVisualStateResolver.ts` (pure): `unbuilt` (AUT-033 inactive shell kept) -> `cell_lv1` -> `cell_lv10` (level >= 10; Lv25+ keep it).
- `AutomatedCellProduction.ts` (pure): clock-driven fake jobs (no per-item simulation): pooled box rides the input belt and scale-hides into the core, 1.2 s dwell,
  a Robot scales up at the output belt, slides out to z 1.05 and scale-hides. Slots evenly staggered. Arm yaw +-15 / nod 3 deg by timer (Lv1 period 2.4 s, arm 2 half a
  period out of phase; Lv10 period 1.9 s, arm 3 offset a third). Lamp blink once per cycle (8% off window, staggered).
- `AutomatedCellExitRoute.ts` (pure): the optional Cell -> Storage loop for pooled population robots (see below), 8.6 s lap.
- `AutomatedCellRevealViewModel.ts` (pure, read-only): descriptor + the single bounded focus beat of the live construction (no Era change of its own, no title/door/light sweep).
- `AutomatedCellVisualController.ts` (`cc`): modules from `automatedCellPrefabs`, 6 lamp pairs (graphite off / cyan 82,206,224 on, `lightLevel` flickers them at activation, no
  dynamic light), 2 guide parts (graphite off / ~40% cyan on), 3 pooled boxes + 3 pooled Robot instances (Robot prefab shared with the Worker Bot), arms, ConstructionTarget
  (`getConstructionModuleIds`, `setConstructionSample`, `onConstructionActivated`), one bounded focus through the existing `MobileCameraController.focusOnRevealTarget` at
  (2.3, 0.5, 1.9) on `AutomatedCell_RevealAnchor`, DEBUG `automated_cell_state` (`synced`, `construction_started`, `focus_requested`, `activated`, `item_cycle`). Visibility by
  scale, never `node.active`. The cycle starts after activation; a load shows the built cell instantly with no focus (the beat is raised only from the live
  `setConstructionSample`); Reboot (producer unbuilt) hides it and a new build replays, as in AUT-042.
- Floors: `floorHeightAt` gains the cell slab (0.16) and the AutomatedCell zone foundation (0.12).
- Wiring: `FactoryWorldBootstrap.createAutomatedCellSlice` / `connectAutomatedCellPresentation` (slab, lamps, guide, reveal anchor), third ConstructionTarget `automated_cell`
  (shared sparks re-anchored on the cell), `PresentationController.automatedCellVisual`. Scene file: one new serialized array `automatedCellPrefabs` (7 refs) and the
  `Zone_AutomatedCell` position.
- Population (optional SHOULD, done): `resolvePoolRobotRoute(slot, robotLineBuilt, automatedCellBuilt = false)` sends pooled slots 2, 5, 8, ... (ranks 3, 6, 9, ...; a second
  third, disjoint from the Line third 1, 4, 7, ...) to the Cell loop once the cell is built; `RobotPopulationSnapshot.automatedCellBuilt`. No new instances, Robots Built mapping
  unchanged. Route: output pad (2.7, 1.0) dwell 1 s (idle, facing the cell) -> south lane z 0.86 -> storage stop (-0.25, 1.0) beside the crate face, dwell 1 s -> back on z 0.96-0.98;
  everything stays south of the Line -> Storage lane (z 0.3..0.7) and clear of the cell by at least 0.1.
- Device helper: `npm run device:seed-aut043 -- --variant unbuilt|lv1|lv10` (`tools/device/seed_aut043.ts`). Not run on a device. NOTE: the Automated Cell is constructed
  by buying the **Automated Cell Architecture** breakthrough (25,000,000 Output; requires Robot Line Lv25 and 100 Robots Built), not from the Producer Panel. `unbuilt` seeds Robot
  Line Lv25, 100 Robots Built, 50,000,000 Output and the breakthrough NOT owned; `lv1` / `lv10` own it and have the cell built.

## Zone rect shift (owner decision 2026-11-12) and every consequence

`ZONE_LAYOUT.AutomatedCell`: `{ x: 6.2, z: 3.2, width: 4.5, depth: 4 }` -> `{ x: 2.3, z: 1.9, width: 2.0, depth: 1.7 }` (x 1.3..3.3, z 1.05..2.75). The original zone was entirely off-screen at the
default portrait view; the new rect projects at screen x -0.52..-0.93 (default view, zone corners at y 0) and -0.26..+0.25 in the reveal view. It does not overlap any other zone
(Robot Line z <= 0.55, ARC z >= 3.25, Assembly x <= 0, Fabricator x <= -3.5). Camera API and default framing are untouched.

Derived from the layout automatically (no edit needed, covered by tests): the `Zone_AutomatedCell` runtime position, the `AutomatedCell_SelectableTarget` (selection/tap zone, scale = width x 1 x depth),
the AUT-033 `AutomatedCell_InactiveShell` / `_DisconnectedLogistics` placeholders and `_FutureFoundation` (children of the zone, sized from the layout), `AutomatedCell_FocusAnchor` and
`AutomatedCell_CompositionAnchor` (zone-local), and the camera pan bounds (`resolveCameraPanBounds` unions unlocked zone rects +1 margin, clamped to the global focus bounds).

Edits that were required:

- `assets/scripts/presentation/FactoryZoneLayout.ts`: the rect above.
- `assets/scenes/factory/FactoryWorld.scene`: serialized `Zone_AutomatedCell` `_lpos` (6.2, 0, 3.2) -> (2.3, 0, 1.9) (the bootstrap resets it at runtime, but the serialized value is kept consistent).
- `tests/camera_pan_bounds.test.ts` (1 line): the test pins `ZONE_LAYOUT` verbatim ("moved unchanged"); updated to the new owner-approved rect.
- `tests/selection_raycast.test.ts` (1 line): the `ZONES` fixture mirrors `ZONE_LAYOUT` targets; updated to the new rect (the hit-test maths is unchanged).
- `tests/robot_line_visual.test.ts`: `floorHeightAt(3.0, 1.5) === 0` became false (the cell slab now covers that point, top 0.16); replaced by `floorHeightAt(3.0, 0.9) === 0` (ground south of the Robot Line lane and outside the
  cell zone). The new cell floors are asserted in `tests/automated_cell_visual.test.ts`. Two population controller regex pins (`resolvePoolRobotRoute(...)` call sites) now allow the optional third argument `this.automatedCellBuilt`.
- `AssemblySliceLayout.FLOOR_RECTS`: cell slab (0.16) and the AutomatedCell zone foundation (0.12) added so robots on the Cell route stand on the right height.

Pan bounds behaviour: the existing camera/pan tests pass unchanged apart from the pinned rect. Because the Automated Cell producer is constructed by a breakthrough, `evaluateProducerBuildProgression` reports `locked`
(a `breakthroughConstruction` blocker is always listed) until it is built, so the cell zone only joins the pan bounds once built (`already_built`). Once built the bounds grow by the cell rect +1 (maxZ 3.75, now
south of the Line instead of the old far east-north corner); the east extent stays the Robot Line zone (7.5), no longer the off-screen old cell (9.45 clipped to 9). The default focus (-2.5, 0) stays inside the bounds. This is a
behaviour change for the pan range (less panning room to the north-east once the cell exists) that the owner may want to confirm on device.

Device scenario fixtures (`tests/device_*_scenario.test.ts`, `tools/device/ui_geometry.ts` `DEFAULT_VIEW_OPTIONAL_ZONES = ['AutomatedCell']`) encode screen coordinates of an *off-screen* AutomatedCell as mock data. They are
simulated fixtures and still pass; they were not changed. On a real device the AutomatedCell zone is now on screen at the default view (it was "optional/off-screen" before), which the scenarios tolerate
(optional zone). If the device scenario should now require it on screen, that is a Technical Lead call.

## Final layout (world)

| Module | Asset | Position, rotY, scale | Extent / top |
|---|---|---|---|
| `foundation_slab` | primitive grey box | centre (2.3, 0.08, 1.85), 1.7 x 0.16 x 1.5 | x 1.45..3.15, z 1.1..2.6, top 0.16 |
| `wall_west` | `structure-high` | (1.58, 0.16, 1.55), 0, 0.78 | x 1.463..1.697, z 1.121..1.979, top 1.33 |
| `wall_back` | `structure-high` | (2.0, 0.16, 2.48), 90, 0.78 | x 1.571..2.429, z 2.363..2.597, top 1.33 |
| `conveyor_in` / `conveyor_out` | `conveyor` | (2.2 / 2.7, 0.16, 1.33), 90, 0.45 | z 1.105..1.555, top 0.34 |
| `core` | `machine` | (2.3, 0.16, 1.93), 0, 0.5 | x 2.0..2.6, z 1.555..2.305, top 0.81 |
| `arm_1` / `arm_2` | `robot-arm-a` | (2.95, 0.16, 1.76), 0 / (1.80, 0.16, 2.175), 180, 0.30 | top 1.12 |
| `arm_3` (Lv10) | `robot-arm-b` | (2.93, 0.16, 2.2), 0, 0.30 | top 1.06 |
| `hopper` (Lv10) | `hopper-square` | (2.3, 0.81, 1.93), 0, 0.40 | x 2.077..2.523, z 1.707..2.153, top 1.21 |
| lamps | primitives 0.05-0.1 | Lv1: input (1.9, .19, 1.2), output (2.97, .19, 1.2), core face (2.3, .58, 1.53), arm_1 base (3.1, .19, 1.45); Lv10 adds arm_3 base (3.05, .19, 2.48), hopper face (2.55, 1.0, 1.93) | |
| guide | primitives | strip x -0.1..3.6, z 0.95, 0.12 x 0.04; stub (2.7, z 0.95..1.1) | graphite / cyan 59,112,121 (40%) |
| items | `box-large` 0.2 / `Robot.glb` 0.12 | belt top 0.34 | robot top 0.88 |

Highest element 1.33 (equal to the Robot Line's tallest, under the 1.35 cap and the Fabricator press 1.505).

## Deviations from the Art Director proposals (all <= 0.1, forced by the geometry tests)

1. Slab: size z 1.4 -> 1.5 and centre z 1.9 -> 1.85 (z 1.1..2.6): the conveyors (0.45 deep, butting into the core) must sit on the slab, so the slab front edge moved south by 0.1.
2. Conveyors z 1.3 -> 1.33 (z 1.105..1.555): so they sit on the slab and face-contact the core.
3. Core z 1.9 -> 1.93: the core front face (z 1.555) meets the conveyor ends without interpenetration.
4. Arm 1 z 1.7 -> 1.76: its +-15 deg swing clears the output conveyor (arm swing AABB = half 0.15 x (cos15 + sin15) = 0.184).
5. Arm 2 (1.84, 2.15) -> (1.80, 2.175): fits the pocket between the west wall (z <= 1.979 after item 6) and the core (x >= 2.0) and the back wall (z >= 2.363) with swing.
6. West wall z 1.6 -> 1.55 (z 1.121..1.979): stays on the slab (z >= 1.1) and leaves arm 2's swing room.
7. Arm 3 x 2.95 -> 2.93: its yaw extreme corner reaches screen x about -0.926 (>= -0.93); at 2.95 it was -0.933.
8. Hopper lamp x 2.545 -> 2.55 (flush with the hopper face).
9. Guide stub spans z 0.95..1.1 (slab edge) instead of 0.95..1.2: the part past z 1.05 is covered by the cell zone foundation (top 0.12) and the slab, and the conveyor starts at z 1.105.
10. Cycle timing is expressed as a fixed job (box ride 1.0 s, dwell 1.2 s, robot out 1.2 s = 3.4 s) inside the cycle (4.8 s Lv1 / 3.6 s Lv10), pool slots staggered by cycle / pool (2.4 s apart at Lv1, 1.2 s at Lv10).
    The proposal said "one cycle per 4.8 s / 3.6 s"; here each pooled slot loops once per cycle and the pool overlaps, so the visible throughput is pool / cycle.

## Measured AUT-032 GLB facts (POSITION bounds, unit scale)

machine x -0.6..0.6, y 0..1.29975, z -0.75..0.75 (solid block); robot-arm-a 1.0 x 3.2 x 1.0; robot-arm-b 1.0 x 3.0 x 1.0; structure-high 0.3 x 1.5 x 1.1; conveyor 1.0 x 0.4 x 1.0;
hopper-square 1.117 x 1.0 x 1.117 (x/z +-0.5586); box-large 1.1 x 0.55 x 1.0; all pivots bottom-centre. Robot.glb (skinned) body about +-0.25 wide x 0.95 deep at unit scale.
Machine top is 1.29975 (not exactly 1.3): the hopper (y 0.81) floats 0.0001 above the core roof, below any visible threshold.

## Tests (`npm run check`: PASS, 670 tests (646 before); pacing regression 4/4 PASS)

- `tests/automated_cell_visual.test.ts` (22): scene prefab alignment (7 refs, AUT-032 only, forbidden assets absent, no new glb); owner zone-rect shift (exact rect, no overlap with any other zone,
  scene node, selection pick at the new centre and not the old, shell relocation, pan bounds valid and containing the default focus, east extent); measured GLB facts; modules on the slab, <= 1.35, no interpenetration,
  contrast metrics vs the Robot Line (near-square footprint, less than half the length, vertical); arm swing +-15 deg, lamps, hopper, items fit; footprint clear of Robot Line, ARC, spine, crate, lane and exit
  crossing, `floorHeightAt`; guide strip geometry and colours; everything on screen at the default and reveal views with tall elements (including the arm swing boxes) at screen x >= -0.93; resolver (unbuilt / Lv1 / Lv10 / Lv25+ / Reboot,
  deterministic, read-only); production periodicity, stagger, box -> dwell -> robot timeline, scale-hide; arm timer and phase offsets; lamp blink; Cell route (periodic, floor, clearance, on screen, 1 s pad dwell, south of the Line lane);
  population allocation + view model; ConstructionViewModel order, no replay on load, one activation, Reboot replay; reveal view model and no focus on load; engine-free / command-free / no ctor parameter properties;
  bootstrap, registry, ConstructionTarget registration, reveal API reuse, no `.active = false`, no lights, `automated_cell_state` declared and emitted, metas.
- `tests/device_aut043_seed.test.ts` (2): seeded unbuilt (breakthrough eligible and affordable) / Lv1 / Lv10 saves round-trip; command registered.
- Existing tests changed: see "Zone rect shift" (4 files, 5 lines).

## Pending / open risks

- **Human gate (pending):** device screenshots at unbuilt / Lv1 / Lv10 (`npm run device:seed-aut043 -- --variant ...`), the live reveal (buy the Automated Cell Architecture breakthrough: sequence order slab -> walls -> conveyors -> core -> arms,
  one focus beat, lamps on, cycle starting), and the key acceptance **contrast with the Robot Line** (compact, walled, vertical, dense vs long, low, open). A gate APK (FactoryWorld start scene) must be built; none was built here.
  Checklist: (1) `unbuilt`: the shell sits south of the spine at the new place, on screen; buy the breakthrough and watch the build; (2) Lv1: slab, walls behind, conveyors, core, 2 arms, 4 lamps, boxes entering and robots leaving;
  (3) Lv10: arm 3, hopper, 6 lamps, faster cycle; (4) Robot Line vs Cell silhouettes side by side at the default view; (5) guide strip graphite -> cyan, and the Cell-route robots walking over it; (6) relaunch shows the built cell instantly with no replay;
  (7) pan bounds feel with the cell built (less room to the north-east).
- Unverified visually: conveyor flow axis (turned 90, assumed along z, boxes move toward the core, robots toward -z), machine.glb being a solid block, arm yaw/nod pivot (bottom-centre), Robot.glb facing +Z (heading 180 faces -z), box/robot sizes,
  lamp visibility (the core lamp sits in front of the core between the conveyors), the hopper silhouette on the roof, whether the west wall is readable from the camera (it is behind the cell relative to the camera).
- Arm swing is an axis-aligned conservative bound; when Lv9 -> Lv10 changes the arm period mid-run the arms jump phase for one frame; the pooled slots re-stagger when the pool grows 2 -> 3.
- The Robot Line `RobotLine_RevealAnchor`/shell rules are untouched; the AUT-040 sparks are the six shared nodes under the Assembly composition (anchored on the cell while it builds).
- Android: 3 extra Robot instances + 3 box instances + 1 module set; the AUT-041 benchmark was not re-run with the cell.
- Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`). The broader factory-coherence composition (one visual flow across Fabricator / Assembly / Line / Cell) is a separate follow-up; only the light connector strip is here.
  Out of scope by plan: Advanced Robotics Complex (AUT-044), Era II/III title/door/light sweeps (AUT-048).

## Real-device gate prepared (2026-11-12, device 1100a155, portrait 1080x2412)

Gate APK (FactoryWorld DEBUG, from `abfbd9f`, tracked build config restored): `temp/gate/ProjectAutomata-aut043-abfbd9f-factoryworld.apk`,
sha256 `92a7cc1f3d74759462b7b0210b1742f6303a45c32eba7773bdeff437f35742d7`; installed. Presence screenshots only (not a verdict): `temp/aut043/lv1.png`, `temp/aut043/lv10.png`
(compact walled cell on screen at the left edge, south of the spine, with the guide strip toward the storage crate; zero error events in the seeded launches).
Seeds: `npm run device:seed-aut043 -- --variant unbuilt|lv1|lv10`. The `unbuilt` seed owns Robot Line Lv25 + 100 Robots Built + 50M Output; the live build is the Next Goal
"Automated Cell Architecture" breakthrough (not the Producer Panel).
Human gate: silhouette contrast vs the Robot Line, readability at the screen edge, the live reveal + focus beat, pan feel with the cell built. Result: **PENDING**.

## Visual QA review of the native device screenshots (2026-11-12, scene-presentation agent, review policy 2026-11-12)

Evidence read: `temp/aut043/unbuilt.png`, `lv1.png`, `lv10.png` (+ `temp/aut042/lv10.png` for regression comparison). Decision: **HUMAN_REVIEW_REQUIRED** (no blocker, objective criteria pass).
- PASS: state visibility (unbuilt shell / Lv1 / Lv10 distinguishable), framing and clipping (cell fully on screen, x ~40..245, y ~1200..1400, clear of HUD and panel), silhouette contrast vs Robot Line
  (compact ~200 px block with vertical posts vs the long open ~500 px line), no visible overlap with spine/storage/line/robots, no regression of Fabricator / Assembly / Robot Line.
- IMPORTANT (subjective, camera-directional): the cell is the smallest object at the left screen edge; arms, hopper and lamps are hard to tell apart at ~200 px and the Lv1 -> Lv10 delta is subtle.
  Possible follow-up (not AUT-043 scope): closer framing or larger scale via an `AUT-VIS` task (Orchestrator + Technical Lead for any default-framing change).
- Not judgeable from stills (owner): the live build/reveal + focus beat, cycle motion, pan feel with the changed bounds, relaunch with no replay.

## Human gate result (2026-11-12): ACCEPTED

Owner accepted AUT-043 after the visual QA review (decision: accept, track the size/coherence issue). Non-blocking follow-up (AUT-VIS, tracked with the factory-coherence item): the Automated Cell is small at the left
screen edge (~200 px vs ~500 px for the Robot Line) and the Lv1 -> Lv10 delta is subtle; closer framing or larger scale / stronger shared production-flow logic belongs to a Scene Presentation / Art Direction task
(a default-framing change also needs Orchestrator + Technical Lead). The live build/reveal feel was not separately reviewed by the owner; it is accepted with the task.
