# AUT-MIG-001 Rewarded Claim History (save v2 -> v3)

Owner-approved (2026-11-14), strictly additive save-schema change scoped to rewarded claim history.
No command, event, runtime wiring, UI, ads or reward flow was added; AUT-055/056 consume the helpers.

## Schema

`RewardedClaimState` gains `recentClaimUtcMs: number[]` (newest claim timestamps, ascending).
`claimCount` (lifetime) and `lastClaimUtcMs` keep their meaning.
`CURRENT_SAVE_VERSION` is now 3.

## Cap

`REWARDED_CLAIM_HISTORY_CAP = 3` (`state/RewardedClaimLimits.ts`, single constant). The rolling 24 h
quota is at most 3 claims per placement (`OFFLINE_DOUBLE_RULES` / `EXTENDED_OVERCLOCK_RULES`,
MONETIZATION sections 4-5), and eligibility only needs the newest `max` timestamps (quota frees when the
claim at index `count - max` ages out). It lives in `state/` so validation does not import `monetization/`;
`tests/rewarded_claim_history.test.ts` pins it to the maximum of the rule constants.

## Migration v2 -> v3 (`v2-to-v3-rewarded-claim-history`)

For every existing `rewardedClaims` entry: `recentClaimUtcMs = [lastClaimUtcMs]` when `lastClaimUtcMs` is a
finite number, else `[]`. Rationale: a known last-claim timestamp is real data and the conservative choice
(it still counts toward the quota and keeps the Extended Overclock minimum interval enforced; an empty
history would silently grant extra quota). Nothing else is ever invented: `claimCount` is NOT expanded
into fabricated timestamps and the rolling window is not approximated. `claimCount`/`lastClaimUtcMs` are
untouched. The payload hash is recomputed only when the v2 hash was valid (corruption is never laundered),
like the v1 -> v2 step. A claim that is not an object or already has `recentClaimUtcMs` fails migration
(`SAVE_MIGRATION_FAILED`, then the existing backup-recovery path). Framework behavior (idempotence,
forward-version rejection, no write-back on load) is unchanged.

## Validation (`StateValidation`)

Exact keys now include `recentClaimUtcMs`. Diagnostics: `STATE_EXPECTED_ARRAY`,
`STATE_INVALID_NON_NEGATIVE_NUMBER` (per item: NaN, negative, non-number), `STATE_CLAIM_HISTORY_TOO_LONG`
(> cap), `STATE_CLAIM_HISTORY_NOT_ASCENDING`, `STATE_CLAIM_HISTORY_LAST_MISMATCH` (non-empty history must end
at `lastClaimUtcMs`; null last requires empty history), `STATE_CLAIM_HISTORY_EXCEEDS_COUNT`
(length > `claimCount`). An empty history with a non-null last claim is accepted. An invalid main save falls
to backup recovery or `fresh_started` exactly as before.

## Helpers (`monetization/RewardedClaimHistory.ts`, pure)

- `recordRewardedClaim(state, placementId, nowUtcMs)` returns the new `RewardedClaimState` without mutating:
  prunes to the 24 h window (a claim exactly 24 h old is dropped), appends, sorts ascending, keeps the newest
  3, increments `claimCount`, sets `lastClaimUtcMs` to the newest history entry (never moves backwards under
  clock regression). Throws `RangeError` for non-finite or negative `nowUtcMs`.
- `getRewardedClaimHistory(state, placementId)` returns an ascending copy (`[]` when absent) for
  `RewardedEligibility`'s `claimTimestampsUtcMs`. `placementId` is the stored key (`rewarded.offline_double`),
  not the short `RewardedPlacementId`.

## Tests and fixtures

`tests/rewarded_claim_history.test.ts` plus fixtures `v2_rewarded_claims.json` / `v3_rewarded_claim_history.json`
cover migration, round trip through `PersistenceCoordinator` with in-memory storage, malformed history,
recording/pruning/cap, eligibility integration, backup recovery, and a v2-downgraded device seed. Literal
`saveVersion: 2` pins in existing tests were moved to 3. Device seeds and scenarios use
`CURRENT_SAVE_VERSION` and fresh state, so they emit v3 and need no change; older v2 installs migrate on load.

## Risk

A v3 save cannot be read by older v2 builds (forward-version rejection); intended.
