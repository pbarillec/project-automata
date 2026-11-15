# AUT-062 Founder Robot / UNIT 0001

Presentation only. No economy, monetization, design, runtime, save (version stays 3), domain-event or schema change. No new imported asset, `Robot.glb` untouched.
**Not device-validated:** the implementer ran no device capture. Readability at the normal camera distance, the crest pixel size and the premium feel are pending
agent visual QA of the screenshots, then a human sign-off on the subjective premium feel of a monetized cosmetic.

## What was built
- `FounderRobotVariant.ts` (pure, no `cc`): palette (GRAPHITE_SHELL 38/40/46, GRAPHITE_DARK 22/24/28, GOLD_ACCENT 232/176/48, GOLD_HILITE 255/214/110, alpha 255 only, no emissive),
  contrast helper, the part list (world units at the final robot scale) and the rule `resolveFounderRobotSlots(owned, visibleCount)`:
  not owned -> none; owned -> rank 0 (the AUT-039 Worker Bot node, even before its first reveal) and, when 4+ robots are visible, exactly one pooled slot (slot 2 = rank 3);
  never all, at most 2, deterministic.
- `FounderRobotVisual.ts` (`cc`, thin): `applyFounderRobotVariant(node, founder)`. First `true` on a node creates a `FounderVariant` child container (box primitives, `builtin-unlit`,
  `USE_COLOR`, `mainColor`, opaque) and tints the node's own cloned material instances (`getMaterialInstance`, never the shared glb material; Main/Grey -> GRAPHITE_SHELL, Black -> GRAPHITE_DARK).
  Created once, reused, never destroyed, hidden by container scale 0; it is a child of the robot so it inherits the pool scale, scale-in and hidden-by-scale (AUT-038), and follows
  position / heading. A robot that is never a Founder costs nothing.
- Wiring: `FirstRobotPresentationController` (rank 0 node) and `RobotPopulationController` (pool) read `isFounderRobotCosmeticOwned(state)` on `sync()` and on every domain-event batch
  (`founderPackApplied` fans out), so a mid-session purchase swaps in place: no fanfare, no reveal, pose / clip untouched. Persistence is derived only from
  `meta.cosmeticOwnership['cosmetic.founder_robot']`.
- DEBUG event `robot_founder { phase, owned, founderRanks, visible, pooled, shellTinted, fallbackShell, applied, crest?, screen? }` (declared in `DeviceDiagnostics`); `sample` events
  (every 2 s, max 12, DEBUG only) add the crest rectangle in window pixels (bottom-left origin, best effort: projected world corners of the fin / antenna / tip).

## Shipped sizes (world units at WORKER_BOT_SCALE 0.24; robot 1.08 tall, head top 1.083)
The briefed starting crest (fin 0.04 x 0.16 x 0.10, antenna 0.015 x 0.20, tip 0.05) was enlarged ONCE by 1.5x up front (`FOUNDER_CREST_ENLARGE`): the AUT-041 benchmark screenshot
(robot about 90 px for 1.08 world, about 85 px per world unit) put the starting fin at about 3 px wide, clearly under the target. Not re-measured on device.

| Part | Size (x, y, z) | Colour |
|---|---|---|
| crest fin (head top) | 0.06 x 0.24 x 0.15 | GOLD_ACCENT |
| antenna (stacked on the fin) | 0.0225 x 0.30 x 0.0225 | GOLD_ACCENT |
| antenna tip | 0.075 cube | GOLD_HILITE |
| two shoulder bands | 0.11 x 0.09 x 0.20 at x +-0.18, y 0.64 | GOLD_ACCENT |
| chest band | 0.40 x 0.06 x 0.34 at y 0.46 | GOLD_ACCENT |
| UNIT 0001 plate, front and back | 0.12 x 0.06 x 0.012 at y 0.56, z +-0.176 | GOLD_ACCENT |
| 4 pips per plate | 0.016 x 0.026 x 0.006 | GRAPHITE_DARK |

Crest + antenna + tip add 0.54 world (50% of the body; brief minimum 1/3). Estimated at about 85 px per world unit: about 46 px tall, but only about 5-9 px wide (the briefed ~22 px width is
NOT met by a thin stacked crest) and about 500-600 px2 of gold including bands. These are estimates, not captures. If visual QA finds the crest unreadable the brief says: report, do NOT
substitute another cosmetic (Art / Orchestrator decide; AUT-062 plan fallback is a more visible factory cosmetic only after approval).

## UNIT 0001
Shipped the fallback: an opaque gold plate with 4 graphite pips (front and back). Glyph text is anti-aliased / alpha-blended and cannot be guaranteed opaque on Android, so no
Label / sprite is used. Legibility is not a pass criterion.

## Shell tint and fallback status
Primary path: per-node cloned material instances tinted through `mainColor` (the `builtin-standard` albedo property). Whether the skinned glb materials accept it on Android is UNVERIFIED
(no device run). If no slot can be tinted the code falls back automatically to graphite shell boxes on the head and torso with the gold bands and plates enlarged 1.25x
(`fallbackShell: true` in `robot_founder`). The linear / sRGB treatment of `mainColor` on the standard effect is not verified, so the exact rendered graphite may read slightly darker or lighter.

## Known limits
- Accent boxes are attached to the robot root, not the head bone: they do not follow the walk-cycle head bob (a few pixels).
- Robot.glb is assumed to face +Z (AUT-039); the plate marked "front" follows that assumption (a plate on each side makes it moot).

## Device evidence tooling (nothing run)
- `npm run device:seed-aut062 -- --variant not_owned|owned_before_first_robot|owned_many_robots|mid_session`
- `npm run device:reveal-capture -- --scenario aut062-not-owned|aut062-owned-first|aut062-owned-many|aut062-mid-session|aut062-reload`
- `tools/device/founder_robot_checks.ts` (unit-tested): Founder count <= 2 and < visible from 3 visible, rank 0 owned / none when not owned, owned never flips back, relaunch determinism, mid-session swap
  after the accepted `grantFounderPack`, `robot_perf` windows within the AUT-041 budget (p95 <= 25 ms, >= 50 fps when sampled), no `error` events. Shell status and the crest rectangle are information only.
- `aut062-mid-session` reuses the AUT-059 mock-store purchase drive (chip -> BUY -> relaunch) with `expectFounderShop: purchase_success`.

## Tests
`tests/founder_robot.test.ts` (13): palette opacity and graphite / gold contrast >= 3:1, parts, slot resolver cases, no `cc` in the pure module, source pins (unlit opaque boxes, material
instances, never destroyed, scale-hidden, both controllers wired, no new event / save change), checks, seeds, scenario wiring. Pinned scenario-key lists in `tests/era_environment.test.ts` and
`tests/reveal_capture.test.ts` were updated for the five new scenarios. `npm run check`: PASS (1299 tests, pacing 4/4).

## Pending
- Agent visual QA of the owned-many / owned-first / not-owned captures (crest + gold read at the normal camera distance), then human sign-off on the premium feel.
- Real-device confirmation of the shell tint (or the fallback) and of the crest pixel size.
