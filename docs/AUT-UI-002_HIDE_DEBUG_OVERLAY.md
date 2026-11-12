# AUT-UI-002 Hide FPS/debug overlay

Owner decision 2026-11-12 (follow-up of the AUT-GP-001 / AUT-039 gate PASS): the grey engine FPS/debug overlay covered
the bottom panel during gates.

- `FactoryWorldBootstrap.onLoad` calls `profiler.hideStats()` before diagnostics are configured. Builds stay `debug: true`,
  so the `[AUT-DEVICE]` log diagnostics and the device harness are unaffected (they never read the overlay).
- Test: `tests/debug_overlay_hidden.test.ts`. `npm run check`: PASS (601 tests, pacing 4/4).
- Not device-verified yet: confirm on the next device build that the overlay is gone. Styled-button polish stays queued.
