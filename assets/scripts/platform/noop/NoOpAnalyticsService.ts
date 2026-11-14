import type { AnalyticsParams, AnalyticsService } from '../../services/AnalyticsService';
import type { PlatformServiceState } from '../../services/PlatformServiceTypes';

export class NoOpAnalyticsService implements AnalyticsService {
    public async initialize(): Promise<PlatformServiceState> {
        return this.getStatus();
    }

    public getStatus(): PlatformServiceState {
        return { kind: 'analytics', status: 'unavailable', reason: 'platform_provider_unavailable' };
    }

    public track(_eventId: string, _params?: AnalyticsParams): void {
        // intentionally silent
    }
}
