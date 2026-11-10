# AUT-UI-001 Core Loop Player Input (Manual Produce + Next Goal Breakthrough)

The HUD now carries the two core-loop actions: a permanent **Manual Produce** Button and a
**Next Goal unlock** Button that buys an eligible, affordable breakthrough in one tap. Both submit
`GameCommand`s through the existing `commandEmitter → FactoryWorldStateBinding.submit` path; the
Fabricator world tap stays selection only.

**Status: technical acceptance met in retry 1** (ui001, r036, C3, INT-001 PASS ×2 each on the
retry-1 gate APK), after a Technical Lead-approved one-line fix of a pre-existing AUT-037 defect (see
"Retry 1"). **Combined human gate: PENDING** (not run; kit below). Nothing here validates
readability, comfort, feel or onboarding.

## Decisions applied

- Owner (2026-11-10): Fabricator world tap = selection only; Manual Produce = permanent HUD Button
  (placement (a)); breakthrough purchases through the HUD Next Goal flow.
- Technical Lead defaults: Manual Produce stays available after automation; the Next Goal action
  exists only for `breakthrough` goals, is enabled only when `eligible` AND `affordable`, one tap,
  no confirmation; producer builds stay in the panel.
- Implementer choice (documented): a **locked** breakthrough goal shows the Next Goal Button
  **visible-disabled** ("Unlock 1.5K • Unavailable"); owned / unknown breakthroughs hide it.

## What was built

- **`presentation/CoreLoopActions.ts`** (new, engine-free, `.ts.meta` uuid `7398d5d8-…`):
  - `resolveManualProduceAction()` → always `{ visible, enabled, command: { type: 'manualProduce' } }`.
  - `resolveNextGoalAction(nextGoalVm)` → visible only for `category === 'breakthrough'` with
    `eligibilityStatus` `eligible`/`locked`; enabled only when `eligible` and
    `affordability.state === 'affordable'`; command `{ type: 'purchaseBreakthrough', breakthroughId }`.
  - No VM, runtime or economy change: it reads only `category`, `objective.breakthroughId`,
    `objective.eligibilityStatus`, `affordability.state`.
- **`CoreHudController`**: two child nodes `ManualProduceAction`, `NextGoalAction` (UI_2D, Label
  SHRINK, no wrap, one `Button` each with an `EventHandler` → `onActionPressed(event, key)`).
  - `manualProduce()` / `purchaseNextGoal()` re-resolve the action from the latest snapshot and emit
    only through `commandEmitter` (nothing while disabled or before the session wires the emitter).
  - Disabled Buttons are `interactable = false`; their touch falls through to the root, which still
    swallows it. The four root `TOUCH_*` listeners are unchanged.
  - `getActionStates()` feeds the DEBUG `ui_layout` diagnostic only.
- **`UiLayout`**: `CORE_HUD_LAYOUT.actionRow` below the six label rows — height 52, font 21, gap 8,
  `ManualProduceAction` 160 + `NextGoalAction` 272 = row width 440. `cardHeight` includes it,
  `cardActionRect()` gives each Button its own rect, `computeUiLayout().hudButtons` predicts them.
  - HUD 460×252 (was 460×200). Coverage HUD + panel: **26.7% at 16:9** (budget 30%), 21.3% on the
    NE2215 (2412×1080). One row side by side (not two stacked rows) keeps the HUD bottom at y=678 px
    on the NE2215, clear of the projected Advanced Robotics Complex centre (y=656) that R-036 checks.
  - Font 21: "Manual Produce" measured ~0.52 × font per character on device (the R-036 estimate is
    0.48); at 22 / 152 units it shrank to 20.67. At 21 / 160 the device reports 20.67 design units (Android floors label pixels, see the `UiLayout.ts` comment), still at or above the 20-unit minimum.
- **Text** (`localization/en.json` → regenerated `EmbeddedTextCatalogue.ts`), **wording approved by the Game Designer
  (desk review, 2026-11-10, no changes)**:
  - `hud.action.manual_produce` = "Manual Produce" (GAME_DESIGN §9 wording).
  - `hud.action.next_goal_unlock` = "Unlock".
  - The Next Goal caption reuses the existing panel templates with the goal cost:
    `producer_panel.action` → "Unlock 1.5K"; `producer_panel.action.unavailable` →
    "Unlock 1.5K • Unavailable". No disabled-variant key was needed. `HudTexts` gained
    `manualProduceAction` / `nextGoalAction` (empty while hidden).
- **`FactoryWorldStateBinding`**: one optional `reportCommandResult?(command, result)` option, called
  after every session result (accepted or rejected, after the fan-out), guarded like other reporters.
  No other behaviour change.
- **`FactoryWorldBootstrap`**: passes a DEBUG-only `command_result` emitter to that hook; `ui_layout`
  now also reports the two HUD action rects, `hudActions` (visible/enabled) and `fontSizes`
  (effective post-SHRINK size of every non-empty label **in design units** — `Label.actualFontSize`
  is in render pixels, so it is divided by the TTF render scale `max(1, view.getScaleX())`).
- **`DeviceDiagnostics`**: `command_result` `{ command, ok, reason, eventTypes, industrialOutput }`
  (`industrialOutput` = last `industrialOutputChanged.newAmount` of the command, else null).
- **Device harness**: `tools/device/scenarios/ui001_core_loop.ts` + CLI `ui001`. Reads
  `MANUAL_PRODUCTION_AMOUNT`, the Auto Feeder cost and the Fabricator ×1 cost from code/config.
  `r036_ui_layout.ts` needed no change (extra rects are ignored by its parser).

## Tests

- New: `tests/core_loop_actions.test.ts` (mapping: fresh → hidden; locked → visible-disabled;
  eligible+unaffordable → disabled; eligible+affordable → enabled with `auto_feeder`; owned → hidden;
  Manual Produce always enabled; captions, no raw key, no missing text),
  `tests/core_loop_input_wiring.test.ts` (runs the real controller method bodies against a fake
  host: emits only via `commandEmitter`, nothing while disabled, re-check on stale snapshot; Buttons
  on children; 4 root listeners; selection path has no `GameCommand`; binding hook gets accepted and
  rejected results, submit works without hook, throwing hook is reported; DEBUG emitter wiring;
  meta uuid), `tests/device_ui001_scenario.test.ts` (simulated device: PASS path + 9 fault modes +
  BLOCKED without APK + helpers).
- Amended (legitimate, per TL list):
  - `presentation_text_wiring`: HUD `setContentSize` count 2→3 and `.fontSize =` 1→2 (the action
    loop), plus HUD Button count = 1 and action-row sourcing.
  - `hud_landscape_wiring`: HUD Buttons on children (count 1, never on root); `ui_layout` reports
    HUD action rects, `actualFontSize`, `hudActions`.
  - `ui_layout`: action row fills the row width, ≥ panel Button height, inside the card below the
    label rows; HUD Buttons inside HUD/safe area, disjoint from each other, the panel and HUD label
    rows on all five reference screens; action captions fit at nominal font.
  - `ui_input_routing` T4 (HUD Buttons on children too) and T5 (HUD Button rects included in the
    world-camera hit-test check). T3 unchanged and green.
- `npm run check`: PASS (493 tests in attempt 1; 497 with the retry-1 regression test).

## Device evidence (NE2215)

Acceptance runs — retry-1 gate APK `temp/gate/ProjectAutomata-ui001-retry1-3dc1899-dirty-factoryworld.apk`
(sha be87bcd6…):

| Scenario | Run 1 (install) | Run 2 (`--skip-install`) |
|---|---|---|
| ui001 | PASS, all 8 scenario steps, 9 recorded steps counting `clear_saves` (`ui001-core-loop-20261110T113129Z-be87bcd6`) | PASS (`…T113204Z-be87bcd6`) |
| r036 | PASS (`r036-ui-layout-20261110T113233Z-be87bcd6`) | PASS (`…T113253Z-…`) |
| c3 | PASS (`c3-producer-selection-20261110T113307Z-be87bcd6`) | PASS (`…T113326Z-…`) |
| int001 | PASS (`int001-session-persistence-20261110T113337Z-be87bcd6`) | PASS (`…T113401Z-…`) |

ui001 on device: 10 Manual Produce taps → Industrial Output 1 … 10 (+`MANUAL_PRODUCTION_AMOUNT`
each), no selection/camera event; fresh Next Goal action hidden and inert; Fabricator selected →
×1 → `buyProducerLevels fabricator ×1 ok` (first end-to-end proof of the panel Buttons); seeded save
→ Next Goal enabled → `purchaseBreakthrough auto_feeder ok`, `reveal_state started` → `complete`
(source runtime); second tap → no purchase; HOME → `suspended_saved`; kill + relaunch →
`loaded_main`, owned, no reveal replay; every effective font ≥ 20 design units; zero `error` events.
The build config was restored afterwards (empty diff).

Earlier failing runs (attempt 1):
- APK sha c554e0d3: ui001 failed at step 2 — the new HUD handler had the wrong Cocos handler
  signature (fixed in the HUD before the next build).
- APK sha 9a1d062d: ui001 failed twice at step 4 `buy_x1_command_result`
  (`ui001-core-loop-20261110T112348Z-9a1d062d`, `ui001-core-loop-20261110T112649Z-9a1d062d`); r036,
  C3, INT-001 passed ×2 on that APK.

## Retry 1: pre-existing AUT-037 defect found by the UI-001 device run

Cocos calls `EventHandler` handlers as `handler(clickEvent, customEventData)`
(`ComponentEventHandler.emit`). `ProducerPanelController.onActionPressed(actionId: string)` (AUT-037)
therefore received the click event as `actionId`, so ×1/×10/×MAX never submitted a command on
device; AUT-R-036 only proved those taps do not leak to the world. The UI-001 step-4 device check
exposed it (runs above).

- Fix (Technical Lead approved, one line, nothing else in the file changed):
  `public onActionPressed(_event: unknown, actionId: string): void {`.
- Regression test `tests/producer_panel_button_handler.test.ts`: the panel EventHandler targets
  `onActionPressed` with customEventData x1/x10/xMax; the real handler + `purchase()` bodies called
  as Cocos does — `(clickEvent, 'x10')` emits exactly `buyProducerLevels` quantity 10,
  `(clickEvent, 'xMax')` emits `buyMaxProducerLevels`, a disabled action or unknown id emits
  nothing; both the panel and HUD handlers have the `(_event: unknown, actionId: string)` shape.
- `npm run check`: PASS (497 tests). No existing test changed in retry 1.

## Human-gate kit (prepared, not run)

Use the retry-1 FactoryWorld gate APK
`temp/gate/ProjectAutomata-ui001-retry1-3dc1899-dirty-factoryworld.apk` (sha be87bcd6…, DEBUG build).
Fresh-save launch on the NE2215 (`pm clear` is refused, so delete the saves with run-as):

```
adb install -r temp/gate/ProjectAutomata-ui001-retry1-3dc1899-dirty-factoryworld.apk
adb shell am force-stop com.projectautomata.androidbaseline
adb shell run-as com.projectautomata.androidbaseline rm -f files/save_main.json files/save_backup.json files/save_temp.json
adb shell am start -n com.projectautomata.androidbaseline/com.cocos.game.AppActivity
```

Hold the phone in landscape and answer:

1. At arm's length in landscape, can you read Industrial Output, production/s, Next Goal and the panel?
2. Are Manual Produce, ×1/×10/×MAX and the Next Goal unlock comfortable to tap with no mis-taps?
3. Starting fresh, unaided, can you reach and buy "Automate Fabricator" (Auto Feeder)?

Readability (deferred from AUT-R-036), tap comfort and unaided onboarding stay PENDING until a human
answers them; a failure routes to Scene Presentation (AUT-R-036-02 / AUT-VIS) or the Game Designer.

## Risks / notes

- A purchase followed by a process kill **without** HOME can be lost for up to the dirty-save periodic
  window (25 s): existing persistence policy, unchanged. The scenario uses HOME (critical suspend
  save) before the kill.
- Disabled vs enabled Next Goal is conveyed by text only ("• Unavailable"); no styling (out of scope).
- Long Next Goal costs (e.g. "Unlock 12.5M • Unavailable") will shrink the caption slightly; the device minimum is still 20 units. If the human gate finds it hard to read, the fallback is a HUD-only disabled key (needs Technical Lead approval).
- Proposed follow-up (Game Designer, not scheduled): GAME_DESIGN names the first breakthrough goal "Automate Fabricator", but the HUD shows "Unlock Auto Feeder" (inherited from AUT-LOC-001). Fixing it needs a per-breakthrough goal phrase in content data.

## Human gate result (owner, 2026-11-10)

PASS (functional). The HUD and buttons are usable, and the owner reached and bought Auto Feeder unaided.

Owner notes, all non-blocking:
- Visual styling is still rough and text-only (AUT-VIS).
- At high Fabricator levels the milestone modules appear mispositioned. This is a separate Scene Presentation follow-up (the known Lv25+ layout item).

Owner correction recorded after the gate: the product orientation is PORTRAIT, not landscape. The landscape layout from AUT-R-036 will be corrected in a follow-up before AUT-039.
