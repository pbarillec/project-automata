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
import type { PlatformOverlayTracker } from '../../services/PlatformOverlay';
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
import type {
    MockAdScriptStep,
    MockCallRecord,
    MockPurchaseScriptStep,
} from './MockPlatformScript';
import { MockCallGate, MockScriptQueue } from './MockPlatformScript.ts';

interface MockRewardedPlacement {
    available?: boolean;
    showResult?: RewardedAdResultStatus;
    reason?: string;
}

export interface MockAdsServiceOptions {
    initialStatus?: PlatformServiceStatus;
    placements?: Record<string, MockRewardedPlacement>;
    /** When provided, begin/end('rewarded_ad') is reported around every real show. */
    overlay?: PlatformOverlayTracker;
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
    private readonly overlay: PlatformOverlayTracker | undefined;
    private readonly results = new Map<string, Promise<RewardedAdResult>>();

    /** Ordered per-placement outcomes. When empty for a placement, option behaviour applies. */
    public readonly script = new MockScriptQueue<MockAdScriptStep>();
    /** Manual resolver for steps flagged `manual` (deterministic timeouts, no real timers). */
    public readonly gate = new MockCallGate();
    public readonly calls: MockCallRecord[] = [];
    /** Every result handed to the caller, including simulated duplicate callbacks. */
    public readonly deliveries: RewardedAdResult[] = [];

    public constructor(options: MockAdsServiceOptions = {}) {
        this.serviceState = state('ads', 'uninitialized');
        this.placements = { ...(options.placements ?? {}) };
        this.overlay = options.overlay;

        if (options.initialStatus !== undefined && options.initialStatus !== 'uninitialized') {
            this.serviceState = state('ads', options.initialStatus);
        }
    }

    public async initialize(): Promise<PlatformServiceState> {
        this.calls.push({ service: 'ads', method: 'initialize' });

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

    public enqueueOutcomes(placementId: RewardedPlacementId, ...steps: MockAdScriptStep[]): void {
        this.script.enqueue(placementId, ...steps);
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
        this.calls.push({ service: 'ads', method: 'preloadRewarded', key: placementId });
        const availability = await this.getRewardedAvailability(placementId);

        return {
            ok: availability.available,
            status: availability.status,
            reason: availability.reason,
            message: availability.message,
        };
    }

    /**
     * A requestId is single-use: the first result is memoized and any later call with the same
     * requestId returns the same result flagged `duplicate: true` without side effects.
     */
    public showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult> {
        this.calls.push({
            service: 'ads',
            method: 'showRewarded',
            requestId: request.requestId,
            key: request.placementId,
        });

        const memoized = this.results.get(request.requestId);
        if (memoized !== undefined) {
            return memoized.then((first) => {
                const replay: RewardedAdResult = { ...first, duplicate: true };
                this.deliveries.push(replay);
                return replay;
            });
        }

        const pending = this.runShow(request);
        this.results.set(request.requestId, pending);
        return pending;
    }

    private async runShow(request: RewardedAdRequest): Promise<RewardedAdResult> {
        const availability = await this.getRewardedAvailability(request.placementId);
        if (!availability.available) {
            return this.deliver({
                status: 'unavailable',
                placementId: request.placementId,
                requestId: request.requestId,
                rewardVerified: false,
                reason: availability.reason,
            });
        }

        const placement = this.placements[request.placementId] ?? {};
        const step = this.script.next(request.placementId);
        const resultStatus = step?.outcome ?? placement.showResult ?? 'rewarded';
        const reason = resultStatus === 'rewarded'
            ? undefined
            : step?.reason ?? placement.reason ?? `mock_rewarded_${resultStatus}`;

        const result: RewardedAdResult = {
            status: resultStatus,
            placementId: request.placementId,
            requestId: request.requestId,
            rewardVerified: resultStatus === 'rewarded',
            reason,
        };

        if (resultStatus === 'unavailable') {
            return this.deliver(result, step?.duplicateCallback === true);
        }

        this.overlay?.begin('rewarded_ad', request.requestId);
        try {
            if (step?.manual === true) {
                await this.gate.hold(request.requestId);
            }
        } finally {
            this.overlay?.end(request.requestId);
        }

        return this.deliver(result, step?.duplicateCallback === true);
    }

    private deliver(result: RewardedAdResult, duplicateCallback = false): RewardedAdResult {
        this.deliveries.push(result);
        if (duplicateCallback) {
            this.deliveries.push({ ...result, duplicate: true });
        }

        return result;
    }
}

export interface MockPurchaseServiceOptions {
    initialStatus?: PlatformServiceStatus;
    products?: ProductDetails[];
    purchaseResults?: Record<string, PurchaseResultStatus>;
    /** When provided, begin/end('purchase_flow') is reported around every real purchase. */
    overlay?: PlatformOverlayTracker;
    /** AUT-061: what the store query reports (see `onPurchaseDelivery`). */
    restore?: 'owned' | 'not_owned' | 'error';
    /** AUT-061: the product a `restore: 'owned'` query reports (default: the first configured product). */
    restoreProductId?: ProductId;
}

export class MockPurchaseService implements PurchaseService {
    private readonly deliveryHandlers = new Set<(result: PurchaseResult) => void>();
    private restoreMode: 'owned' | 'not_owned' | 'error' | undefined;
    private readonly restoreProductId: ProductId;
    private serviceState: PlatformServiceState;
    private readonly products = new Map<ProductId, ProductDetails>();
    private readonly purchaseResults: Record<string, PurchaseResultStatus>;
    private readonly overlay: PlatformOverlayTracker | undefined;
    private readonly results = new Map<string, Promise<PurchaseResult>>();

    /** Ordered per-product outcomes. When empty for a product, option behaviour applies. */
    public readonly script = new MockScriptQueue<MockPurchaseScriptStep>();
    /** Manual resolver for steps flagged `manual` (deterministic timeouts, no real timers). */
    public readonly gate = new MockCallGate();
    public readonly calls: MockCallRecord[] = [];
    /** Every result handed to the caller, including simulated duplicate callbacks. */
    public readonly deliveries: PurchaseResult[] = [];

    public constructor(options: MockPurchaseServiceOptions = {}) {
        this.serviceState = state('purchase', options.initialStatus ?? 'uninitialized');
        this.purchaseResults = { ...(options.purchaseResults ?? {}) };
        this.overlay = options.overlay;
        this.restoreMode = options.restore;

        for (const product of options.products ?? []) {
            this.products.set(product.productId, { ...product });
        }
        this.restoreProductId = options.restoreProductId ?? options.products?.[0]?.productId ?? 'founder_pack';
    }

    public async initialize(): Promise<PlatformServiceState> {
        this.calls.push({ service: 'purchases', method: 'initialize' });

        if (this.serviceState.status === 'unavailable' || this.serviceState.status === 'failed') {
            return this.serviceState;
        }

        this.serviceState = state('purchase', 'ready');
        return this.serviceState;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState;
    }

    public enqueueOutcomes(productId: ProductId, ...steps: MockPurchaseScriptStep[]): void {
        this.script.enqueue(productId, ...steps);
    }

    public async queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult> {
        this.calls.push({ service: 'purchases', method: 'queryProductDetails' });

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

    /**
     * A requestId is single-use: the first result (and its transactionId) is memoized and any
     * later call with the same requestId returns it flagged `duplicate: true`.
     */
    public purchase(request: PurchaseRequest): Promise<PurchaseResult> {
        this.calls.push({
            service: 'purchases',
            method: 'purchase',
            requestId: request.requestId,
            key: request.productId,
        });

        const memoized = this.results.get(request.requestId);
        if (memoized !== undefined) {
            return memoized.then((first) => {
                const replay: PurchaseResult = { ...first, duplicate: true };
                this.deliveries.push(replay);
                return replay;
            });
        }

        const pending = this.runPurchase(request);
        this.results.set(request.requestId, pending);
        return pending;
    }

    private async runPurchase(request: PurchaseRequest): Promise<PurchaseResult> {
        if (this.serviceState.status !== 'ready') {
            return this.deliver({
                status: 'unavailable',
                productId: request.productId,
                requestId: request.requestId,
                reason: this.serviceState.reason ?? this.serviceState.status,
            });
        }

        if (!this.products.has(request.productId)) {
            return this.deliver({
                status: 'failed',
                productId: request.productId,
                requestId: request.requestId,
                reason: 'mock_product_missing',
            });
        }

        const step = this.script.next(request.productId);
        const resultStatus = step?.outcome ?? this.purchaseResults[request.productId] ?? 'completed';
        const result: PurchaseResult = {
            status: resultStatus,
            productId: request.productId,
            requestId: request.requestId,
            transactionId: resultStatus === 'completed'
                ? step?.transactionId ?? `mock-${request.requestId}`
                : undefined,
            reason: resultStatus === 'completed' ? undefined : step?.reason ?? `mock_purchase_${resultStatus}`,
        };

        if (resultStatus === 'unavailable') {
            return this.deliver(result, step?.duplicateCallback === true);
        }

        this.overlay?.begin('purchase_flow', request.requestId);
        try {
            if (step?.manual === true) {
                await this.gate.hold(request.requestId);
            }
        } finally {
            this.overlay?.end(request.requestId);
        }

        return this.deliver(result, step?.duplicateCallback === true);
    }

    private deliver(result: PurchaseResult, duplicateCallback = false): PurchaseResult {
        this.deliveries.push(result);
        if (duplicateCallback) {
            this.deliveries.push({ ...result, duplicate: true });
        }

        return result;
    }

    /**
     * AUT-061: a restore-capable mock store. `restore: 'owned'` makes every store query deliver the Founder pack as an already acknowledged owned
     * purchase (`already_owned`, restore semantics) through the delivery handlers; `'not_owned'` delivers nothing; `'error'` fails the query.
     * Without the option the query only answers ok (the AUT-059 behaviour).
     */
    public onPurchaseDelivery(handler: (result: PurchaseResult) => void): () => void {
        this.deliveryHandlers.add(handler);
        return () => {
            this.deliveryHandlers.delete(handler);
        };
    }

    /** AUT-061: changes what the next store queries report (e.g. a purchase completed outside the app). */
    public setRestoreMode(mode: 'owned' | 'not_owned' | 'error' | undefined): void {
        this.restoreMode = mode;
    }

    public async restorePurchases(): Promise<PlatformOperationResult> {
        this.calls.push({ service: 'purchases', method: 'restorePurchases' });

        if (this.serviceState.status !== 'ready') {
            return blockedResult(this.serviceState);
        }

        if (this.restoreMode === 'error') {
            return { ok: false, status: 'failed', reason: 'mock_restore_error' };
        }

        if (this.restoreMode === 'owned') {
            const result: PurchaseResult = {
                status: 'already_owned',
                productId: this.restoreProductId,
                requestId: `mock-restore:${this.restoreProductId}`,
                transactionId: `mock-restore-order-${this.restoreProductId}`,
            };
            this.deliveries.push(result);
            for (const handler of [...this.deliveryHandlers]) {
                try {
                    handler({ ...result });
                } catch {
                    // a consumer error never breaks the provider
                }
            }
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
