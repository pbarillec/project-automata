# AUT-044 Advanced Robotics Complex Visual

**Human gate: PENDING** (visual QA review of device screenshots at unbuilt / Lv1 / Lv10 and of the live reveal capture first; owner only for the subjective items below).
Automated checks prove layout geometry, state resolution, wiring and determinism only. Presentation only: no economy, runtime, data, save, camera-API/framing, HUD-text or art-direction change;
existing AUT-032 Kenney assets and primitives only (no new asset file; Modular Space is NOT imported). AUT-045 (era environment) and AUT-048 (era transition title/door/light sweep) are out of scope.

## What was built

Pattern as AUT-043, file for file: pure engine-free modules (explicit `.ts` imports, no constructor parameter properties) + a thin `cc` controller, wired at runtime. Producer id `advanced_robotics_complex`,
built by the `advanced_robotics` breakthrough (which also enters era `robotics_complex`; the era change itself is not presented here).

- `AdvancedRoboticsComplexLayout.ts` (pure): world layout, module -> asset mapping (`ARC_PREFAB_SLOTS`, index-aligned with the serialized `advancedRoboticsComplexPrefabs`), transforms, slab, gantry beams,
  14 lamps, connector guide, item scales, reveal target, spark anchor, `arcLocal`.
- `AdvancedRoboticsComplexVisualStateResolver.ts` (pure): `unbuilt` (AUT-033 inactive shell kept) -> `arc_lv1` -> `arc_lv10` (level >= 10; Lv25+ keep it).
- `AdvancedRoboticsComplexProduction.ts` (pure): clock-driven fake jobs (no per-item simulation). Cycle = cadence between finished products (Lv1 3.0 s, Lv10 2.4 s); each pooled slot loops once per `cycle x pool`
  (9.0 s / 9.6 s) and slots are one cycle apart. A job: pooled box rides the entry belt (1.0 s) and scale-hides into the core, dwells 1.5 s, a Robot scales up at the exit belt and slides 1.6 s to the apron pad then
  scale-hides. Lv10: the 4th slot's box rides the overhead gantry belt into the head instead. Arms yaw +-15 / nod 3 deg by timer (period = cycle; arm 2 half a period out of phase, arm B a third).
  Lamp blink once per cycle (8% off, staggered); the spire lamp pulses 0.6..1 once per cycle.
- `AdvancedRoboticsComplexExitRoute.ts` (pure): the robot exit path (exit belt x -0.4, z 4.2 -> apron pad (-0.4, 3.05), feet on the belt then the slab / foundation / ground) and the apron lane (z 3.05, x -2.3..0.9).
- `AdvancedRoboticsComplexRevealViewModel.ts` (pure, read-only): descriptor + the single bounded focus beat of the live construction (no title / door / light sweep / era transition).
- `AdvancedRoboticsComplexVisualController.ts` (`cc`): modules from `advancedRoboticsComplexPrefabs`, 14 lamp pairs (graphite off / cyan 82,206,224 on, `lightLevel` flickers them at activation, no dynamic light),
  2 guide parts, 4 pooled boxes + 4 pooled Robot instances (Robot prefab shared with the Worker Bot), arms, ConstructionTarget (`getConstructionModuleIds`, `setConstructionSample`, `onConstructionActivated`),
  one bounded focus through the existing `MobileCameraController.focusOnRevealTarget` at (-1.0, 1.0, 5.0) on `AdvancedRoboticsComplex_RevealAnchor`, DEBUG `advanced_robotics_complex_state`
  (`synced`, `construction_started`, `focus_requested`, `activated`, `item_cycle`). Visibility by scale, never `node.active`. The cycle starts after activation; a load shows the built complex instantly with no focus
  (the beat is raised only from the live `setConstructionSample`); Reboot (producer unbuilt) hides it and a new build replays.
- Floors: `floorHeightAt` gains the complex slab (0.16) and the zone foundation (0.12).
- Wiring: `FactoryWorldBootstrap.createAdvancedRoboticsComplexSlice` / `connectAdvancedRoboticsComplexPresentation` (slab, beams, lamps, guide, reveal anchor), fourth ConstructionTarget `advanced_robotics_complex`
  (shared sparks re-anchored on the complex), `PresentationController.advancedRoboticsComplexVisual`. Scene file: one new serialized array `advancedRoboticsComplexPrefabs` (7 refs) and the `Zone_AdvancedRoboticsComplex` position.
- Device helper: `npm run device:seed-aut044 -- --variant unbuilt|lv1|lv10` (`tools/device/seed_aut044.ts`) and `npm run device:reveal-capture -- --scenario aut044` (default scenario stays `aut043`). Not run on a device.

## Zone rect shift (owner-approved presentation-only layout fix; OWNER AWARENESS REQUESTED) and every consequence

`ZONE_LAYOUT.AdvancedRoboticsComplex`: `{ x: 2, z: 6, width: 6, depth: 5.5 }` -> `{ x: -1.0, z: 5.125, width: 3.5, depth: 3.75 }` (x -2.75..0.75, z 3.25..7.0). The old zone (x -1..5, z 3.25..8.75) was mostly off-screen at the
default portrait view; this is the same owner-approved treatment as the AUT-043 Cell shift. No overlap with any other zone (Cell zone z <= 2.75 and x >= 1.3; Robot Line z <= 0.55). Camera API and default framing untouched.

Derived automatically (covered by tests): the `Zone_AdvancedRoboticsComplex` runtime position, the selectable target (selection/tap zone), the AUT-033 `_InactiveShell` / `_DisconnectedLogistics` / `_FutureFoundation`
(children of the zone, sized from the layout; unbuilt shell corners project at screen x >= -0.93), `FocusAnchor` / `CompositionAnchor`, and the camera pan bounds.

Edits that were required:

- `assets/scripts/presentation/FactoryZoneLayout.ts`: the rect above.
- `assets/scenes/factory/FactoryWorld.scene`: serialized `Zone_AdvancedRoboticsComplex` `_lpos` (2, 0, 6) -> (-1, 0, 5.125) (the bootstrap resets it at runtime, kept consistent) + the new prefab array.
- `tests/camera_pan_bounds.test.ts` (1 line): the test pins `ZONE_LAYOUT` verbatim; updated to the approved rect.
- `tests/selection_raycast.test.ts` (1 line): the `ZONES` fixture mirrors `ZONE_LAYOUT`; updated (the hit-test maths is unchanged).
- `AssemblySliceLayout.FLOOR_RECTS`: complex slab (0.16) and zone foundation (0.12) added (robot feet on the exit route).
- Device scenario fixtures (`tests/device_*_scenario.test.ts`, `tools/device/ui_geometry.ts`): NOT changed, as in AUT-043. `DEFAULT_VIEW_REQUIRED_ZONES` already lists `AdvancedRoboticsComplex` as required on screen
  (the fixtures encode mock screen coordinates sx 300, sy 1600 that remain valid); the shifted zone is closer to the screen centre, so the requirement is easier to meet on a real device. The stale `DEFAULT_VIEW_OPTIONAL_ZONES = ['AutomatedCell']`
  (the Cell is on screen since AUT-043) was left as is: removing it would also touch the c3/r031/r036/ui001 scenario fixtures that mock the Cell off screen, so it is not trivially safe; a Technical Lead call.

Pan-bound feel change: none for the built factory. With the complex built the pan bounds union grows by the new zone +1 (x -3.75..1.75, z 2.25..8.0); the maximum z was already clipped to the global focus bound (8) by the old zone
(old z to 8.75 + 1) and the east/west extents are dominated by the Robot Line / Fabricator, so `resolveCameraPanBounds` returns the identical rectangle with the old and the new rect (pinned by a test). Before the complex is built it
does not join the bounds (the breakthrough construction blocker keeps it `locked`), unchanged.

## Final layout (world), measured GLB facts and deviations

Slab: grey primitive 3.0 x 0.16 x 3.2 centre (-1.0, 0.08, 5.15): x -2.5..0.5, z 3.55..6.75, top 0.16. Zone foundation (0.12) stays derived.

| Module | Asset | Position, rotY, scale | Extent / top |
|---|---|---|---|
| `frame_west_1/2` | `structure-high` | (-2.3, 0.16, 4.2875 / 5.6625), 0, 1.25 | x -2.4875..-2.1125, z 3.6..4.975 / 4.975..6.35, top 2.035 |
| `frame_back_1/2` | `structure-high` | (-1.8 / -0.425, 0.16, 6.5375), 90, 1.25 | x -2.4875..-1.1125 / -1.1125..0.2625, z 6.35..6.725, top 2.035 |
| `conveyor_in` / `conveyor_out` | `conveyor` | (-1.0 / -0.4, 0.16, 3.95), 90, 0.6 | x -1.3..-0.7 / -0.7..-0.1, z 3.65..4.25, belt top 0.40 |
| `core` | `machine` | (-0.7, 0.16, 5.0), 0, 1.0 | x -1.3..-0.1, z 4.25..5.75, top 1.46 |
| `head` | `hopper-square` | (-0.7, 1.46, 5.0), 0, 0.85 | x -1.175..-0.225, z 4.525..5.475, top 2.31 (Lv1 top) |
| `arm_1` / `arm_2` | `robot-arm-a` | (0.2, 0.16, 3.98 / 4.6), 0 / 180, 0.45 | top 1.60; swing x -0.076..0.476 |
| `bay` (Lv10) | `machine` | (0.2, 0.16, 5.95), 0, 0.5 | x -0.1..0.5, z 5.575..6.325, top 0.81 |
| `arm_b` (Lv10) | `robot-arm-b` | (0.2, 0.16, 5.22), 0, 0.45 | top 1.51 |
| `beam_1/2` (Lv10) | graphite primitive | centre (-1.83, 2.095, 4.75 / 5.25), 1.3125 x 0.12 x 0.15 | rest on the west frame tops (y 2.035..2.155), end on the head face |
| `overhead_belt` (Lv10) | `conveyor` | (-1.425, 2.155, 5.0), 0, 0.5 | x -1.675..-1.175, z 4.75..5.25, belt top 2.355 |
| `spire` (Lv10) | `machine` | (-0.7, 2.31, 5.0), 0, 0.5 | top 2.96; spire lamp to 3.10 (Lv10 top = 3.10) |
| lamps | primitives 0.05-0.1 | Lv1 (8): input, output, core face, head face, arm 1 / arm 2 bases, west + back frame tops; Lv10 (+6): bay, arm B base, 2 gantry strips, overhead belt, spire | graphite off / cyan on |
| connector guide | primitives | strip x -1.0, z 1.35..3.25 (0.12 wide, ground), stub z 3.25..3.55 on the zone foundation (y 0.12..0.16) | graphite / cyan 59,112,121 (40%); from the storage crate north face to the slab edge; not the Cell output |
| items | `box-large` 0.2 / `Robot.glb` 0.12 | entry belt top 0.40, overhead belt top 2.355, apron pad (-0.4, 3.05) | robot top 0.94 |

Measured heights: Lv1 top 2.31 (<= 2.35), Lv10 top 3.10 (<= 3.1). Measured screen projections (default view, same maths as `tests/automated_cell_visual.test.ts`): the leftmost tall corner (including every arm swing box) is at
screen x -0.897 (>= -0.93); reveal view (focus (-1, 1, 5), distance 9.5): all corners within +-0.59 (limit +-0.77).

Measured AUT-032 GLB facts (POSITION bounds, unit scale): machine x -0.6..0.6, y 0..1.29975, z -0.75..0.75 (solid block); robot-arm-a 1.0 x 3.2 x 1.0; robot-arm-b 1.0 x 3.0 x 1.0; structure-high 0.3 x 1.5 x 1.1;
conveyor 1.0 x 0.4 x 1.0 (flow along local X); hopper-square 1.117 x 1.0 x 1.117; box-large 1.1 x 0.55 x 1.0; all pivots bottom-centre. Robot.glb (skinned) body about +-0.25 wide x 0.95 deep at unit scale.

Deviations from the Art Director proposals (each recorded; the first two exceed 0.1 because the proposals do not fit the approved footprint):

1. **Frame scale 1.3 -> 1.25** (top 2.11 -> 2.035): at 1.3 the west run (2 x 1.43 = 2.86) plus the back-run thickness does not fit the slab depth (z 3.55..6.75) without crossing the corner or the slab edge. Gantry beams therefore rest at y 2.035..2.155
   (proposal y 2.1 centre: 2.095 here).
2. **Second bay machine scale 0.7 -> 0.5 and position (-0.25, 6.0) -> (0.2, 5.95)**: a 0.7 machine (0.84 x 1.05) overlaps the core (x <= -0.1, z <= 5.75) wherever it stays inside x <= 0.5, z <= 6.75 and clear of the back frames (z >= 6.35).
   It now stands on the open east strip beside the core (top 0.81 instead of 1.07).
3. Arms: the Art Director put arm_1 / arm_2 "flanking the core on the open side"; arms 1 / 2 / B stand on the east strip (x 0.2) at z 3.98 / 4.6 / 5.22 so that their +-15 deg swing boxes tile without overlap, with the base lamps in the gaps. `arm_b` is on the east strip too (the
   position behind the core / head would be hidden from the camera by the head tower).
4. Core, conveyors, head, beams, overhead belt and spire follow the proposal (the overhead belt rests at y 2.155 instead of ~2.12 because the beams top out at 2.155; belt top 2.355).
5. Lamps: positions chosen inside the gaps / on faces so that no lamp overlaps a module or an arm swing box; the head lamp sits on the camera (-z) face; the spire lamp is the "0.1 cyan pole/lamp up to 3.1".
6. Production timing expressed as cadence: the brief's "cycle 3.0 s / 2.4 s" is the interval between finished products; a pooled slot loops once per `cycle x pool` (a 4.1 s job must fit; ride 1.0 + dwell 1.5 + robot out 1.6). At most one box and one robot are visible at once.
   The overhead-belt box is the 4th Lv10 slot (one product in four enters from above). The overhead belt is a single 0.5 conveyor, so its box rides 0.3 along it.
7. Guide strip ends at the zone foundation edge (z 3.25) with a stub on the foundation up to the slab edge: past z 3.25 the 0.12 foundation would hide a ground-level strip.

## Robot lane

Fake-production robots leave over the exit belt, step off the slab front edge and end on the apron pad (-0.4, 3.05); the apron lane is the segment z 3.05, x -2.3..0.9: 0.5 from the slab edge (z 3.55), distance 0.5 from the Cell zone corner (>= 0.4), and
>= 0.4 from every composition box (pinned by tests). Feet are on the belt (0.40), the slab (0.16), the zone foundation (0.12) and the ground. The optional population-robot class on the apron route was **NOT done** (it would re-split the
Robots Built thirds that AUT-041/042/043 pin; not simple). The AUT-043 observation that Cell/Line population robots cross the Cell front slab edge (the Cell route output pad (2.7, 1.0) sits 0.1 from the Cell slab edge at z 1.1 and the
guide strip z 0.95) was checked and **left as is**: moving it changes pinned, human-accepted AUT-043 route values and clearances, so it is left for the AUT-VIS follow-up.

## Tests (`npm run check`: PASS, 696 tests (22 new: 19 + 2 + 1); pacing regression 4/4 PASS)

- `tests/advanced_robotics_complex_visual.test.ts` (19): scene prefab alignment (7 refs, AUT-032 only, no new glb, no Modular Space); the exact zone rect, no overlap with any zone, scene node, selection pick, shell relocation, unbuilt shell on screen
  (x >= -0.93), pan bounds valid and identical to the old-rect result; measured GLB facts; modules on the slab / frames, no interpenetration, Lv1 top <= 2.35, Lv10 top <= 3.1, L-shaped frames, gantry beams; arm swing boxes, lamps and items;
  footprint, connector guide, `floorHeightAt`, apron lane clearances >= 0.4 and the exit route feet; default view tall corners and arm swings at screen x >= -0.93, reveal view within +-0.77; resolver (unbuilt / Lv1 / Lv10 / Lv25+ / Reboot, deterministic,
  read-only); production periodicity, cadence, box -> 1.5 s dwell -> robot, overhead slot, scale-hide; arm timer and phase offsets; lamp blink; ConstructionViewModel order and no replay on load / one activation / Reboot replay; reveal view model and
  no focus on load; engine-free / command-free / no ctor parameter properties; bootstrap, registry, ConstructionTarget registration, reveal API reuse, no `.active = false`, no lights, `advanced_robotics_complex_state` declared and emitted, metas.
- `tests/device_aut044_seed.test.ts` (2): seeded unbuilt (eligible, affordable, one-tap purchase constructs the complex, `resolveNextGoal` / HUD action = `advanced_robotics`) / Lv1 / Lv10 round-trip; command registered.
- `tests/reveal_capture.test.ts` (+1): the scenario table (`aut043` default, `aut044`), unknown scenarios rejected.
- Existing tests changed: `camera_pan_bounds` (1 line), `selection_raycast` (1 line) for the approved zone rect.

## Seed / HUD finding (route: Technical Lead / UI)

With the natural era (`automated_factory`) the Next Goal for the Advanced Robotics breakthrough is an **`era`** goal (the breakthrough also enters `robotics_complex`), and `CoreLoopActions.resolveNextGoalAction` only exposes the HUD action for
`breakthrough` goals, so the live capture could not tap it. The `unbuilt` seed therefore pre-enters era `robotics_complex` (seed-only state; the purchase still constructs the complex; the era effect is then a no-op, so the capture covers the construction beat
but not an era transition, which is AUT-048). Asserted by test: natural era -> no HUD action; seeded era -> enabled `purchaseBreakthrough advanced_robotics`. Whether the player should get a HUD action for era goals is a product/UI decision, not taken here.

## Review plan

1. Vision-capable visual QA first (CLAUDE.md Review policy): device screenshots `npm run device:seed-aut044 -- --variant unbuilt|lv1|lv10` and the live reveal capture `npm run device:reveal-capture -- --scenario aut044`
   (gate APK: FactoryWorld start scene; none was built here). Objective criteria: state visibility (shell / Lv1 / Lv10), on-screen framing and clipping at the left edge, no overlap with the Cell / spine / HUD, silhouette contrast (a building-scale tower with an L-frame, gantry and spire vs the
   Cell and the Robot Line), staged build order, no pop-in, guide strip graphite -> cyan, robots staying clear of the slab edge.
2. Owner only for the subjective items: that it feels building-scale and autonomous (a frontier producer), pacing / motion feel, the reveal focus beat, and the zone shift / pan range awareness above.

## Open risks / unverified

- Not verified visually or on a device: conveyor flow axes (turned 90 = along z; unrotated overhead belt = along x), `machine.glb` as a solid block, arm yaw / nod pivot, Robot.glb facing, hopper-square top footprint under the spire, lamp visibility (the core / head lamps
  sit on the camera faces), the east strip arms against the camera, whether the L-frames read as a building from the camera.
- Android instance budget: +4 Robot instances (skinned) +4 box instances + 1 module set (about 17 modules + 14 lamp pairs + 4 primitives) on top of the Cell (3 + 3); the AUT-041 benchmark was NOT re-run with the complex.
- Arms and lamps are conservative axis-aligned bounds (3 deg nod ignored); a Lv9 -> Lv10 transition changes the cycle mid-run (a one-frame phase jump); pooled slots re-stagger when the pool grows 3 -> 4.
- `DEFAULT_VIEW_OPTIONAL_ZONES` still lists the Cell (stale since AUT-043) - Technical Lead call.
- Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`, `TECHNICAL_DESIGN`). The broader factory-coherence composition is a separate follow-up; only the light connector strip is here.
