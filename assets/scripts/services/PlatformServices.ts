import type { AdsService } from './AdsService';
import type { AnalyticsService } from './AnalyticsService';
import type { EntitlementService } from './EntitlementService';
import type { PlatformCapabilities } from './PlatformCapabilities';
import type { PurchaseService } from './PurchaseService';

export interface PlatformServices {
    ads: AdsService;
    purchases: PurchaseService;
    entitlements: EntitlementService;
    analytics: AnalyticsService;
    capabilities: PlatformCapabilities;
}
