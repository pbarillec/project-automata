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

## Real-device human gate (prepared 2026-11-12, device 1100a155, portrait 1080x2412)

Gate APK (FactoryWorld DEBUG, built from `0e3aeba`, tracked build config restored): `temp/gate/ProjectAutomata-aut040-0e3aeba-factoryworld.apk`,
sha256 `89424ac2c84ffacce8c7653f088fe0d9c7cab36863efe3772cffbf0d75ffad95`. Installed on the phone.

Seed (re-runnable any time): `npm run device:seed-aut040` -> force-stop, writes a save (Fabricator Lv15 automated, Assembly Station
unlocked but NOT built, Output 4500 = 3x its cost) and relaunches. Verified on device: `loaded_main`, Assembly `unbuilt`, no error events,
screenshot `temp/aut040/00-seeded-launch.png` shows the HUD "Build Assembly Station 0/1" and **no FPS/debug overlay** (AUT-UI-002 confirmed
by screenshot; the human confirms it).

Checklist for the human (build the Assembly Station live, then judge):
1. FPS/debug overlay is gone (bottom of the screen).
2. Tap the Assembly Station, build it from the Producer Panel: the sequence plays once, about 2 s: the grey shell gives way, the slab, bed,
   corner appear in order (small ghost -> solid), cyan/amber sparks, then it settles. Readable, not too long/short, no pop-in at the start or end.
3. The built station and HUD are correct afterwards; the manual batch still works.
4. Home + relaunch (or `npm run device:seed-aut040` is NOT needed): the built station appears instantly, no replay.
5. Reboot/back to unbuilt (re-seed) plays the sequence again on the next build.

Tracing: `adb logcat -d | grep AUT-DEVICE | grep construction_state` should show `started` (modules, durationSeconds) then `activated`.
Not covered by an automated scenario (the build tap is a human step); automated checks remain `npm run check`.
Human gate result: PENDING. AUT-041 must not start before it.
