# AUT-063 Analytics Event Layer

Status: implemented (automated checks only; no device run).

## What was built
- `services/AnalyticsEvents.ts`: central catalogue. Event ids plus a per-event parameter schema (`ANALYTICS_EVENT_SCHEMAS`): identifiers, opaque request ids, closed enums, bounded integers, booleans. String cap 64, charset `[A-Za-z0-9_.:-]`. No price, currency, transaction, token or user/device parameters exist in any schema. `bucketOfflineSeconds` buckets absence durations (`lt_1m`, `1_5m`, `5_30m`, `30m_2h`, `2_8h`, `gt_8h`). AUT-064 extends the catalogue by adding ids and schemas here.
- `services/AnalyticsValidator.ts`: pure `validateAnalyticsEvent` (unknown event, missing / unknown param, wrong type, bad value, too long, out of range).
- `services/AnalyticsEventMapper.ts`: pure mapping. `mapDomainEvents` (stateless) covers producer unlock, Breakthrough purchase, era reached, first robot, civilization reached, reboot completed, permanent upgrade purchase and Founder purchase complete / restore (`founderPackApplied`, only when `changed`). `AnalyticsFlowMapper` (state only for de-duplication) maps the rewarded flows (opportunity on transition, start, complete, failure, unavailable), the Founder shop flow (offer shown once per session, start, cancel, failure, pending, apply rejection) and offline report signals (shown / collected / auto-collected, bucketed).
- `services/AnalyticsTracker.ts`: the only object that calls a provider. `strict` validation (DEBUG) reports invalid events as non-fatal diagnostics and does not forward them; `off` (release) sanitizes to capped primitives. Provider throws are swallowed and counted; 5 consecutive failures disable the tracker; init failure / timeout (injected timer) only disables it. Never throws, never awaited by gameplay.
- Providers: `platform/mock/DebugAnalyticsService.ts` (logging sink, bounded ring) and the existing `NoOpAnalyticsService`. No vendor SDK, no network.
- `presentation/AnalyticsObserver.ts` (pure): the single boundary bridge, wired in `FactoryWorldBootstrap` (domain events via the binding's `observeDomainEvents`, flow `onDiagnostic` outcomes, and `OfflineReportController.onAnalytics`). `BuildPlatformServices.createBuildAnalyticsTracker` picks Debug + strict validation in DEBUG builds, NoOp + validation off otherwise. Provider init runs once the session is ready.
- DEBUG diagnostic event `analytics` (`tracked | invalid | provider_failure | disabled`) added to `DEVICE_EVENT_TYPES` and `DEFAULT_REVEAL_EVENT_TYPES`.

## Notes
- `rewarded_complete` means the ad reward was verified; the grant outcome stays derivable from `offline_collected(doubled)` and the boost events.
- A new ad attempt re-arms the opportunity, so the next offer read counts as a fresh opportunity.
- `reboot_preview` is in the catalogue but no mapper emits it (no domain event exists for it; out of AUT-063 scope).
- No save-schema change; no gameplay or state reads from analytics.
- Not built: an objective device check for the `analytics` event (needs a scenario seed); only the event type and capture list entry exist.

## Tests
`tests/analytics_event_layer.test.ts`: catalogue, validation, mapping per domain event, rewarded / purchase / offline mapping and de-duplication, provider failure and init timeout non-authoritative, source scan (no provider / vendor SDK reference outside the allow-list; domain, runtime, economy, lifecycle and monetization never mention analytics).

## Device smoke (2026-11-15)

Gate APK `aut063`; `npm run check` 1320 tests green. `aut059-purchase-success` capture PASS (0 errors). The DEBUG `analytics` events appear in logcat/timeline (e.g. `rewarded_opportunity`, `purchase_offer_shown`, `offline_auto_collected`, `purchase_start`, one `purchase_complete` despite the scripted duplicate callback). No dedicated objective check/scenario yet (AUT-064 may add one).
