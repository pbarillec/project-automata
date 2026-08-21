import type {
    AdsService,
    RewardedAdRequest,
    RewardedAdResult,
} from '../../services/AdsService';
import type {
    EntitlementService,
    EntitlementStatus,
} from '../../services/EntitlementService';
import type {
    PlatformAvailability,
    PlatformOperationResult,
    PlatformServiceState,
    ProductId,
    RewardedPlacementId,
    EntitlementId,
} from '../../services/PlatformServiceTypes';
import type {
    ProductDetailsResult,
    PurchaseRequest,
    PurchaseResult,
    PurchaseService,
} from '../../services/PurchaseService';

const unavailableReason = 'platform_provider_unavailable';

function unavailableState(kind: PlatformServiceState['kind']): PlatformServiceState {
    return { kind, status: 'unavailable', reason: unavailableReason };
}

function unavailableOperation(): PlatformOperationResult {
    return { ok: false, status: 'unavailable', reason: unavailableReason };
}

export class NoOpAdsService implements AdsService {
    public async initialize(): Promise<PlatformServiceState> {
        return this.getStatus();
    }

    public getStatus(): PlatformServiceState {
        return unavailableState('ads');
    }

    public async getRewardedAvailability(_placementId: RewardedPlacementId): Promise<PlatformAvailability> {
        return { available: false, status: 'unavailable', reason: unavailableReason };
    }

    public async preloadRewarded(_placementId: RewardedPlacementId): Promise<PlatformOperationResult> {
        return unavailableOperation();
    }

    public async showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult> {
        return {
            status: 'unavailable',
            placementId: request.placementId,
            requestId: request.requestId,
            rewardVerified: false,
            reason: unavailableReason,
        };
    }
}

export class NoOpPurchaseService implements PurchaseService {
    public async initialize(): Promise<PlatformServiceState> {
        return this.getStatus();
    }

    public getStatus(): PlatformServiceState {
        return unavailableState('purchase');
    }

    public async queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult> {
        return {
            ok: false,
            products: [],
            missingProductIds: [...productIds],
            reason: unavailableReason,
        };
    }

    public async purchase(request: PurchaseRequest): Promise<PurchaseResult> {
        return {
            status: 'unavailable',
            productId: request.productId,
            requestId: request.requestId,
            reason: unavailableReason,
        };
    }

    public async restorePurchases(): Promise<PlatformOperationResult> {
        return unavailableOperation();
    }
}

export class NoOpEntitlementService implements EntitlementService {
    public async initialize(): Promise<PlatformServiceState> {
        return this.getStatus();
    }

    public getStatus(): PlatformServiceState {
        return unavailableState('entitlement');
    }

    public async getEntitlementStatus(entitlementId: EntitlementId): Promise<EntitlementStatus> {
        return {
            entitlementId,
            owned: false,
            source: 'none',
            reason: unavailableReason,
        };
    }

    public async reconcileEntitlements(): Promise<PlatformOperationResult> {
        return unavailableOperation();
    }
}

