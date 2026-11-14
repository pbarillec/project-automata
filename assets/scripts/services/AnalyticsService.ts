import type { PlatformServiceState } from './PlatformServiceTypes';

export type AnalyticsParams = Record<string, string | number | boolean>;

/**
 * Fire-and-forget analytics boundary. `track` must never throw and never block gameplay
 * (TECHNICAL_DESIGN 24.1). Implementations swallow their own errors.
 */
export interface AnalyticsService {
    initialize(): Promise<PlatformServiceState>;
    getStatus(): PlatformServiceState;
    track(eventId: string, params?: AnalyticsParams): void;
}
