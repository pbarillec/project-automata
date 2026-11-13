# AUT-046 Milestone & Breakthrough Presentation Layer

**Human gate: PENDING** (vision-capable visual QA of seeded device screenshots first; owner only for the subjective items below). Automated checks prove tier mapping, queue rules, dedupe, focus gating, wording, layout geometry, wiring and determinism only.
Presentation only: no economy, runtime, data, save, camera-API, design, monetization or art-direction change; no new asset file (a UI pill/labels, two flat primitive pulse plates, the AUT-040 spark pool). AUT-047 (overclock), AUT-048 (era transition) and AUT-049 (Reboot) are out of scope.

## What was built

One reusable pipeline: `DomainEvent -> tier -> toast + pulse/spark + optional focus`. No per-milestone cinematic. Pattern as AUT-040 / AUT-045: pure engine-free modules (explicit `.ts` imports, no constructor parameter properties) + one thin `cc` controller.

- `MilestoneTier.ts` (pure data + classifier): `MILESTONE_EVENT_TIERS` (one row per `DomainEvent` type, test-pinned to the union), `ROBOTS_BUILT_THRESHOLD_TIERS` (one entry per threshold), `BREAKTHROUGH_FOCUS_PRODUCER`, `classifyMilestoneEvent` -> `{ tier, trigger }`. Trigger flags: accent, sparks, pulse, focus target.
- `MilestoneToastQueue.ts` (pure): timing (Minor 0.15/0.5/0.2 s; Major 0.25/1.9/0.35 = 2.5 s with a 0.6 s underline wipe) and the queue (below).
- `MilestoneFeedback.ts` (pure): pulse / spark envelopes (Minor pulse 0.5 s; Major pulse 1.0 s + 5 sparks over 0.8 s), accent colours, and `resolveMilestoneFocus` (focus gating).
- `MilestoneToastText.ts` (pure): wording: English templates in this module, producer / breakthrough names through the catalogue display-name keys.
- `MilestoneToastLayout.ts` (pure): the band, tier sizes, colours, predicted screen rect.
- `MilestonePresentationViewModel.ts` (pure, read-only): fact-key dedupe, silent first sync, Reboot, exceptional / subsumed handling, owns the queue.
- `MilestonePresentationController.ts` (`cc`, thin): builds the toast children lazily, renders frames, runs the pulse plate / sparks, requests the focus, emits `milestone_presentation`.
- Wiring: `PresentationController.milestonePresentation` (`sync` + `consumeDomainEvents`, fed LAST so every owner reveal has already started); `FactoryWorldBootstrap.createMilestonePresentation` (after `createUiRoot`): `UiSafeArea/MilestoneToast` (Widget top-anchored below the HUD card), two flat pulse plates `MilestonePulse_amber/cyan` (unlit boxes, scale 0 at rest), wiring of the camera, the AUT-040 construction controller and the focus anchors; names are assigned with the HUD's once the session is ready (after `binding.init()`, so the load baseline never depends on names). `ConstructionPresentationController.isAnyConstructing()` (new, 1 method) and `isFirstAutomationEvidence` exported from `AutomationPayoffViewModel` (reused, not duplicated). Scene file: unchanged.

## Tier table (as implemented)

| Event | Tier | Presentation |
|---|---|---|
| `producerMilestoneReached` | MINOR | chip "<producer> Lv N" + short pulse (amber); no sparks, no focus |
| `automationStateChanged` (isAutomated, not the first) | MINOR | chip "<producer> automated" + pulse (cyan, dimmer than lamps) |
| `automationStateChanged` first (fabricator / `auto_feeder`) | EXCEPTIONAL | routed only (FirstAutomation controller) |
| `automationStateChanged` isAutomated=false | none | |
| `breakthroughPurchased` | MAJOR | title = breakthrough name, subtitle "Breakthrough unlocked", underline wipe, 5 sparks, 1 s pulse, focus allowed |
| `robotsBuiltThresholdReached` | MAJOR (all thresholds, see below) | title "Robots built: N", subtitle, sparks, pulse (cyan), focus on the Robot Line |
| `producerConstructed` | MAJOR | toast title ONLY "<producer> built" (no sparks / pulse / focus: AUT-040 owns the build reveal) |
| `firstRobotProduced`, `eraChanged`, `rebootCompleted` | EXCEPTIONAL | classified only; never presented here (AUT-048 / 049) |
| everything else (output, production, level purchases, assisted batches, AI Core events, permanent upgrades, flags, `temporaryBoost*`, civilization) | none | |

## Queue and gating rules (all unit-tested)

- One visible toast at a time (so max 1 per tier). A Major pre-empts (drops) the visible and waiting Minors; a Minor arriving while a Major is visible is dropped.
- Same-tier FIFO, at most 2 waiting; extras collapse into "+N" on the last waiting (else visible) toast. Same-producer Minors within 1 s merge (later one dropped). A burst (one event batch) offers at most 1 Major + 1 Minor (extra Majors collapse, extra Minors drop).
- A breakthrough that constructs a producer (`producerConstructed` source `breakthrough` in the same batch) shows ONE Major (the breakthrough); the construction toast is skipped as `subsumed`.
- Silent load: the first `sync` only records facts (breakthroughs owned, producers built, producers automated). Events dedupe by fact key (`b:` / `c:` / `a:` / `m:` / `r:`), a later snapshot that reveals a not-yet-announced fact fires it once, and the pair never double-fires (snapshot-before-event and event-before-snapshot both covered). Reboot (event or a snapshot where facts vanished) clears the timeline and re-baselines silently, so milestones can present again in the next run.
- Focus: only a Major with a focus producer, only when its anchor is >= 2.5 world units off the camera focus, and only when no Exceptional event shares the burst, no construction sequence runs and no camera focus transition is active; otherwise the toast shows and the focus is skipped (`focus_skipped` with the reason). The beat is the existing `MobileCameraController.focusOnRevealTarget` (its serialized 0.45 s ease); a touch / pan cancels it in the camera itself (no re-snap). The toast band has no touch listener, so input and panning stay live.

## Diagnostics / seed

DEBUG `[AUT-DEVICE]` event `milestone_presentation` (declared in `DeviceDiagnostics`, recorded by the reveal timeline): phases `synced`, `toast_started` (id, key, tier, kind, accent, producerId, title, subtitle, extra), `toast_finished`, `queue` (queued / dropped / collapsed), `skipped` (duplicate / subsumed), `exceptional_routed`, `focus_requested`, `focus_skipped` (reason).

`npm run device:seed-aut046` (`tools/device/seed_aut046.ts`, variant `breakthrough`): Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot owned, Output 500000; the HUD Next Goal is Robotic Logistics (250000, affordable): one tap on Unlock emits `breakthroughPurchased` -> one Major toast "Robotic Logistics" with sparks / pulse on the Assembly Station and a camera focus when it is off-centre (pan away first). No Exceptional event in that burst. Round-trips through the save; the load itself must be silent. Not run on a device.

## Tests (`tests/milestone_presentation.test.ts`, 22; `npm run check`: PASS, 734 tests, pacing regression 4/4 PASS)

Tier table pinned to the `DomainEvent` union and per-type tiers; classification (first / non-first automation, de-automation, robots thresholds as single data entries, exceptional = no trigger); trigger flags; no-toast events (incl. view model output empty); timing; queue (pre-emption, FIFO, max 2 waiting, "+N", merge, burst limit); view model (silent first sync, events before baseline, real `GameRuntime` breakthrough, snapshot/event ordering both ways, Reboot replay, exceptional-in-burst focus suppression, subsumed construction, first robot routed); focus gating; effects; wording (no x-multiplier headline); layout on 5 screens (below HUD, above panel, clear of every button, inside the factory band, fonts >= 20); wiring and controller guarantees (no touch listener, only the reveal focus API, no command / state write, scale-based visibility, no ctor parameter properties, unique metas); no scene churn; seed. Existing tests changed: none.

## Deviations / interpretations (each to confirm)

1. **Robots Built thresholds**: which are "important" is undecided, so all four (1 / 10 / 100 / 1000) are MAJOR; each is a single entry of `ROBOTS_BUILT_THRESHOLD_TIERS` to downgrade (`'minor'` / `'none'`). Threshold 1 can share a batch with `firstRobotProduced` (Exceptional): the toast shows, the focus is skipped.
2. **No reusable toast component existed** in the HUD: a minimal one (graphite pill, two labels, accent underline sprite) lives in `MilestonePresentationController`.
3. **Camera "hold <= 1.2 s total" / return**: the existing reveal API only eases to the target (0.45 s serialized) and stays; no new camera API, so there is no hold-then-return. The beat is interruptible by touch / pan natively.
4. **"1 Major + 1 Minor per burst"** is implemented as offered-per-burst limits plus the rule that a Major drops Minors and Minors are dropped while a Major is visible; so in practice a burst shows one toast (the Major). A Minor that arrives while a Major is visible is dropped rather than delayed (it would be stale).
5. **Sparks** use the shared AUT-040 pool (5 of 6 nodes, alternating cyan / amber, so a Major spark burst is mixed-colour rather than accent-only) and are skipped while a construction runs (the pool and the sequence conflict otherwise). Light pulse = a flat unlit plate scaling 0 -> 1.6 -> 0 on the producer's focus anchor (amber / cyan), not a real light.
6. **Text**: the toast templates are a small English table in `MilestoneToastText.ts`, NOT keys in `localization/en.json`: the AUT-LOC-001 tests pin the shared catalogue to the HUD / panel composition (no dead keys, exact params) and the bootstrap `displayNames` assignment count; moving the templates into the catalogue (and extending those tests) is a localization follow-up (AUT-052). Names still come from the catalogue. Cyan accent (59,112,121) is the AUT-045 environment cyan (dimmer than the 82,206,224 lamps); amber is 224,168,72 (implementer value).
7. Implementer values for Art Director / Scene Presentation review: pill 440x44 (Minor) / 620x96 (Major), fonts 24 / 30 / 22, 8-unit gap below the HUD, off-centre threshold 2.5, pulse 0.5 / 1.0 s, spark radius / height.
8. `breakthroughPurchased` for the very first breakthrough (Auto Feeder) still shows its Major toast alongside the first-automation reveal (focus skipped through the Exceptional-in-burst rule); say so if the Art Director wants it silent.

## Review plan / unverified

1. Vision-capable visual QA first: `npm run device:seed-aut046`, tap the HUD Unlock, screenshot the toast (placement under the HUD, not over Next Goal / buttons, readability, accent contrast, producer pulse / sparks, no clipping). Objective criteria are decidable from stills.
2. Owner only for the subjective items: how the Major feels (2.5 s duration, underline wipe, spark / pulse strength), Minor chip subtlety, whether the focus beat helps, the importance of the robots thresholds.
3. Not verified on a device or visually: any colour, the toast / pulse / spark motion, the real touch-transparency of the band (guaranteed by having no listener, not run), Widget placement at runtime, focus interruption feel, burst behaviour with real timings. No APK was built here.
4. Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`, `TECHNICAL_DESIGN`).

## Device evidence and visual QA (2026-11-13)

DEBUG APK built from 5002204 (gate label aut046e), seeded Robotic Logistics one tap away (`npm run device:seed-aut046`), Next Goal Unlock tapped; capture via `npm run device:reveal-capture -- --scenario aut046` plus a dense parallel-screencap burst (~100-200 ms) under `temp/aut046_dense/` (gitignored). Logcat: 0 errors; `toast_started` / `pulse_started` / `sparks_started` / `focus_skipped (on_centre)` / `effect_applied` / `toast_finished` (~2.5 s).

Iterations driven by vision QA: (1) toast pill/accent used spriteFrame-less Sprites that rendered nothing -> Graphics fills; (2) offer-started toasts never started pulse/sparks/focus (only `tick.started` was handled) -> fixed; (3) anchor lookup used a snake_case node name that never resolved (`<producer>_FocusAnchor`) -> zone-based `Zone_X/X_FocusAnchor`; (4) opaque pulse plate hid the machine -> thin outline ring inside the footprint, amber sparks.

Vision QA (`scene-presentation`): PASS on stills — toast (graphite pill, amber title and accent bar, below HUD/above panel, one at a time, silent baseline), HUD/camera unobstructed, pulse ring and amber sparks visible without covering the station/gantry. Non-blocking POLISH: the ring reads as a partial L-bracket at the front/lower-left of the plate rather than hugging the machine cluster.

Pending (owner, subjective/live): pulse timing/duration, whether the Major reveal feels satisfying/premium, toast fade, 2.5 s duration. Not exercised on device: Minor toast, queue bursts, a Major with an off-centre target (focus path).
