# AUT-064 Monetization Analytics Coverage

Status: implemented (automated checks only; no device run).

## What was built
Extension of the AUT-063 layer (nothing rebuilt):
- `services/AnalyticsEvents.ts`: new events `offline_bonus_granted`, `extended_overclock_activated`, `extended_overclock_ended`; new / extended params (see table); `bucketElapsedSeconds`, `rewardMagnitude`; every event may carry the optional opaque `session_id`.
- `services/AnalyticsEventMapper.ts`: `AnalyticsFlowMapper` now tracks **opportunity episodes**, the in-session Founder unlock / run-start clocks and the Extended Overclock production snapshot; `mapDomainEvent(s)` takes an optional Founder context.
- `presentation/AnalyticsObserver.ts`: injects the per-launch `session_id`, owns a late-bound read-only state reader.
- `presentation/AnalyticsStateContext.ts` (+ `.meta`): pure read-only snapshot context (era, civilization, next-goal id, lifetime output) wired by `FactoryWorldBootstrap` (`setStateReader`). Ids that would not pass the catalogue are dropped, never sent.
- `OfflineDoubleFlow` DEBUG diagnostics now also carry `multiplier` (offer) and `claimsInWindow` (granted). Behaviour unchanged.
- `tools/analytics/MonetizationMetricsDerivation.ts`: pure analyzer (no runtime use, not under `assets/`): opt-in rate, uses per player-day, conversion, time to purchase from an event stream.
- Optional device check `tools/device/analytics_checks.ts`, wired through `reveal_capture.ts` (`expectAnalytics`) and `cli.ts`.

## Semantics
- **Opportunity = offer episode**, not offer read (refines AUT-063's per-state-transition de-dup). An episode opens the first time the offer reads as offered (eligible + ad available), stays open across failed / closed / timed-out ads, retries, card refreshes and ad-availability flaps, and closes when the offer disappears for a player reason (hidden / ineligible / already active), when the reward is granted, or when the offline report is collected. Id: `ofd_<n>` / `xoc_<n>` (per-session counter, no timestamp).
- **Opt-in** = `rewarded_start` carrying the episode's `opportunity_id`. A retry is another start, never another opportunity.
- `session_id`: random `s` + 12 base-36 characters per launch, never persisted, no clock. The analytics backend adds the timestamp and the pseudonymous player key (envelope fields, not params).
- Analytics stays non-authoritative: nothing reads back, no save-schema change, domain / runtime / state never mention analytics (AUT-063 source scan still green).

## Event to metric mapping (MONETIZATION section 24)

| Section 24 measurement | Derived from |
| --- | --- |
| `offline_reward_opportunity` | distinct `(session_id, opportunity_id)` of `rewarded_opportunity{placement=offline_double}` |
| `offline_reward_opt_in` | opportunities with >= 1 `rewarded_start` of the same `opportunity_id`; completion = `rewarded_complete`; failures = `rewarded_failure` / `rewarded_unavailable` |
| `offline_reward_multiplier_used` | `offline_bonus_granted.multiplier` (also `rewarded_opportunity.multiplier`) |
| `offline_duration` | `rewarded_opportunity.absence_bucket` (and `offline_report_shown` / `offline_collected.absence_bucket`) |
| `base_offline_reward` | `rewarded_opportunity.base_reward_mag` / `offline_bonus_granted.base_reward_mag` (`floor(log10)` bucket) |
| `bonus_offline_reward` | `offline_bonus_granted.bonus_reward_mag` |
| `claims_per_player_day` | `offline_bonus_granted.claims_in_window` (game rolling-24 h window) and a trailing-24 h count of grants per player from backend timestamps |
| `post_reward_session_length`, `post_reward_retention` | `session_id` + backend timestamps after `offline_bonus_granted` (no extra event) |
| `extended_overclock_opportunity` / `_opt_in` | same episode semantics with `placement=extended_overclock` |
| `uses_per_player_day` | `extended_overclock_activated` per player and UTC day; `claims_in_window` as the game-side rolling counter |
| `run_age_at_activation` | `extended_overclock_activated.run_age_bucket` (in-session clock since the last observed Reboot, else `unknown`) and the exact span from timestamps (last `reboot_completed`, else the player's first event) |
| `era_at_activation`, civilization | `extended_overclock_activated.era_id`, `.civilization` |
| `next_goal_at_activation` | `extended_overclock_activated.next_goal_id` (omitted when the id would not fit the catalogue) |
| `production_gained` | `extended_overclock_ended.production_gain_mag`, an ESTIMATE: `(lifetime output earned delta) x (m - 1) / m` between activation and expiry; omitted when the activation was not observed in the same session |
| `starter_offer_impression` | `purchase_offer_shown` (once per session, store ready + price shown) with `since_unlock_bucket`, `before_first_reboot` |
| `starter_offer_purchase` | `purchase_start` (intent) and `purchase_complete` (one per grant; a duplicate callback adds none); `purchase_cancel` / `_failure` / `_pending` for the funnel |
| `time_from_unlock_to_purchase` | `purchase_complete.since_unlock_bucket` (in-session clock) and exact: first `purchase_complete` minus the first `first_robot` / `breakthrough_purchase(worker_bot)` timestamp |
| `purchase_before_first_reboot` | `purchase_complete.before_first_reboot` (state civilization <= 1) |
| restore context | `purchase_restore.restore_context` = `purchase_attempt` (reached through a purchase call) or `store_query` (startup / foreground ownership query) |
| `price_tier` | **Not available.** `ProductDetails` exposes only a localized price string (no tier, no currency code). The string is never read or logged. Needs a provider change (price tier / currency code) decided by Monetization before it can be added |
| `payer_first_reboot_time`, `payer_retention` | `purchase_complete` + `reboot_completed` + `session_id` timestamps |
| Business metrics (DAU, ARPDAU, ARPPU, retention, LTV, revenue split) | backend / store reporting; the events only provide impressions (`rewarded_start` / `rewarded_complete`) and payer / conversion counts. Revenue amounts are intentionally not logged |

`MonetizationMetricsDerivation.deriveMonetizationMetrics(records)` computes the opt-in rate (overall, by absence bucket and base-reward bucket), attempts, multiplier mix, rolling-day claims, Extended Overclock uses per active player-day, Founder conversion (purchasers among players who saw the offer), time to purchase and the before-first-reboot split.

## Known limits
- No run-start / Founder-unlock timestamp is persisted (no save-schema change allowed). In-session buckets are therefore `unknown` when the start was not observed in the session; the exact span is derived from the backend timestamps. Persisting them would be a schema decision for the Technical Lead.
- `rewarded_opportunity` is emitted when the offer is read, not when the chip is rendered; a visible-impression count would need a presentation signal (not added).
- The gain estimate includes manual / offline output earned inside the window and ignores a suspended Free Overclock overlap (the Extended Overclock supersedes it).

## Tests
- `tests/monetization_analytics_coverage.test.ts`: episode semantics (retry / re-read / ad flap non-inflation), offline / Extended Overclock / Founder context params, opaque ids, no price text, provider and state-reader failure, real-config next-goal id fit, derivation of the three metric families from synthetic multi-player streams, scope guards.
- `tests/analytics_device_checks.test.ts`: the device check module, `evaluateRevealTimeline` wiring, scenario table and CLI forwarding.
- `tests/analytics_event_layer.test.ts`: AUT-063 tests updated for the new params.

## Device capture (objective check only, not run here)
`expectAnalytics` is added to `aut055-success`, `aut056-success` and `aut059-purchase-success`; no new scenario. With the DEBUG gate APK installed:
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/device/cli.ts reveal-capture --scenario aut055-success`
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/device/cli.ts reveal-capture --scenario aut056-success`
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/device/cli.ts reveal-capture --scenario aut059-purchase-success`

(`npm run device:reveal-capture -- --scenario <id>` is the equivalent npm wrapper.) Each adds the `analytics_*` checks to the usual PASS / FAIL list.

## Device evidence (2026-11-15)

Gate APK `aut064`; `npm run check` 1342 tests green. Captures PASS with all new `analytics_*` checks: `aut055-success` (opportunity -> start -> complete -> bonus granted -> collected doubled), `aut056-success` (opportunity -> start -> complete -> activated with era/civ/next-goal), `aut059-purchase-success` (impression once, start, single complete despite duplicate callback). One opaque session id per run, no price text. Open items for the Technical Lead / Monetization: `price_tier` unavailable (no tier/currency from store metadata); `run_age_bucket`/`since_unlock_bucket` mostly `unknown` in-session (exact spans derivable from backend timestamps; persisting run-start/unlock timestamps would be a save-schema decision, not taken).
