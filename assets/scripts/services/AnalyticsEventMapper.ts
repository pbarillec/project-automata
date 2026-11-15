import type { DomainEvent } from '../domain/Events.ts';
import { ANALYTICS_EVENTS, bucketOfflineSeconds, type AnalyticsEventId } from './AnalyticsEvents.ts';

/**
 * AUT-063 pure mapper: DomainEvent / flow outcomes -> AnalyticsEvent drafts (engine-free, no provider, no `cc`).
 *
 * Domain events map statelessly (`mapDomainEvents`). The rewarded / purchase flows and the offline report only expose DEBUG-style
 * `(phase, payload)` outcomes, so those mappers are stateful ONLY for de-duplication (opportunity transitions, one offer impression per session,
 * the request id of the attempt in flight). Parameters are built from content ids, enums, booleans, bucketed durations and opaque request ids only:
 * never prices, store tokens, transaction ids or exact durations.
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

const draft = (eventId: AnalyticsEventId, params: AnalyticsEventDraft['params'] = {}): AnalyticsEventDraft => ({ eventId, params });

/** Adds an optional opaque request id only when it is a non-empty string. */
const withRequest = (params: Record<string, string | number | boolean>, requestId: unknown): Record<string, string | number | boolean> => {
    if (typeof requestId === 'string' && requestId.length > 0) params.request_id = requestId;
    return params;
};

/** Stateless: one domain event -> zero or more analytics drafts. */
export function mapDomainEvent(event: DomainEvent): AnalyticsEventDraft[] {
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
            if (event.origin === 'purchase') return [draft(ANALYTICS_EVENTS.purchaseComplete, withRequest({ product: PRODUCT }, event.requestId))];
            return [draft(ANALYTICS_EVENTS.purchaseRestore, { product: PRODUCT })];
        }
        default:
            return [];
    }
}

export function mapDomainEvents(events: readonly DomainEvent[]): AnalyticsEventDraft[] {
    const out: AnalyticsEventDraft[] = [];
    for (const event of events) out.push(...mapDomainEvent(event));
    return out;
}

type OpportunityState = 'offered' | 'ad_unavailable' | 'none';

/** Stateful (de-duplication only) mapper for flow outcomes. One instance per session. */
export class AnalyticsFlowMapper {
    private readonly opportunity = new Map<AnalyticsRewardedPlacement, OpportunityState>();
    private readonly lastRequest = new Map<AnalyticsRewardedPlacement, string>();
    private offerShown = false;

    /**
     * Rewarded flow phases: `offer` (the offer was (re)read), `ad_started`, `ad_result`. `not_granted` / `granted` stay with the flow and domain
     * outcomes (the ad completion is the rewarded_complete event; the grant is derivable from offline_collected(doubled) / the boost events).
     */
    public mapRewardedPhase(placement: AnalyticsRewardedPlacement, phase: string, payload: Readonly<Record<string, unknown>>): AnalyticsEventDraft[] {
        switch (phase) {
            case 'offer': {
                const blockedBy = payload.blockedBy ?? null;
                const state: OpportunityState = blockedBy === null && payload.eligible === true && payload.adAvailable === true
                    ? 'offered'
                    : blockedBy === 'ad' ? 'ad_unavailable' : 'none';
                const previous = this.opportunity.get(placement) ?? 'none';
                this.opportunity.set(placement, state);
                if (state === previous) return [];
                if (state === 'offered') return [draft(ANALYTICS_EVENTS.rewardedOpportunity, { placement })];
                if (state === 'ad_unavailable') return [draft(ANALYTICS_EVENTS.rewardedUnavailable, { placement, stage: 'offer' })];
                return [];
            }
            case 'ad_started': {
                const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
                // A new attempt re-arms the opportunity (the next offer read counts as a fresh chance).
                this.opportunity.set(placement, 'none');
                if (requestId.length === 0) return [];
                this.lastRequest.set(placement, requestId);
                return [draft(ANALYTICS_EVENTS.rewardedStart, { placement, request_id: requestId })];
            }
            case 'ad_result': {
                if (payload.duplicate === true) return [];
                const requestId = this.lastRequest.get(placement);
                const params = (extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> => withRequest({ placement, ...extra }, requestId);
                const status = payload.status;
                if (status === 'rewarded') {
                    return payload.rewardVerified === true
                        ? [draft(ANALYTICS_EVENTS.rewardedComplete, params())]
                        : [draft(ANALYTICS_EVENTS.rewardedFailure, params({ reason: 'unverified' }))];
                }
                if (status === 'unavailable') return [draft(ANALYTICS_EVENTS.rewardedUnavailable, { placement, stage: 'show' })];
                if (status === 'closed' || status === 'failed' || status === 'timeout') return [draft(ANALYTICS_EVENTS.rewardedFailure, params({ reason: status }))];
                return [];
            }
            default:
                return [];
        }
    }

    /**
     * Founder shop flow phases: `refresh` (offer impression, once per session), `purchase_started`, `purchase_result` (cancel / failure), `pending`,
     * `applied` (rejected). Completion and restore come from the `founderPackApplied` domain event.
     */
    public mapPurchasePhase(phase: string, payload: Readonly<Record<string, unknown>>): AnalyticsEventDraft[] {
        switch (phase) {
            case 'refresh': {
                if (this.offerShown) return [];
                if (payload.offer === 'available' && payload.store === 'ready' && payload.priceShown === true) {
                    this.offerShown = true;
                    return [draft(ANALYTICS_EVENTS.purchaseOfferShown, { product: PRODUCT })];
                }
                return [];
            }
            case 'purchase_started':
                return typeof payload.requestId === 'string' && payload.requestId.length > 0
                    ? [draft(ANALYTICS_EVENTS.purchaseStart, { product: PRODUCT, request_id: payload.requestId })]
                    : [];
            case 'purchase_result': {
                if (payload.duplicate === true) return [];
                const params = (extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> => withRequest({ product: PRODUCT, ...extra }, payload.requestId);
                const status = payload.status;
                if (status === 'cancelled') return [draft(ANALYTICS_EVENTS.purchaseCancel, params())];
                if (status === 'failed' || status === 'timeout' || status === 'unavailable') return [draft(ANALYTICS_EVENTS.purchaseFailure, params({ reason: status }))];
                return [];
            }
            case 'pending':
                return [draft(ANALYTICS_EVENTS.purchasePending, withRequest({ product: PRODUCT }, payload.requestId))];
            case 'applied':
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
                return [draft(ANALYTICS_EVENTS.offlineReportShown, { reason: signal.reason, absence_bucket: bucket, cap_applied: signal.capApplied })];
            case 'collected':
                return [draft(ANALYTICS_EVENTS.offlineCollected, withSaved({ absence_bucket: bucket, cap_applied: signal.capApplied, doubled: signal.doubled }, signal.saveOk))];
            case 'auto_collected':
                return [draft(ANALYTICS_EVENTS.offlineAutoCollected, withSaved({ absence_bucket: bucket }, signal.saveOk))];
            default:
                return [];
        }
    }
}
