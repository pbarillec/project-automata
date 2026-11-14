/**
 * AUT-054 rewarded eligibility rules (player eligibility only).
 *
 * Pure and engine-free: no `cc`, no platform/ or services/ imports. It answers "is the PLAYER
 * allowed a rewarded opportunity now?" independently of ad availability (AdsService).
 *
 * No monetization data file exists yet (data/monetization is empty), so the values below mirror
 * docs/MONETIZATION.md section 4 (Offline Double) and section 5 (Extended Overclock) in one place.
 *
 * Window rule: a claim at time t counts in the rolling window while nowUtcMs - t < 24 h
 * (a claim exactly 24 h old is outside).
 *
 * Suspicious wall time (conservative rule): if nowUtcMs is not finite, or any claim timestamp is
 * in the future (t > nowUtcMs) or not finite, the clock is untrustworthy. Such claims are KEPT
 * inside the window (never grants extra quota), and the result is not eligible with reason
 * `suspicious_time` and `nextEligibleAtUtc: null`. Nothing throws.
 */

export const MS_PER_MINUTE = 60_000;
export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RewardedPlacementId = 'offline_double' | 'extended_overclock';

export interface RewardedEligibilityRules {
    readonly maxClaimsPerRolling24h: number;
    /** Offline Double only: minimum effective offline time, in minutes. */
    readonly minimumOfflineMinutes?: number;
    /** Extended Overclock only: minimum minutes since the last claim. */
    readonly minimumIntervalMinutes?: number;
}

export const OFFLINE_DOUBLE_RULES: RewardedEligibilityRules = Object.freeze({
    minimumOfflineMinutes: 30,
    maxClaimsPerRolling24h: 3,
});

/** AUT-055: MONETIZATION section 4 multiplier applied to the offline reward by a verified rewarded ad. */
export const OFFLINE_DOUBLE_MULTIPLIER = 2.0;

/**
 * AUT-055: the stored `monetization.rewardedClaims` key and the ad placement id for Offline Double.
 * (The short id 'offline_double' is used only by evaluateOfflineDoubleEligibility.)
 */
export const OFFLINE_DOUBLE_CLAIM_KEY = 'rewarded.offline_double';

export const EXTENDED_OVERCLOCK_RULES: RewardedEligibilityRules = Object.freeze({
    maxClaimsPerRolling24h: 3,
    minimumIntervalMinutes: 60,
});

export type RewardedEligibilityReason =
    | 'ok'
    | 'no_offline_report'
    | 'below_min_offline'
    | 'quota_reached'
    | 'min_interval'
    | 'suspicious_time';

export interface RewardedEligibilityResult {
    readonly placementId: RewardedPlacementId;
    readonly eligible: boolean;
    readonly reason: RewardedEligibilityReason;
    /** Earliest UTC ms at which the blocking condition clears, or null (eligible / unknown). */
    readonly nextEligibleAtUtc: number | null;
    readonly remainingQuota: number;
    readonly claimsInWindow: number;
}

export interface OfflineDoubleEligibilityInput {
    readonly nowUtcMs: number;
    /** True when a collectible (uncollected) offline report exists. */
    readonly hasCollectibleReport: boolean;
    readonly effectiveOfflineSeconds: number | null | undefined;
    readonly claimTimestampsUtcMs?: readonly number[] | null;
}

export interface ExtendedOverclockEligibilityInput {
    readonly nowUtcMs: number;
    readonly claimTimestampsUtcMs?: readonly number[] | null;
}

export interface RewardedOfferDecision {
    readonly offer: boolean;
    readonly blockedBy: 'player' | 'ad' | null;
}

/** Claims still counting in the rolling window, ascending. Future/non-finite claims are kept. */
export function pruneClaimsToRollingWindow(
    claimTimestampsUtcMs: readonly number[] | null | undefined,
    nowUtcMs: number,
): number[] {
    const claims = claimTimestampsUtcMs ?? [];
    const kept: number[] = [];
    for (const t of claims) {
        if (typeof t !== 'number' || !Number.isFinite(t)) {
            kept.push(Number.POSITIVE_INFINITY);
            continue;
        }
        if (!Number.isFinite(nowUtcMs) || t > nowUtcMs || nowUtcMs - t < ROLLING_WINDOW_MS) {
            kept.push(t);
        }
    }
    return kept.sort((a, b) => a - b);
}

export function evaluateOfflineDoubleEligibility(
    input: OfflineDoubleEligibilityInput,
    rules: RewardedEligibilityRules = OFFLINE_DOUBLE_RULES,
): RewardedEligibilityResult {
    const window = readWindow(input.nowUtcMs, input.claimTimestampsUtcMs, rules);
    const base = { placementId: 'offline_double' as const, ...window.summary };
    if (window.suspicious) {
        return { ...base, eligible: false, reason: 'suspicious_time', nextEligibleAtUtc: null };
    }
    const seconds = input.effectiveOfflineSeconds;
    if (!input.hasCollectibleReport || typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return { ...base, eligible: false, reason: 'no_offline_report', nextEligibleAtUtc: null };
    }
    if (seconds < (rules.minimumOfflineMinutes ?? 0) * 60) {
        return { ...base, eligible: false, reason: 'below_min_offline', nextEligibleAtUtc: null };
    }
    if (window.summary.remainingQuota <= 0) {
        return { ...base, eligible: false, reason: 'quota_reached', nextEligibleAtUtc: window.quotaClearsAt };
    }
    return { ...base, eligible: true, reason: 'ok', nextEligibleAtUtc: null };
}

export function evaluateExtendedOverclockEligibility(
    input: ExtendedOverclockEligibilityInput,
    rules: RewardedEligibilityRules = EXTENDED_OVERCLOCK_RULES,
): RewardedEligibilityResult {
    const window = readWindow(input.nowUtcMs, input.claimTimestampsUtcMs, rules);
    const base = { placementId: 'extended_overclock' as const, ...window.summary };
    if (window.suspicious) {
        return { ...base, eligible: false, reason: 'suspicious_time', nextEligibleAtUtc: null };
    }
    const intervalMs = (rules.minimumIntervalMinutes ?? 0) * MS_PER_MINUTE;
    const last = window.claims.length > 0 ? window.claims[window.claims.length - 1] : null;
    const intervalClearsAt = last === null ? null : last + intervalMs;
    const intervalBlocked = intervalClearsAt !== null && input.nowUtcMs < intervalClearsAt;
    if (window.summary.remainingQuota <= 0) {
        const candidates = [window.quotaClearsAt, intervalBlocked ? intervalClearsAt : null]
            .filter((v): v is number => v !== null);
        return {
            ...base,
            eligible: false,
            reason: 'quota_reached',
            nextEligibleAtUtc: candidates.length > 0 ? Math.max(...candidates) : null,
        };
    }
    if (intervalBlocked) {
        return { ...base, eligible: false, reason: 'min_interval', nextEligibleAtUtc: intervalClearsAt };
    }
    return { ...base, eligible: true, reason: 'ok', nextEligibleAtUtc: null };
}

/**
 * Trivial combinator. Player eligibility and ad availability stay separate inputs; the player
 * reason wins when both block.
 */
export function canOfferRewarded(
    eligibility: RewardedEligibilityResult,
    adAvailable: boolean,
): RewardedOfferDecision {
    if (!eligibility.eligible) {
        return { offer: false, blockedBy: 'player' };
    }
    return adAvailable ? { offer: true, blockedBy: null } : { offer: false, blockedBy: 'ad' };
}

interface WindowRead {
    readonly claims: readonly number[];
    readonly suspicious: boolean;
    readonly quotaClearsAt: number | null;
    readonly summary: { readonly remainingQuota: number; readonly claimsInWindow: number };
}

function readWindow(
    nowUtcMs: number,
    claimTimestampsUtcMs: readonly number[] | null | undefined,
    rules: RewardedEligibilityRules,
): WindowRead {
    const claims = pruneClaimsToRollingWindow(claimTimestampsUtcMs, nowUtcMs);
    const suspicious = !Number.isFinite(nowUtcMs) || claims.some((t) => !Number.isFinite(t) || t > nowUtcMs);
    const max = rules.maxClaimsPerRolling24h;
    const remainingQuota = Math.max(0, max - claims.length);
    // Quota frees when the claim that makes count == max ages out: index (count - max).
    const quotaClearsAt = remainingQuota <= 0 && !suspicious
        ? claims[claims.length - max] + ROLLING_WINDOW_MS
        : null;
    return { claims, suspicious, quotaClearsAt, summary: { remainingQuota, claimsInWindow: claims.length } };
}
