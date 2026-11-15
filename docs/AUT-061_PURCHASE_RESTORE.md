# AUT-061 Purchase Restore & Entitlement Reconciliation

Closes the gaps of the reconcile path built in AUT-058 (domain / coordinator), AUT-059 (flow) and AUT-060 (Play Billing). No new product surface (no restore button, no UI change), no economy / monetization value changed, no Billing native change, **no save change (version stays 3, nothing new persisted)**.

## What was built

- `assets/scripts/monetization/FounderReconciliation.ts` (pure, no imports): the single policy entry `decideFounderReconciliation({localOwned, store: owned|not_owned|unknown|unavailable|error, delivery?: purchase|owned_report, transactionId?, seenTransactionIds?}) -> plan {actions, reason, revokes:false, surgeGrant, recordTransaction}` and `classifyFounderStoreQuery`. It decides only; `FounderShopFlow` executes the plan through the existing session commands (`applyFounderPackPurchase`, `reconcileFounderEntitlement`). The AUT-058 domain functions are reused unchanged.
- `FounderShopFlow`: `completed` / `already_owned` deliveries now go through the policy; new `reportStoreQuery(result)` (a failed / unavailable query is a "no answer": policy keeps local, the session is never contacted, no `owned:false` is ever sent), `isPurchaseActive()`, diagnostics `reconciliation` and `store_query_policy`. A failed acknowledge now forgets the delivery key so the next redelivery (foreground query) retries the acknowledge; the grant replay stays idempotent.
- `presentation/FounderStoreQuery.ts` (pure scheduler): runs `purchases.restorePurchases()` at startup and on foreground. Foreground runs are throttled (>= 60 s after the previous query started, failures included), suppressed while blocked (never counted against the window), one at a time, only for a `ready` provider that exposes `onPurchaseDelivery` (NoOp = unsupported), and fail-closed when the blocker or provider throws.
- `FactoryWorldBootstrap`: builds the query after the flow; `isBlocked = platformOverlay.isOverlayActive() || flow.isPurchaseActive() || shop.isOpen()`; `run('startup')` after init `ready` (replaces the direct AUT-060 call); `run('foreground')` at the end of `onGameShow`, AFTER the overlay-gate skip (an ad / Play sheet closing never queries) and after `binding.resume()`.
- DEBUG mock: `MockPurchaseService` gained `onPurchaseDelivery`, `restore: 'owned' | 'not_owned' | 'error'` (+ `setRestoreMode`). `owned` delivers the pack as an acknowledged owned purchase (`already_owned`, stable transaction key), `error` fails the query. `debug_purchase.json` accepts `"restore": "owned|not_owned|error"` (allow-listed, a mock field so it wins over `provider`).

## Rules (all tested in `tests/purchase_restore.test.ts`)

| Local | Store | Result |
| --- | --- | --- |
| not owned | owned (acknowledged / reinstall) | entitlement + cosmetic restored, grant flag recorded, **0 Surges**, one critical save, no acknowledge |
| owned | owned (acknowledged) | no-op (no command, no save) |
| owned | not_owned / unknown / unavailable / error | **kept** (acceptance: never revoked, no session call, no write) |
| any | transaction id already handled | no-op |
| fresh save | owned, later unacknowledged redelivery of the same purchase | restore first (flag set) -> the redelivery grants nothing, acknowledged once |
| any | unacknowledged purchase (live redelivery) | normal grant path (2 Surges only while the grant flag is unset) -> acknowledge once, only after the durable save |

Also covered: Reboot survival, real SaveEnvelope round trip, coordinator critical save only when something changed, throttle boundary (59.999 s vs 60 s), suppression by purchase sheet overlay / rewarded ad overlay / purchase in flight / open shop modal, one query at a time, failed acknowledge retry.

## Device tooling (DEBUG APK, mock store, no taps)

- `npm run device:seed-aut061 [-- --variant reinstall|local_owned_store_error] [--serial <id>]`
  - `reinstall` (default): FRESH save (nothing owned) + `debug_purchase.json {"price":"TEST PRICE 9.99","restore":"owned"}`.
  - `local_owned_store_error`: locally owned save (entitlement, cosmetic, 2 charges) + `{"restore":"error"}`.
- `npm run device:reveal-capture -- --scenario aut061-restore-reinstall` (expects chip Owned, entitlement + cosmetic + grant flag, 0 Surge charges at every state event, one reconcile command, no grant / purchase / acknowledge, 0 errors) and `--scenario aut061-restore-store-error` (store query failed, policy `store_no_answer_keep_local` with `revokes:false`, no reconcile command, still owned with 2 charges, chip Owned).
- `tools/device/restore_checks.ts` (unit-tested) is passed through `cli.ts` AND `reveal_capture.ts` (`expectRestore`) to `evaluateRevealTimeline`. Pinned lists in `era_environment` / `reveal_capture` tests and the AUT-060 bootstrap pin were updated legitimately.

## Decisions / risks

- A local-owned + store-owned report is a pure no-op, so `lastKnownValidUtcMs` is no longer refreshed by redundant owned reports (it is still refreshed by the domain on a purchase replay). The value is informational; ownership never expires or is revoked.
- A successful store query that delivers nothing is classified `unknown`, not `not_owned` (the Play query result carries no count to the script); either way the policy keeps local ownership. Revoking on a definitive refund is still not designed (TECHNICAL_DESIGN 23.8).
- `pendingPurchaseRequests` is still not persisted (unchanged from AUT-060): a pending purchase is redelivered as `pending` by the store query after a relaunch and by the foreground query while the app lives.
- The foreground query is blocked by the open shop modal; a purchase that resolves while it is open still arrives through the `onPurchaseDelivery` listener.

## Verification status

- Automated: `npm run check` (see report). NOT verified: real Play behaviour (query on resume, refund, pending resolution), the two `aut061-*` device captures (not run, per task), actual timing of the foreground query on a device.

## Device evidence (2026-11-15)

Gate APK `aut061`; `npm run check` 1286 tests green. Captures PASS (0 errors): `aut061-restore-reinstall` (chip Owned, entitlement+cosmetic restored, 0 Surge charges), `aut061-restore-store-error` (local ownership kept, no revoke), regression `aut059-available`. Real Google Play query-on-resume/pending/refund behaviour remains pending (see AUT-060 owner-supplied items). Chip appearance only checked via objective events.
