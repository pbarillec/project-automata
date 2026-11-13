# AUT-UI-003 Free Overclock HUD Action

Owner decision: Free Overclock is an explicit player-triggered interaction. The two existing Overclock HUD rows (`FreeOverclockValue`, `FreeOverclockTimer`) are now the control: tap when ready to activate, see the active countdown (AUT-047 amber pill), then the cooldown seconds until ready again.

**Human gate: PENDING.** Automated checks prove mapping, wiring, layout geometry and the device tooling only. Readability, tap comfort and the activation look on a phone are not verified; no APK was built and nothing was run on a device.

No new gameplay system, no DEBUG-only trigger, no economy / design / monetization change, no rewarded-ad flow, no new text key.

## What was built

- `UiLayout`: third `HUD_ACTION_KEYS` entry `OverclockAction`, placed through a new optional card field `rowActions` (`{ key, firstRow, lastRow }`): the Button spans the two Overclock rows at the full row width (no action-row slot of its own). `cardActionRect` / `cardActionFontSize` / `computeUiLayout().hudButtons` handle it, so `ui_layout` rects and the device harness work unchanged.
- Touch target: the two Overclock rows grew from 24 to 26 units (2 x 26 = 52, the height of the other HUD Buttons and the panel Buttons). The HUD card is 4 units taller (about 6 px at 1080 wide); HUD + panel coverage stays under the 35% budget (tested on all reference screens).
- `CoreLoopActions.resolveOverclockAction(freeOverclock)`: always visible, enabled only when `freeOverclock.canActivate` (state `ready`); command is the existing `{ type: 'activateFreeOverclock' }`.
- `CoreHudController`: the action loop creates an `OverclockAction` Button node (UITransform + Button, no Label of its own, created after the rows so it is on top) with the same `EventHandler -> onActionPressed(_event, 'OverclockAction')`. `onActionPressed` calls the existing `activateFreeOverclock()` (re-checks `canActivate`, emits only through `commandEmitter`). `applyActionStates` makes the Button `interactable` only while enabled; a disabled tap falls through to the root, which swallows it. `getActionStates()` reports it in the DEBUG `ui_layout` `hudActions`.
- Visual states (texts are the existing `hud.free_overclock.*` strings; the pill is the AUT-047 `BoostHudPill`, unchanged):
  - locked: dimmed text "Free Overclock: Locked", not interactable.
  - ready: amber text "Free Overclock: Ready" (the tappable look), interactable. New pure `BoostHudPill.resolveOverclockRowText`.
  - active: AUT-047 amber pill, dark text "Free Overclock: x2" + "<n>s" countdown, not interactable.
  - suspended: AUT-047 amber outline "Paused", not interactable.
  - cooldown: dimmed text "Free Overclock: Cooldown" + "<n>s", not interactable; ready again re-enables it.
- Device tooling: `RevealTrigger` `overclock` (taps the `OverclockAction` rect from `ui_layout`; `--trigger overclock`), `tools/device/seed_ui003.ts` + `npm run device:seed-ui003` (the AUT-047 `ready` factory: Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot, no boost, no cooldown; Free Overclock is READY by the existing `isFreeOverclockUnlocked` rule, asserted by a test), reveal scenario `ui003` (seed, `trigger: 'overclock'`, `expectConstruction: null`, `expectFocus: false`, 30 s at 400 ms). New capture option `expectCommands`: the `ui003` scenario requires an accepted `command_result` for `activateFreeOverclock` (check id `command_activateFreeOverclock_ok`) and `boost_presentation` phases `started` and `effect_applied`.

Run on a device (DEBUG FactoryWorld APK installed): `npm run device:reveal-capture -- --scenario ui003`, or `npm run device:seed-ui003` for a hand test.

## Tests

- New `tests/overclock_hud_action.test.ts`: state mapping through a real runtime (ready -> active -> cooldown -> ready again), row text mapping, the real controller method bodies against a fake host (inert before a snapshot, nothing while disabled, emits only `activateFreeOverclock` through `commandEmitter`, stale snapshot dropped), layout (rect equals the two rows, height >= 52 units, no overlap with other rows / actions / panel, inside HUD and safe area on 6 screens), caption widths, seed round trip, scenario / CLI / package script, check evaluation (accepted vs rejected command_result, missing boost phases) and `parseHudActions` for the new key.
- Amended (legitimate pins):
  - `era_environment`, `reveal_capture`: `Object.keys(REVEAL_SCENARIOS)` now includes `ui003`.
  - `boost_presentation`: CLI usage regex now includes `ui003` (AUT-047 deviation 1 about the missing HUD action is superseded by this task).
  - `device_ui001_scenario`: `parseHudActions` of an empty event now has the third key (null).
  - `ui_layout`: the HUD action caption-fit loop skips `OverclockAction` (it has no label of its own; covered in the new test).
- AUT-UI-001 HUD checks, AUT-R-036 layout contracts and the `core_loop_input_wiring` / `hud_view_model` pins are unchanged and green.
- `npm run check`: PASS (763 tests, 0 fail; pacing regression PASS).

## Deviations / notes

1. No new text key: the ready affordance is the existing "Free Overclock: Ready" text plus the amber tint; there is no explicit "activate" verb in the UI. If the owner wants one, a new `hud.free_overclock.*` key follows AUT-LOC-001 (Game Designer wording).
2. HUD row heights 24 -> 26 for the two Overclock rows (touch target rule: Buttons >= 52 units). Layout only; no economy or design value.
3. Amber ready text and dimmed (140,148,146) locked / cooldown text are implementer values for Scene Presentation review; the AUT-047 pill colours are untouched. A ready-state pill was deliberately not added (it would change the AUT-047 pill contract).
4. Seed reuses `buildAut047SeededState('ready')`; it is a review seed (5000 Industrial Output), not a gameplay state.

## Unverified

Everything on a device: tap comfort on the 52-unit row, that the amber ready text and dimmed disabled text are readable and distinct, the activation impulse + ramp-in after the tap (AUT-047 look, still unit-tested only until the `ui003` capture is run), the cooldown countdown and the re-enable on screen, that a disabled tap never reaches the world. Visual evidence goes to the vision-capable visual QA first; the feel of the activation (1.3x ramp) stays with the owner.
