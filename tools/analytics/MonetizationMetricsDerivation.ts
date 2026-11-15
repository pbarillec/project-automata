/**
 * AUT-064 monetization metrics derivation (pure analyzer, engine-free, NO runtime use; only tests / offline tooling import it).
 *
 * It proves that the MONETIZATION section 24 measurements for Rewarded Offline, Extended Overclock and the Founder pack can be derived from the CLEAN
 * analytics events alone: it takes an event stream (event id + validated params, plus the ingest-side envelope `tsMs` and `userKey` that the
 * analytics backend adds; neither is an event parameter) and computes opt-in rates, uses per player-day, conversion and time-to-purchase.
 *
 * Semantics (see docs/AUT-064_MONETIZATION_ANALYTICS.md):
 * - opportunity = distinct (user, session_id, opportunity_id) of `rewarded_opportunity`; opt-in = that opportunity has at least one `rewarded_start`.
 *   Retries inside an episode add attempts, never opportunities (the mapper emits one opportunity per offer episode).
 * - uses/day = `extended_overclock_activated` per (userKey, UTC day); claims per rolling day = grants within the trailing 24 h of the same user.
 * - Founder time-to-purchase = first `purchase_complete` minus the user's unlock moment (first `first_robot` or `breakthrough_purchase(worker_bot)`),
 *   from the backend timestamps (exact), next to the in-session `since_unlock_bucket` distribution.
 * - Price tier is NOT derivable: the store metadata exposes no tier / currency code (only a localized price string, which is never logged).
 */

export interface AnalyticsRecord {
    readonly eventId: string;
    readonly params: Readonly<Record<string, string | number | boolean>>;
    /** Ingest timestamp (epoch ms) added by the analytics backend. */
    readonly tsMs: number;
    /** Ingest-side pseudonymous player key (NOT an event parameter). Defaults to a single anonymous player. */
    readonly userKey?: string;
}

export interface OptInStats {
    readonly opportunities: number;
    readonly optIns: number;
    /** optIns / opportunities (0 when there is no opportunity). */
    readonly optInRate: number;
}

export interface RewardedOfflineMetrics extends OptInStats {
    /** `rewarded_start` count (attempts, retries included). */
    readonly attempts: number;
    readonly completions: number;
    readonly grants: number;
    readonly multiplierUsed: Readonly<Record<string, number>>;
    readonly byAbsenceBucket: Readonly<Record<string, OptInStats>>;
    readonly byBaseRewardMag: Readonly<Record<string, OptInStats>>;
    readonly baseRewardMagDistribution: Readonly<Record<string, number>>;
    readonly bonusRewardMagDistribution: Readonly<Record<string, number>>;
    /** Largest number of grants of one player inside any trailing 24 h window (derived from timestamps). */
    readonly maxClaimsInRollingDay: number;
    /** Largest `claims_in_window` reported by the game itself (cross-check). */
    readonly maxReportedClaimsInWindow: number;
}

export interface ExtendedOverclockMetrics extends OptInStats {
    readonly attempts: number;
    readonly activations: number;
    /** Average activations per (player, UTC day) that has at least one activation. */
    readonly usesPerActivePlayerDay: number;
    readonly maxUsesPerPlayerDay: number;
    readonly runAgeBucketDistribution: Readonly<Record<string, number>>;
    /** Run age at activation from timestamps (run start = latest `reboot_completed`, else the player's first event); median seconds or null. */
    readonly medianRunAgeSeconds: number | null;
    readonly byEra: Readonly<Record<string, number>>;
    readonly byNextGoal: Readonly<Record<string, number>>;
    readonly endedCount: number;
    readonly productionGainMagDistribution: Readonly<Record<string, number>>;
}

export interface FounderMetrics {
    readonly impressions: number;
    readonly impressionPlayers: number;
    readonly starts: number;
    readonly purchases: number;
    readonly purchasePlayers: number;
    /** purchasers that saw the offer / players that saw the offer. */
    readonly conversion: number;
    readonly restores: number;
    readonly beforeFirstRebootPurchases: number;
    readonly sinceUnlockBucketAtPurchase: Readonly<Record<string, number>>;
    readonly sinceUnlockBucketAtImpression: Readonly<Record<string, number>>;
    /** Seconds from unlock to first purchase, per purchasing player (backend timestamps). */
    readonly timeToPurchaseSeconds: readonly number[];
    readonly medianTimeToPurchaseSeconds: number | null;
}

export interface MonetizationMetrics {
    readonly rewardedOffline: RewardedOfflineMetrics;
    readonly extendedOverclock: ExtendedOverclockMetrics;
    readonly founder: FounderMetrics;
}

export const ROLLING_DAY_MS = 24 * 60 * 60 * 1000;
const WORKER_BOT_BREAKTHROUGH = 'worker_bot';

type Params = Readonly<Record<string, string | number | boolean>>;

const userOf = (r: AnalyticsRecord): string => r.userKey ?? 'anon';
const key = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : null);
const bump = (map: Record<string, number>, name: string | null): void => {
    if (name !== null) map[name] = (map[name] ?? 0) + 1;
};
const median = (values: readonly number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const rate = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

interface Opportunity {
    readonly params: Params;
    attempts: number;
}

function opportunityKey(r: AnalyticsRecord): string | null {
    const opportunityId = key(r.params.opportunity_id);
    return opportunityId === null ? null : `${userOf(r)}|${key(r.params.session_id) ?? ''}|${opportunityId}`;
}

function collectOpportunities(records: readonly AnalyticsRecord[], placement: string): Opportunity[] {
    const map = new Map<string, Opportunity>();
    for (const r of records) {
        if (r.eventId !== 'rewarded_opportunity' || r.params.placement !== placement) continue;
        const k = opportunityKey(r);
        if (k !== null && !map.has(k)) map.set(k, { params: r.params, attempts: 0 });
    }
    for (const r of records) {
        if (r.eventId !== 'rewarded_start' || r.params.placement !== placement) continue;
        const k = opportunityKey(r);
        const opportunity = k === null ? undefined : map.get(k);
        if (opportunity) opportunity.attempts += 1;
    }
    return [...map.values()];
}

function optInStats(opportunities: readonly Opportunity[]): OptInStats {
    const optIns = opportunities.filter((o) => o.attempts > 0).length;
    return { opportunities: opportunities.length, optIns, optInRate: rate(optIns, opportunities.length) };
}

function groupStats(opportunities: readonly Opportunity[], field: string): Record<string, OptInStats> {
    const groups: Record<string, Opportunity[]> = {};
    for (const o of opportunities) {
        const name = key(o.params[field]);
        if (name !== null) (groups[name] ??= []).push(o);
    }
    return Object.fromEntries(Object.entries(groups).map(([name, list]) => [name, optInStats(list)]));
}

function rollingDayMax(timestampsByUser: ReadonlyMap<string, readonly number[]>): number {
    let max = 0;
    for (const times of timestampsByUser.values()) {
        const sorted = [...times].sort((a, b) => a - b);
        let from = 0;
        for (let i = 0; i < sorted.length; i += 1) {
            while (sorted[i] - sorted[from] >= ROLLING_DAY_MS) from += 1;
            max = Math.max(max, i - from + 1);
        }
    }
    return max;
}

function deriveRewardedOffline(records: readonly AnalyticsRecord[]): RewardedOfflineMetrics {
    const opportunities = collectOpportunities(records, 'offline_double');
    const multiplierUsed: Record<string, number> = {};
    const base: Record<string, number> = {};
    const bonus: Record<string, number> = {};
    const grantTimes = new Map<string, number[]>();
    let grants = 0;
    let maxReported = 0;
    for (const r of records) {
        if (r.eventId !== 'offline_bonus_granted') continue;
        grants += 1;
        bump(multiplierUsed, key(r.params.multiplier));
        bump(base, key(r.params.base_reward_mag));
        bump(bonus, key(r.params.bonus_reward_mag));
        const u = userOf(r);
        grantTimes.set(u, [...(grantTimes.get(u) ?? []), r.tsMs]);
        maxReported = Math.max(maxReported, Number(r.params.claims_in_window ?? 0));
    }
    return {
        ...optInStats(opportunities),
        attempts: opportunities.reduce((sum, o) => sum + o.attempts, 0),
        completions: records.filter((r) => r.eventId === 'rewarded_complete' && r.params.placement === 'offline_double').length,
        grants,
        multiplierUsed,
        byAbsenceBucket: groupStats(opportunities, 'absence_bucket'),
        byBaseRewardMag: groupStats(opportunities, 'base_reward_mag'),
        baseRewardMagDistribution: base,
        bonusRewardMagDistribution: bonus,
        maxClaimsInRollingDay: rollingDayMax(grantTimes),
        maxReportedClaimsInWindow: maxReported,
    };
}

const utcDay = (tsMs: number): number => Math.floor(tsMs / ROLLING_DAY_MS);

function deriveExtendedOverclock(records: readonly AnalyticsRecord[]): ExtendedOverclockMetrics {
    const opportunities = collectOpportunities(records, 'extended_overclock');
    const runAgeBuckets: Record<string, number> = {};
    const byEra: Record<string, number> = {};
    const byGoal: Record<string, number> = {};
    const gain: Record<string, number> = {};
    const perDay = new Map<string, number>();
    const firstEvent = new Map<string, number>();
    const lastReboot = new Map<string, number>();
    const runAges: number[] = [];
    for (const r of records) {
        const u = userOf(r);
        firstEvent.set(u, Math.min(firstEvent.get(u) ?? r.tsMs, r.tsMs));
    }
    let activations = 0;
    let ended = 0;
    for (const r of [...records].sort((a, b) => a.tsMs - b.tsMs)) {
        const u = userOf(r);
        if (r.eventId === 'reboot_completed') lastReboot.set(u, r.tsMs);
        if (r.eventId === 'extended_overclock_ended') {
            ended += 1;
            bump(gain, key(r.params.production_gain_mag));
        }
        if (r.eventId !== 'extended_overclock_activated') continue;
        activations += 1;
        bump(runAgeBuckets, key(r.params.run_age_bucket));
        bump(byEra, key(r.params.era_id));
        bump(byGoal, key(r.params.next_goal_id));
        const day = `${u}|${utcDay(r.tsMs)}`;
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        runAges.push(Math.max(0, (r.tsMs - (lastReboot.get(u) ?? firstEvent.get(u) ?? r.tsMs)) / 1000));
    }
    const counts = [...perDay.values()];
    return {
        ...optInStats(opportunities),
        attempts: opportunities.reduce((sum, o) => sum + o.attempts, 0),
        activations,
        usesPerActivePlayerDay: counts.length === 0 ? 0 : counts.reduce((a, b) => a + b, 0) / counts.length,
        maxUsesPerPlayerDay: counts.length === 0 ? 0 : Math.max(...counts),
        runAgeBucketDistribution: runAgeBuckets,
        medianRunAgeSeconds: median(runAges),
        byEra,
        byNextGoal: byGoal,
        endedCount: ended,
        productionGainMagDistribution: gain,
    };
}

function deriveFounder(records: readonly AnalyticsRecord[]): FounderMetrics {
    const impressionPlayers = new Set<string>();
    const purchasePlayers = new Set<string>();
    const unlockAt = new Map<string, number>();
    const firstPurchase = new Map<string, number>();
    const atPurchase: Record<string, number> = {};
    const atImpression: Record<string, number> = {};
    let impressions = 0;
    let starts = 0;
    let purchases = 0;
    let restores = 0;
    let beforeFirstReboot = 0;
    for (const r of [...records].sort((a, b) => a.tsMs - b.tsMs)) {
        const u = userOf(r);
        const unlocks = r.eventId === 'first_robot' || (r.eventId === 'breakthrough_purchase' && r.params.breakthrough_id === WORKER_BOT_BREAKTHROUGH);
        if (unlocks && !unlockAt.has(u)) unlockAt.set(u, r.tsMs);
        switch (r.eventId) {
            case 'purchase_offer_shown':
                impressions += 1;
                impressionPlayers.add(u);
                bump(atImpression, key(r.params.since_unlock_bucket));
                break;
            case 'purchase_start':
                starts += 1;
                break;
            case 'purchase_complete':
                purchases += 1;
                purchasePlayers.add(u);
                if (!firstPurchase.has(u)) firstPurchase.set(u, r.tsMs);
                bump(atPurchase, key(r.params.since_unlock_bucket));
                if (r.params.before_first_reboot === true) beforeFirstReboot += 1;
                break;
            case 'purchase_restore':
                restores += 1;
                break;
            default:
                break;
        }
    }
    const times: number[] = [];
    for (const [u, purchasedAt] of firstPurchase) {
        const unlocked = unlockAt.get(u);
        if (unlocked !== undefined) times.push(Math.max(0, (purchasedAt - unlocked) / 1000));
    }
    const converted = [...purchasePlayers].filter((u) => impressionPlayers.has(u)).length;
    return {
        impressions,
        impressionPlayers: impressionPlayers.size,
        starts,
        purchases,
        purchasePlayers: purchasePlayers.size,
        conversion: rate(converted, impressionPlayers.size),
        restores,
        beforeFirstRebootPurchases: beforeFirstReboot,
        sinceUnlockBucketAtPurchase: atPurchase,
        sinceUnlockBucketAtImpression: atImpression,
        timeToPurchaseSeconds: times,
        medianTimeToPurchaseSeconds: median(times),
    };
}

/** Pure: an event stream -> the three metric families. Never mutates the input. */
export function deriveMonetizationMetrics(records: readonly AnalyticsRecord[]): MonetizationMetrics {
    return {
        rewardedOffline: deriveRewardedOffline(records),
        extendedOverclock: deriveExtendedOverclock(records),
        founder: deriveFounder(records),
    };
}
