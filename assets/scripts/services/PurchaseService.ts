import type {
    PlatformOperationResult,
    PlatformServiceState,
    ProductId,
} from './PlatformServiceTypes';

export type PurchaseProductType = 'durable' | 'consumable';

export interface ProductDetails {
    productId: ProductId;
    type: PurchaseProductType;
    available: boolean;
    title?: string;
    description?: string;
    localizedPrice?: string;
    reason?: string;
}

export interface ProductDetailsResult {
    ok: boolean;
    products: ProductDetails[];
    missingProductIds: ProductId[];
    reason?: string;
}

export type PurchaseResultStatus =
    | 'completed'
    | 'cancelled'
    | 'pending'
    | 'failed'
    | 'unavailable'
    | 'timeout'
    | 'already_owned';

export interface PurchaseRequest {
    productId: ProductId;
    requestId: string;
}

export interface PurchaseResult {
    status: PurchaseResultStatus;
    productId: ProductId;
    requestId: string;
    transactionId?: string;
    /** AUT-060: the store purchase token (opaque). Needed only to acknowledge; never shown, never persisted in the save. */
    purchaseToken?: string;
    reason?: string;
    message?: string;
    /** True when this is a replay of an already-delivered result for the same requestId. */
    duplicate?: boolean;
}

export interface PurchaseService {
    initialize(): Promise<PlatformServiceState>;
    getStatus(): PlatformServiceState;
    queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult>;
    purchase(request: PurchaseRequest): Promise<PurchaseResult>;
    restorePurchases(): Promise<PlatformOperationResult>;
    /**
     * AUT-060 (optional, real store providers only): purchases that arrive OUTSIDE a `purchase()` call (a pending purchase that completes later,
     * a late result after a timeout, or the redelivery of an unacknowledged purchase found by the store query). The handler must route them
     * through the same grant path as a normal purchase and acknowledge only after the grant is durable. Returns the unsubscribe function.
     */
    onPurchaseDelivery?(handler: (result: PurchaseResult) => void): () => void;
    /** AUT-060 (optional): acknowledges a delivered purchase with the store. Call ONLY after the entitlement is durably applied. */
    acknowledgePurchase?(result: PurchaseResult): Promise<PlatformOperationResult>;
}

