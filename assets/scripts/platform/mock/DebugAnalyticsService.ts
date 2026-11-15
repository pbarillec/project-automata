import type { AnalyticsParams, AnalyticsService } from '../../services/AnalyticsService';
import type { PlatformServiceState } from '../../services/PlatformServiceTypes';

/**
 * AUT-063 Debug analytics provider: no network, no vendor SDK. It hands every event to an injected log sink (the DEBUG bootstrap forwards it to the
 * [AUT-DEVICE] channel) and keeps a bounded in-memory ring for tests. A throwing sink is swallowed.
 */
export interface DebugAnalyticsEvent {
    eventId: string;
    params: AnalyticsParams;
}

export const DEBUG_ANALYTICS_MAX_BUFFERED = 200;

export class DebugAnalyticsService implements AnalyticsService {
    private serviceState: PlatformServiceState = { kind: 'analytics', status: 'uninitialized' };
    private readonly sink: ((event: DebugAnalyticsEvent) => void) | undefined;

    public readonly events: DebugAnalyticsEvent[] = [];

    public constructor(sink?: (event: DebugAnalyticsEvent) => void) {
        this.sink = sink;
    }

    public async initialize(): Promise<PlatformServiceState> {
        this.serviceState = { kind: 'analytics', status: 'ready' };
        return this.serviceState;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState;
    }

    public track(eventId: string, params: AnalyticsParams = {}): void {
        try {
            const event = { eventId, params: { ...params } };
            this.events.push(event);
            if (this.events.length > DEBUG_ANALYTICS_MAX_BUFFERED) this.events.shift();
            this.sink?.(event);
        }
        catch {
            // non-authoritative: never propagates
        }
    }
}
