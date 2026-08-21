import type { AdsService } from './AdsService';
import type { EntitlementService } from './EntitlementService';
import type { PurchaseService } from './PurchaseService';

export interface PlatformServices {
    ads: AdsService;
    purchases: PurchaseService;
    entitlements: EntitlementService;
}

