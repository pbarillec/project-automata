/**
 * AUT-MIG-001: cap on `RewardedClaimState.recentClaimUtcMs`.
 *
 * Derivation: the rolling-24h quota (docs/MONETIZATION.md sections 4-5; OFFLINE_DOUBLE_RULES and
 * EXTENDED_OVERCLOCK_RULES in monetization/RewardedEligibility.ts) is at most 3 claims per
 * placement. Enforcing it only needs the newest `maxClaimsPerRolling24h` timestamps (the quota
 * frees when the claim at index `count - max` ages out), so older entries are never stored.
 * Kept here (state layer, engine-free) so StateValidation does not depend on monetization/;
 * tests/rewarded_claim_history.test.ts pins it to the maximum of the AUT-054 rule constants.
 */
export const REWARDED_CLAIM_HISTORY_CAP = 3;
