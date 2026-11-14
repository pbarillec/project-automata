# AUT-054 Rewarded Eligibility Rules

## Built

- `assets/scripts/monetization/RewardedEligibility.ts`: pure, engine-free module with no imports at all (no `cc`, no `platform/`, no `services/`).
- Per-placement player eligibility, independent of AdMob and ad availability:
  - `evaluateOfflineDoubleEligibility`: needs a collectible offline report, effective offline time >= 30 min (1800 s; 1799 s is blocked) and fewer than 3 claims in the rolling 24 h.
  - `evaluateExtendedOverclockEligibility`: fewer than 3 claims in the rolling 24 h and >= 60 min since the last claim. MONETIZATION section 5 states no other player-state condition (Free Overclock suspension belongs to AUT-056), so none was added.
- Result: `{ placementId, eligible, reason, nextEligibleAtUtc | null, remainingQuota, claimsInWindow }`. Reasons: `ok | no_offline_report | below_min_offline | quota_reached | min_interval | suspicious_time`.
- `pruneClaimsToRollingWindow(claims, now)`: a claim counts while `now - t < 24 h`; exactly 24 h old is outside.
- `canOfferRewarded(eligibility, adAvailable)`: trivial combinator; the two concepts stay separate inputs, player reason wins when both block.

## Values

No monetization data file exists (`data/monetization/` is empty), so named constants (`OFFLINE_DOUBLE_RULES`, `EXTENDED_OVERCLOCK_RULES`) mirror `docs/MONETIZATION.md` sections 4 and 5 in one place. No economy value was chosen. Moving them to data is a later option.

## Next-eligible time

- `quota_reached`: when the claim that makes count == max ages out (`+24 h`); for Extended Overclock, the max with the interval clearing time if that is later.
- `min_interval`: last claim + 60 min.
- `below_min_offline`, `no_offline_report`, `suspicious_time`: `null` (depends on future events or an untrusted clock).

## Suspicious wall time (conservative rule)

If `nowUtcMs` is not finite, or any claim is future-dated or not finite, the result is `eligible: false`, `reason: suspicious_time`, `nextEligibleAtUtc: null`. Such claims are kept inside the window (non-finite count as in-window), so a backwards clock never grants extra quota. Nothing throws. A clock moved backwards with no future-dated claims is not detectable by this module; the existing monotonic/UTC safeguards in `time/` and offline handling remain responsible.

## Deferred (escalation note for AUT-055 / AUT-056)

`GameState.monetization.rewardedClaims` holds only `claimCount` and `lastClaimUtcMs` per placement. That is not a rolling-24h claim history, so the module takes an injected claim-timestamp list. AUT-054 did not change save schema, state, persistence, commands, events, runtime or UI. Persisting per-placement claim timestamps (a save schema/state change, with migration) must be decided and scheduled by the Technical Lead before AUT-055/056 wire this in.

## Tests

`tests/rewarded_eligibility.test.ts`: matrix per placement, 24 h prune boundary, interval boundary, offline 29:59/30:00, next-eligible per reason, remaining quota, backwards/future/NaN clocks, empty/undefined history, no-import source scan, ad-availability independence.
