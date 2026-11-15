# AUT-059 Founder Shop UI

Presentation-only task on top of AUT-058. No Billing SDK (AUT-060), no restore flow (AUT-061), no Founder Robot visuals (AUT-062), no Surge activation, no analytics events, no economy/monetization value changed, no save change.

## What was built

Pure, unit-tested modules (no `cc`, explicit `.ts` imports, no ctor parameter properties) in `assets/scripts/presentation/`:

- `FounderShopFlow.ts`: offer status (from the session) + store product metadata (PurchaseService) + purchase result -> `FounderShopFlowState {offer, store, price, purchase, note}`. `buy()`, `deliver(result)` (store callback / redelivery), `refresh()`, `dismissNote()`. Only `applied_saved` / `already_applied` from `coordinator.applyFounderPackPurchase` counts as delivered; the optional `acknowledge` hook (for AUT-060) runs only after that. `already_owned` from the store goes through `reconcileFounderEntitlement` (never grants Surges). Duplicate taps (in-flight guard) and duplicate callbacks (delivered / in-progress key set, plus the AUT-058 grant-once flags) are no-ops.
- `FounderShopViewModel.ts`: chip + modal strings and enablement, all text from the catalogue (`founder.*` keys in `localization/en.json`, embedded catalogue regenerated).
- `FounderShopLayout.ts`: chip slot, 640-wide modal card, hit rects, colours, `computeFounderShopRects`.
- `DebugPurchaseScriptFile.ts` + `createBuildPurchaseService` (in `BuildPlatformServices.ts`): DEBUG purchase script / provider selection.
- Thin `FounderShopController.ts` (cc): builds nodes, Graphics fillRect only, scale-based visibility, each button a Button on its own child with hit rect = drawn rect (>= 64 units), backdrop alpha 150, graphite pill (24,29,32,245), amber / cyan accents, never red. Wired in `FactoryWorldBootstrap` (`createFounderShop`, below the offline report root, created after Settings / AI / Reboot / Extended Overclock).
- `FactoryWorldStateBinding`: `getFounderOfferStatus()` (from the authoritative state), `applyFounderPackPurchase`, `reconcileFounderEntitlement` (fan-out + command-result report like Extended Overclock). `FactoryWorldSessionPort` got two optional methods. The coordinator is unchanged.

## Rules implemented

- States: locked = NO entry (no tease); available = chip + modal with BUY; pending = pending chip/state, BUY disabled; owned = owned chip/state, no BUY. The entry shows only once the store is `ready` (hidden while loading, unavailable, failed, NoOp), except owned (an owner never sees a store error) and pending (kept).
- Price: ONLY `ProductDetails.localizedPrice` verbatim. Missing / no price: neutral line "Price unavailable right now", BUY disabled; the product is re-read after 4 s (missing) or 30 s (found). Tests scan the sources and the catalogue for currency symbols / price-like numbers.
- Contents: exactly the Founder Robot variant and "2 Factory Surges: x2 for 30 min each" (values from `FounderOfferKeys`).
- Cancel / fail / unavailable / timeout: nothing granted, calm amber note (not red), BUY available again. `not_saved` (apply succeeded in memory, save failed) is not acknowledged.
- Release builds: `createBuildPurchaseService(false, ...)` = `NoOpPurchaseService` (store unavailable -> entry hidden). A DEBUG build without `debug_purchase.json` also uses NoOp (so other captures are unaffected). The mock exists only in DEBUG with the script (`debug_purchase.json`, read once, deleted, parsed with an allow-list: price test string or `metadata: "missing"`, outcomes completed / pending / cancelled / failed / unavailable / timeout / already_owned, `duplicateCallback`).

## Placement decision

Third line under the HUD band, RIGHT-aligned (280 x 64, under the Reboot chip). Existing: line 1 SET left + AI right (toast band centred); line 2 Extended Overclock left (340) + Reboot right (200). Line 3 is empty on both sides, so nothing overlaps (tested on 6 screen/safe-area configurations incl. the toast band, HUD, panel, every chip) and the left half of the factory view stays free. Modal: shared card centre (`offlineReportCardCenterOffsetY`). Exclusivity: the modal root is below the offline report root and above the other modal roots (their chips sit under its full-screen backdrop); additionally `setSuppressed(offline report || Reboot title card)` hides the chip and closes the modal, and `setModalBlocked(settings || AI upgrades || reboot open)` makes the chip inert.

## Device tooling

- `tools/device/seed_aut059.ts` (variants `available`, `owned`, `locked`, `no_store`), `tools/device/founder_shop_checks.ts` (unit-tested objective checks), `REVEAL_SCENARIOS` entries, `founder_shop` DEBUG diagnostics (`DeviceDiagnostics`, controller reports, flow phases, persisted-state `state` events), `ui_layout` rects `FounderChip` / `FounderPanel` / `FounderBuy` / `FounderClose`.
- Seed: `npm run device:seed-aut059 -- --variant available|owned|locked|no_store [--outcome completed|pending|cancelled|failed] [--duplicate] [--missing-metadata]`.
- Capture: `npm run device:reveal-capture -- --scenario aut059-available | aut059-purchase-success | aut059-pending | aut059-cancel | aut059-fail | aut059-owned | aut059-hidden | aut059-locked`.
- The mock price string is the synthetic `TEST PRICE 9.99` (test metadata of the mock store; the checks require the UI to show it verbatim).

## Open items

- AUT-060: a real provider replaces the NoOp in `createBuildPurchaseService`; call `flow.deliver` from the store callback and pass `acknowledge`. Pending purchases are in-memory only (not persisted; `pendingPurchaseRequests` handling is still undecided, see AUT-058); a relaunch returns to "available" until the store redelivers.
- `applied_persistence_failed` leaves the pack owned in memory; a later replay returns `already_applied` without a save (AUT-058 behaviour, flagged for AUT-060 acknowledge semantics).
- Analytics purchase events not wired. Founder Robot visuals / Surge activation (AUT-062) will read the same state.
- Visual QA (chip/modal readability, no red, placement feel) and real-device behaviour are not validated here.
