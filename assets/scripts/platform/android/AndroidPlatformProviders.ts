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
    ProductDetails,
    ProductDetailsResult,
    PurchaseRequest,
    PurchaseResult,
    PurchaseService,
} from '../../services/PurchaseService';
import { callAutomataStaticString } from './AndroidNativeBridge';

type NativeObject = Record<string, unknown>;

function parseNativeObject(raw: string): NativeObject {
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' ? parsed as NativeObject : {};
    } catch {
        return { ok: false, status: 'failed', reason: 'android_native_bridge_malformed_json' };
    }
}

function stringField(source: NativeObject, key: string, fallback = ''): string {
    const value = source[key];
    return typeof value === 'string' ? value : fallback;
}

function booleanField(source: NativeObject, key: string, fallback = false): boolean {
    const value = source[key];
    return typeof value === 'boolean' ? value : fallback;
}

function productArrayField(source: NativeObject): ProductDetails[] {
    const products = source.products;
    if (!Array.isArray(products)) {
        return [];
    }

    return products
        .filter((product): product is NativeObject => product !== null && typeof product === 'object')
        .map((product) => ({
            productId: stringField(product, 'productId'),
            type: stringField(product, 'type', 'durable') === 'consumable' ? 'consumable' : 'durable',
            available: booleanField(product, 'available'),
            title: stringField(product, 'title') || undefined,
            description: stringField(product, 'description') || undefined,
            localizedPrice: stringField(product, 'localizedPrice') || undefined,
            reason: stringField(product, 'reason') || undefined,
        }))
        .filter((product) => product.productId.length > 0);
}

function stringArrayField(source: NativeObject, key: string): string[] {
    const value = source[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function serviceState(kind: PlatformServiceState['kind'], source: NativeObject): PlatformServiceState {
    return {
        kind,
        status: stringField(source, 'status', 'failed') as PlatformServiceState['status'],
        reason: stringField(source, 'reason') || undefined,
        message: stringField(source, 'message') || undefined,
    };
}

function operationResult(source: NativeObject): PlatformOperationResult {
    return {
        ok: booleanField(source, 'ok'),
        status: stringField(source, 'status', 'failed') as PlatformOperationResult['status'],
        reason: stringField(source, 'reason') || undefined,
        message: stringField(source, 'message') || undefined,
    };
}

export class AndroidAdsService implements AdsService {
    public async initialize(): Promise<PlatformServiceState> {
        return serviceState('ads', parseNativeObject(callAutomataStaticString('initializeAds')));
    }

    public getStatus(): PlatformServiceState {
        return serviceState('ads', parseNativeObject(callAutomataStaticString('getAdsStatus')));
    }

    public async getRewardedAvailability(placementId: RewardedPlacementId): Promise<PlatformAvailability> {
        const source = parseNativeObject(callAutomataStaticString(
            'getRewardedAvailability',
            '(Ljava/lang/String;)Ljava/lang/String;',
            placementId,
        ));

        return {
            available: booleanField(source, 'available'),
            status: stringField(source, 'status', 'failed') as PlatformAvailability['status'],
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
    }

    public async preloadRewarded(placementId: RewardedPlacementId): Promise<PlatformOperationResult> {
        return operationResult(parseNativeObject(callAutomataStaticString(
            'preloadRewarded',
            '(Ljava/lang/String;)Ljava/lang/String;',
            placementId,
        )));
    }

    public async showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult> {
        const source = parseNativeObject(callAutomataStaticString(
            'showRewarded',
            '(Ljava/lang/String;)Ljava/lang/String;',
            JSON.stringify(request),
        ));

        return {
            status: stringField(source, 'status', 'failed') as RewardedAdResult['status'],
            placementId: stringField(source, 'placementId', request.placementId),
            requestId: stringField(source, 'requestId', request.requestId),
            rewardVerified: booleanField(source, 'rewardVerified'),
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
    }
}

export class AndroidPurchaseService implements PurchaseService {
    public async initialize(): Promise<PlatformServiceState> {
        return serviceState('purchase', parseNativeObject(callAutomataStaticString('initializePurchases')));
    }

    public getStatus(): PlatformServiceState {
        return serviceState('purchase', parseNativeObject(callAutomataStaticString('getPurchaseStatus')));
    }

    public async queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult> {
        const source = parseNativeObject(callAutomataStaticString(
            'queryProductDetails',
            '(Ljava/lang/String;)Ljava/lang/String;',
            productIds.join(','),
        ));

        return {
            ok: booleanField(source, 'ok'),
            products: productArrayField(source),
            missingProductIds: stringArrayField(source, 'missingProductIds'),
            reason: stringField(source, 'reason') || undefined,
        };
    }

    public async purchase(request: PurchaseRequest): Promise<PurchaseResult> {
        const source = parseNativeObject(callAutomataStaticString(
            'purchaseProduct',
            '(Ljava/lang/String;)Ljava/lang/String;',
            JSON.stringify(request),
        ));

        return {
            status: stringField(source, 'status', 'failed') as PurchaseResult['status'],
            productId: stringField(source, 'productId', request.productId),
            requestId: stringField(source, 'requestId', request.requestId),
            transactionId: stringField(source, 'transactionId') || undefined,
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
    }

    public async restorePurchases(): Promise<PlatformOperationResult> {
        return operationResult(parseNativeObject(callAutomataStaticString('restorePurchases')));
    }
}

export class AndroidEntitlementService implements EntitlementService {
    public async initialize(): Promise<PlatformServiceState> {
        return serviceState('entitlement', parseNativeObject(callAutomataStaticString('initializeEntitlements')));
    }

    public getStatus(): PlatformServiceState {
        return serviceState('entitlement', parseNativeObject(callAutomataStaticString('getEntitlementServiceStatus')));
    }

    public async getEntitlementStatus(entitlementId: EntitlementId): Promise<EntitlementStatus> {
        const source = parseNativeObject(callAutomataStaticString(
            'getEntitlementStatus',
            '(Ljava/lang/String;)Ljava/lang/String;',
            entitlementId,
        ));

        return {
            entitlementId: stringField(source, 'entitlementId', entitlementId),
            owned: booleanField(source, 'owned'),
            source: stringField(source, 'source', 'none') as EntitlementStatus['source'],
            reason: stringField(source, 'reason') || undefined,
        };
    }

    public async reconcileEntitlements(): Promise<PlatformOperationResult> {
        return operationResult(parseNativeObject(callAutomataStaticString('reconcileEntitlements')));
    }
}

