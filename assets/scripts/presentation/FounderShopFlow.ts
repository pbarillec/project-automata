import type { LifecycleFounderResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import type { FounderEntitlementSource, FounderOfferStatus } from '../monetization/FounderOffer.ts';
import { PRODUCTS } from '../services/PlatformServiceTypes.ts';
import type { ProductDetails, PurchaseResult, PurchaseService } from '../services/PurchaseService';

/**
 * AUT-059 pure Founder's Factory Pack shop flow (engine-free, no `cc`). Mirrors ExtendedOverclockFlow.
 *
 * Truths: the OFFER status (locked / available / owned) comes from the session (the authoritative state); the PRICE text comes ONLY from the
 * store product metadata (`ProductDetails.localizedPrice`, never invented, never hardcoded); the purchase RESULT comes from the PurchaseService.
 * The flow never grants anything itself: a completed delivery is handed to the session (`applyFounderPackPurchase`, AUT-058) and only an
 * `applied_saved` / `already_applied` answer counts as delivered (the optional `acknowledge` hook, used by the later Billing provider, runs
 * only after that, so a crash between payment and grant is redelivered as a purchase). Cancel / fail / unavailable grant nothing; a pending
 * purchase grants nothing until the store confirms it. Duplicate taps and duplicate callbacks are idempotent.
 */

export type FounderShopOffer = 'unknown' | 'locked' | 'available' | 'owned';
/** `unavailable`: the store service cannot sell (NoOp / failed / unavailable provider) -> the entry stays hidden. */
export type FounderShopStore = 'unknown' | 'loading' | 'ready' | 'unavailable';
export type FounderShopPurchase = 'idle' | 'in_flight' | 'pending';
export type FounderShopNote = 'cancelled' | 'failed' | 'unavailable' | 'not_saved';
export type FounderShopOutcome = 'purchased' | 'already_owned' | 'pending' | 'cancelled' | 'failed' | 'unavailable' | 'not_saved' | 'duplicate';

export interface FounderShopFlowState {
    readonly offer: FounderShopOffer;
    readonly store: FounderShopStore;
    /** The store's localized price text (verbatim metadata), or null when missing / loading. */
    readonly price: string | null;
    readonly purchase: FounderShopPurchase;
    /** A calm, non-red message about the last attempt; cleared by `dismissNote()` / the next attempt. */
    readonly note: FounderShopNote | null;
}

/** The session surface the flow needs (structurally the binding's founder methods). */
export interface FounderShopSessionPort {
    getFounderOfferStatus(): FounderOfferStatus | null;
    applyFounderPackPurchase(request: { readonly requestId: string; readonly source: FounderEntitlementSource }): Promise<LifecycleFounderResult | null>;
    reconcileFounderEntitlement(report: { readonly owned: boolean | null; readonly source: FounderEntitlementSource }): Promise<LifecycleFounderResult | null>;
}

export type FounderShopDiagnostic = (phase: string, payload: Record<string, unknown>) => void;

export interface FounderShopFlowOptions {
    readonly purchases: PurchaseService;
    readonly session: FounderShopSessionPort;
    /** 'mock' only for the DEBUG mock provider, otherwise 'store'. */
    readonly entitlementSource: FounderEntitlementSource;
    /** Epoch milliseconds; stamps the per-attempt request id and the product cache. */
    readonly now: () => number;
    readonly onChange?: () => void;
    readonly onDiagnostic?: FounderShopDiagnostic;
    /** Called (once per delivery) only AFTER the session answered applied_saved / already_applied. The store acknowledge belongs here (AUT-060). */
    readonly acknowledge?: (result: PurchaseResult) => Promise<void> | void;
}

/** A found price is trusted this long; a missing one is re-read sooner. */
export const FOUNDER_SHOP_PRODUCT_TTL_MS = 30_000;
export const FOUNDER_SHOP_PRODUCT_RETRY_MS = 4_000;

const MAX_PRICE_LENGTH = 48;

/** The store's localized price verbatim (trimmed), or null when the product is missing / unavailable / has no usable price. */
export function readFounderPrice(product: ProductDetails | undefined): string | null {
    if (!product || product.available === false) return null;
    const text = typeof product.localizedPrice === 'string' ? product.localizedPrice.trim() : '';
    return text.length > 0 && text.length <= MAX_PRICE_LENGTH ? text : null;
}

export class FounderShopFlow {
    private readonly purchases: PurchaseService;
    private readonly session: FounderShopSessionPort;
    private readonly source: FounderEntitlementSource;
    private readonly now: () => number;
    private readonly onChange: (() => void) | undefined;
    private readonly onDiagnostic: FounderShopDiagnostic | undefined;
    private readonly acknowledge: ((result: PurchaseResult) => Promise<void> | void) | undefined;
    private offer: FounderShopOffer = 'unknown';
    private store: FounderShopStore = 'unknown';
    private price: string | null = null;
    private note: FounderShopNote | null = null;
    private inFlight = false;
    private pending = false;
    private attemptSeq = 0;
    private refreshToken = 0;
    private productReadAtMs: number | null = null;
    private lastRefreshSignature = '';
    private readonly inProgress = new Set<string>();
    private readonly delivered = new Set<string>();

    public constructor(options: FounderShopFlowOptions) {
        this.purchases = options.purchases;
        this.session = options.session;
        this.source = options.entitlementSource;
        this.now = options.now;
        this.onChange = options.onChange;
        this.onDiagnostic = options.onDiagnostic;
        this.acknowledge = options.acknowledge;
    }

    public getState(): FounderShopFlowState {
        return Object.freeze({
            offer: this.offer,
            store: this.store,
            price: this.price,
            purchase: this.inFlight ? 'in_flight' : this.pending ? 'pending' : 'idle',
            note: this.note,
        });
    }

    public dismissNote(): void {
        if (this.note === null) return;
        this.note = null;
        this.onChange?.();
    }

    /** Re-reads the session offer and, only while the offer is available, the store product metadata. The latest call wins. */
    public async refresh(options: { readonly force?: boolean } = {}): Promise<FounderShopFlowState> {
        const token = ++this.refreshToken;
        let status: FounderOfferStatus | null = null;
        try {
            status = this.session.getFounderOfferStatus();
        }
        catch {
            status = null;
        }
        const offer: FounderShopOffer = status === null ? 'unknown' : status === 'locked' ? 'locked' : status === 'owned' ? 'owned' : 'available';
        let store: FounderShopStore = this.store;
        let price = this.price;
        if (offer === 'available') {
            const serviceStatus = this.safeServiceStatus();
            if (serviceStatus === 'unavailable' || serviceStatus === 'failed') {
                store = 'unavailable';
                price = null;
                this.productReadAtMs = null;
            }
            else if (serviceStatus !== 'ready') {
                store = 'loading';
                price = null;
                this.productReadAtMs = null;
            }
            else {
                const nowMs = this.now();
                const ttl = price === null ? FOUNDER_SHOP_PRODUCT_RETRY_MS : FOUNDER_SHOP_PRODUCT_TTL_MS;
                const stale = this.productReadAtMs === null || options.force === true || !(nowMs - this.productReadAtMs < ttl);
                if (stale) {
                    if (store !== 'ready') store = 'loading';
                    try {
                        const details = await this.purchases.queryProductDetails([PRODUCTS.founderPack]);
                        price = readFounderPrice(details.products.find((product) => product.productId === PRODUCTS.founderPack));
                    }
                    catch {
                        price = null;
                    }
                    store = 'ready';
                    this.productReadAtMs = nowMs;
                }
                else {
                    store = 'ready';
                }
            }
        }
        else if (offer === 'owned' || offer === 'locked') {
            price = null;
            store = 'unknown';
            this.productReadAtMs = null;
        }
        if (token !== this.refreshToken) return this.getState();
        this.offer = offer;
        this.store = store;
        this.price = price;
        if (offer === 'owned') this.pending = false;
        const signature = `${offer}|${store}|${price ?? ''}|${this.pending}`;
        if (signature !== this.lastRefreshSignature) {
            this.lastRefreshSignature = signature;
            this.emit('refresh', { offer, store, priceShown: price !== null, price, pending: this.pending });
        }
        this.onChange?.();
        return this.getState();
    }

    /** Starts the purchase through the PurchaseService. Null when not purchasable right now or already in flight (duplicate taps are no-ops). */
    public async buy(): Promise<FounderShopOutcome | null> {
        if (this.inFlight || this.pending) return null;
        if (this.offer !== 'available' || this.store !== 'ready' || this.price === null) return null;
        this.inFlight = true;
        this.note = null;
        this.onChange?.();
        this.attemptSeq += 1;
        const requestId = `${PRODUCTS.founderPack}:${this.now()}:${this.attemptSeq}`;
        let outcome: FounderShopOutcome = 'failed';
        try {
            this.emit('purchase_started', { requestId });
            const result = await this.purchases.purchase({ productId: PRODUCTS.founderPack, requestId });
            outcome = await this.handleResult(result);
        }
        catch {
            outcome = 'failed';
            this.note = 'failed';
        }
        this.inFlight = false;
        await this.refresh({ force: true });
        return outcome;
    }

    /**
     * A purchase delivery (the result of `buy`, or a later store callback / redelivery). Idempotent per transaction (or request) id:
     * an already delivered or in-progress delivery is ignored.
     */
    public async deliver(result: PurchaseResult): Promise<FounderShopOutcome> {
        const outcome = await this.handleResult(result);
        await this.refresh({ force: true });
        return outcome;
    }

    private async handleResult(result: PurchaseResult): Promise<FounderShopOutcome> {
        const key = result.transactionId ?? result.requestId;
        this.emit('purchase_result', { status: result.status, requestId: result.requestId, transactionId: result.transactionId ?? null, duplicate: result.duplicate === true, reason: result.reason ?? null });
        if (result.duplicate === true || this.delivered.has(key) || this.inProgress.has(key)) {
            this.emit('duplicate_ignored', { requestId: result.requestId, transactionId: result.transactionId ?? null });
            return 'duplicate';
        }
        switch (result.status) {
            case 'completed':
                return this.apply(result, key, false);
            case 'already_owned':
                return this.apply(result, key, true);
            case 'pending':
                this.pending = true;
                this.note = null;
                this.emit('pending', { requestId: result.requestId });
                return 'pending';
            case 'cancelled':
                this.note = 'cancelled';
                return 'cancelled';
            case 'unavailable':
                this.note = 'unavailable';
                return 'unavailable';
            case 'failed':
            case 'timeout':
            default:
                this.note = 'failed';
                return 'failed';
        }
    }

    /** Hands a completed / already-owned delivery to the session; only a durable answer counts as delivered (and may be acknowledged). */
    private async apply(result: PurchaseResult, key: string, restoreOnly: boolean): Promise<FounderShopOutcome> {
        this.inProgress.add(key);
        try {
            let applied: LifecycleFounderResult | null = null;
            try {
                applied = restoreOnly
                    ? await this.session.reconcileFounderEntitlement({ owned: true, source: this.source })
                    : await this.session.applyFounderPackPurchase({ requestId: result.requestId, source: this.source });
            }
            catch {
                applied = null;
            }
            this.emit('applied', { status: applied?.status ?? 'error', restoreOnly, requestId: result.requestId });
            if (applied === null || applied.status === 'rejected') {
                this.note = 'failed';
                return 'failed';
            }
            if (applied.status === 'applied_persistence_failed') {
                // In memory only: nothing is acknowledged, a later delivery retries the save path.
                this.note = 'not_saved';
                this.pending = false;
                return 'not_saved';
            }
            this.delivered.add(key);
            this.pending = false;
            this.note = null;
            if (!restoreOnly && this.acknowledge) {
                try {
                    await this.acknowledge(result);
                    this.emit('acknowledged', { requestId: result.requestId });
                }
                catch {
                    this.emit('acknowledge_failed', { requestId: result.requestId });
                }
            }
            return restoreOnly ? 'already_owned' : 'purchased';
        }
        finally {
            this.inProgress.delete(key);
        }
    }

    private safeServiceStatus(): string {
        try {
            return this.purchases.getStatus().status;
        }
        catch {
            return 'failed';
        }
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        try {
            this.onDiagnostic?.(phase, payload);
        }
        catch {
            // diagnostics never affect the flow
        }
    }
}
