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
    | 'unavailable';

export interface PurchaseRequest {
    productId: ProductId;
    requestId: string;
}

export interface PurchaseResult {
    status: PurchaseResultStatus;
    productId: ProductId;
    requestId: string;
    transactionId?: string;
    reason?: string;
    message?: string;
}

export interface PurchaseService {
    initialize(): Promise<PlatformServiceState>;
    getStatus(): PlatformServiceState;
    queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult>;
    purchase(request: PurchaseRequest): Promise<PurchaseResult>;
    restorePurchases(): Promise<PlatformOperationResult>;
}

