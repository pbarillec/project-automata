import type { DomainEvent } from '../domain/Events.ts';
import {
    AnalyticsFlowMapper,
    type AnalyticsEventDraft,
    type AnalyticsRewardedPlacement,
    type AnalyticsStateContext,
    type OfflineAnalyticsSignal,
} from '../services/AnalyticsEventMapper.ts';
import type { AnalyticsTracker } from '../services/AnalyticsTracker.ts';

/**
 * AUT-063 presentation-boundary analytics observer (pure, engine-free, no `cc`). The ONLY bridge between the game and analytics:
 * it observes domain events and flow / offline-report outcomes, maps them through the catalogue mapper and hands the drafts to the tracker.
 *
 * Domain, economy, runtime and UI scripts never import an analytics provider or SDK; they only expose outcomes that this observer reads.
 * Every entry point is wrapped so an analytics problem can never reach the caller (non-authoritative).
 *
 * AUT-064: every event carries an opaque per-launch `session_id` (random, no timestamp, never persisted). The optional state reader supplies read-only
 * context (era, civilization, next goal, lifetime output) for the Extended Overclock events; the observer never writes anything back.
 */
export interface AnalyticsObserverOptions {
    readonly now?: () => number;
    /** Replaceable id source (tests); default: random base-36 characters, no clock. */
    readonly createSessionId?: () => string;
    readonly readState?: () => AnalyticsStateContext | null;
}

const randomSessionId = (): string => {
    let id = 's';
    for (let i = 0; i < 12; i += 1) id += Math.floor(Math.random() * 36).toString(36);
    return id;
};

export class AnalyticsObserver {
    private readonly tracker: AnalyticsTracker;
    private readonly sessionId: string;
    private readStateFn: (() => AnalyticsStateContext | null) | null;
    private readonly flows: AnalyticsFlowMapper;

    public constructor(tracker: AnalyticsTracker, options: AnalyticsObserverOptions = {}) {
        this.tracker = tracker;
        this.readStateFn = options.readState ?? null;
        let sessionId = 's0';
        try {
            sessionId = (options.createSessionId ?? randomSessionId)();
        }
        catch {
            // keep the fallback id
        }
        this.sessionId = sessionId;
        this.flows = new AnalyticsFlowMapper({ now: options.now, readState: () => this.readStateFn?.() ?? null });
    }

    /** Late-bound read-only state reader (the session binding does not exist yet when the observer is created). */
    public setStateReader(read: (() => AnalyticsStateContext | null) | null): void {
        this.readStateFn = read;
    }

    /** Initialises the provider (fire-and-forget; never rejects). */
    public start(): void {
        void this.tracker.initialize();
    }

    public observeDomainEvents(events: readonly DomainEvent[]): void {
        this.safe(() => this.flows.mapDomainEvents(events));
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
            for (const draft of map()) this.tracker.track(draft.eventId, { ...draft.params, session_id: this.sessionId });
        }
        catch {
            // non-authoritative
        }
    }
}
