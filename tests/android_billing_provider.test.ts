import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    ANDROID_BILLING_ACK_EVENT,
    ANDROID_BILLING_OPERATION_TIMEOUT_MS,
    ANDROID_BILLING_PRODUCTS_EVENT,
    ANDROID_BILLING_PURCHASE_EVENT,
    ANDROID_BILLING_PURCHASE_TIMEOUT_MS,
    ANDROID_BILLING_QUERY_EVENT,
    ANDROID_BILLING_STATE_EVENT,
    AndroidPurchaseService,
    type AndroidBillingTransport,
} from '../assets/scripts/platform/android/AndroidPurchaseService.ts';
import { MockPurchaseService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { NoOpPurchaseService } from '../assets/scripts/platform/noop/NoOpPlatformProviders.ts';
import { createBuildPurchaseService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { DEBUG_PURCHASE_PROVIDER_PLAY_BILLING, parseDebugPurchaseScriptFile } from '../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { FounderShopFlow, type FounderShopSessionPort } from '../assets/scripts/presentation/FounderShopFlow.ts';
import { PRODUCTS } from '../assets/scripts/services/PlatformServiceTypes.ts';
import { PlatformOverlayTracker } from '../assets/scripts/services/PlatformOverlay.ts';
import type { LifecycleFounderResult } from '../assets/scripts/lifecycle/LifecycleSessionCoordinator.ts';
import { AUT060_SEED_VARIANTS, buildAut060PurchaseScriptFile, isAut060SeedVariant } from '../tools/device/seed_aut060.ts';
import { evaluateBilling, type BillingTimelineEvent } from '../tools/device/billing_checks.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n/g, '\n');

class FakeTransport implements AndroidBillingTransport {
    public readonly calls: Array<{ method: string; args: string[] }> = [];
    public readonly handlers = new Map<string, Set<(payload: string) => void>>();
    public responses = new Map<string, string | (() => string)>();
    public onCall: ((method: string) => void) | null = null;

    public callString(method: string, _signature: string, ...args: string[]): string {
        this.calls.push({ method, args });
        this.onCall?.(method);
        const response = this.responses.get(method);
        const value = typeof response === 'function' ? response() : response;
        return value ?? '{"ok":false,"status":"unavailable","reason":"no_response"}';
    }

    public subscribe(event: string, handler: (payload: string) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();
        set.add(handler);
        this.handlers.set(event, set);
        return () => { set.delete(handler); };
    }

    public emit(event: string, payload: Record<string, unknown>): void {
        for (const handler of [...(this.handlers.get(event) ?? [])]) handler(JSON.stringify(payload));
    }

    public purchase(requestId: string, status: string, extra: Record<string, unknown> = {}): void {
        this.emit(ANDROID_BILLING_PURCHASE_EVENT, { status, productId: PRODUCTS.founderPack, requestId, ...extra });
    }

    public methods(): string[] { return this.calls.map((call) => call.method); }
}

function makeService(options: { overlay?: PlatformOverlayTracker } = {}) {
    const transport = new FakeTransport();
    transport.responses.set('purchaseProduct', '{"status":"started"}');
    transport.responses.set('queryProductDetails', '{"status":"started"}');
    transport.responses.set('acknowledgePurchase', '{"status":"started"}');
    transport.responses.set('restorePurchases', '{"status":"started"}');
    transport.responses.set('initializePurchases', '{"ok":false,"status":"initializing"}');
    const timers: Array<{ delay: number; fire: () => void; cancelled: boolean }> = [];
    const diagnostics: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const service = new AndroidPurchaseService({
        transport,
        overlay: options.overlay,
        schedule: (callback, delay) => {
            const timer = { delay, fire: callback, cancelled: false };
            timers.push(timer);
            return () => { timer.cancelled = true; };
        },
        onDiagnostic: (phase, payload) => diagnostics.push({ phase, payload }),
    });
    return { transport, service, timers, diagnostics };
}

const req = (requestId: string) => ({ productId: PRODUCTS.founderPack, requestId });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('android billing: initialize waits for the native terminal state event (start-then-event)', async () => {
    const { transport, service } = makeService();
    const pending = service.initialize();
    assert.deepEqual(transport.methods(), ['initializePurchases']);
    transport.emit(ANDROID_BILLING_STATE_EVENT, { ok: true, status: 'ready' });
    assert.equal((await pending).status, 'ready');
});

test('android billing: init retry after a service disconnect (failed -> initialize again -> ready)', async () => {
    const { transport, service } = makeService();
    const first = service.initialize();
    transport.emit(ANDROID_BILLING_STATE_EVENT, { ok: false, status: 'failed', reason: 'service_disconnected' });
    const failed = await first;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.reason, 'service_disconnected');
    const second = service.initialize();
    transport.emit(ANDROID_BILLING_STATE_EVENT, { ok: true, status: 'ready' });
    assert.equal((await second).status, 'ready');
    assert.deepEqual(transport.methods(), ['initializePurchases', 'initializePurchases']);
});

test('android billing: initialize that never hears back fails closed on the backstop', async () => {
    const { service, timers } = makeService();
    const pending = service.initialize();
    const backstop = timers.find((timer) => timer.delay === ANDROID_BILLING_OPERATION_TIMEOUT_MS);
    assert.ok(backstop);
    backstop.fire();
    const state = await pending;
    assert.equal(state.status, 'failed');
    assert.equal(state.reason, 'billing_init_timeout');
});

test('android billing: initialize answers at once when native is already terminal (unavailable)', async () => {
    const { transport, service } = makeService();
    transport.responses.set('initializePurchases', '{"ok":false,"status":"unavailable","reason":"billing_unavailable"}');
    const state = await service.initialize();
    assert.equal(state.status, 'unavailable');
    assert.equal(state.reason, 'billing_unavailable');
});

test('android billing: product details carry the store localized price verbatim and never invent one', async () => {
    const { transport, service } = makeService();
    const pending = service.queryProductDetails([PRODUCTS.founderPack]);
    assert.equal(transport.calls[0].method, 'queryProductDetails');
    assert.equal(transport.calls[0].args[0], PRODUCTS.founderPack);
    transport.emit(ANDROID_BILLING_PRODUCTS_EVENT, { ok: true, products: [{ productId: PRODUCTS.founderPack, type: 'durable', available: true, title: 'Founder', localizedPrice: '2,99 EUR' }], missingProductIds: [] });
    const details = await pending;
    assert.equal(details.ok, true);
    assert.equal(details.products[0].localizedPrice, '2,99 EUR');
    const missing = service.queryProductDetails([PRODUCTS.founderPack]);
    transport.emit(ANDROID_BILLING_PRODUCTS_EVENT, { ok: true, products: [], missingProductIds: [PRODUCTS.founderPack] });
    const none = await missing;
    assert.deepEqual(none.products, []);
    assert.deepEqual(none.missingProductIds, [PRODUCTS.founderPack]);
});

test('android billing: product query timeout and unavailable store fail closed (no price)', async () => {
    const { transport, service, timers } = makeService();
    const pending = service.queryProductDetails([PRODUCTS.founderPack]);
    timers.find((timer) => timer.delay === ANDROID_BILLING_OPERATION_TIMEOUT_MS)!.fire();
    const timedOut = await pending;
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.reason, 'product_details_timeout');
    transport.responses.set('queryProductDetails', '{"ok":false,"status":"failed","reason":"service_disconnected"}');
    const refused = await service.queryProductDetails([PRODUCTS.founderPack]);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'service_disconnected');
});

test('android billing: success - overlay brackets the flow, completed carries order id + token, nothing is acknowledged by the provider', async () => {
    const overlay = new PlatformOverlayTracker();
    const phases: string[] = [];
    overlay.subscribe((event) => phases.push(`${event.phase}:${event.kind}`));
    const { transport, service } = makeService({ overlay });
    const pending = service.purchase(req('r1'));
    assert.equal(overlay.isOverlayActive(), true);
    assert.deepEqual(JSON.parse(transport.calls[0].args[0]), req('r1'));
    transport.purchase('r1', 'completed', { transactionId: 'GPA.1', purchaseToken: 'tok-1' });
    const result = await pending;
    assert.deepEqual(result, { status: 'completed', productId: PRODUCTS.founderPack, requestId: 'r1', transactionId: 'GPA.1', purchaseToken: 'tok-1' });
    assert.equal(overlay.isOverlayActive(), false);
    assert.deepEqual(phases, ['begin:purchase_flow', 'end:purchase_flow']);
    assert.ok(!transport.methods().includes('acknowledgePurchase'), 'the provider never acknowledges on its own');
});

test('android billing: pending then purchased - pending grants nothing, the later completion is a delivery', async () => {
    const { transport, service } = makeService();
    const deliveries: unknown[] = [];
    service.onPurchaseDelivery((result) => deliveries.push(result));
    const pending = service.purchase(req('r2'));
    transport.purchase('r2', 'pending', { transactionId: 'GPA.2', purchaseToken: 'tok-2' });
    assert.equal((await pending).status, 'pending');
    assert.deepEqual(deliveries, [], 'the matched pending result resolves the call, it is not a delivery');
    transport.purchase('', 'completed', { transactionId: 'GPA.2', purchaseToken: 'tok-2' });
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0], { status: 'completed', productId: PRODUCTS.founderPack, requestId: 'store:GPA.2', transactionId: 'GPA.2', purchaseToken: 'tok-2' });
});

test('android billing: cancel, fail, unavailable and an unknown status resolve without a transaction', async () => {
    for (const [status, expected] of [['cancelled', 'cancelled'], ['failed', 'failed'], ['unavailable', 'unavailable'], ['bogus', 'failed']] as const) {
        const { transport, service } = makeService();
        const pending = service.purchase(req(`r-${status}`));
        transport.purchase(`r-${status}`, status, { reason: 'x' });
        const result = await pending;
        assert.equal(result.status, expected);
        assert.equal(result.transactionId, undefined);
        assert.equal(result.purchaseToken, undefined);
    }
});

test('android billing: item already owned (acknowledged) is already_owned and carries no grant', async () => {
    const { transport, service } = makeService();
    const pending = service.purchase(req('r3'));
    transport.purchase('r3', 'already_owned', { transactionId: 'GPA.3', purchaseToken: 'tok-3' });
    const result = await pending;
    assert.equal(result.status, 'already_owned');
});

test('android billing: a completed result without a purchase token, or for another product, fails closed', async () => {
    const { transport, service } = makeService();
    const noToken = service.purchase(req('r4'));
    transport.purchase('r4', 'completed', { transactionId: 'GPA.4' });
    const a = await noToken;
    assert.equal(a.status, 'failed');
    assert.equal(a.reason, 'missing_purchase_token');
    const other = service.purchase(req('r5'));
    transport.emit(ANDROID_BILLING_PURCHASE_EVENT, { status: 'completed', productId: 'some_other_product', requestId: 'r5', purchaseToken: 't', transactionId: 'x' });
    const b = await other;
    assert.equal(b.status, 'failed');
    assert.equal(b.reason, 'product_mismatch');
});

test('android billing: immediate terminal native answers (service unavailable) resolve without waiting and end the overlay', async () => {
    const overlay = new PlatformOverlayTracker();
    const { transport, service } = makeService({ overlay });
    transport.responses.set('purchaseProduct', JSON.stringify({ status: 'unavailable', productId: PRODUCTS.founderPack, requestId: 'r6', reason: 'service_disconnected' }));
    const result = await service.purchase(req('r6'));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'service_disconnected');
    assert.equal(overlay.isOverlayActive(), false);
    // service disconnect / retry: a second attempt (new request id) after the connection is back
    transport.responses.set('purchaseProduct', '{"status":"started"}');
    const retry = service.purchase(req('r7'));
    transport.purchase('r7', 'completed', { transactionId: 'GPA.7', purchaseToken: 'tok-7' });
    assert.equal((await retry).status, 'completed');
});

test('android billing: a reused request id is a no-op duplicate and never reaches native twice', async () => {
    const { transport, service } = makeService();
    const first = service.purchase(req('dup'));
    transport.purchase('dup', 'cancelled');
    await first;
    const again = await service.purchase(req('dup'));
    assert.equal(again.duplicate, true);
    assert.equal(transport.methods().filter((m) => m === 'purchaseProduct').length, 1);
});

test('android billing: a duplicate callback resolves the call once and is dropped (never a second delivery)', async () => {
    const { transport, service } = makeService();
    const deliveries: unknown[] = [];
    service.onPurchaseDelivery((result) => deliveries.push(result));
    const pending = service.purchase(req('r8'));
    transport.purchase('r8', 'completed', { transactionId: 'GPA.8', purchaseToken: 'tok-8' });
    transport.purchase('r8', 'completed', { transactionId: 'GPA.8', purchaseToken: 'tok-8' });
    assert.equal((await pending).status, 'completed');
    assert.equal(deliveries.length, 0);
    // the same purchase redelivered by a later store query (requestId "") still reaches the idempotent grant path
    transport.purchase('', 'completed', { transactionId: 'GPA.8', purchaseToken: 'tok-8' });
    assert.equal(deliveries.length, 1);
});

test('android billing: timeout fails closed, ends the overlay and a late completion is still delivered (never lost)', async () => {
    const overlay = new PlatformOverlayTracker();
    const { transport, service, timers } = makeService({ overlay });
    const deliveries: Array<{ status: string }> = [];
    service.onPurchaseDelivery((result) => deliveries.push(result));
    const pending = service.purchase(req('r9'));
    timers.find((timer) => timer.delay === ANDROID_BILLING_PURCHASE_TIMEOUT_MS)!.fire();
    const result = await pending;
    assert.equal(result.status, 'timeout');
    assert.equal(overlay.isOverlayActive(), false);
    transport.purchase('r9', 'completed', { transactionId: 'GPA.9', purchaseToken: 'tok-9' });
    assert.deepEqual(deliveries.map((d) => d.status), ['completed']);
    transport.purchase('r9', 'cancelled');
    assert.equal(deliveries.length, 1, 'a late cancel buys nothing and is dropped');
});

test('android billing: a thrown native call resolves failed and never throws into the flow', async () => {
    const overlay = new PlatformOverlayTracker();
    const { transport, service } = makeService({ overlay });
    transport.responses.set('purchaseProduct', () => { throw new Error('boom'); });
    const result = await service.purchase(req('r10'));
    assert.equal(result.status, 'failed');
    assert.equal(overlay.isOverlayActive(), false);
});

test('android billing: restore/query redelivers owned purchases through the delivery handler and resolves with the query result', async () => {
    const { transport, service } = makeService();
    const deliveries: Array<{ status: string; purchaseToken?: string; requestId: string }> = [];
    service.onPurchaseDelivery((result) => deliveries.push(result));
    const pending = service.restorePurchases();
    transport.purchase('', 'completed', { transactionId: 'GPA.11', purchaseToken: 'tok-11' });
    transport.purchase('', 'already_owned', { transactionId: 'GPA.12', purchaseToken: 'tok-12' });
    transport.emit(ANDROID_BILLING_QUERY_EVENT, { ok: true, status: 'ready', count: 2 });
    const query = await pending;
    assert.equal(query.ok, true);
    assert.deepEqual(deliveries.map((d) => d.status), ['completed', 'already_owned']);
    assert.ok(deliveries.every((d) => d.requestId.startsWith('store:')));
    transport.responses.set('restorePurchases', '{"ok":false,"status":"failed","reason":"service_disconnected"}');
    const refused = await service.restorePurchases();
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'service_disconnected');
});

test('android billing: acknowledge needs a token, is single-flight per token and idempotent after success', async () => {
    const { transport, service } = makeService();
    const base = { status: 'completed' as const, productId: PRODUCTS.founderPack, requestId: 'a1' };
    assert.equal((await service.acknowledgePurchase(base)).reason, 'missing_purchase_token');
    const first = service.acknowledgePurchase({ ...base, purchaseToken: 'tok-a' });
    const second = service.acknowledgePurchase({ ...base, purchaseToken: 'tok-a' });
    assert.equal(transport.methods().filter((m) => m === 'acknowledgePurchase').length, 1);
    transport.emit(ANDROID_BILLING_ACK_EVENT, { purchaseToken: 'tok-a', ok: true, status: 'acknowledged' });
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
    const third = await service.acknowledgePurchase({ ...base, purchaseToken: 'tok-a' });
    assert.equal(third.ok, true);
    assert.equal(transport.methods().filter((m) => m === 'acknowledgePurchase').length, 1);
});

test('android billing: acknowledge failure and timeout report not-ok and can be retried', async () => {
    const { transport, service, timers } = makeService();
    const base = { status: 'completed' as const, productId: PRODUCTS.founderPack, requestId: 'a2', purchaseToken: 'tok-b' };
    const failed = service.acknowledgePurchase(base);
    transport.emit(ANDROID_BILLING_ACK_EVENT, { purchaseToken: 'tok-b', ok: false, status: 'failed', reason: 'ack_error_6' });
    assert.equal((await failed).ok, false);
    const hung = service.acknowledgePurchase(base);
    timers.filter((timer) => timer.delay === ANDROID_BILLING_OPERATION_TIMEOUT_MS && !timer.cancelled).at(-1)!.fire();
    const timedOut = await hung;
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.reason, 'acknowledge_timeout');
    assert.equal(transport.methods().filter((m) => m === 'acknowledgePurchase').length, 2, 'a failed acknowledge is retried by a later call');
});

// ---------------------------------------------------------------- integration with the AUT-059 flow: acknowledge strictly AFTER a durable grant

function makeFlow(options: { applyStatus: LifecycleFounderResult['status']; log?: string[] }) {
    const { transport, service, timers } = makeService();
    const log = options.log ?? [];
    // The store answers every product query (the flow re-reads the metadata after each attempt).
    transport.onCall = (method) => {
        log.push(`native:${method}`);
        if (method === 'queryProductDetails') queueMicrotask(() => transport.emit(ANDROID_BILLING_PRODUCTS_EVENT, { ok: true, products: [{ productId: PRODUCTS.founderPack, type: 'durable', available: true, localizedPrice: 'STORE PRICE' }], missingProductIds: [] }));
    };
    transport.responses.set('getPurchaseStatus', '{"ok":true,"status":"ready"}');
    let grants = 0;
    let applyStatus = options.applyStatus;
    const session: FounderShopSessionPort = {
        getFounderOfferStatus: () => 'available',
        applyFounderPackPurchase: async () => {
            grants += 1;
            log.push('session:apply');
            await flush();
            log.push('session:apply_done');
            return { status: applyStatus, execution: {} as never, save: null as never } as LifecycleFounderResult;
        },
        reconcileFounderEntitlement: async () => {
            log.push('session:reconcile');
            return { status: 'already_applied', execution: {} as never, save: null } as LifecycleFounderResult;
        },
    };
    const flow = new FounderShopFlow({
        purchases: service,
        session,
        entitlementSource: 'store',
        now: () => 1_000,
        acknowledge: async (result) => {
            const ack = service.acknowledgePurchase(result);
            await flush();
            transport.emit(ANDROID_BILLING_ACK_EVENT, { purchaseToken: result.purchaseToken, ok: true, status: 'acknowledged' });
            const done = await ack;
            if (!done.ok) throw new Error('ack failed');
        },
    });
    service.onPurchaseDelivery((result) => { void flow.deliver(result); });
    return { transport, service, flow, log, timers, grants: () => grants, setApply: (status: LifecycleFounderResult['status']) => { applyStatus = status; } };
}

async function startFlow(ctx: ReturnType<typeof makeFlow>) {
    await ctx.flow.refresh();
    assert.equal(ctx.flow.getState().price, 'STORE PRICE');
    const buy = ctx.flow.buy();
    await flush();
    return { buy }; // wrapped: returning the promise itself would make startFlow await the purchase
}

test('android billing + flow: success grants once, acknowledges only AFTER the durable apply, duplicate callback never regrants', async () => {
    const ctx = makeFlow({ applyStatus: 'applied_saved' });
    const { buy } = await startFlow(ctx);
    const requestId = JSON.parse(ctx.transport.calls.find((c) => c.method === 'purchaseProduct')!.args[0]).requestId as string;
    ctx.transport.purchase(requestId, 'completed', { transactionId: 'GPA.20', purchaseToken: 'tok-20' });
    ctx.transport.purchase(requestId, 'completed', { transactionId: 'GPA.20', purchaseToken: 'tok-20' }); // duplicate callback
    assert.equal(await buy, 'purchased');
    await flush();
    await flush();
    assert.equal(ctx.grants(), 1);
    const ackIndex = ctx.log.indexOf('native:acknowledgePurchase');
    assert.ok(ackIndex > ctx.log.indexOf('session:apply_done'), `acknowledge must follow the durable apply: ${ctx.log.join(' > ')}`);
    assert.equal(ctx.log.filter((entry) => entry === 'native:acknowledgePurchase').length, 1);
});

test('android billing + flow: apply that could not be saved => NO acknowledge (redelivered later)', async () => {
    const ctx = makeFlow({ applyStatus: 'applied_persistence_failed' });
    const { buy } = await startFlow(ctx);
    const requestId = JSON.parse(ctx.transport.calls.find((c) => c.method === 'purchaseProduct')!.args[0]).requestId as string;
    ctx.transport.purchase(requestId, 'completed', { transactionId: 'GPA.21', purchaseToken: 'tok-21' });
    assert.equal(await buy, 'not_saved');
    await flush();
    assert.ok(!ctx.log.includes('native:acknowledgePurchase'), ctx.log.join(' > '));
    // The store query redelivers the still-unacknowledged purchase; the save now works -> grant confirmed, then acknowledge.
    ctx.setApply('applied_saved');
    ctx.transport.purchase('', 'completed', { transactionId: 'GPA.21', purchaseToken: 'tok-21' });
    await flush(); await flush(); await flush();
    assert.equal(ctx.log.filter((entry) => entry === 'native:acknowledgePurchase').length, 1);
    assert.ok(ctx.log.lastIndexOf('session:apply_done') < ctx.log.indexOf('native:acknowledgePurchase'));
});

test('android billing + flow: pending then completed outside the flow grants once and acknowledges after the grant', async () => {
    const ctx = makeFlow({ applyStatus: 'applied_saved' });
    const { buy } = await startFlow(ctx);
    const requestId = JSON.parse(ctx.transport.calls.find((c) => c.method === 'purchaseProduct')!.args[0]).requestId as string;
    ctx.transport.purchase(requestId, 'pending', { transactionId: 'GPA.22', purchaseToken: 'tok-22' });
    assert.equal(await buy, 'pending');
    assert.equal(ctx.grants(), 0, 'pending grants nothing');
    assert.ok(!ctx.log.includes('native:acknowledgePurchase'));
    ctx.transport.purchase('', 'completed', { transactionId: 'GPA.22', purchaseToken: 'tok-22' });
    await flush(); await flush(); await flush();
    assert.equal(ctx.grants(), 1);
    assert.ok(ctx.log.indexOf('native:acknowledgePurchase') > ctx.log.indexOf('session:apply_done'));
});

test('android billing + flow: cancel and fail grant nothing and acknowledge nothing', async () => {
    for (const status of ['cancelled', 'failed'] as const) {
        const ctx = makeFlow({ applyStatus: 'applied_saved' });
        const { buy } = await startFlow(ctx);
        const requestId = JSON.parse(ctx.transport.calls.find((c) => c.method === 'purchaseProduct')!.args[0]).requestId as string;
        ctx.transport.purchase(requestId, status);
        assert.equal(await buy, status);
        assert.equal(ctx.grants(), 0);
        assert.ok(!ctx.log.includes('native:acknowledgePurchase'));
    }
});

test('android billing + flow: already owned reconciles ownership without a grant (never regrants Surges) and without acknowledge', async () => {
    const ctx = makeFlow({ applyStatus: 'applied_saved' });
    const { buy } = await startFlow(ctx);
    const requestId = JSON.parse(ctx.transport.calls.find((c) => c.method === 'purchaseProduct')!.args[0]).requestId as string;
    ctx.transport.purchase(requestId, 'already_owned', { transactionId: 'GPA.23', purchaseToken: 'tok-23' });
    assert.equal(await buy, 'already_owned');
    assert.equal(ctx.grants(), 0);
    assert.ok(ctx.log.includes('session:reconcile'));
    assert.ok(!ctx.log.includes('native:acknowledgePurchase'));
});

test('android billing + flow: timeout is fail-closed (note, nothing granted, nothing acknowledged)', async () => {
    const ctx = makeFlow({ applyStatus: 'applied_saved' });
    const { buy } = await startFlow(ctx);
    ctx.timers.find((timer) => timer.delay === ANDROID_BILLING_PURCHASE_TIMEOUT_MS)!.fire();
    assert.equal(await buy, 'failed');
    assert.equal(ctx.grants(), 0);
    assert.ok(!ctx.log.includes('native:acknowledgePurchase'));
});

// ---------------------------------------------------------------- the coordinator never reports success for an unsaved grant on replay

test('coordinator: a replayed Founder grant after a failed save retries the save before reporting success', () => {
    const source = read('assets/scripts/lifecycle/LifecycleSessionCoordinator.ts');
    assert.match(source, /founderEntitlementUnsaved/);
    assert.match(source, /this\.founderEntitlementUnsaved = !save\.ok;/);
    assert.match(source, /if \(this\.founderEntitlementUnsaved\) \{/);
});

// ---------------------------------------------------------------- build selection

test('createBuildPurchaseService: release = Android billing when a transport exists, else NoOp; never the mock', () => {
    const transport = new FakeTransport();
    assert.ok(createBuildPurchaseService(false, undefined, { androidTransport: transport }).service instanceof AndroidPurchaseService);
    assert.ok(createBuildPurchaseService(false).service instanceof NoOpPurchaseService);
    assert.ok(createBuildPurchaseService(false, undefined, { androidTransport: null }).service instanceof NoOpPurchaseService);
    const mockScript = parseDebugPurchaseScriptFile(JSON.stringify({ price: 'TEST PRICE 9.99', outcomes: ['completed'] }))!;
    assert.ok(createBuildPurchaseService(false, mockScript, { androidTransport: transport }).service instanceof AndroidPurchaseService, 'a release build ignores the debug script');
    assert.equal(createBuildPurchaseService(false, undefined, { androidTransport: transport }).source, 'store');
});

test('createBuildPurchaseService: DEBUG keeps NoOp without a script, the mock with a mock script (precedence), the real provider only on play_billing', () => {
    const transport = new FakeTransport();
    assert.ok(createBuildPurchaseService(true, undefined, { androidTransport: transport }).service instanceof NoOpPurchaseService, 'DEBUG without a script stays hidden');
    const mockScript = parseDebugPurchaseScriptFile(JSON.stringify({ price: 'TEST PRICE 9.99' }))!;
    assert.ok(createBuildPurchaseService(true, mockScript, { androidTransport: transport }).service instanceof MockPurchaseService);
    const mixed = parseDebugPurchaseScriptFile(JSON.stringify({ provider: DEBUG_PURCHASE_PROVIDER_PLAY_BILLING, price: 'TEST PRICE 9.99' }))!;
    assert.ok(createBuildPurchaseService(true, mixed, { androidTransport: transport }).service instanceof MockPurchaseService, 'the mock wins over the real provider when both are present');
    const real = parseDebugPurchaseScriptFile(JSON.stringify({ provider: DEBUG_PURCHASE_PROVIDER_PLAY_BILLING }))!;
    assert.equal(real.provider, DEBUG_PURCHASE_PROVIDER_PLAY_BILLING);
    const selection = createBuildPurchaseService(true, real, { androidTransport: transport });
    assert.ok(selection.service instanceof AndroidPurchaseService);
    assert.equal(selection.source, 'store');
    assert.ok(createBuildPurchaseService(true, real, { androidTransport: null }).service instanceof NoOpPurchaseService, 'no native bridge -> hidden, not the mock');
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ provider: 'other' })), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ price: 'X' }))!.provider, undefined);
});

test('bootstrap wiring: real transport, shared overlay tracker, acknowledge hook and delivery routing', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /createBuildPurchaseService\(DEBUG === true, this\.debugPurchaseScript, \{\s*androidTransport: createAndroidBillingTransport\(\),\s*overlay: this\.platformOverlay,/);
    assert.match(bootstrap, /acknowledge: typeof purchases\.acknowledgePurchase === 'function'/);
    assert.match(bootstrap, /purchases\.onPurchaseDelivery\?\.\(\(result\) => \{ void flow\.deliver\(result\); \}\);/);
    assert.match(bootstrap, /purchases\.restorePurchases\(\)/);
    // the overlay gate already keys on the shared tracker, whatever the overlay kind
    assert.match(bootstrap, /this\.overlayGate\.onHide\(this\.platformOverlay\.classifyBackground\(\) === 'overlay'\)/);
});

// ---------------------------------------------------------------- native source + config scan (no secrets, product id pinned, ack discipline)

test('native billing: product id is pinned to PRODUCTS.founderPack and documented', () => {
    const java = read('native/engine/android/app/src/com/cocos/game/AutomataBillingController.java');
    const match = /PRODUCT_FOUNDER_PACK = "([a-z0-9_]+)";/.exec(java);
    assert.ok(match);
    assert.equal(match[1], PRODUCTS.founderPack);
    assert.match(read('docs/AUT-060_PLAY_BILLING_PROVIDER.md'), new RegExp(PRODUCTS.founderPack));
});

test('native billing: the bridge delegates every purchase method to the controller and keeps the entitlement stubs', () => {
    const bridge = read('native/engine/android/app/src/com/cocos/game/AutomataPlatformBridge.java');
    for (const [method, call] of [
        ['initializePurchases', 'AutomataBillingController.initialize()'],
        ['getPurchaseStatus', 'AutomataBillingController.getStatus()'],
        ['queryProductDetails', 'AutomataBillingController.queryProductDetails(productIdsCsv)'],
        ['purchaseProduct', 'AutomataBillingController.purchase(requestJson)'],
        ['acknowledgePurchase', 'AutomataBillingController.acknowledge(requestJson)'],
        ['restorePurchases', 'AutomataBillingController.restore()'],
    ] as const) {
        assert.match(bridge, new RegExp(`public static String ${method}\\([^)]*\\) \\{\\s*return ${call.replace(/[()]/g, '\\$&')};`), method);
    }
    assert.match(bridge, /public static String initializeEntitlements\(\)/);
});

test('native billing: it never acknowledges or consumes by itself and uses the pinned API shapes', () => {
    const java = read('native/engine/android/app/src/com/cocos/game/AutomataBillingController.java');
    assert.doesNotMatch(java, /consumeAsync|ConsumeParams/, 'the pack is a non-consumable');
    const calls = [...java.matchAll(/client\.acknowledgePurchase\(/g)];
    assert.equal(calls.length, 1, 'exactly one acknowledge call site');
    const body = /private static void sendAcknowledge\(final String token\) \{[\s\S]*?\n    \}\n/.exec(java);
    assert.ok(body && /client\.acknowledgePurchase\(/.test(body[0]), 'the only acknowledge call is inside sendAcknowledge');
    const listener = /private static final PurchasesUpdatedListener PURCHASES_LISTENER[\s\S]*?\n    \};\n/.exec(java);
    assert.ok(listener && !/acknowledge/i.test(listener[0]), 'the purchases listener never acknowledges');
    assert.match(java, /static String acknowledge\(String requestJson\)/);
    // Billing 9.x shapes: pending purchases enabled for one-time products, auto reconnection, INAPP product type, formatted price from the store.
    assert.match(java, /enablePendingPurchases\(PendingPurchasesParams\.newBuilder\(\)\.enableOneTimeProducts\(\)\.build\(\)\)/);
    assert.match(java, /enableAutoServiceReconnection\(\)/);
    assert.match(java, /BillingClient\.ProductType\.INAPP/);
    assert.match(java, /getFormattedPrice\(\)/);
    assert.match(java, /resultStatus = purchase\.isAcknowledged\(\) \? "already_owned" : "completed";/);
    for (const event of [ANDROID_BILLING_STATE_EVENT, ANDROID_BILLING_PRODUCTS_EVENT, ANDROID_BILLING_PURCHASE_EVENT, ANDROID_BILLING_ACK_EVENT, ANDROID_BILLING_QUERY_EVENT]) {
        assert.ok(java.includes(`"${event}"`), `the native side dispatches ${event}`);
    }
});

test('native billing: the Play Billing dependency stays pinned, no billing secret or price literal exists in tracked source', () => {
    const gradle = read('native/engine/android/app/build.gradle');
    assert.match(gradle, /com\.android\.billingclient:billing:9\.1\.0/);
    const roots = ['native/engine/android', 'assets/scripts', 'tools', 'tests'];
    const offenders: string[] = [];
    const walk = (directory: string) => {
        for (const name of readdirSync(directory)) {
            if (['node_modules', 'temp', 'build', 'library'].includes(name)) continue;
            const full = path.join(directory, name);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (!/\.(ts|java|xml|gradle|json|ps1|js|properties)$/.test(name)) continue;
            const text = readFileSync(full, 'utf8');
            if (/\.(ts|java)$/.test(name) && /(licen[cs]e_?key|base64_?public_?key|MIIB[A-Za-z0-9+/]{20,})/i.test(text) && !/android_billing_provider\.test\.ts$/.test(name)) offenders.push(`${full}: license key material`);
            if (/billing_?api_?key|play_?service_?account/i.test(text) && !/android_billing_provider\.test\.ts$/.test(name)) offenders.push(`${full}: billing credential name`);
        }
    };
    for (const root of roots) walk(path.join(repoRoot, root));
    assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------- device tooling

test('device tooling: AUT-060 seed variants and the real-provider debug script', () => {
    assert.deepEqual([...AUT060_SEED_VARIANTS], ['available', 'owned']);
    assert.equal(isAut060SeedVariant('available'), true);
    assert.equal(isAut060SeedVariant('nope'), false);
    const script = JSON.parse(buildAut060PurchaseScriptFile());
    assert.deepEqual(script, { provider: 'play_billing' });
    assert.equal(parseDebugPurchaseScriptFile(buildAut060PurchaseScriptFile())!.provider, 'play_billing');
});

const ev = (tMs: number, event: Record<string, unknown>): BillingTimelineEvent => ({ tMs, event: { v: 1, seq: 0, ...event } as never });
const shop = (tMs: number, phase: string, extra: Record<string, unknown> = {}) => ev(tMs, { evt: 'founder_shop', phase, ...extra });

test('billing checks: without a Play test account/product the real-store scenarios report an explicit environment block, never a false PASS', () => {
    const noStore = [shop(0, 'store_initialized', { status: 'unavailable', reason: 'billing_unavailable' })];
    for (const expectation of ['license_tester_purchase', 'cancel', 'restore_owned'] as const) {
        const checks = evaluateBilling(noStore, expectation);
        const blocked = checks.find((check) => check.id === 'billing_environment');
        assert.ok(blocked, expectation);
        assert.equal(blocked.ok, false);
        assert.match(blocked.detail, /ENVIRONMENT_BLOCKED/);
        assert.ok(checks.every((check) => check.ok || check.id === 'billing_environment' || /ENVIRONMENT_BLOCKED/.test(check.detail)), 'every failing check names the environment block');
    }
    const noProduct = [shop(0, 'store_initialized', { status: 'ready' }), shop(10, 'refresh', { offer: 'available', store: 'ready', priceShown: false, price: null, pending: false })];
    const checks = evaluateBilling(noProduct, 'license_tester_purchase');
    assert.match(checks.find((check) => check.id === 'billing_environment')!.detail, /ENVIRONMENT_BLOCKED.*product/i);
});

test('billing checks: a complete license-tester purchase passes (price from the store, grant once, acknowledge after the durable grant)', () => {
    const events: BillingTimelineEvent[] = [
        shop(0, 'store_initialized', { status: 'ready' }),
        shop(10, 'refresh', { offer: 'available', store: 'ready', priceShown: true, price: 'EUR 2.99', pending: false }),
        shop(20, 'purchase_started', { requestId: 'r' }),
        shop(25, 'billing_native_started', { requestId: 'r' }),
        shop(30, 'billing_purchase_result', { status: 'completed', requestId: 'r', transactionId: 'GPA.1' }),
        shop(40, 'purchase_result', { status: 'completed', requestId: 'r', transactionId: 'GPA.1' }),
        shop(50, 'applied', { status: 'applied_saved', restoreOnly: false, requestId: 'r' }),
        shop(55, 'state', { reason: 'applied', owned: true, cosmetic: true, grantRecorded: true, surgeCharges: 2 }),
        shop(59, "billing_acknowledged", {}), shop(60, "acknowledged", { requestId: "r" }),
        ev(61, { evt: 'command_result', command: { type: 'grantFounderPack' }, ok: true }),
    ];
    const checks = evaluateBilling(events, 'license_tester_purchase');
    assert.deepEqual(checks.filter((check) => !check.ok), []);
    const early = events.slice();
    for (const phase of ['billing_acknowledged', 'acknowledged']) {
        early.splice(early.findIndex((e) => e.event.phase === 'applied'), 0, early.splice(early.findIndex((e) => e.event.phase === phase), 1)[0]);
    }
    assert.ok(evaluateBilling(early, 'license_tester_purchase').some((check) => check.id === 'billing_ack_after_grant' && !check.ok));
});

test('billing checks: cancel grants and acknowledges nothing; restore_owned never regrants Surges', () => {
    const base = [shop(0, 'store_initialized', { status: 'ready' }), shop(10, 'refresh', { offer: 'available', store: 'ready', priceShown: true, price: 'EUR 2.99', pending: false })];
    const cancel = [...base, shop(20, 'purchase_started', { requestId: 'r' }), shop(25, 'billing_native_started', { requestId: 'r' }), shop(30, 'billing_purchase_result', { status: 'cancelled', requestId: 'r' }), shop(31, 'purchase_result', { status: 'cancelled', requestId: 'r' }), shop(40, 'state', { owned: false, surgeCharges: 0 })];
    assert.deepEqual(evaluateBilling(cancel, 'cancel').filter((check) => !check.ok), []);
    const granted = [...cancel, shop(50, 'acknowledged', { requestId: 'r' })];
    assert.ok(evaluateBilling(granted, 'cancel').some((check) => !check.ok));
    const restore = [
        shop(0, 'store_initialized', { status: 'ready' }),
        shop(5, 'store_query', { ok: true, status: 'ready', reason: null }),
        shop(10, 'billing_delivery', { status: 'already_owned', requestId: 'store:GPA.1' }),
        shop(11, 'applied', { status: 'already_applied', restoreOnly: true, requestId: 'store:GPA.1' }),
        shop(12, 'state', { owned: true, grantRecorded: true, surgeCharges: 0 }),
    ];
    assert.deepEqual(evaluateBilling(restore, 'restore_owned').filter((check) => !check.ok), []);
    const regrant = [...restore.slice(0, 4), shop(12, 'state', { owned: true, grantRecorded: true, surgeCharges: 2 })];
    assert.ok(evaluateBilling(regrant, 'restore_owned').some((check) => !check.ok));
});

test('device tooling: expectBilling is passed through cli.ts AND reveal_capture.ts to evaluateRevealTimeline, and the scenarios are registered', () => {
    const cli = read('tools/device/cli.ts');
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(cli, /expectBilling: scenario\.expectBilling,/);
    assert.match(capture, /expectBilling: options\.expectBilling, expectPermanentUpgrades/);
    assert.match(capture, /expectBilling\?: BillingExpectation; expectPermanentUpgrades/);
    assert.match(capture, /if \(options\.expectBilling !== undefined\) checks\.push\(\.\.\.evaluateBilling\(events, options\.expectBilling\)\);/);
    assert.match(cli, /seed-aut060/);
    assert.match(read('package.json'), /"device:seed-aut060"/);
    for (const id of ['aut060-license-tester-purchase', 'aut060-cancel', 'aut060-restore-owned']) assert.match(capture, new RegExp(`'${id}': \{ id: '${id}'`));
});
