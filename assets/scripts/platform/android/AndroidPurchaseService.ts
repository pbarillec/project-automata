import type { PlatformOverlayTracker } from '../../services/PlatformOverlay';
import type {
    PlatformOperationResult,
    PlatformServiceState,
    PlatformServiceStatus,
    ProductId,
} from '../../services/PlatformServiceTypes';
import type {
    ProductDetails,
    ProductDetailsResult,
    PurchaseRequest,
    PurchaseResult,
    PurchaseResultStatus,
    PurchaseService,
} from '../../services/PurchaseService';

/**
 * AUT-060 Android Google Play Billing provider (pure, engine-free: no `cc`, no native class names). The real transport is injected by
 * AndroidNativeBridge.ts; tests inject a scripted fake one.
 *
 * Wire protocol with the native AutomataBillingController (every native call returns a JSON string at once; slow work is START-THEN-EVENT):
 *   initializePurchases()            -> {ok,status:initializing|ready|unavailable|failed,reason?}; later `automata.billing.state` {status,reason?}
 *   getPurchaseStatus()              -> {ok,status,reason?}                                        (synchronous snapshot)
 *   queryProductDetails(csv)         -> {status:started} | terminal {ok:false,status,reason}      ; event `automata.billing.product_details`
 *                                       {ok,products:[{productId,type,available,title,description,localizedPrice,reason}],missingProductIds,reason?}
 *   purchaseProduct({productId,requestId}) -> {status:started} | terminal {status:unavailable|failed|already_owned,...}
 *                                     ; event `automata.billing.purchase_result` {status,productId,requestId,transactionId?,purchaseToken?,reason?,message?}
 *   acknowledgePurchase({purchaseToken}) -> {status:started} | terminal {ok:false,reason}         ; event `automata.billing.acknowledge_result`
 *                                       {purchaseToken,ok,status:acknowledged|already_acknowledged|failed,reason?}
 *   restorePurchases()               -> {status:started} | terminal {ok:false,...}                ; events `automata.billing.purchase_result` (one per
 *                                       owned purchase, requestId "" = outside any flow) then `automata.billing.query_result` {ok,status,count,reason?}
 *
 * Rules (TECHNICAL_DESIGN 23.8 / AUT-058):
 * - `completed` is reported only for a PURCHASED, not yet acknowledged purchase that carries a purchase token. An already acknowledged owned
 *   purchase is reported as `already_owned` (restore semantics: never re-grants Surges).
 * - This provider NEVER acknowledges by itself: `acknowledgePurchase` is called by the grant flow only after the entitlement is durably applied.
 * - Purchases arriving outside a `purchase()` call (pending that completes later, a result after the backstop timeout, the redelivery of an
 *   unacknowledged purchase) go to the `onPurchaseDelivery` handlers, so they take the same grant-then-acknowledge path. Nothing is ever lost
 *   because the JS backstop timed out: the store keeps the purchase unacknowledged and the next query redelivers it.
 * - The platform overlay (`purchase_flow`) is begun BEFORE the native call and ended BEFORE the promise resolves.
 * - Nothing here throws into the flows: every failure resolves `unavailable | failed | timeout`.
 */
export const ANDROID_BILLING_STATE_EVENT = 'automata.billing.state';
export const ANDROID_BILLING_PRODUCTS_EVENT = 'automata.billing.product_details';
export const ANDROID_BILLING_PURCHASE_EVENT = 'automata.billing.purchase_result';
export const ANDROID_BILLING_ACK_EVENT = 'automata.billing.acknowledge_result';
export const ANDROID_BILLING_QUERY_EVENT = 'automata.billing.query_result';

/** No final purchase result this long after `started` -> resolve `timeout` (the Play sheet can legitimately stay open for minutes). */
export const ANDROID_BILLING_PURCHASE_TIMEOUT_MS = 10 * 60_000;
/** Init / product query / acknowledge / restore query backstop. */
export const ANDROID_BILLING_OPERATION_TIMEOUT_MS = 20_000;
export const ANDROID_BILLING_USED_REQUEST_LIMIT = 64;

export interface AndroidBillingTransport {
    /** Synchronous native call returning the raw JSON string. */
    callString(method: string, signature: string, ...args: string[]): string;
    /** Subscribes to a native-to-script event; returns the unsubscribe function. */
    subscribe(event: string, handler: (payload: string) => void): () => void;
}

export type AndroidBillingTimer = (callback: () => void, delayMs: number) => () => void;
export type AndroidBillingDiagnostic = (phase: string, payload: Record<string, unknown>) => void;

export interface AndroidBillingServiceOptions {
    readonly transport: AndroidBillingTransport;
    readonly overlay?: PlatformOverlayTracker;
    readonly schedule?: AndroidBillingTimer;
    readonly purchaseTimeoutMs?: number;
    readonly operationTimeoutMs?: number;
    readonly onDiagnostic?: AndroidBillingDiagnostic;
}

type NativeObject = Record<string, unknown>;

const STRING_SIGNATURE = '(Ljava/lang/String;)Ljava/lang/String;';
const PURCHASE_STATUSES: readonly PurchaseResultStatus[] = ['completed', 'cancelled', 'pending', 'failed', 'unavailable', 'timeout', 'already_owned'];
/** Statuses that are forwarded to the delivery handlers when no `purchase()` call is waiting for them. */
const DELIVERABLE_STATUSES: readonly PurchaseResultStatus[] = ['completed', 'pending', 'already_owned'];
const SERVICE_STATUSES: readonly PlatformServiceStatus[] = ['uninitialized', 'initializing', 'ready', 'unavailable', 'failed'];

function defaultSchedule(callback: () => void, delayMs: number): () => void {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
}

function parseNativeObject(raw: unknown): NativeObject {
    if (typeof raw !== 'string') return { ok: false, status: 'failed', reason: 'android_native_bridge_invalid_response' };
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as NativeObject
            : { ok: false, status: 'failed', reason: 'android_native_bridge_malformed_json' };
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

function serviceStatus(source: NativeObject): PlatformServiceStatus {
    const status = stringField(source, 'status', 'failed');
    return (SERVICE_STATUSES as readonly string[]).includes(status) ? status as PlatformServiceStatus : 'failed';
}

function productsField(source: NativeObject): ProductDetails[] {
    const products = source.products;
    if (!Array.isArray(products)) return [];
    return products
        .filter((product): product is NativeObject => product !== null && typeof product === 'object')
        .map((product) => ({
            productId: stringField(product, 'productId'),
            type: stringField(product, 'type', 'durable') === 'consumable' ? 'consumable' as const : 'durable' as const,
            available: booleanField(product, 'available'),
            title: stringField(product, 'title') || undefined,
            description: stringField(product, 'description') || undefined,
            localizedPrice: stringField(product, 'localizedPrice') || undefined,
            reason: stringField(product, 'reason') || undefined,
        }))
        .filter((product) => product.productId.length > 0);
}

interface PendingPurchase {
    readonly request: PurchaseRequest;
    readonly resolve: (result: PurchaseResult) => void;
    cancelTimer: (() => void) | null;
}

interface Waiter<T> {
    readonly match: (payload: NativeObject) => boolean;
    readonly resolve: (value: T | null) => void;
    readonly map: (payload: NativeObject) => T;
    cancelTimer: (() => void) | null;
}

export class AndroidPurchaseService implements PurchaseService {
    private readonly transport: AndroidBillingTransport;
    private readonly overlay: PlatformOverlayTracker | undefined;
    private readonly schedule: AndroidBillingTimer;
    private readonly purchaseTimeoutMs: number;
    private readonly operationTimeoutMs: number;
    private readonly onDiagnostic: AndroidBillingDiagnostic | undefined;
    private readonly pending = new Map<string, PendingPurchase>();
    /** requestId -> first delivered result (bounded); a later purchase with the same id is a no-op duplicate. */
    private readonly used = new Map<string, PurchaseResult>();
    private readonly handlers = new Set<(result: PurchaseResult) => void>();
    private readonly stateWaiters: Waiter<PlatformServiceState>[] = [];
    private readonly productWaiters: Waiter<ProductDetailsResult>[] = [];
    private readonly ackWaiters: Waiter<PlatformOperationResult>[] = [];
    private readonly queryWaiters: Waiter<PlatformOperationResult>[] = [];
    private readonly acknowledged = new Set<string>();
    private readonly acknowledging = new Map<string, Promise<PlatformOperationResult>>();
    private unsubscribers: Array<() => void> = [];
    private subscribed = false;

    public constructor(options: AndroidBillingServiceOptions) {
        this.transport = options.transport;
        this.overlay = options.overlay;
        this.schedule = options.schedule ?? defaultSchedule;
        this.purchaseTimeoutMs = options.purchaseTimeoutMs ?? ANDROID_BILLING_PURCHASE_TIMEOUT_MS;
        this.operationTimeoutMs = options.operationTimeoutMs ?? ANDROID_BILLING_OPERATION_TIMEOUT_MS;
        this.onDiagnostic = options.onDiagnostic;
    }

    // ------------------------------------------------------------------ service state

    /** Starts (or re-starts after a failure) the native connection and waits for the first terminal state (ready / unavailable / failed). */
    public async initialize(): Promise<PlatformServiceState> {
        this.ensureSubscribed();
        const waiter = this.waitFor(this.stateWaiters, (payload) => serviceStatus(payload) !== 'initializing' && serviceStatus(payload) !== 'uninitialized', (payload) => this.toState(payload));
        const first = this.safeCall('initializePurchases');
        const state = this.toState(first);
        if (state.status !== 'initializing' && state.status !== 'uninitialized') {
            this.cancelWaiter(this.stateWaiters, waiter.entry);
            this.diagnostic('init', { status: state.status, reason: state.reason ?? null });
            return state;
        }
        const settled = await waiter.promise ?? this.toState({ status: 'failed', reason: 'billing_init_timeout' });
        this.diagnostic('init', { status: settled.status, reason: settled.reason ?? null });
        return settled;
    }

    public getStatus(): PlatformServiceState {
        return this.toState(this.safeCall('getPurchaseStatus'));
    }

    // ------------------------------------------------------------------ product metadata (price truth = the store)

    public async queryProductDetails(productIds: ProductId[]): Promise<ProductDetailsResult> {
        this.ensureSubscribed();
        const ids = productIds.filter((id) => typeof id === 'string' && id.length > 0);
        const failed = (reason: string): ProductDetailsResult => ({ ok: false, products: [], missingProductIds: ids, reason });
        const waiter = this.waitFor(this.productWaiters, () => true, (payload): ProductDetailsResult => ({
            ok: booleanField(payload, 'ok'),
            products: productsField(payload),
            missingProductIds: Array.isArray(payload.missingProductIds) ? payload.missingProductIds.filter((item): item is string => typeof item === 'string') : [],
            reason: stringField(payload, 'reason') || undefined,
        }));
        const started = this.safeCall('queryProductDetails', STRING_SIGNATURE, ids.join(','));
        if (stringField(started, 'status') !== 'started') {
            this.cancelWaiter(this.productWaiters, waiter.entry);
            return failed(stringField(started, 'reason') || 'billing_unavailable');
        }
        return (await waiter.promise) ?? failed('product_details_timeout');
    }

    // ------------------------------------------------------------------ purchase

    public purchase(request: PurchaseRequest): Promise<PurchaseResult> {
        const { productId, requestId } = request;
        const first = this.used.get(requestId);
        if (first !== undefined || this.pending.has(requestId)) {
            return Promise.resolve({
                status: first?.status ?? 'failed',
                productId,
                requestId,
                reason: first?.reason ?? 'duplicate_request_id',
                duplicate: true,
            });
        }
        return new Promise<PurchaseResult>((resolve) => {
            const entry: PendingPurchase = { request, resolve, cancelTimer: null };
            this.pending.set(requestId, entry);
            this.ensureSubscribed();
            this.overlay?.begin('purchase_flow', requestId);
            let started: NativeObject;
            try {
                started = parseNativeObject(this.transport.callString('purchaseProduct', STRING_SIGNATURE, JSON.stringify(request)));
            } catch {
                this.finish(requestId, this.build(request, 'failed', 'android_native_call_failed'));
                return;
            }
            if (!this.pending.has(requestId)) return; // an early result event already completed it
            if (stringField(started, 'status') === 'started') {
                this.diagnostic('native_started', { productId, requestId });
                entry.cancelTimer = this.schedule(() => {
                    this.finish(requestId, this.build(request, 'timeout', 'android_purchase_timeout'));
                }, this.purchaseTimeoutMs);
                return;
            }
            // A terminal immediate answer (unavailable / failed / already_owned ...): no sheet was shown.
            this.finish(requestId, this.toResult(request, started));
        });
    }

    // ------------------------------------------------------------------ acknowledge / restore / deliveries

    /** Acknowledges a delivered purchase. The CALLER guarantees the entitlement is already durably applied; this method never decides that. */
    public acknowledgePurchase(result: PurchaseResult): Promise<PlatformOperationResult> {
        const token = result.purchaseToken ?? '';
        if (token.length === 0) {
            return Promise.resolve({ ok: false, status: 'failed', reason: 'missing_purchase_token' });
        }
        if (this.acknowledged.has(token)) {
            return Promise.resolve({ ok: true, status: 'ready', reason: 'already_acknowledged' });
        }
        const inFlight = this.acknowledging.get(token);
        if (inFlight !== undefined) return inFlight;
        const operation = this.runAcknowledge(token).finally(() => {
            this.acknowledging.delete(token);
        });
        this.acknowledging.set(token, operation);
        return operation;
    }

    /** The store query hook (AUT-061 owns the restore flow): every owned purchase is delivered through `onPurchaseDelivery`. */
    public async restorePurchases(): Promise<PlatformOperationResult> {
        this.ensureSubscribed();
        const fail = (status: PlatformServiceStatus, reason: string): PlatformOperationResult => ({ ok: false, status, reason });
        const waiter = this.waitFor(this.queryWaiters, () => true, (payload): PlatformOperationResult => ({
            ok: booleanField(payload, 'ok'),
            status: booleanField(payload, 'ok') ? 'ready' : serviceStatus(payload),
            reason: stringField(payload, 'reason') || undefined,
        }));
        const started = this.safeCall('restorePurchases');
        if (stringField(started, 'status') !== 'started') {
            this.cancelWaiter(this.queryWaiters, waiter.entry);
            return fail(serviceStatus(started) === 'ready' ? 'failed' : serviceStatus(started), stringField(started, 'reason') || 'billing_unavailable');
        }
        return (await waiter.promise) ?? fail('failed', 'purchase_query_timeout');
    }

    public onPurchaseDelivery(handler: (result: PurchaseResult) => void): () => void {
        this.ensureSubscribed();
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    /** Releases the native event subscriptions (tests / teardown). */
    public dispose(): void {
        for (const unsubscribe of this.unsubscribers) {
            try { unsubscribe(); } catch { /* teardown never throws */ }
        }
        this.unsubscribers = [];
        this.subscribed = false;
    }

    // ------------------------------------------------------------------ internals

    private async runAcknowledge(token: string): Promise<PlatformOperationResult> {
        this.ensureSubscribed();
        const waiter = this.waitFor(this.ackWaiters, (payload) => stringField(payload, 'purchaseToken') === token, (payload): PlatformOperationResult => {
            const ok = booleanField(payload, 'ok');
            return { ok, status: ok ? 'ready' : 'failed', reason: stringField(payload, 'reason') || stringField(payload, 'status') || undefined };
        });
        const started = this.safeCall('acknowledgePurchase', STRING_SIGNATURE, JSON.stringify({ purchaseToken: token }));
        if (stringField(started, 'status') !== 'started') {
            this.cancelWaiter(this.ackWaiters, waiter.entry);
            return { ok: false, status: 'failed', reason: stringField(started, 'reason') || 'acknowledge_not_started' };
        }
        const result = (await waiter.promise) ?? { ok: false, status: 'failed' as const, reason: 'acknowledge_timeout' };
        if (result.ok) {
            this.acknowledged.add(token);
            this.diagnostic('acknowledged', { reason: result.reason ?? null });
        } else {
            this.diagnostic('acknowledge_failed', { reason: result.reason ?? null });
        }
        return result;
    }

    private ensureSubscribed(): void {
        if (this.subscribed) return;
        this.subscribed = true;
        const subscribe = (event: string, handler: (payload: NativeObject) => void): void => {
            try {
                this.unsubscribers.push(this.transport.subscribe(event, (raw) => handler(parseNativeObject(raw))));
            } catch {
                // Pending operations then end through their backstop timeouts.
            }
        };
        subscribe(ANDROID_BILLING_STATE_EVENT, (payload) => this.settle(this.stateWaiters, payload));
        subscribe(ANDROID_BILLING_PRODUCTS_EVENT, (payload) => this.settle(this.productWaiters, payload));
        subscribe(ANDROID_BILLING_ACK_EVENT, (payload) => this.settle(this.ackWaiters, payload));
        subscribe(ANDROID_BILLING_QUERY_EVENT, (payload) => this.settle(this.queryWaiters, payload));
        subscribe(ANDROID_BILLING_PURCHASE_EVENT, (payload) => this.onPurchaseEvent(payload));
    }

    private waitFor<T>(list: Waiter<T>[], match: (payload: NativeObject) => boolean, map: (payload: NativeObject) => T): { entry: Waiter<T>; promise: Promise<T | null> } {
        const entry: Waiter<T> = { match, map, resolve: () => undefined, cancelTimer: null };
        const promise = new Promise<T | null>((resolve) => {
            (entry as { resolve: (value: T | null) => void }).resolve = resolve;
            entry.cancelTimer = this.schedule(() => {
                this.cancelWaiter(list, entry);
                resolve(null);
            }, this.operationTimeoutMs);
        });
        list.push(entry);
        return { entry, promise };
    }

    private cancelWaiter<T>(list: Waiter<T>[], entry: Waiter<T>): void {
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        entry.cancelTimer?.();
        entry.cancelTimer = null;
    }

    private settle<T>(list: Waiter<T>[], payload: NativeObject): void {
        for (const entry of [...list]) {
            if (!entry.match(payload)) continue;
            this.cancelWaiter(list, entry);
            entry.resolve(entry.map(payload));
        }
    }

    private onPurchaseEvent(source: NativeObject): void {
        const requestId = stringField(source, 'requestId');
        const entry = requestId.length > 0 ? this.pending.get(requestId) : undefined;
        if (entry !== undefined) {
            this.finish(requestId, this.toResult(entry.request, source));
            return;
        }
        // No purchase() call is waiting for this event: a late result, a pending purchase that completed, a duplicate callback or a store query
        // redelivery. Failures and cancels without a waiter are dropped (nothing was bought); purchased / pending / owned go to the grant path.
        const result = this.toResult({ productId: stringField(source, 'productId'), requestId }, source);
        if (!(DELIVERABLE_STATUSES as readonly string[]).includes(result.status)) return;
        // A duplicate callback of a result this provider already resolved (same request, same status, same token) is dropped, so the waiting purchase() call
        // keeps the single authoritative result. A different status (pending -> completed) or a result after the timeout still goes through.
        const prior = requestId.length > 0 ? this.used.get(requestId) : undefined;
        if (prior !== undefined && prior.status === result.status && prior.purchaseToken === result.purchaseToken) return;
        const keyed: PurchaseResult = result.requestId.length > 0 ? result : { ...result, requestId: `store:${result.transactionId ?? result.purchaseToken ?? 'unknown'}` };
        this.diagnostic('delivery', { status: keyed.status, requestId: keyed.requestId, transactionId: keyed.transactionId ?? null });
        for (const handler of [...this.handlers]) {
            try {
                handler(keyed);
            } catch {
                // a consumer error never breaks the provider
            }
        }
    }

    private toResult(request: { readonly productId: string; readonly requestId: string }, source: NativeObject): PurchaseResult {
        const rawStatus = stringField(source, 'status');
        const known = (PURCHASE_STATUSES as readonly string[]).includes(rawStatus);
        let status: PurchaseResultStatus = known ? rawStatus as PurchaseResultStatus : 'failed';
        let reason = stringField(source, 'reason') || (known ? undefined : 'android_unknown_result_status');
        const productId = stringField(source, 'productId') || request.productId;
        const token = stringField(source, 'purchaseToken');
        const orderId = stringField(source, 'transactionId');
        if (status === 'completed') {
            // Fail closed: a purchase without a token cannot be acknowledged, and one for another product is never this pack.
            if (token.length === 0) {
                status = 'failed';
                reason = 'missing_purchase_token';
            } else if (productId !== request.productId) {
                status = 'failed';
                reason = 'product_mismatch';
            }
        }
        const result: PurchaseResult = { status, productId, requestId: request.requestId };
        const transactionId = orderId || (status === 'completed' || status === 'already_owned' ? token : '');
        if (transactionId) result.transactionId = transactionId;
        if (token && (status === 'completed' || status === 'already_owned' || status === 'pending')) result.purchaseToken = token;
        if (reason) result.reason = reason;
        const message = stringField(source, 'message');
        if (message) result.message = message;
        return result;
    }

    private build(request: PurchaseRequest, status: PurchaseResultStatus, reason: string): PurchaseResult {
        return { status, productId: request.productId, requestId: request.requestId, reason };
    }

    /** The only completion path of a purchase() call: first result wins; ends the overlay BEFORE resolving. */
    private finish(requestId: string, result: PurchaseResult): void {
        const entry = this.pending.get(requestId);
        if (entry === undefined) return;
        this.pending.delete(requestId);
        entry.cancelTimer?.();
        entry.cancelTimer = null;
        this.used.set(requestId, result);
        if (this.used.size > ANDROID_BILLING_USED_REQUEST_LIMIT) {
            const oldest = this.used.keys().next().value;
            if (oldest !== undefined) this.used.delete(oldest);
        }
        this.diagnostic('purchase_result', { requestId, status: result.status, transactionId: result.transactionId ?? null, reason: result.reason ?? null });
        try {
            this.overlay?.end(requestId);
        } catch {
            // the overlay bookkeeping never breaks the flow
        }
        entry.resolve(result);
    }

    private toState(source: NativeObject): PlatformServiceState {
        return {
            kind: 'purchase',
            status: serviceStatus(source),
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
    }

    private safeCall(method: string, signature = '()Ljava/lang/String;', ...args: string[]): NativeObject {
        try {
            return parseNativeObject(this.transport.callString(method, signature, ...args));
        } catch {
            return { ok: false, status: 'failed', reason: 'android_native_call_failed' };
        }
    }

    private diagnostic(phase: string, payload: Record<string, unknown>): void {
        try {
            this.onDiagnostic?.(phase, payload);
        } catch {
            // diagnostics never break the provider
        }
    }
}
