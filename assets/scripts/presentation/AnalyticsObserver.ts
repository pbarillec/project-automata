import type { DomainEvent } from '../domain/Events.ts';
import {
    AnalyticsFlowMapper,
    mapDomainEvents,
    type AnalyticsEventDraft,
    type AnalyticsRewardedPlacement,
    type OfflineAnalyticsSignal,
} from '../services/AnalyticsEventMapper.ts';
import type { AnalyticsTracker } from '../services/AnalyticsTracker.ts';

/**
 * AUT-063 presentation-boundary analytics observer (pure, engine-free, no `cc`). The ONLY bridge between the game and analytics:
 * it observes domain events and flow / offline-report outcomes, maps them through the catalogue mapper and hands the drafts to the tracker.
 *
 * Domain, economy, runtime and UI scripts never import an analytics provider or SDK; they only expose outcomes that this observer reads.
 * Every entry point is wrapped so an analytics problem can never reach the caller (non-authoritative).
 */
export class AnalyticsObserver {
    private readonly tracker: AnalyticsTracker;
    private readonly flows = new AnalyticsFlowMapper();

    public constructor(tracker: AnalyticsTracker) {
        this.tracker = tracker;
    }

    /** Initialises the provider (fire-and-forget; never rejects). */
    public start(): void {
        void this.tracker.initialize();
    }

    public observeDomainEvents(events: readonly DomainEvent[]): void {
        this.safe(() => mapDomainEvents(events));
    }

    public observeRewardedPhase(placement: AnalyticsRewardedPlacement, phase: string, payload: Readonly<Record<string, unknown>>): void {
        this.safe(() => this.flows.mapRewardedPhase(placement, phase, payload));
    }

    public observePurchasePhase(phase: string, payload: Readonly<Record<string, unknown>>): void {
        this.safe(() => this.flows.mapPurchasePhase(phase, payload));
    }

    public observeOfflineSignal(signal: OfflineAnalyticsSignal): void {
        this.safe(() => this.flows.mapOfflineSignal(signal));
    }

    private safe(map: () => AnalyticsEventDraft[]): void {
        try {
            for (const draft of map()) this.tracker.track(draft.eventId, draft.params);
        }
        catch {
            // non-authoritative
        }
    }
}
