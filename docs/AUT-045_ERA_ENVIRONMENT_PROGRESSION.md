# AUT-045 Era Environment Progression

**Human gate: PENDING** (vision-capable visual QA of seeded device screenshots first; owner only for the subjective items below). Automated checks prove state resolution, layout geometry, projection limits, wiring and determinism only.
Presentation only: no economy, runtime, data, save, camera-API/framing, HUD-text or art-direction change; no new asset file (primitives through the existing `createBox` helper and the AUT-032 `structure-high` prefab). AUT-046 (milestone presentation),
AUT-047 (overclock), AUT-048 (era transition title / door / light sweep) and AUT-049 are out of scope.

## What was built

Pattern as AUT-042..044: pure engine-free modules (explicit `.ts` imports, no constructor parameter properties) + a thin `cc` controller wired at runtime. Additive, no separate maps.

- `EraEnvironmentLayout.ts` (pure data): era table (palette, light, clear colour, group visibility), the hall / vertical group / teaser boxes and `structure-high` instances, timing constants, bounds helpers.
- `EraEnvironmentStateResolver.ts` (pure): `state.run.currentEraId` -> descriptor `{ palette, hallVisible, verticalVisible, teaserVisible }`; unknown / null era falls back to the Workshop. Frame blending (`blendEraEnvironmentFrame`), teaser seam pulse and core spin samples.
- `EraEnvironmentViewModel.ts` (pure, read-only): first sync / save load / a non-progressive change (Reboot) SNAP; only a live move to a HIGHER era starts the transition. The decision is taken from the era id of the snapshot, never from replayed events, so
  the snapshot-before-event / event-before-snapshot ordering (AUT-040 / AUT-043) starts it exactly once (a second look at the same era is a no-op and never rewinds the fade). A change during a fade blends from the frame on screen.
- `EraEnvironmentVisualController.ts` (`cc`): recolours the three shell boxes (`SiteBoundary`, `MainLogisticsSpine`, `FutureAccessBarrier`), the world camera clear colour (clear flags set to SOLID_COLOR, colour per era) and the key light colour / illuminance; recolours
  the hall primitives per role; scales the three group roots (hidden = scale 0, appearing = scale-Y rise, never `node.active`); instantiates the `structure-high` prefab for posts / pylons / flanks; animates the teaser (core spin 10 deg/s, seam pulse 60-100 % over 3 s,
  only while the teaser is visible); DEBUG `era_environment_state` (`synced`, `transition_started`, `transition_finished`, `snapped`).
- Wiring: `FactoryWorldBootstrap.createEraEnvironment` (after the key light exists, before the registry) builds `FactorySite/EraEnvironment/{Hall,Vertical,Teaser}` with the unlit primitives (DEFAULT layer, built hidden by scale); `PresentationController.eraEnvironmentVisual` (`sync` +
  `consumeDomainEvents`). Scene: one new serialized array `environmentPrefabs` (1 ref: `structure-high`, the same reference as the AUT-044 frames) on FactoryWorldBootstrap; nothing else in the scene changed.
- Diagnostics / seed: `era_environment_state` declared in `DeviceDiagnostics` and recorded by the reveal timeline; `npm run device:seed-aut045 -- --variant workshop|era2|era3` (`tools/device/seed_aut045.ts`): workshop = the AUT-042 unbuilt state (manual_workshop), era2 = AUT-042 Lv10 Robot Line
  (automated_factory), era3 = AUT-044 Lv10 Complex (robotics_complex); no new state. Not run on a device.

## Which state sets the era (verified in code)

`currentEraId` is the only key. Era II (`automated_factory`) is entered by CONSTRUCTING the Robot Line (`GameRuntime`, producer purchase -> `applyEraTransition`; it emits `eraChanged`). Era III (`robotics_complex`) is entered by the `advanced_robotics` breakthrough (`enterEra`).
A Reboot replaces the run with `createFreshRunState()` whose era is `manual_workshop` (snap back to the Workshop look). Covered by tests.

## Transitions

Live change to a higher era: palette / light colour / illuminance / clear colour ease (smoothstep) over 1.2 s (cap 1.5 s); a group that has to appear rises by scale-Y 0 -> 1 linearly over 1.0 s; the whole transition is 1.2 s. Driven by the controller's own `update` clock: no title, no door sweep, no camera
move or focus (it never touches `MobileCameraController`), no replay, independent of the construction reveal (no `ConstructionTarget`, it neither delays nor is delayed by it). Load and Reboot snap.

## Final layout and values

World coordinates (FactorySite at the origin). Era table exactly as approved: Workshop 76,82,87 / 92,101,104 / 52,59,62, clear 36,40,44, light 255,244,226 @45000 (also the Reboot state); Era II 82,91,98 / 104,114,119 / 58,68,74, clear 30,36,42, light 255,252,245 @47000;
Era III 62,69,77 / 84,96,104 / 46,56,64, clear 22,28,36, light 238,246,255 @43000. Illuminance stays within +-5 % of 45000 (42750..47250). Key light rotation, count (one) and absence of shadows unchanged; no new light.

- Hall (Era II+): floor 6.0x0.08x7.0 at (-7,0.04,3.6) (x -10..-4, z 0.1..7.1); rear wall 6.0x1.1x0.18 at (-7,0.55,7.2) and west wall 0.18x1.1x7.0 at (-9.9,0.55,3.6); caps 0.06 high x 0.22 wide on both walls; three light bars 1.2x0.06x0.12 on the rear wall face (x -8.6 / -7 / -5.4, y 0.95);
  two routing strips 5.0x0.03x0.08 at z 2.4 and 5.0; four `structure-high` scale 1.0 corner posts (top 1.5). Colours per Era II / Era III as approved (floor 96,106,112 / 70,78,86; walls 66,76,82 / 54,62,70; caps 120,130,134 / 196,201,203; bars 255,244,214 / 214,236,240; strips amber 200,150,60 / graphite 74,85,88).
- Vertical group (Era III): two pylons (each two `structure-high` stacked, see deviation 2) at (-9.2,.,7.4) and (-5.0,.,7.4), turned 90 deg to stand flat against the wall (top 3.0, below the Complex top 3.1); graphite catwalk 4.2x0.1x0.5 at y 2.2 between them with four dim-cyan 59,112,121 lamps; hall front-edge trim 6.0x0.03x0.06 dim cyan at z 0.13.
- AI Megafactory teaser (Era III only, static, 6 nodes): apron 5.0x0.1x1.8 (44,52,60) at (-7.5,0.05,9.9); sealed gate 4.0x2.6x0.4 (38,46,56) at (-7.5,1.3,10.4); two `structure-high` scale 1.6 flanks at x -9.9 and -5.1 (top 2.4); door seam 0.12x1.8x0.05 cyan 59,112,121 on the gate face, pulsing 60-100 % every 3 s;
  AI Core motif 0.4 cube (tilted 45 deg) at (-7.5,2.9,10.0) spinning 10 deg/s, unlit cyan 59,112,121; no label.
- Environment cyan never exceeds 59,112,121 (the seam pulse only dims it); producer lamps 82,206,224 stay the brightest cyan.

Measured at the default portrait view (same projection maths as the Cell / Complex tests; focus (-2.5,0), distance 14): every new module |sx| <= 0.95 and sy in [-0.45, 0.50] (tallest new element: the core motif, sy about 0.47); tall elements sx >= -0.93 (left-most tall: the east flank, sx about -0.65). The hall floor projects at sx -0.42..0.57,
sy 0.05..0.32 (the Complex stays to its left, sx -0.98..-0.30).

## Deviations from the Art Director proposals (each recorded)

1. **Teaser shifted from centre x -6 to x -7.5** (flanks -9.9 / -5.1; the brief allowed "x <= -7"): the screen test shows the east flank at x -3.6 overlaps the Complex head tower / frames at the default view, and at x -7 it still touches the tower; at -7.5 no tall new module with sx < -0.5 overlaps any Complex upper structure
   (pinned by a test, which also asserts that the original x -6 would have overlapped). Heights are unchanged (flanks 2.4, gate 2.6).
2. **Pylons: stacked x2 at scale 1.0 instead of 1.3** (deviation 0.3 > 0.1): two `structure-high` stacked at scale 1.3 reach 3.9, which contradicts the approved "top <= 3.0, lower than the Complex top 3.1"; scale 1.0 gives exactly 3.0 and keeps the catwalk (y 2.2) attached. Pylons are turned 90 deg (z 7.4 kept): unrotated, a 1.1-deep frame would poke through the rear wall.
3. **Teaser primitive colours**: the brief says "2 materials"; the teaser has three distinct primitive colours (apron 44,52,60, gate 38,46,56, cyan shared by the seam and the core) because both structure colours were specified exactly. Each `createBox` still owns its own material instance (the project helper), as everywhere else.
4. The key-light colour and the clear colour are now SET in code (the brief records the workshop values as "today's"; the code never set them, so the engine defaults (white light, default clear colour) are replaced by 255,244,226 / 36,40,44 even in the Workshop). Presentation-only, but it is a visible change at the Workshop (the warm tint on GLB modules); see risks.
5. Light bars are placed on the camera-facing face of the rear wall (y 0.95, z 7.05) rather than on its top (the cap occupies the top); the seam sits on the gate's camera-facing face (z 10.175).

## Tests (`npm run check`: PASS, 712 tests (16 new); pacing regression 4/4 PASS)

- `tests/era_environment.test.ts` (16): state -> environment table for Workshop / Era II / Era III and the Workshop fallback (null / unknown era), keyed only on `currentEraId` (producers, breakthroughs and Output ignored), which events set the era (Robot Line build, the breakthrough via `purchaseBreakthrough`,
  `createFreshRunState` for Reboot); group visibility map and teaser only in `robotics_complex`; determinism / read-only; timing (fade 1.2 s <= 1.5 s cap, rise 1.0 s, exact settle, monotonic); view model (load snaps, live fade starts once, dedupe of repeated snapshots / events, Reboot snaps back, Workshop -> Era III skip,
  chained change blends from the current frame, no replay on load); teaser pulse (60-100 %, 3 s) and spin; cyan cap, illuminance +-5 %, gate / apron lighter than the Era III clear colour; producer slabs / foundations / lamps / guides never touched (controller source, id collisions, palette colours, bootstrap literals unchanged), no new lights or shadows, light rotation unchanged;
  engine-free / command-free / no ctor parameter properties / no `node.active = false` / scale-Y rise / no camera API / no label; layout facts (hall rect, tops, teaser <= 7 nodes, clear of every zone, unique ids); no new asset files and the single `environmentPrefabs` scene array (same structure-high reference as the AUT-044 frames);
  default-view projection for every new module (|sx| <= 0.95, sy in [-0.45, 0.50], tall sx >= -0.93) and no tall new module with sx < -0.5 overlapping the Complex upper structures; bootstrap / registry / meta wiring; seed round-trips and the command registration.
- Existing tests changed: none (the new `environmentPrefabs` list and `era_environment_state` event do not disturb any pinned expectation).

## Live reveal scenario: NOT added

Era II is entered by building the Robot Line (a producer purchase through the producer panel, not a Next Goal action) and Era III by the `advanced_robotics` breakthrough, whose Next Goal is an `era` goal with no HUD action (AUT-044 finding, owner decision: no era-goal HUD action for now). A `reveal-capture` Next Goal tap therefore cannot
trigger a live era change; no HUD action was added and `REVEAL_SCENARIOS` is unchanged (pinned by a test). The seeded states cover the per-era look; the live fade is unverified on a device (see below). Only `era_environment_state` was added to the recorded reveal event types.

## Review plan

1. Vision-capable visual QA first (CLAUDE.md Review policy): seeded device screenshots `npm run device:seed-aut045 -- --variant workshop|era2|era3` (FactoryWorld DEBUG APK; none was built here) plus a Reboot (-> Workshop). Objective criteria: hall / vertical group / teaser present only in the intended era; Workshop unchanged apart from the warm light;
   on-screen framing and no clipping at the left edge; no overlap with the Complex upper area, the HUD or the panel; the gate reads against the dark clear colour; cyan stays dimmer than the producer lamps; producers (slabs, lamps, guides) unchanged; no pop-in on a load.
2. Owner only for the subjective items: the mood / feel of the warm-to-cool shift, the teaser's appeal (does it foreshadow Era IV), the pleasantness of the 1.2 s fade and the rise (motion, not judged from stills).

## Open risks / unverified

- Not verified visually or on a device: any colour, the fade / rise motion, the teaser, the hall against the real GLB lighting. The environment primitives are `builtin-unlit`: the light only changes GLB modules (producers, posts, pylons, flanks); the unlit hall / shell colours are exactly the table values regardless of the light.
- The controller now writes the world camera `clearFlags` / `clearColor` (presentation-only, no framing / API change, but it touches the camera component); `Camera.ClearFlag.SOLID_COLOR` and `Renderer.getSharedMaterial(0)` were checked against the 3.8.8 engine sources, not run.
- The Workshop key-light tint (255,244,226) and clear colour (36,40,44) replace engine defaults (deviation 4).
- HUD top clearance is not measured: the checks bound sy <= 0.50 at the default view (HUD / panel bands sit beyond), but a pan / focus beat moves the content; the pan bounds are unchanged and the environment cannot be panned to beyond x -9 / z 8.
- The teaser lies at z 9.9..10.6, beyond the site plate (z 9) and the pan bound (z 8): it is visible at the default view above the far edge but never reachable by panning. The near hall posts and the Complex west frame overlap in screen space (the hall is behind / beside it); not measured as a depth-order read.
- Android instance budget: about 27 extra primitives + 10 `structure-high` instances (static); not benchmarked.
- A Reboot snaps back to the Workshop (hall / vertical group / teaser disappear instantly); whether an instant disappearance feels right belongs to AUT-046 / AUT-048.
- Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`, `TECHNICAL_DESIGN`).
