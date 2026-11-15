# AUT-060 Google Play Billing Production Provider

Integrates the pinned Play Billing Library (`com.android.billingclient:billing:9.1.0`, AUT-005) behind `PurchaseService` for the single non-consumable Founder's Factory Pack.
No restore UI / reconciliation flow (AUT-061), no Founder Robot visuals (AUT-062), no consent, no economy / monetization value changed, no save change (version stays 3).

## Product id (build-time constant)

`founder_pack` = `PRODUCTS.founderPack` (`assets/scripts/services/PlatformServiceTypes.ts`), mirrored by `PRODUCT_FOUNDER_PACK` in `AutomataBillingController.java`. A test and
`tools/ci/check_android_billing_config.ps1` (part of `npm run check`) pin both to the same value. The task text suggested `founder_factory_pack` as an example; the existing
constant was kept so no AUT-058/059 key, test or doc changes. The in-app product must be created in the Play Console with exactly this id (one-time product, one purchase option).
Billing needs no secret: nothing besides this id is configured, and the scan fails the build if licence-key material or a billing credential name appears in tracked source.

## What was built

### Native (`native/engine/android/app/src/com/cocos/game/`)

- `AutomataBillingController.java` (package-private); `AutomataPlatformBridge.java` delegates `initializePurchases`, `getPurchaseStatus`, `queryProductDetails`, `purchaseProduct`,
  `acknowledgePurchase` (new), `restorePurchases`. The entitlement stubs are untouched; the old compile-only purchase stubs were removed.
- `BillingClient` built with `enablePendingPurchases(oneTimeProducts)` and `enableAutoServiceReconnection()`; every client call runs on the UI thread, getters read volatile snapshots.
- **START-THEN-EVENT** like AUT-057: a bridge call returns `{"status":"started"}` or a terminal immediate answer; results are dispatched through
  `JsbBridgeWrapper.dispatchEventToScript` on the game thread.
- Product metadata: `queryProductDetailsAsync` (INAPP); the price is `OneTimePurchaseOfferDetails.getFormattedPrice()` verbatim, never composed or hardcoded.
- Purchase: `launchBillingFlow` (one flow at a time, request ids single-use). Outcome through `PurchasesUpdatedListener`:
  PURCHASED + not acknowledged -> `completed`; PURCHASED + acknowledged -> `already_owned` (restore semantics, never a grant); PENDING -> `pending`;
  `USER_CANCELED` -> `cancelled`; `ITEM_ALREADY_OWNED` -> queries the store (an unacknowledged owned purchase is delivered as `completed`, otherwise `already_owned`);
  service / billing / network errors -> `unavailable`; other errors -> `failed`.
- Purchases arriving outside a flow (PENDING that completes later, late results) use the same event with an empty `requestId`.
- `acknowledgePurchase(purchaseToken)` is called ONLY by the script; there is exactly one native acknowledge call site and the purchases listener never acknowledges (both scanned).
  There is no consume (non-consumable). An unacknowledged purchase is refunded by Google after 3 days, so a failed grant is never acknowledged blindly; it is redelivered by `restorePurchases`
  (store query) at every start.

### TypeScript

- `platform/android/AndroidPurchaseService.ts` (pure, no `cc`): injected `AndroidBillingTransport {callString, subscribe}` (same shape as the ads transport;
  `createAndroidBillingTransport()` in `AndroidNativeBridge.ts`). Implements `PurchaseService` plus the new OPTIONAL members `onPurchaseDelivery(handler)` and `acknowledgePurchase(result)`;
  `PurchaseResult` gained the optional `purchaseToken`. The old compile-only `AndroidPurchaseService` stub in `AndroidPlatformProviders.ts` was replaced (re-exported).
- Overlay: `purchase_flow` overlay begun BEFORE the native call and ended BEFORE the promise resolves, on the same `PlatformOverlayTracker` / `OverlayBackgroundGate` as ads, so the Play sheet
  never creates an offline absence / suspend / report.
- Fail-closed: `completed` without a purchase token or for another product -> `failed`; unknown status -> `failed`; backstops (10 min purchase, 20 s init / query / acknowledge / restore) resolve
  `timeout` / failed; nothing throws into the flows. After a timeout the purchase is NOT lost: a late `completed` / `pending` / `already_owned` event goes to the delivery handlers and takes the
  normal grant path; a late cancel / failure is dropped. A duplicate callback of an already resolved result (same request, status and token) is dropped so the waiting call keeps the single
  authoritative result; the grant stays idempotent anyway (AUT-058 flags + the flow's delivered / in-progress key set).
- Wiring (`FactoryWorldBootstrap`): the flow's `acknowledge` hook calls `purchases.acknowledgePurchase` (AUT-059 runs it only after `applied_saved` / `already_applied`); deliveries call
  `flow.deliver`; after init `ready` the provider is asked once for `restorePurchases()` (the store query hook), so unacknowledged / pending purchases are redelivered through
  `applyFounderPackPurchase` BEFORE any acknowledge. Already-acknowledged owned purchases arrive as `already_owned` and go through the existing `reconcileFounderEntitlement` (never grants Surges).
  The full restore flow, UI and reconciliation rules remain AUT-061.
- `LifecycleSessionCoordinator` (AUT-058 open item): if a Founder grant was applied in memory but its critical save failed, a REPLAYED grant used to answer `already_applied` (-> an acknowledge
  without a durable grant). It now retries the critical save first and answers `applied_saved` / `applied_persistence_failed`; `already_applied` is only returned once the state is durable.

### Selection (`createBuildPurchaseService(debug, script, deps)`)

- Release: Android provider when the native transport exists, else `NoOpPurchaseService` (entry hidden). The debug script is never read in release.
- DEBUG: no script -> NoOp (other captures unaffected); script with mock fields (`price` / `outcomes` / `metadata` / `duplicateCallback`) -> the AUT-059 mock (takes precedence);
  script `{"provider":"play_billing"}` only -> the real provider (license-tester runs).

### Wire protocol (native <-> script)

| Call | Immediate answer | Event |
| --- | --- | --- |
| `initializePurchases()` | `{ok,status:initializing\|ready\|unavailable\|failed,reason?}` | `automata.billing.state` `{status,reason?}` |
| `getPurchaseStatus()` | status snapshot | - |
| `queryProductDetails(csv)` | `{status:"started"}` or terminal | `automata.billing.product_details` `{ok,products[{productId,type,available,title,description,localizedPrice}],missingProductIds,reason?}` |
| `purchaseProduct({productId,requestId})` | `{status:"started"}` or terminal `unavailable\|failed` | `automata.billing.purchase_result` `{status,productId,requestId,transactionId?(orderId),purchaseToken?,reason?}` |
| `acknowledgePurchase({purchaseToken})` | `{status:"started"}` or terminal | `automata.billing.acknowledge_result` `{purchaseToken,ok,status,reason?}` |
| `restorePurchases()` | `{status:"started"}` or terminal | one `purchase_result` per owned purchase (`requestId:""`), then `automata.billing.query_result` `{ok,status,count,reason?}` |

DEBUG diagnostics: `founder_shop` events with phases `billing_native_started`, `billing_purchase_result`, `billing_delivery`, `billing_acknowledged`, `billing_init`, plus `store_query`.
Purchase tokens are never logged.

## Device tooling

`npm run device:seed-aut060 [-- --variant available|owned]` writes the AUT-047 factory save (offer unlocked, no local entitlement) and `debug_purchase.json {"provider":"play_billing"}`.
Scenarios (`npm run device:reveal-capture -- --scenario ...`): `aut060-license-tester-purchase`, `aut060-cancel` (BACK on the sheet), `aut060-restore-owned` (reinstall-like save, store query).
`tools/device/billing_checks.ts` first checks `billing_environment`: no `store_initialized`, a store that is not `ready`, no store price for the product, or a failed query yields ONE failing
check whose detail starts with `ENVIRONMENT_BLOCKED:`; the CLI then prints `ENVIRONMENT_BLOCKED` and exits 3 (never PASS, never a code FAIL). The Play sheet is not driven through ADB: BUY is a real
tap and the tester completes the sheet by hand. `expectBilling` is passed through `cli.ts` AND `reveal_capture.ts` to `evaluateRevealTimeline`.

## Owner-supplied before real-store verification / release

- A Play Console app for the FINAL package id (the current `com.projectautomata.androidbaseline` is a baseline name, TECHNICAL_DESIGN 26.1) and the in-app product `founder_pack`
  (non-consumable, price and localization set in the Console, active).
- License testers (Play Console > Settings > License testing) and a test device with Google Play signed in as a tester.
- An internal testing track upload (signed bundle / APK, same package + signing key) installed through the Play opt-in link; the debug APK from the gate build is not accepted by Play Billing
  unless its package and signature match an uploaded build.
- Release signing configuration, privacy policy URL / Data Safety (purchases), refund policy decision (no revoke is implemented: TECHNICAL_DESIGN 23.8).

## Decisions / risks

- Product id kept as `founder_pack` (see above).
- A shop entry also appears (price "unavailable", BUY disabled) when the store is ready but the product is missing from the Console (AUT-059 behaviour). Hiding the entry in that case would be a
  product / UX decision (not taken here).
- The store query runs once per start (after init). Purchases completed while the app is paused and not redelivered by `PurchasesUpdatedListener` are picked up at the next start (or, if the
  app is alive, by the listener); a foreground re-query on resume is not implemented (flag for AUT-061).
- `ITEM_ALREADY_OWNED` with an unacknowledged purchase is delivered as `completed` and therefore granted once (flags are idempotent) then acknowledged.
- `pendingPurchaseRequests` in the save is still unused: a pending purchase is not persisted; after a relaunch the store query redelivers it as `pending`.
- The Play Billing 9.x APIs were compile-checked against the real `billing-9.1.0` API jar; the full Cocos / Gradle build is left to the gate build.

## Verification status

- Automated: `npm run check` (tests with a scripted fake transport: success, pending-then-purchased, cancel, fail, already owned, duplicate callback, service disconnect / retry,
  ack-after-grant ordering, save failure => no acknowledge, timeout fail-closed, late delivery; build selection; static native / config scans; billing checks incl. ENVIRONMENT_BLOCKED).
- NOT verified: anything against the real Play store (purchase sheet, pending, refunds, acknowledge, query, localized price), the event reaching the JS thread while the Play sheet pauses the
  activity, the overlay gate with the real sheet, the gate-build compile of the Java, and the three `aut060-*` captures (they require the owner-supplied items above).
