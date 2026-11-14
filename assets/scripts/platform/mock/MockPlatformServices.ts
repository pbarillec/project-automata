import type { PlatformCapabilities } from '../../services/PlatformCapabilities';
import type { PlatformServices } from '../../services/PlatformServices';
import { PlatformOverlayTracker } from '../../services/PlatformOverlay.ts';
import { MockAnalyticsService } from './MockAnalyticsService.ts';
import type { MockAnalyticsServiceOptions } from './MockAnalyticsService';
import {
    MockAdsService,
    MockEntitlementService,
    MockPurchaseService,
} from './MockPlatformProviders.ts';
import type {
    MockAdsServiceOptions,
    MockEntitlementServiceOptions,
    MockPurchaseServiceOptions,
} from './MockPlatformProviders';

export interface MockPlatformServicesOptions {
    ads?: Omit<MockAdsServiceOptions, 'overlay'>;
    purchases?: Omit<MockPurchaseServiceOptions, 'overlay'>;
    entitlements?: MockEntitlementServiceOptions;
    analytics?: MockAnalyticsServiceOptions;
    capabilities?: Partial<PlatformCapabilities>;
}

export interface MockPlatformServices extends PlatformServices {
    ads: MockAdsService;
    purchases: MockPurchaseService;
    entitlements: MockEntitlementService;
    analytics: MockAnalyticsService;
    overlay: PlatformOverlayTracker;
}

export const MOCK_PLATFORM_CAPABILITIES: PlatformCapabilities = Object.freeze({
    platform: 'editor',
    rewardedAds: true,
    billing: true,
    restorePurchases: true,
    analytics: true,
    fullscreenOverlays: false,
});

/** Network-free, deterministic platform services for editor and CI. */
export function createMockPlatformServices(options: MockPlatformServicesOptions = {}): MockPlatformServices {
    const overlay = new PlatformOverlayTracker();

    return {
        ads: new MockAdsService({ ...(options.ads ?? {}), overlay }),
        purchases: new MockPurchaseService({ ...(options.purchases ?? {}), overlay }),
        entitlements: new MockEntitlementService(options.entitlements),
        analytics: new MockAnalyticsService(options.analytics),
        capabilities: { ...MOCK_PLATFORM_CAPABILITIES, ...(options.capabilities ?? {}) },
        overlay,
    };
}
