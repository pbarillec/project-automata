import type { PlatformServices } from '../../services/PlatformServices';
import { NO_PLATFORM_CAPABILITIES } from '../../services/PlatformCapabilities.ts';
import { NoOpAnalyticsService } from './NoOpAnalyticsService.ts';
import {
    NoOpAdsService,
    NoOpEntitlementService,
    NoOpPurchaseService,
} from './NoOpPlatformProviders.ts';

export function createNoOpPlatformServices(): PlatformServices {
    return {
        ads: new NoOpAdsService(),
        purchases: new NoOpPurchaseService(),
        entitlements: new NoOpEntitlementService(),
        analytics: new NoOpAnalyticsService(),
        capabilities: { ...NO_PLATFORM_CAPABILITIES },
    };
}
