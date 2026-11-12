# AUT-040 Reusable Construction Presentation

**Human gate: PENDING** (feel, readability and timing of the sequence on a real device). Automated checks only prove
wiring and determinism. Presentation only: no economy, runtime, save, camera or scene-file change.

## What was built
- `ConstructionSequence.ts` (pure): generic timeline, 1.5-3 s (default 2.2 s, clamped). Modules reveal in plan order with
  overlapping windows: ghost (small) -> building -> done, then a 20% activation window. Also samples `sparkIntensity` and
  `lightLevel`.
- `ConstructionViewModel.ts` (pure, read-only): starts a sequence from a live `producerConstructed` event or a live
  unbuilt -> built transition seen by a later sync (AUT-039 snapshot-before-event ordering, deduplicated). A first sync
  (save load) never plays one; Reboot cancels and allows a replay. Reports each completion once (activation hook).
- `ConstructionPresentationController.ts` (`cc`, thin): `registerTarget(producerId, ConstructionTarget)`, applies frame 0
  immediately (no built-state flash), drives a 6-node spark pool, calls the target's activation hook, emits the DEBUG
  `construction_state` device event (`started` / `activated`).
- First target: `AssemblyVisualController` (replaces the AUT-039 instant shell -> built swap: module scales follow the
  sequence, the inactive shell shrinks away as it starts). Wired at runtime in `FactoryWorldBootstrap`
  (`createConstructionPresentation`); `PresentationController` feeds it before the other controllers.
- Tests: `tests/construction_presentation.test.ts`. `npm run check`: PASS (609 tests, pacing 4/4).

## Pending / limits
- Not device-verified; no new device scenario yet. Sparks/timing are implementer values (Scene Presentation / human gate).
- `lightLevel` is sampled but not rendered yet (sparks only); a construction light is a follow-up if the gate wants it.
- Other producers (Fabricator, Robot Line, ...) are not registered as targets; they do so in their own tasks (AUT-042+).
