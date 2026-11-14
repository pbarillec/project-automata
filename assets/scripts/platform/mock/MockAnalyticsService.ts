import type { AnalyticsParams, AnalyticsService } from '../../services/AnalyticsService';
import type { PlatformServiceState } from '../../services/PlatformServiceTypes';

export interface MockAnalyticsEvent {
    eventId: string;
    params: AnalyticsParams;
}

export interface MockAnalyticsServiceOptions {
    /** Every track call throws internally; the service must swallow it. */
    throwOnTrack?: boolean;
}

export class MockAnalyticsService implements AnalyticsService {
    private serviceState: PlatformServiceState = { kind: 'analytics', status: 'uninitialized' };
    private failuresPending = 0;
    private readonly alwaysThrow: boolean;

    public readonly events: MockAnalyticsEvent[] = [];
    /** Number of track calls that failed internally and were swallowed. */
    public swallowedFailures = 0;

    public constructor(options: MockAnalyticsServiceOptions = {}) {
        this.alwaysThrow = options.throwOnTrack === true;
    }

    public async initialize(): Promise<PlatformServiceState> {
        this.serviceState = { kind: 'analytics', status: 'ready' };
        return this.serviceState;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState;
    }

    /** Make the next `count` track calls fail internally. */
    public failNext(count = 1): void {
        this.failuresPending += count;
    }

    public track(eventId: string, params: AnalyticsParams = {}): void {
        try {
            if (this.alwaysThrow || this.failuresPending > 0) {
                if (this.failuresPending > 0) {
                    this.failuresPending -= 1;
                }

                throw new Error('mock_analytics_failure');
            }

            this.events.push({ eventId, params: { ...params } });
        } catch {
            this.swallowedFailures += 1;
        }
    }
}
