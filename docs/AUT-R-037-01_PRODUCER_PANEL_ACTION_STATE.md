# AUT-R-037-01 Producer Panel Action State

Corrective task on AUT-037 (Producer Panel), baseline `main` `d1ea98f`. Presentation only: no economy, progression, layout, camera or save changes.

## What was built

- **×MAX caption shows the resolved quantity.** `formatPanelAction` (`PresentationText.ts`) uses dedicated templates for `xMax`: `Buy ×MAX (×N) {cost}`, and `Buy ×MAX (×N) {cost} • Unavailable` when disabled. `N` is `action.quantity` from the view model, unrounded; a zero MAX reads `(×0)`. ×1 and ×10 keep the generic `producer_panel.action*` templates.
- **Localization.** Two new keys in `localization/en.json`: `producer_panel.action.max` and `producer_panel.action.max.unavailable`. `EmbeddedTextCatalogue.ts` was regenerated with `tools/config/embed_text_catalogue.ts`; the catalogue holds 171 entries. `docs/AUT-LOC-001_ENGLISH_TEXT_CATALOGUE.md` lists the new keys.
- **Native Button state.** `ProducerPanelViewModel.ts` exports the pure `isProducerPanelActionInteractable(action)`: true only for an existing action with `isEnabled === true` and a command. `ProducerPanelController.ts` keeps the three Buttons in a map and `applyActionStates()` sets `Button.interactable` per action after layout creation, in `refresh()` and in `replaceSelection()`. No snapshot (startup, pending selection) or `actions: null` (locked producer) disables all three; each action is evaluated independently.
- **Unchanged.** `purchase()` still validates `isEnabled` and the command before emitting. ×MAX still emits `buyMaxProducerLevels` with no fixed quantity, so the runtime recomputes the affordable maximum. No cost, affordability or MAX value is computed in the controller.

## Tests

Added to `tests/producer_panel_button_handler.test.ts`: Button mapping using the real `applyActionStates` body (startup, affordable, zero MAX, partial affordability, locked, refresh, pending selection), controller wiring, and ×MAX / zero-MAX captions. Updated for the new keys: `presentation_text`, `ui_robustness_text`, `ui_layout` (×MAX caption with quantity 9999 and the widest cost fits the 216-unit, two-line button) and `offline_report` (catalogue count 169 → 171).

`npm run check`: GATE PASS (config, Ads, Billing, 1583/1583 tests, pacing regression unchanged).

## Known limitations

- The two-line caption relies on label wrapping; the break position is not forced.
- Tests run the real method bodies against mocks, not a live Cocos node. Native disabled appearance and touch behaviour are unverified.
- No dedicated `producer_panel_scene` / `ui_input_routing` tests were added; the panel's root touch handlers are unchanged.
- A quantity wider than 9999 with the widest cost has not been fit-tested.

## Outstanding Android human gate

Not yet run (no APK built). On the FactoryWorld DEBUG APK, portrait device:

1. Fresh save, no selection: all three Buttons inert.
2. 0 IO: all disabled, ×MAX shows `(×0)`.
3. Enough IO for ×1 only: ×1 enabled, ×10 disabled.
4. Several levels affordable: ×MAX shows the correct quantity and cost; tapping it buys the current maximum and the level, balance and preview refresh.
5. Locked producer: all disabled. Switching producer: no stale enabled state.
6. Balance rising through production: states update.
7. Pressing disabled Buttons: no command, camera pan or world selection.
8. Screenshots of a positive and a zero ×MAX caption; legibility and tap comfort at arm's length (human gate).
