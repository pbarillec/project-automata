# AUT-053 - Production Platform Service Interfaces & Mocks

Status: implemented. Zero player-visible change; nothing is wired into `FactoryWorldBootstrap` or UI.

Goal: an editor/CI-exercisable, deterministic, network-free monetization boundary plus overlay hooks, built on the AUT-CX-005 baseline.

## Contracts (`assets/scripts/services/`)

- `AdsService`, `PurchaseService`, `EntitlementService` (from AUT-CX-005), plus new `AnalyticsService`: `initialize()`, `getStatus()`, `track(eventId, params?)`. `track` is fire-and-forget and must never throw (TECHNICAL_DESIGN 24.1).
- Additive status changes: `RewardedAdResultStatus` gains `timeout`; `PurchaseResultStatus` gains `timeout` and `already_owned`. `closed` is documented as dismissed-without-reward (`rewardVerified` is false). `RewardedAdResult` and `PurchaseResult` gain optional `duplicate?: boolean`. `PlatformServiceKind` gains `analytics`.
- `PlatformServices` now also carries `analytics` and `capabilities`.
- `AnalyticsEvents.ts`: `ANALYTICS_EVENTS` catalogue (17 snake_case ids, TECHNICAL_DESIGN 24.1) and `AnalyticsEventId`. There is deliberately no domain-event mapper.

## Capability model

`PlatformCapabilities { platform: 'editor'|'android'|'ios'|'noop', rewardedAds, billing, restorePurchases, analytics, fullscreenOverlays }`. `NO_PLATFORM_CAPABILITIES` is all false (`noop`). The mock factory reports `editor` with everything true except `fullscreenOverlays` (the mock shows no real overlay). Consumers decide from capabilities, never from platform sniffing.

## Overlay hook contract

`PlatformOverlayTracker` (pure, no cc): `begin(kind, requestId)`, `end(requestId)`, `isOverlayActive()`, `activeCount`, `subscribe(listener)` (returns unsubscribe), `classifyBackground(): 'overlay' | 'user_absence'`. Kinds: `rewarded_ad`, `purchase_flow`. Duplicate `begin` and unknown/duplicate `end` are no-ops; throwing listeners are isolated. Providers call `begin` immediately before presenting and `end` in a `finally` after the result (including failure/timeout). The mocks do this when given a tracker (the aggregate mock factory wires one). Calls that never present (unavailable, memoized duplicates) emit nothing.

`LifecycleSessionCoordinator`, bootstrap and save/suspend semantics are NOT modified. The consumer side - skipping the suspend/resume handling when `classifyBackground()` is `overlay` - is deferred to AUT-057 (AdMob) / AUT-060 (Billing), when real overlays exist.

Naming deviation: TECHNICAL_DESIGN 23.9 names a `PlatformLifecycleCoordinator`; this task ships the pure `PlatformOverlayTracker` instead, as the engine-free hook the future coordinator will consume. The design doc is not rewritten.

## Idempotency rules

- A `requestId` is single-use. Mock ads and purchases memoize the first result per `requestId` (including in-flight calls) and return the same result, same `transactionId`, flagged `duplicate: true`, with no script consumption or overlay events.
- `duplicateCallback` on a script step simulates a provider firing its callback twice: both deliveries are recorded in `deliveries[]`, the second flagged `duplicate`.
- `RewardClaimLedger.tryConsume(requestId)` / `createIdempotentRewardGuard()`: pure, in-memory, returns true only the first time. It holds no game state and is not persisted; reward flows (AUT-055/056) own persistence-level dedupe.

## Mock scripting guide (`platform/mock/`)

- `createMockPlatformServices(options)` returns `ads`, `purchases`, `entitlements`, `analytics`, `capabilities` and `overlay`, typed as concrete mocks. `createNoOpPlatformServices()` (`platform/noop/`) returns the all-unavailable set.
- Ads: `ads.enqueueOutcomes(placementId, { outcome: 'rewarded'|'closed'|'failed'|'unavailable'|'timeout', reason?, duplicateCallback?, manual? }, ...)`. Purchases: `purchases.enqueueOutcomes(productId, { outcome: 'completed'|'cancelled'|'pending'|'failed'|'unavailable'|'timeout'|'already_owned', transactionId?, ... })`.
- Queues are ordered per placement/product. An empty queue falls back to the earlier option behaviour (`setPlacement`, `purchaseResults`), so existing tests are unchanged. Placement unavailability and missing products take precedence and do not consume steps.
- Timeouts are deterministic with no timers: a step with `manual: true` holds the call until `gate.release(requestId)`; `outcome: 'timeout'` without `manual` resolves immediately.
- `calls[]` logs every service call (`service`, `method`, `requestId`, `key`).
- `MockAnalyticsService`: records `events[]`; `failNext(n)` or `{ throwOnTrack: true }` make `track` fail internally; failures are swallowed and counted in `swallowedFailures`. `NoOpAnalyticsService` is silent with status `unavailable`.

## Isolation

`tests/platform_monetization_mocks.test.ts` scans the engine-free layers (config, domain, state, economy, progression, runtime, persistence, time, offline, lifecycle, simulation) for imports of `platform/`, monetization services, `cc`, native bridge or Google SDK names, and asserts only `presentation/`, `app/`, `platform/` and `services/` import `platform/`. The existing scan keeps covering the new services/mock/noop files; Android remains the only `cc` importer. `platform/android` is unchanged.

Runtime (non-type) imports between the new files use explicit `.ts` extensions so Node can execute them; type-only imports remain extensionless as in the AUT-CX-005 files.

## Deferred

- AUT-054: rewarded eligibility rules. AUT-055/056: reward flows (offline double, extended overclock). AUT-057: AdMob provider and the consumer-side suspend/resume skip for ad overlays. AUT-058: Founder Pack. AUT-060: Google Play Billing provider and its overlay skip.
- No analytics provider choice, no event mapper, no consent integration, no iOS provider.
- No real SDK, network or device work in this task.
