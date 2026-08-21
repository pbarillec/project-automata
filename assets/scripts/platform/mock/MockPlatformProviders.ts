import type {
    AdsService,
    RewardedAdRequest,
    RewardedAdResult,
    RewardedAdResultStatus,
} from '../../services/AdsService';
import type {
    EntitlementService,
    EntitlementStatus,
} from '../../services/EntitlementService';
import type {
    PlatformAvailability,
    PlatformOperationResult,
    PlatformServiceState,
    PlatformServiceStatus,
    ProductId,
    RewardedPlacementId,
    EntitlementId,
} from '../../services/PlatformServiceTypes';
import type {
    ProductDetails,
    ProductDetailsResult,
    PurchaseRequest,
    PurchaseResult,
    PurchaseResultStatus,
    PurchaseService,
} from '../../services/PurchaseService';

interface MockRewardedPlacement {
    available?: boolean;
    showResult?: RewardedAdResultStatus;
    reason?: string;
}

export interface MockAdsServiceOptions {
    initialStatus?: PlatformServiceStatus;
    placements?: Record<string, MockRewardedPlacement>;
}

function state(kind: PlatformServiceState['kind'], status: PlatformServiceStatus, reason?: string): PlatformServiceState {
    return reason === undefined ? { kind, status } : { kind, status, reason };
}

function blockedResult(currentState: PlatformServiceState): PlatformOperationResult {
    return {
        ok: false,
        status: currentState.status,
        reason: currentState.reason ?? currentState.status,
    };
}

export class MockAdsService implements AdsService {
    private serviceState: PlatformServiceState;
    private readonly placements: Record<string, MockRewardedPlacement>;

    public constructor(options: MockAdsServiceOptions = {}) {
        this.serviceState = state('ads', 'uninitialized');
        this.placements = { ...(options.placements ?? {}) };

        if (options.initialStatus !== undefined && options.initialStatus !== 'uninitialized') {
            this.serviceState = state('ads', options.initialStatus);
        }
    }

    public async initialize(): Promise<PlatformServiceState> {
        if (this.serviceState.status === 'unavailable' || this.serviceState.status === 'failed') {
            return this.serviceState;
        }

        this.serviceState = state('ads', 'ready');
        return this.serviceState;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState;
    }

    public setPlacement(placementId: RewardedPlacementId, placement: MockRewardedPlacement): void {
        this.placements[placementId] = placement;
    }

    public async getRewardedAvailability(placementId: RewardedPlacementId): Promise<PlatformAvailability> {
        if (this.serviceState.status !== 'ready') {
            return {
                available: false,
                status: this.serviceState.status,
                reason: this.serviceState.reason ?? this.serviceState.status,
            };
        }

        const placement = this.placements[placementId] ?? {};
        const available = placement.available !== false;

        return {
            available,
            status: available ? 'ready' : 'unavailable',
            reason: available ? undefined : placement.reason ?? 'mock_rewarded_unavailable',
        };
    }

    public async preloadRewarded(placementId: RewardedPlacementId): Promise<PlatformOperationResult> {
        const availability = await this.getRewardedAvailability(placementId);

        return {
            ok: availability.available,
            status: availability.status,
            reason: availability.reason,
            message: availability.message,
        };
    }

    public async showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult> {
        const availability = await this.getRewardedAvailability(request.placementId);
        if (!availability.available) {
            return {
                status: 'unavailable',
                placementId: request.placementId,
                requestId: request.requestId,
                rewardVerified: false,
                reason: availability.reason,
            };
        }

        const placement = this.placements[request.placementId] ?? {};
        const resultStatus = placement.showResult ?? 'rewarded';

        return {
            status: resultStatus,
            placementId: request.placementId,
            requestId: request.requestId,
            rewardVerified: resultStatus === 'rewarded',
            reason: resultStatus === 'rewarded' ? undefined : placement.reason ?? `mock_rewarded_${resultStatus}`,
        };
    }
}

export interface MockPurchaseServiceOptions {
    initialStatus?: PlatformServiceStatus;
    products?: ProductDetails[];
    purchaseResults?: Record<string, PurchaseResultStatus>;
}

export class MockPurchaseService implements PurchaseService {
    private serviceState: PlatformServiceState;
    private readonly products = new Map<ProductId, ProductDetails>();
    private readonly purchaseResults: Record<string, PurchaseResultStatus>;

    public constructor(options: MockPurchaseServiceOptions = {}) {
        this.serviceState = state('purchase', options.initialStatus ?? 'uninitialized');
        this.purchaseResults = { ...(options.purchaseResults ?? {}) };

        for (const product of options.products ?? []) {
            this.products.set(product.productId, { ...product });
        }
    }

    public async initialize(): Promise<PlatformServiceState> {
        if (this.serviceState.status === 'unavailable' || this.serviceState.status === 'failed') {
            return this.serviceState;
        }

        this.serviceState = state('purchase', 'ready');
        return this.serviceState;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState;
    }

    public async queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult> {
        if (this.serviceState.status !== 'ready') {
            return {
                ok: false,
                products: [],
                missingProductIds: [...productIds],
                reason: this.serviceState.reason ?? this.serviceState.status,
            };
        }

        const products: ProductDetails[] = [];
        const missingProductIds: ProductId[] = [];

        for (const productId of productIds) {
            const product = this.products.get(productId);
            if (product === undefined) {
                missingProductIds.push(productId);
            } else {
                products.push({ ...product });
            }
        }

        return {
            ok: missingProductIds.length === 0,
            products,
            missingProductIds,
            reason: missingProductIds.length === 0 ? undefined : 'mock_product_missing',
        };
    }

    public async purchase(request: PurchaseRequest): Promise<PurchaseResult> {
        if (this.serviceState.status !== 'ready') {
            return {
                status: 'unavailable',
                productId: request.productId,
                requestId: request.requestId,
                reason: this.serviceState.reason ?? this.serviceState.status,
            };
        }

        if (!this.products.has(request.productId)) {
            return {
                status: 'failed',
                productId: request.productId,
                requestId: request.requestId,
                reason: 'mock_product_missing',
            };
        }

        const resultStatus = this.purchaseResults[request.productId] ?? 'completed';

        return {
            status: resultStatus,
            productId: request.productId,
            requestId: request.requestId,
            transactionId: resultStatus === 'completed' ? `mock-${request.requestId}` : undefined,
            reason: resultStatus === 'completed' ? undefined : `mock_purchase_${resultStatus}`,
        };
    }

    public async restorePurchases(): Promise<PlatformOperationResult> {
        if (this.serviceState.status !== 'ready') {
            return blockedResult(this.serviceState);
        }

        return { ok: true, status: 'ready' };
    }
}

export interface MockEntitlementServiceOptions {
    initialStatus?: PlatformServiceStatus;
    ownedEntitlementIds?: EntitlementId[];
}

export class MockEntitlementService implements EntitlementService {
    private serviceState: PlatformServiceState;
    private readonly ownedEntitlementIds: Set<EntitlementId>;

    public constructor(options: MockEntitlementServiceOptions = {}) {
        this.serviceState = state('entitlement', options.initialStatus ?? 'uninitialized');
        this.ownedEntitlementIds = new Set(options.ownedEntitlementIds ?? []);
    }

    public async initialize(): Promise<PlatformServiceState> {
        if (this.serviceState.status === 'unavailable' || this.serviceState.status === 'failed') {
            return this.serviceState;
        }

        this.serviceState = state('entitlement', 'ready');
        return this.serviceState;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState;
    }

    public async getEntitlementStatus(entitlementId: EntitlementId): Promise<EntitlementStatus> {
        const owned = this.serviceState.status === 'ready' && this.ownedEntitlementIds.has(entitlementId);

        return {
            entitlementId,
            owned,
            source: owned ? 'mock' : 'none',
            reason: this.serviceState.status === 'ready' ? undefined : this.serviceState.status,
        };
    }

    public setMockEntitlement(entitlementId: EntitlementId, owned: boolean): void {
        if (owned) {
            this.ownedEntitlementIds.add(entitlementId);
        } else {
            this.ownedEntitlementIds.delete(entitlementId);
        }
    }

    public async reconcileEntitlements(): Promise<PlatformOperationResult> {
        if (this.serviceState.status !== 'ready') {
            return blockedResult(this.serviceState);
        }

        return { ok: true, status: 'ready' };
    }
}

