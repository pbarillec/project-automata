/**
 * AUT-MIG-001 rewarded claim history helpers (pure, engine-free).
 *
 * Records claims into `RewardedClaimState.recentClaimUtcMs` and exposes the timestamps that
 * RewardedEligibility consumes. No commands, events, runtime wiring or UI: AUT-055/056 call these.
 *
 * `placementId` arguments are the stored `monetization.rewardedClaims` key (e.g.
 * `rewarded.offline_double`), not the short RewardedPlacementId.
 */
import type { GameState, RewardedClaimState } from '../state/GameState.ts';
import { REWARDED_CLAIM_HISTORY_CAP } from '../state/RewardedClaimLimits.ts';
import { pruneClaimsToRollingWindow } from './RewardedEligibility.ts';

export { REWARDED_CLAIM_HISTORY_CAP };

/** Claim timestamps (ascending copy) for a placement; empty when it has no entry. */
export function getRewardedClaimHistory(state: GameState, placementId: string): number[] {
    const claim = state.monetization.rewardedClaims[placementId];
    return claim === undefined ? [] : claim.recentClaimUtcMs.slice();
}

/**
 * Returns the claim state after a claim at `nowUtcMs`; never mutates `state`.
 * History is pruned to the rolling 24 h window (a claim exactly 24 h old is dropped), the new
 * claim is added, order is ascending, and only the newest REWARDED_CLAIM_HISTORY_CAP are kept.
 * claimCount is incremented; lastClaimUtcMs is the newest history timestamp (so a regressed clock
 * never moves it backwards). Throws RangeError for a non-finite or negative `nowUtcMs`.
 */
export function recordRewardedClaim(state: GameState, placementId: string, nowUtcMs: number): RewardedClaimState {
    if (typeof nowUtcMs !== 'number' || !Number.isFinite(nowUtcMs) || nowUtcMs < 0) {
        throw new RangeError('recordRewardedClaim requires a finite non-negative nowUtcMs.');
    }
    const previous = state.monetization.rewardedClaims[placementId];
    const kept = pruneClaimsToRollingWindow(previous?.recentClaimUtcMs, nowUtcMs);
    kept.push(nowUtcMs);
    kept.sort((a, b) => a - b);
    const history = kept.slice(-REWARDED_CLAIM_HISTORY_CAP);
    return {
        placementId,
        claimCount: (previous?.claimCount ?? 0) + 1,
        lastClaimUtcMs: history[history.length - 1],
        recentClaimUtcMs: history,
    };
}
