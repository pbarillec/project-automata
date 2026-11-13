# AUT-047 Overclock Presentation

**Human gate: PENDING** (vision-capable visual QA of device screenshots first; owner only for the subjective items below). Automated checks prove the state -> presentation mapping, envelopes, silent load, spark limits, no toast, HUD mapping, wiring and the seed only.
Presentation only: no economy, runtime, data, save, camera-API, design, monetization or art-direction change; no new asset file (a HUD pill drawn with Graphics, one flat outline plate, the AUT-040 spark pool). Rewarded flow, Extended Overclock UI, offline catch-up, Reboot / Era presentation, sound, HUD layout and button behaviour are out of scope.

## What was built

Keyed on "a temporary production boost is active" (any boost id with a `productionMultiplier` effect, so Extended Overclock reuses it later), not on `free_overclock` alone. Pattern as AUT-040 / AUT-045 / AUT-046: pure engine-free modules (explicit `.ts` imports, no constructor parameter properties) + one thin `cc` controller.

- `BoostPresentation.ts` (pure): `resolveBoostSnapshot` (inactive / active / suspended), `selectBoostSparkMachines`, envelopes, spark placement samplers and `BoostPresentationModel` (`syncFromState` silent, `consumeEvents`, `tick`, `reset`). `tick` writes into one reused frame object (no per-frame allocation) and reports `idle` so nothing runs while inactive.
- `PresentationTimeScale.ts` (pure, module-level holder, clamped 1..1.4): the shared presentation-only time scale. The simulation never reads it (test-pinned).
- `BoostHudPill.ts` (pure): HUD view state -> pill style (active amber fill + dark text, suspended amber outline + dimmed text, otherwise none).
- `BoostPresentationController.ts` (`cc`, thin): writes the time scale, runs the sparks / ring, stops on idle, emits `boost_presentation`.
- Wiring: `PresentationController.boostPresentation` (`sync` + `consumeDomainEvents`, after the milestone controller); `FactoryWorldBootstrap.createBoostPresentation` (controller node `BoostPresentation`, own flat outline plate `BoostPulse_amber` of 4 opaque bars, scale 0 at rest, anchors via the zone naming `Zone_<Zone>/<Zone>_FocusAnchor` through `producerZoneName`); `onGameHide` -> `onBackground()` (stop at once), `onGameShow` -> `resume(state)` (silent re-sync, new `FactoryWorldStateBinding.getStateSnapshot()`). Scene file unchanged.
- Time-scale consumers (presentation clocks only): `AssemblyVisualController` (status panel pulse), `FirstAutomationPresentationController` (Fabricator activity pulse), `RobotLineVisualController` (belt + arm clocks), `AutomatedCellVisualController`, `AdvancedRoboticsComplexVisualController` (their cycle clocks), `FirstRobotPresentationController` (Worker Bot route in `loop` mode only, never the reveal beat; clip `state.speed`), `RobotPopulationController` (pool route clock + clip `state.speed`). One line each.
- HUD: `CoreHudController` adds a `FreeOverclockPill` Graphics node under the two Overclock rows (`FreeOverclockValue`, `FreeOverclockTimer`). Texts are the existing `hud.free_overclock.*` strings: active "Free Overclock: x2" + "<n>s"; suspended "Free Overclock: Paused" with the frozen seconds. The pill only redraws when its style changes.

## Look table (as implemented)

| State | World | HUD |
|---|---|---|
| locked / ready | baseline, nothing running | existing HUD |
| activation (`temporaryBoostActivated`, live only) | ~0.35 s impulse: amber ring on the Assembly zone footprint + 3 sparks; speed ramps 1.0 -> 1.3x over ~0.4 s; no camera focus / shake / flash / tint | pill turns amber |
| active | time scale 1.3x on the loops above; low-rate amber sparks (one 22 % flash per 1.3 s per spark) on at most 2 machines (Assembly Station, then Robot Line else Fabricator) | amber pill, dark text, x2 + seconds |
| expiry / cooldown | ease out ~0.6 s to 1.0x, sparks stop, no residual amber, no fanfare | pill removed (cooldown look unchanged) |
| suspended | treated as paused: baseline visuals (eases out); resume re-enters active through the same ramp, no impulse | amber outline, dimmed, "Paused", frozen seconds |
| load with an active boost | silent: no impulse, sustained look at once | amber pill with the remaining seconds |
| app background | stops at once; foreground re-syncs silently from the state | n/a |

No toast: `temporaryBoost*` stays tier `none` in `MilestoneTier` (test-pinned).

## Diagnostics / seed / scenario

DEBUG `[AUT-DEVICE]` event `boost_presentation` (declared in `DeviceDiagnostics`, recorded by the reveal timeline): phases `synced`, `started`, `ended`, `suspended`, `resumed` (payload source, impulse, mode, remainingSeconds, multiplier, machines, anchorsResolved), `settled`, `stopped` (background) and `effect_applied` (anchorResolved, anchorName, timeScale, level, plateScale / plateWorldPos, sparkScale / sparkWorldPos, poolSize).

`npm run device:seed-aut047 [-- --variant active|ready]` (`tools/device/seed_aut047.ts`): Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot, 100 robots; `active` (default) has Free Overclock active with 22 s left, `ready` has it ready. `npm run device:reveal-capture -- --scenario aut047` seeds `active`, no trigger, 30 s capture at 400 ms; checks `boost_synced`, `boost_effect_applied`, `boost_ended`, `boost_settled`. Not run on a device.

## Tests (`tests/boost_presentation.test.ts`, 13; existing tests changed: the two `Object.keys(REVEAL_SCENARIOS)` pins in `era_environment` / `reveal_capture`)

Mapping locked / ready / active / cooldown / suspended through a real `GameRuntime`, any-boost keying, activation impulse + ramp envelopes (one impulse only, monotonic, within 1.25-1.4), expiry ease-out and idle, suspend / resume, silent load (no impulse, sustained look), reset, spark limits (<= 3 sparks, <= 2 machines, odd amber pool nodes, low duty), reused frame / clamped time scale, no toast, HUD text and pill mapping, footprint containment, controller / bootstrap / loop-controller wiring (no node.active, no Sprite, no camera focus, no state write), seed round trip, CLI / scenario / timeline checks.

## Deviations / interpretations (each to confirm)

1. **No HUD Overclock action exists.** `CoreHudController.activateFreeOverclock()` has no button and no caller (button behaviour is out of scope), so the live activation impulse cannot be triggered on a device; no `overclock` reveal-capture trigger was added (nothing to tap). The `aut047` scenario seeds Overclock already ACTIVE (sustained look from the load, then the real expiry ease-out and the cooldown pill after 22 s). The impulse + ramp-in is covered by unit tests only. A follow-up (button task) or a DEBUG-only trigger is needed to see it on a phone.
2. **Amber lamp lift dropped.** The only existing lamps are the cyan automation lamps (graphite / cyan unlit boxes), which must not be recoloured, and no amber producer-lamp material exists to lift. Nothing was invented. Report to the Art Director if a lamp asset / material is wanted.
3. **Robot_Running not used.** The clip exists in `Robot.glb` but `WorkerBotRoute.ts` is test-pinned to never use it; Worker Bot and pool robots are time-scaled (route clock + clip speed) only, as the fallback allows.
4. **Not time-scaled:** the AUT-040 construction sequences, camera / HUD animation, the AUT-046 toast. The Robot Line / Cell / Complex robots only loop `Robot_Idle` (their motion is the scaled belt / arm clocks), so no clip speed applies there.
5. **Sparks** use the three odd (already amber) AUT-040 pool nodes, so the pool is never recoloured; they yield while a construction sequence runs. An AUT-046 spark burst at the same moment may briefly overwrite them (rare, < 1 s). The ring is a dedicated plate (`BoostPulse_amber`, same outline layout as AUT-046) so a simultaneous milestone pulse cannot hide it.
6. **Implementer values** for Scene Presentation / Art Director review: speed 1.3x, ramp in 0.4 s / out 0.6 s, impulse 0.35 s, spark size 0.12 / radius 0.8 / flash 22 % of 1.3 s, amber 224,168,72 (HUD pill), pill padding 2 and outline 3 units. The pill spans the two existing rows (no new layout).
7. The visual speed-up is applied through a module-level shared scale (the loop controllers do not know about boosts); it is reset to 1 on idle, background and stop.

## Review plan / unverified

1. Vision-capable visual QA first: `npm run device:seed-aut047`, then screenshot the HUD pill (amber fill, readable dark text, x2 + seconds), the sparks on the Assembly Station / Fabricator (inside the footprints, machines uncovered), and the cooldown look after expiry; check no residual amber.
2. Owner only for the subjective items: whether ~1.3x reads as "faster", spark rate / strength, pill contrast, the ramp / ease timings.
3. Not verified on a device or visually: any colour, motion, the Android clip `state.speed` behaviour with `crossFade`, the HUD Graphics pill rendering, the activation impulse (no trigger, see deviation 1), background / foreground behaviour. No APK was built here.
4. Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`, `TECHNICAL_DESIGN`).

## Device evidence and visual QA (2026-11-13)

DEBUG APK from 334d0ce (gate label aut047), `npm run device:reveal-capture -- --scenario aut047` (Free Overclock seeded ACTIVE with 22 s left, 38 frames, `temp/reveal/aut047-2026-11-13T114239/`, gitignored). Automated checks PASS: boost_synced (silent load, sustained look), effect_applied (timeScale 1.3, anchorResolved), boost_ended ~21.5 s, boost_settled timeScale 1.0, 0 error events.

Vision QA (`scene-presentation`): PASS on stills for HUD pill identifiable (solid amber bar "Free Overclock: x2" + countdown, no overlap), sparse small amber sparks (<=1-2 per frame, no coverage, no red/tint/flash, cyan lamp unchanged), post-expiry baseline (no residual amber, pill "Cooldown 240s" counting down), active vs cooldown clearly different, no clipping/regression. Decision HUMAN_REVIEW_REQUIRED only for the 1.3x motion/spark-cadence feel.

Non-blocking POLISH (tracked): cooldown row is unstyled grey text (distinguished by its label); spark hue reads slightly yellow versus the amber pill.

Not shown / pending: activation impulse + ramp-in (no HUD Overclock button exists, so it is unit-test only — follow-up needs a button task or DEBUG trigger), READY state, 1.3x speed feel (owner).
