import type { DomainEvent } from '../domain/Events.ts';
import { EXTENDED_OVERCLOCK_BOOST_ID, WORKER_BOT_BREAKTHROUGH_ID } from '../progression/TemporaryBoosts.ts';
import { ANALYTICS_EVENTS, bucketElapsedSeconds, bucketOfflineSeconds, rewardMagnitude, type AnalyticsEventId } from './AnalyticsEvents.ts';

/**
 * AUT-063 pure mapper: DomainEvent / flow outcomes -> AnalyticsEvent drafts (engine-free, no provider, no `cc`).
 *
 * Domain events map statelessly (`mapDomainEvents`). The rewarded / purchase flows and the offline report only expose DEBUG-style
 * `(phase, payload)` outcomes, so those mappers are stateful ONLY for de-duplication (opportunity transitions, one offer impression per session,
 * the request id of the attempt in flight). Parameters are built from content ids, enums, booleans, bucketed durations and opaque request ids only:
 * never prices, store tokens, transaction ids or exact durations.
 *
 * AUT-064: the flow mapper also tracks OPPORTUNITY EPISODES (one `rewarded_opportunity` per offer episode, not per offer read, so retries and ad
 * refreshes never inflate it), the in-session Founder unlock / run-start clocks, and the Extended Overclock production snapshot. It only reads an
 * injected clock and an injected, optional state reader; it persists nothing and nothing reads back from it.
 */
export interface AnalyticsEventDraft {
    readonly eventId: AnalyticsEventId;
    readonly params: Readonly<Record<string, string | number | boolean>>;
}

export type AnalyticsRewardedPlacement = 'offline_double' | 'extended_overclock';

export type OfflineAnalyticsSignal =
    | { readonly kind: 'shown'; readonly reason: string; readonly rawSeconds: number; readonly capApplied: boolean }
    | { readonly kind: 'collected'; readonly rawSeconds: number; readonly capApplied: boolean; readonly doubled: boolean; readonly saveOk: boolean | null }
    | { readonly kind: 'auto_collected'; readonly rawSeconds: number; readonly saveOk: boolean | null };

const PRODUCT = 'founder_pack';

/** Read-only facts the observer may supply from the authoritative state (all optional; analytics never writes state). */
export interface AnalyticsStateContext {
    readonly eraId: string | null;
    readonly civilization: number | null;
    readonly nextGoalId: string | null;
    /** Monotonic lifetime industrial output earned (survives Reboots); used only for the Extended Overclock gain ESTIMATE. */
    readonly lifetimeEarned: number | null;
}

export interface AnalyticsFlowMapperOptions {
    /** Epoch ms clock (in-session elapsed buckets only; never emitted). */
    readonly now?: () => number;
    readonly readState?: () => AnalyticsStateContext | null;
}

/** Context the stateless domain mapper needs for the Founder events (AUT-064). */
export interface AnalyticsDomainContext {
    /** Seconds since the Founder offer unlocked, or null when the unlock was not observed in this session. */
    readonly sinceUnlockSeconds: number | null;
    readonly beforeFirstReboot: boolean;
    readonly restoreContext: 'purchase_attempt' | 'store_query';
}

const DEFAULT_DOMAIN_CONTEXT: AnalyticsDomainContext = Object.freeze({ sinceUnlockSeconds: null, beforeFirstReboot: true, restoreContext: 'store_query' as const });

const draft = (eventId: AnalyticsEventId, params: AnalyticsEventDraft['params'] = {}): AnalyticsEventDraft => ({ eventId, params });

/** Adds an optional opaque request id only when it is a non-empty string. */
const withRequest = (params: Record<string, string | number | boolean>, requestId: unknown): Record<string, string | number | boolean> => {
    if (typeof requestId === 'string' && requestId.length > 0) params.request_id = requestId;
    return params;
};

/** Stateless: one domain event -> zero or more analytics drafts. */
export function mapDomainEvent(event: DomainEvent, context: AnalyticsDomainContext = DEFAULT_DOMAIN_CONTEXT): AnalyticsEventDraft[] {
    switch (event.type) {
        case 'producerConstructed':
            return [draft(ANALYTICS_EVENTS.producerUnlock, { producer_id: event.producerId, source: event.source })];
        case 'breakthroughPurchased':
            return [draft(ANALYTICS_EVENTS.breakthroughPurchase, { breakthrough_id: event.breakthroughId })];
        case 'eraChanged':
            return [draft(ANALYTICS_EVENTS.eraReached, { era_id: event.newEraId })];
        case 'firstRobotProduced':
            return [draft(ANALYTICS_EVENTS.firstRobot)];
        case 'civilizationChanged':
            return [draft(ANALYTICS_EVENTS.civilizationReached, { civilization: event.newCivilization })];
        case 'rebootCompleted':
            return [draft(ANALYTICS_EVENTS.rebootCompleted, { civilization: event.newCivilization, ai_cores_granted: Math.max(0, Math.floor(event.aiCoresGranted)) })];
        case 'permanentUpgradePurchased':
            return [draft(ANALYTICS_EVENTS.permanentUpgradePurchase, { upgrade_id: event.upgradeId, rank: event.newRank })];
        case 'founderPackApplied': {
            // A replay (nothing changed) is not a new completion / restore.
            if (!event.changed) return [];
            if (event.origin === 'purchase') {
                return [draft(ANALYTICS_EVENTS.purchaseComplete, withRequest({
                    product: PRODUCT,
                    since_unlock_bucket: bucketElapsedSeconds(context.sinceUnlockSeconds),
                    before_first_reboot: context.beforeFirstReboot,
                }, event.requestId))];
            }
            return [draft(ANALYTICS_EVENTS.purchaseRestore, { product: PRODUCT, restore_context: context.restoreContext })];
        }
        default:
            return [];
    }
}

export function mapDomainEvents(events: readonly DomainEvent[], context: AnalyticsDomainContext = DEFAULT_DOMAIN_CONTEXT): AnalyticsEventDraft[] {
    const out: AnalyticsEventDraft[] = [];
    for (const event of events) out.push(...mapDomainEvent(event, context));
    return out;
}

type OfferReadState = 'offered' | 'ad_unavailable' | 'none';

interface PlacementEpisode {
    /** Open opportunity episode id (null = none open). Retries after a failed ad keep the same episode. */
    id: string | null;
    read: OfferReadState;
    sequence: number;
    lastRequest: string | null;
}

interface BoostSnapshot {
    readonly multiplier: number;
    readonly lifetimeEarned: number | null;
    readonly requestId: string | null;
}

const OPPORTUNITY_PREFIX: Readonly<Record<AnalyticsRewardedPlacement, string>> = { offline_double: 'ofd', extended_overclock: 'xoc' };

/** Stateful mapper for flow outcomes (de-duplication, opportunity episodes, in-session clocks). One instance per session. */
export class AnalyticsFlowMapper {
    private readonly now: () => number;
    private readonly readStateFn: () => AnalyticsStateContext | null;
    private readonly episodes = new Map<AnalyticsRewardedPlacement, PlacementEpisode>();
    private offerShown = false;
    private purchaseAttemptOpen = false;
    /** In-session observation clocks (epoch ms; never emitted, only bucketed). null = not observed in this session. */
    private unlockedAtMs: number | null = null;
    private runStartedAtMs: number | null = null;
    private rebootSeen = false;
    private lastOfflineBucket: ReturnType<typeof bucketOfflineSeconds> | null = null;
    private boost: BoostSnapshot | null = null;

    public constructor(options: AnalyticsFlowMapperOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.readStateFn = options.readState ?? (() => null);
    }

    /** Domain events -> drafts, also feeding the in-session clocks (Founder unlock, run start) and the Extended Overclock expiry. */
    public mapDomainEvents(events: readonly DomainEvent[]): AnalyticsEventDraft[] {
        const out: AnalyticsEventDraft[] = [];
        for (const event of events) {
            this.trackClocks(event);
            out.push(...mapDomainEvent(event, this.domainContext()));
            if (event.type === 'temporaryBoostExpired' && event.boostId === EXTENDED_OVERCLOCK_BOOST_ID) out.push(...this.mapOverclockEnd());
        }
        return out;
    }

    private trackClocks(event: DomainEvent): void {
        const nowMs = this.now();
        if (this.unlockedAtMs === null && (event.type === 'firstRobotProduced' || (event.type === 'breakthroughPurchased' && event.breakthroughId === WORKER_BOT_BREAKTHROUGH_ID))) {
            this.unlockedAtMs = nowMs;
        }
        if (event.type === 'rebootCompleted') {
            this.rebootSeen = true;
            this.runStartedAtMs = nowMs;
        }
    }

    private domainContext(): AnalyticsDomainContext {
        const civilization = this.readState()?.civilization ?? null;
        return {
            sinceUnlockSeconds: this.unlockedAtMs === null ? null : Math.max(0, (this.now() - this.unlockedAtMs) / 1000),
            beforeFirstReboot: civilization !== null ? civilization <= 1 : !this.rebootSeen,
            restoreContext: this.purchaseAttemptOpen ? 'purchase_attempt' : 'store_query',
        };
    }

    private readState(): AnalyticsStateContext | null {
        try {
            return this.readStateFn();
        }
        catch {
            return null;
        }
    }

    private episode(placement: AnalyticsRewardedPlacement): PlacementEpisode {
        let episode = this.episodes.get(placement);
        if (!episode) {
            episode = { id: null, read: 'none', sequence: 0, lastRequest: null };
            this.episodes.set(placement, episode);
        }
        return episode;
    }

    /** Closes the open opportunity episode of a placement (the next offered read starts a new one). */
    private closeEpisode(placement: AnalyticsRewardedPlacement): void {
        const episode = this.episode(placement);
        episode.id = null;
    }

    /**
     * Rewarded flow phases: `offer` (the offer was (re)read), `ad_started`, `ad_result`, `granted`. `not_granted` stays with the flow.
     *
     * Opportunity semantics (AUT-064): ONE `rewarded_opportunity` per offer episode. An episode opens when the offer is first readable as offered
     * (eligible + ad available) and stays open across ad failures, retries, offer re-reads and ad-availability flaps; it closes when the offer
     * becomes unavailable for a player reason (hidden / ineligible / already active) or when the reward is granted. Opt-in = `rewarded_start`
     * carrying the episode's `opportunity_id`; a retry within the episode is another start, never another opportunity.
     */
    public mapRewardedPhase(placement: AnalyticsRewardedPlacement, phase: string, payload: Readonly<Record<string, unknown>>): AnalyticsEventDraft[] {
        const episode = this.episode(placement);
        const withOpportunity = (params: Record<string, string | number | boolean>): Record<string, string | number | boolean> => {
            if (episode.id !== null) params.opportunity_id = episode.id;
            return params;
        };
        switch (phase) {
            case 'offer': {
                const blockedBy = payload.blockedBy ?? null;
                const state: OfferReadState = blockedBy === null && payload.eligible === true && payload.adAvailable === true
                    ? 'offered'
                    : blockedBy === 'ad' ? 'ad_unavailable' : 'none';
                const previous = episode.read;
                episode.read = state;
                if (state === 'none') {
                    episode.id = null;
                    return [];
                }
                if (state === 'offered') {
                    if (episode.id !== null) return [];
                    episode.sequence += 1;
                    episode.id = `${OPPORTUNITY_PREFIX[placement]}_${episode.sequence}`;
                    return [draft(ANALYTICS_EVENTS.rewardedOpportunity, this.opportunityParams(placement, episode.id, payload))];
                }
                // ad_unavailable: only the transition is reported (a flapping ad read never repeats it).
                if (previous === 'ad_unavailable') return [];
                return [draft(ANALYTICS_EVENTS.rewardedUnavailable, withOpportunity({ placement, stage: 'offer' }))];
            }
            case 'ad_started': {
                const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
                if (requestId.length === 0) return [];
                episode.lastRequest = requestId;
                return [draft(ANALYTICS_EVENTS.rewardedStart, withOpportunity({ placement, request_id: requestId }))];
            }
            case 'ad_result': {
                if (payload.duplicate === true) return [];
                const params = (extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> => withOpportunity(withRequest({ placement, ...extra }, episode.lastRequest));
                const status = payload.status;
                if (status === 'rewarded') {
                    return payload.rewardVerified === true
                        ? [draft(ANALYTICS_EVENTS.rewardedComplete, params())]
                        : [draft(ANALYTICS_EVENTS.rewardedFailure, params({ reason: 'unverified' }))];
                }
                if (status === 'unavailable') return [draft(ANALYTICS_EVENTS.rewardedUnavailable, withOpportunity({ placement, stage: 'show' }))];
                if (status === 'closed' || status === 'failed' || status === 'timeout') return [draft(ANALYTICS_EVENTS.rewardedFailure, params({ reason: status }))];
                return [];
            }
            case 'granted': {
                const out = placement === 'offline_double' ? this.mapOfflineGrant(episode, payload) : this.mapOverclockGrant(episode, payload);
                this.closeEpisode(placement);
                return out;
            }
            default:
                return [];
        }
    }

    private opportunityParams(placement: AnalyticsRewardedPlacement, opportunityId: string, payload: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> {
        const params: Record<string, string | number | boolean> = { placement, opportunity_id: opportunityId };
        if (placement === 'offline_double') {
            if (this.lastOfflineBucket !== null) params.absence_bucket = this.lastOfflineBucket;
            const multiplier = typeof payload.multiplier === 'number' && Number.isInteger(payload.multiplier) && payload.multiplier >= 1 ? payload.multiplier : null;
            const projected = typeof payload.projectedReward === 'number' ? payload.projectedReward : null;
            if (multiplier !== null) {
                params.multiplier = multiplier;
                if (projected !== null) params.base_reward_mag = rewardMagnitude(projected / multiplier);
            }
        }
        return params;
    }

    private mapOfflineGrant(episode: PlacementEpisode, payload: Readonly<Record<string, unknown>>): AnalyticsEventDraft[] {
        const base = typeof payload.baseReward === 'number' ? payload.baseReward : null;
        const granted = typeof payload.grantedReward === 'number' ? payload.grantedReward : null;
        const multiplier = typeof payload.multiplier === 'number' && Number.isInteger(payload.multiplier) && payload.multiplier >= 1 ? payload.multiplier : null;
        if (base === null || granted === null || multiplier === null) return [];
        const params: Record<string, string | number | boolean> = {
            multiplier,
            base_reward_mag: rewardMagnitude(base),
            bonus_reward_mag: rewardMagnitude(Math.max(0, granted - base)),
            claims_in_window: claimsOf(payload),
        };
        withRequest(params, episode.lastRequest);
        if (episode.id !== null) params.opportunity_id = episode.id;
        return [draft(ANALYTICS_EVENTS.offlineBonusGranted, params)];
    }

    private mapOverclockGrant(episode: PlacementEpisode, payload: Readonly<Record<string, unknown>>): AnalyticsEventDraft[] {
        const state = this.readState();
        const multiplier = typeof payload.multiplier === 'number' && Number.isInteger(payload.multiplier) && payload.multiplier >= 1 ? payload.multiplier : 2;
        const nowMs = this.now();
        const params: Record<string, string | number | boolean> = {
            multiplier,
            claims_in_window: claimsOf(payload),
            run_age_bucket: bucketElapsedSeconds(this.runStartedAtMs === null ? null : Math.max(0, (nowMs - this.runStartedAtMs) / 1000)),
        };
        if (state?.eraId) params.era_id = state.eraId;
        if (state?.civilization) params.civilization = state.civilization;
        if (state?.nextGoalId) params.next_goal_id = state.nextGoalId;
        withRequest(params, episode.lastRequest);
        if (episode.id !== null) params.opportunity_id = episode.id;
        this.boost = { multiplier, lifetimeEarned: state?.lifetimeEarned ?? null, requestId: episode.lastRequest };
        return [draft(ANALYTICS_EVENTS.extendedOverclockActivated, params)];
    }

    /** Boost expiry: the production gained is ESTIMATED as (lifetime earned delta) x (m - 1) / m (omitted when the activation was not observed in this session). */
    private mapOverclockEnd(): AnalyticsEventDraft[] {
        const snapshot = this.boost;
        this.boost = null;
        const params: Record<string, string | number | boolean> = { outcome: 'expired' };
        if (snapshot !== null) {
            withRequest(params, snapshot.requestId);
            const endEarned = this.readState()?.lifetimeEarned ?? null;
            if (snapshot.lifetimeEarned !== null && endEarned !== null && snapshot.multiplier > 1) {
                const delta = Math.max(0, endEarned - snapshot.lifetimeEarned);
                params.production_gain_mag = rewardMagnitude(delta * (snapshot.multiplier - 1) / snapshot.multiplier);
            }
        }
        return [draft(ANALYTICS_EVENTS.extendedOverclockEnded, params)];
    }

    /**
     * Founder shop flow phases: `refresh` (offer impression, once per session), `purchase_started`, `purchase_result` (cancel / failure), `pending`,
     * `applied` (rejected). Completion and restore come from the `founderPackApplied` domain event. The impression and the completion carry the
     * time since the offer unlocked (bucketed, `unknown` when the unlock was not observed in this session) and whether the First Reboot happened.
     * The localized price text is never read.
     */
    public mapPurchasePhase(phase: string, payload: Readonly<Record<string, unknown>>): AnalyticsEventDraft[] {
        switch (phase) {
            case 'refresh': {
                if (this.offerShown) return [];
                if (payload.offer === 'available' && payload.store === 'ready' && payload.priceShown === true) {
                    this.offerShown = true;
                    const context = this.domainContext();
                    return [draft(ANALYTICS_EVENTS.purchaseOfferShown, {
                        product: PRODUCT,
                        since_unlock_bucket: bucketElapsedSeconds(context.sinceUnlockSeconds),
                        before_first_reboot: context.beforeFirstReboot,
                    })];
                }
                return [];
            }
            case 'purchase_started':
                if (typeof payload.requestId !== 'string' || payload.requestId.length === 0) return [];
                this.purchaseAttemptOpen = true;
                return [draft(ANALYTICS_EVENTS.purchaseStart, { product: PRODUCT, request_id: payload.requestId })];
            case 'purchase_result': {
                if (payload.duplicate === true) return [];
                const params = (extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> => withRequest({ product: PRODUCT, ...extra }, payload.requestId);
                const status = payload.status;
                if (status !== 'completed' && status !== 'already_owned') this.purchaseAttemptOpen = false;
                if (status === 'cancelled') return [draft(ANALYTICS_EVENTS.purchaseCancel, params())];
                if (status === 'failed' || status === 'timeout' || status === 'unavailable') return [draft(ANALYTICS_EVENTS.purchaseFailure, params({ reason: status }))];
                return [];
            }
            case 'pending':
                this.purchaseAttemptOpen = false;
                return [draft(ANALYTICS_EVENTS.purchasePending, withRequest({ product: PRODUCT }, payload.requestId))];
            case 'applied':
                // The domain event is emitted during the command, before this phase: the attempt is over once the flow reports the application.
                this.purchaseAttemptOpen = false;
                return payload.status === 'rejected' || payload.status === 'error'
                    ? [draft(ANALYTICS_EVENTS.purchaseFailure, withRequest({ product: PRODUCT, reason: 'apply_rejected' }, payload.requestId))]
                    : [];
            default:
                return [];
        }
    }

    /** Offline report outcomes (durations bucketed, never exact). */
    public mapOfflineSignal(signal: OfflineAnalyticsSignal): AnalyticsEventDraft[] {
        const bucket = bucketOfflineSeconds(signal.rawSeconds);
        const withSaved = (params: Record<string, string | number | boolean>, saveOk: boolean | null): Record<string, string | number | boolean> => {
            if (saveOk !== null) params.saved = saveOk;
            return params;
        };
        switch (signal.kind) {
            case 'shown':
                this.lastOfflineBucket = bucket;
                return [draft(ANALYTICS_EVENTS.offlineReportShown, { reason: signal.reason, absence_bucket: bucket, cap_applied: signal.capApplied })];
            case 'collected':
                this.closeEpisode('offline_double');
                return [draft(ANALYTICS_EVENTS.offlineCollected, withSaved({ absence_bucket: bucket, cap_applied: signal.capApplied, doubled: signal.doubled }, signal.saveOk))];
            case 'auto_collected':
                this.closeEpisode('offline_double');
                return [draft(ANALYTICS_EVENTS.offlineAutoCollected, withSaved({ absence_bucket: bucket }, signal.saveOk))];
            default:
                return [];
        }
    }
}

function claimsOf(payload: Readonly<Record<string, unknown>>): number {
    const value = payload.claimsInWindow;
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(10_000, value) : 0;
}
