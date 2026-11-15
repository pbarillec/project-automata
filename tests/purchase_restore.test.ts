import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { applyFounderPackPurchase, getFounderSurgeChargesRemaining, hasFounderSurgeGrantBeenRecorded, isFounderPackOwned, isFounderRobotCosmeticOwned } from '../assets/scripts/monetization/FounderOffer.ts';
import { classifyFounderStoreQuery, decideFounderReconciliation } from '../assets/scripts/monetization/FounderReconciliation.ts';
import { CURRENT_SAVE_VERSION, InMemorySaveStorage, SAVE_MAIN_NAME, deserializeGameStateFromSaveJson, serializeGameStateToSaveJson } from '../assets/scripts/persistence/index.ts';
import { MockPurchaseService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { NoOpPurchaseService } from '../assets/scripts/platform/noop/NoOpPlatformProviders.ts';
import { createBuildPurchaseService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { parseDebugPurchaseScriptFile } from '../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { FounderShopFlow } from '../assets/scripts/presentation/FounderShopFlow.ts';
import { FOUNDER_STORE_QUERY_MIN_INTERVAL_MS, FounderStoreQuery } from '../assets/scripts/presentation/FounderStoreQuery.ts';
import { GameRuntime } from '../assets/scripts/runtime/index.ts';
import { PlatformOverlayTracker } from '../assets/scripts/services/PlatformOverlay.ts';
import { PRODUCTS } from '../assets/scripts/services/PlatformServiceTypes.ts';
import type { PurchaseResult } from '../assets/scripts/services/PurchaseService.ts';
import { FOUNDER_SURGE_CHARGE_FLAGS } from '../assets/scripts/state/FounderOfferKeys.ts';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { REVEAL_SCENARIOS, evaluateRevealTimeline } from '../tools/device/reveal_capture.ts';
import { evaluateRestore, type RestoreTimelineEvent } from '../tools/device/restore_checks.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';
import { buildAut049SeededState } from '../tools/device/seed_aut049.ts';
import { AUT061_SEED_VARIANTS, aut061RestoreMode, buildAut061PurchaseScriptFile, buildAut061SeededSave, buildAut061SeededState } from '../tools/device/seed_aut061.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const PRODUCT = PRODUCTS.founderPack;
const PRICE = 'TEST PRICE 9.99';

// ---------------------------------------------------------------- helpers

async function start(state: GameState) {
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS) }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, boot, session: boot.startup.session };
}
type Ctx = Awaited<ReturnType<typeof start>>;

const mainSaves = (storage: InMemorySaveStorage) => storage.operationLog().filter((o) => o.operation === 'replace' && o.toName === SAVE_MAIN_NAME).length;
const snapshot = (ctx: Ctx) => ctx.session.getStateSnapshot();
const charges = (ctx: Ctx) => getFounderSurgeChargesRemaining(snapshot(ctx));

const freshReinstall = (): GameState => createFreshGameState();
const withWorkerBot = (): GameState => buildAut047SeededState('ready');
function ownedLocally(): GameState {
    const state = withWorkerBot();
    state.meta = applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS - 60_000 }).meta;
    return state;
}

function mockStore(options: { restore?: 'owned' | 'not_owned' | 'error' } = {}) {
    return new MockPurchaseService({ initialStatus: 'ready', products: [{ productId: PRODUCT, type: 'durable', available: true, localizedPrice: PRICE }], ...(options.restore ? { restore: options.restore } : {}) });
}

function makeFlow(ctx: Ctx, purchases: MockPurchaseService, extra: { acknowledge?: (r: PurchaseResult) => void | Promise<void> } = {}) {
    const diag: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const order: string[] = [];
    const binding = new FactoryWorldStateBinding({ session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: null, hud: null, panel: null });
    const flow = new FounderShopFlow({
        purchases,
        session: {
            getFounderOfferStatus: () => binding.getFounderOfferStatus(),
            applyFounderPackPurchase: async (request) => { order.push('apply'); return binding.applyFounderPackPurchase(request); },
            reconcileFounderEntitlement: async (report) => { order.push(`reconcile:${String(report.owned)}`); return binding.reconcileFounderEntitlement(report); },
        },
        entitlementSource: 'mock',
        now: () => NOW_MS,
        onDiagnostic: (phase, payload) => diag.push({ phase, payload }),
        acknowledge: extra.acknowledge ? async (result) => { order.push('ack'); await extra.acknowledge?.(result); } : undefined,
    });
    purchases.onPurchaseDelivery((result) => { void flow.deliver(result); });
    return { flow, diag, order };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const owned = (overrides: Partial<PurchaseResult> = {}): PurchaseResult => ({ status: 'already_owned', productId: PRODUCT, requestId: 'store:order-1', transactionId: 'order-1', ...overrides });
const completed = (overrides: Partial<PurchaseResult> = {}): PurchaseResult => ({ status: 'completed', productId: PRODUCT, requestId: 'store:order-2', transactionId: 'order-2', purchaseToken: 'token-2', ...overrides });

// ---------------------------------------------------------------- the pure policy

test('policy: local false / store true restores entitlement + cosmetic, records the grant flag only, never grants Surges', () => {
    const plan = decideFounderReconciliation({ localOwned: false, store: 'owned', delivery: 'owned_report', transactionId: 'order-1' });
    assert.deepEqual([...plan.actions], ['restore_entitlement']);
    assert.equal(plan.reason, 'restored_from_store');
    assert.equal(plan.surgeGrant, 'record_flag_only');
    assert.equal(plan.recordTransaction, true);
    assert.equal(plan.revokes, false);
    // the delivery kind defaults to restore semantics (never a grant)
    assert.deepEqual([...decideFounderReconciliation({ localOwned: false, store: 'owned' }).actions], ['restore_entitlement']);
});

test('policy: an unacknowledged store purchase takes the normal grant path, then the acknowledge (in that order)', () => {
    for (const localOwned of [false, true]) {
        const plan = decideFounderReconciliation({ localOwned, store: 'owned', delivery: 'purchase', transactionId: 'order-2' });
        assert.deepEqual([...plan.actions], ['grant_purchase', 'acknowledge'], `localOwned=${localOwned}`);
        assert.equal(plan.surgeGrant, 'grant_if_unrecorded');
    }
});

test('policy: local true + store unavailable / unknown / not_owned / error keeps ownership (never a revoke)', () => {
    for (const store of ['unavailable', 'unknown', 'not_owned', 'error'] as const) {
        const plan = decideFounderReconciliation({ localOwned: true, store });
        assert.deepEqual([...plan.actions], [], store);
        assert.equal(plan.revokes, false);
        assert.equal(plan.surgeGrant, 'none');
        assert.equal(plan.reason, store === 'not_owned' ? 'store_not_owned_keep_local' : 'store_no_answer_keep_local');
        assert.equal(decideFounderReconciliation({ localOwned: false, store }).reason, 'no_change');
    }
    // a contradictory delivery next to a non-owned report never acts
    assert.deepEqual([...decideFounderReconciliation({ localOwned: true, store: 'error', delivery: 'purchase' }).actions], []);
    assert.deepEqual([...decideFounderReconciliation({ localOwned: true, store: 'owned' }).actions], [], 'already owned locally: nothing to apply');
    assert.equal(decideFounderReconciliation({ localOwned: true, store: 'owned' }).reason, 'already_owned_locally');
});

test('policy: a duplicate transaction id is a no-op (Set or array, owned or purchase)', () => {
    for (const seen of [new Set(['order-1']), ['order-1']]) {
        for (const delivery of ['owned_report', 'purchase'] as const) {
            const plan = decideFounderReconciliation({ localOwned: false, store: 'owned', delivery, transactionId: 'order-1', seenTransactionIds: seen });
            assert.deepEqual([...plan.actions], []);
            assert.equal(plan.reason, 'duplicate_transaction');
            assert.equal(plan.recordTransaction, false);
        }
    }
    assert.equal(decideFounderReconciliation({ localOwned: false, store: 'owned', transactionId: 'order-9', seenTransactionIds: new Set(['order-1']) }).reason, 'restored_from_store');
});

test('policy: a failed store query is never read as not_owned; plans are frozen', () => {
    assert.equal(classifyFounderStoreQuery({ ok: false, status: 'failed' }), 'error');
    assert.equal(classifyFounderStoreQuery({ ok: false, status: 'unavailable' }), 'unavailable');
    assert.equal(classifyFounderStoreQuery({ ok: false, status: 'uninitialized' }), 'unavailable');
    assert.equal(classifyFounderStoreQuery({ ok: true, status: 'ready' }), 'unknown');
    assert.throws(() => { (decideFounderReconciliation({ localOwned: false, store: 'owned' }).actions as string[]).push('x'); });
});

// ---------------------------------------------------------------- flow + coordinator: the plan's test list

test('local false / store true: the store query restores entitlement + cosmetic with ONE critical save and ZERO Surges', async () => {
    const ctx = await start(withWorkerBot());
    const store = mockStore({ restore: 'owned' });
    const { flow, order, diag } = makeFlow(ctx, store, { acknowledge: () => undefined });
    await flow.refresh();
    const before = mainSaves(ctx.storage);
    assert.deepEqual(await store.restorePurchases(), { ok: true, status: 'ready' });
    await settle();
    const state = snapshot(ctx);
    assert.equal(isFounderPackOwned(state), true);
    assert.equal(isFounderRobotCosmeticOwned(state), true);
    assert.equal(hasFounderSurgeGrantBeenRecorded(state), true, 'the grant flag is recorded');
    assert.equal(charges(ctx), 0);
    assert.deepEqual(order, ['reconcile:true'], 'no grant, no acknowledge');
    assert.equal(mainSaves(ctx.storage) - before, 1);
    assert.equal(flow.getState().offer, 'owned');
    assert.ok(diag.some((d) => d.phase === 'reconciliation' && d.payload.reason === 'restored_from_store' && d.payload.surgeGrant === 'record_flag_only'));
});

test('local true / no network: a failed, unavailable or silent store query keeps ownership, charges and the save untouched (ACCEPTANCE)', async () => {
    const ctx = await start(ownedLocally());
    const store = mockStore({ restore: 'error' });
    const { flow, order, diag } = makeFlow(ctx, store);
    await flow.refresh();
    const before = mainSaves(ctx.storage);
    const failed = await store.restorePurchases();
    assert.equal(failed.ok, false);
    for (const result of [failed, { ok: false, status: 'unavailable' }, { ok: false, status: 'failed', reason: 'timeout' }, { ok: true, status: 'ready' }]) {
        const plan = flow.reportStoreQuery(result);
        assert.deepEqual([...plan.actions], []);
        assert.equal(plan.revokes, false);
        assert.equal(plan.reason, 'store_no_answer_keep_local');
    }
    await settle();
    assert.deepEqual(order, [], 'the session is never contacted (no owned:false / null report, no revoke)');
    assert.equal(isFounderPackOwned(snapshot(ctx)), true);
    assert.equal(isFounderRobotCosmeticOwned(snapshot(ctx)), true);
    assert.equal(charges(ctx), 2);
    assert.equal(mainSaves(ctx.storage), before, 'nothing written');
    assert.equal((await flow.refresh()).offer, 'owned');
    assert.ok(diag.some((d) => d.phase === 'store_query_policy' && d.payload.revokes === false && d.payload.localOwned === true));
    // an owned report from the store with the pack already owned locally changes nothing either (no save, no acknowledge)
    const ack: unknown[] = [];
    const second = makeFlow(ctx, mockStore(), { acknowledge: (r) => { ack.push(r); } });
    assert.equal(await second.flow.deliver(owned()), 'already_owned');
    assert.deepEqual(second.order, []);
    assert.equal(mainSaves(ctx.storage), before);
    assert.equal(ack.length, 0);
});

test('duplicate transaction: a replayed owned / completed delivery is ignored (one reconcile, one apply, one acknowledge)', async () => {
    const ctx = await start(withWorkerBot());
    const acked: PurchaseResult[] = [];
    const { flow, order } = makeFlow(ctx, mockStore(), { acknowledge: (r) => { acked.push(r); } });
    await flow.refresh();
    assert.equal(await flow.deliver(owned()), 'already_owned');
    assert.equal(await flow.deliver(owned()), 'duplicate');
    assert.deepEqual(order, ['reconcile:true']);
    const before = mainSaves(ctx.storage);
    assert.equal(await flow.deliver(completed()), 'purchased');
    assert.equal(await flow.deliver(completed()), 'duplicate');
    assert.equal(await flow.deliver(completed({ duplicate: true })), 'duplicate');
    assert.deepEqual(order, ['reconcile:true', 'apply', 'ack']);
    assert.equal(acked.length, 1);
    assert.equal(mainSaves(ctx.storage) - before, 0, 'owned already, same instant: the replayed grant is already_applied (no write)');
    assert.equal(charges(ctx), 0, 'the restore recorded the grant flag first: even a later purchase delivery cannot add Surges');
});

test('reinstall-style restore: fresh save + store owned -> entitlement + cosmetic back, zero Surges, flag set so a later purchase redelivery cannot regrant', async () => {
    const ctx = await start(freshReinstall());
    assert.equal(isFounderPackOwned(snapshot(ctx)), false);
    const acked: PurchaseResult[] = [];
    const { flow, order } = makeFlow(ctx, mockStore(), { acknowledge: (r) => { acked.push(r); } });
    assert.equal(await flow.deliver(owned()), 'already_owned');
    let state = snapshot(ctx);
    assert.equal(isFounderPackOwned(state), true);
    assert.equal(isFounderRobotCosmeticOwned(state), true);
    assert.equal(hasFounderSurgeGrantBeenRecorded(state), true);
    assert.equal(charges(ctx), 0);
    assert.equal(acked.length, 0);
    // a later unacknowledged redelivery of the same purchase (new transaction key) applies idempotently: still zero Surges, acknowledged once
    assert.equal(await flow.deliver(completed({ transactionId: 'order-1b', requestId: 'store:order-1b' })), 'purchased');
    state = snapshot(ctx);
    assert.equal(charges(ctx), 0, 'a restore must never grant, and a redelivery after it cannot either');
    assert.equal(acked.length, 1);
    assert.deepEqual(order, ['reconcile:true', 'apply', 'ack']);
    for (const flag of FOUNDER_SURGE_CHARGE_FLAGS) assert.notEqual(state.meta.accountFeatureUnlocks[flag], true);
});

test('unacknowledged store purchase on a fresh save (live redelivery): normal grant path -> 2 Surges, acknowledged ONCE after the durable save', async () => {
    const ctx = await start(freshReinstall());
    const acked: PurchaseResult[] = [];
    const savesAtAck: number[] = [];
    const before = mainSaves(ctx.storage);
    const { flow, order } = makeFlow(ctx, mockStore(), { acknowledge: (r) => { acked.push(r); savesAtAck.push(mainSaves(ctx.storage) - before); } });
    assert.equal(await flow.deliver(completed()), 'purchased');
    assert.equal(charges(ctx), 2);
    assert.deepEqual(order, ['apply', 'ack']);
    assert.deepEqual(savesAtAck, [1], 'the acknowledge ran after the critical save');
    assert.equal(await flow.deliver(completed()), 'duplicate');
    assert.equal(await flow.deliver(completed()), 'duplicate');
    assert.equal(acked.length, 1);
    assert.equal(charges(ctx), 2);
});

test('a failed acknowledge keeps the grant (idempotent) and a later redelivery retries the acknowledge without a second grant', async () => {
    const ctx = await start(freshReinstall());
    let calls = 0;
    const { flow, order } = makeFlow(ctx, mockStore(), { acknowledge: () => { calls += 1; if (calls === 1) throw new Error('store busy'); } });
    assert.equal(await flow.deliver(completed()), 'purchased');
    assert.equal(calls, 1);
    assert.equal(await flow.deliver(completed()), 'purchased', 'the redelivery retries (the grant replay is already_applied)');
    assert.equal(calls, 2);
    assert.equal(await flow.deliver(completed()), 'duplicate', 'acknowledged: done');
    assert.equal(charges(ctx), 2, 'never granted twice');
    assert.deepEqual(order, ['apply', 'ack', 'apply', 'ack']);
});

test('coordinator: a restore saves critically only when something changed (lost save: 1 write; owned again: none)', async () => {
    const ctx = await start(withWorkerBot());
    const before = mainSaves(ctx.storage);
    const first = await ctx.session.reconcileFounderEntitlement({ owned: true, source: 'store' });
    assert.equal(first.status, 'applied_saved');
    assert.equal(mainSaves(ctx.storage) - before, 1);
    for (const owned of [true, false, null]) {
        const again = await ctx.session.reconcileFounderEntitlement({ owned, source: 'store' });
        assert.equal(again.status, 'already_applied', String(owned));
    }
    assert.equal(mainSaves(ctx.storage) - before, 1, 'unchanged reports write nothing');
    assert.equal(ctx.session.getFounderSurgeChargesRemaining(), 0);
    // a not-owned / unknown report on a fresh save changes nothing and writes nothing either
    const fresh = await start(withWorkerBot());
    const base = mainSaves(fresh.storage);
    assert.equal((await fresh.session.reconcileFounderEntitlement({ owned: false, source: 'store' })).status, 'already_applied');
    assert.equal((await fresh.session.reconcileFounderEntitlement({ owned: null, source: 'store' })).status, 'already_applied');
    assert.equal(mainSaves(fresh.storage), base);
});

test('Reboot survival: a restored entitlement, cosmetic and recorded grant flag survive a Reboot, still zero Surges', () => {
    const seeded = buildAut049SeededState('reboot');
    const runtime = new GameRuntime(repo, seeded);
    assert.equal(runtime.execute({ type: 'reconcileFounderEntitlement', owned: true, source: 'store', reportedAtUtcMs: NOW_MS }).ok, true);
    assert.equal(runtime.rebootCivilizationConfirmed().ok, true, 'seeded state is Reboot-eligible');
    const after = runtime.getStateSnapshot();
    assert.equal(after.meta.civilizationNumber, 2);
    assert.equal(isFounderPackOwned(after), true);
    assert.equal(isFounderRobotCosmeticOwned(after), true);
    assert.equal(hasFounderSurgeGrantBeenRecorded(after), true);
    assert.equal(getFounderSurgeChargesRemaining(after), 0);
    assert.equal(runtime.execute({ type: 'grantFounderPack', requestId: 'late', source: 'store', grantedAtUtcMs: NOW_MS + 5 }).ok, true);
    assert.equal(getFounderSurgeChargesRemaining(runtime.getStateSnapshot()), 0, 'a purchase redelivery after the Reboot still cannot regrant');
});

test('real SaveEnvelope round trip: a restored state reloads with the same facts and a later purchase delivery still grants zero Surges', async () => {
    assert.equal(CURRENT_SAVE_VERSION, 3, 'AUT-061 does not bump the save version');
    const ctx = await start(freshReinstall());
    const { flow } = makeFlow(ctx, mockStore());
    await flow.deliver(owned());
    const reloaded = await bootstrapGameSession({ storage: ctx.storage, timeService: ctx.clock });
    assert.equal(reloaded.startup.ok, true);
    if (!reloaded.startup.ok) return;
    const loaded = reloaded.startup.session.getStateSnapshot();
    assert.equal(isFounderPackOwned(loaded), true);
    assert.equal(isFounderRobotCosmeticOwned(loaded), true);
    assert.equal(hasFounderSurgeGrantBeenRecorded(loaded), true);
    assert.equal(getFounderSurgeChargesRemaining(loaded), 0);
    const late = await reloaded.startup.session.applyFounderPackPurchase({ requestId: 'late', source: 'store' });
    assert.ok(late.status === 'already_applied' || late.status === 'applied_saved');
    assert.equal(reloaded.startup.session.getFounderSurgeChargesRemaining(), 0);
    const result = deserializeGameStateFromSaveJson(serializeGameStateToSaveJson(loaded, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: 'test', savedAtUtc: iso(NOW_MS) }));
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.state, loaded);
});

test('mock store restore modes: owned delivers already_owned through the handlers, not_owned delivers nothing, error fails, the default only answers ok', async () => {
    const seen: PurchaseResult[] = [];
    const owner = mockStore({ restore: 'owned' });
    owner.onPurchaseDelivery((result) => seen.push(result));
    assert.deepEqual(await owner.restorePurchases(), { ok: true, status: 'ready' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].status, 'already_owned');
    assert.equal(seen[0].productId, PRODUCT);
    assert.equal(typeof seen[0].transactionId, 'string');
    await owner.restorePurchases();
    assert.equal(seen[1].requestId, seen[0].requestId, 'the same transaction every time: the flow dedups it');
    for (const mode of ['not_owned', undefined] as const) {
        const quiet = mockStore(mode ? { restore: mode } : {});
        const got: PurchaseResult[] = [];
        quiet.onPurchaseDelivery((result) => got.push(result));
        assert.equal((await quiet.restorePurchases()).ok, true);
        assert.equal(got.length, 0);
    }
    const failing = mockStore({ restore: 'error' });
    assert.equal((await failing.restorePurchases()).ok, false);
    const unready = new MockPurchaseService({ initialStatus: 'unavailable', restore: 'owned' });
    assert.equal((await unready.restorePurchases()).ok, false, 'an unavailable store never reports ownership');
});

// ---------------------------------------------------------------- the foreground re-query

function queryHarness(options: { blocked?: () => boolean; status?: 'ready' | 'unavailable'; store?: MockPurchaseService } = {}) {
    const clock = { ms: 1_000_000 };
    const store = options.store ?? mockStore({ restore: 'not_owned' });
    store.onPurchaseDelivery(() => undefined);
    const results: Array<{ trigger: string; ok: boolean }> = [];
    const diag: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const query = new FounderStoreQuery({
        purchases: store,
        now: () => clock.ms,
        isBlocked: options.blocked ?? (() => false),
        onResult: (trigger, result) => results.push({ trigger, ok: result.ok }),
        onDiagnostic: (phase, payload) => diag.push({ phase, payload }),
    });
    const calls = () => store.calls.filter((c) => c.method === 'restorePurchases').length;
    return { clock, store, query, results, diag, calls };
}

test('foreground re-query: throttled to at least 60 s after the previous query; the startup query starts the window', async () => {
    const h = queryHarness();
    assert.equal(FOUNDER_STORE_QUERY_MIN_INTERVAL_MS, 60_000);
    assert.equal(await h.query.run('startup'), 'ran');
    h.clock.ms += 5_000;
    assert.equal(await h.query.run('foreground'), 'throttled');
    h.clock.ms += FOUNDER_STORE_QUERY_MIN_INTERVAL_MS - 5_001;
    assert.equal(await h.query.run('foreground'), 'throttled', '59.999 s: still throttled');
    h.clock.ms += 1;
    assert.equal(await h.query.run('foreground'), 'ran', 'exactly 60 s: runs');
    assert.equal(h.calls(), 2);
    h.clock.ms += 10;
    assert.equal(await h.query.run('foreground'), 'throttled', 'every run restarts the window');
    h.clock.ms += 1;
    assert.equal(await h.query.run('startup'), 'ran', 'the startup query ignores the throttle');
    assert.ok(h.diag.some((d) => d.phase === 'store_query_skipped' && d.payload.outcome === 'throttled'));
    assert.deepEqual(h.results.map((r) => r.trigger), ['startup', 'foreground', 'startup']);
});

test('foreground re-query: suppressed during a purchase flow, an ad / purchase overlay or the open shop modal, and a blocked attempt does not use up the window', async () => {
    const overlay = new PlatformOverlayTracker();
    const flags = { purchaseActive: false, modalOpen: false };
    const h = queryHarness({ blocked: () => overlay.isOverlayActive() || flags.purchaseActive || flags.modalOpen });
    assert.equal(await h.query.run('startup'), 'ran');
    h.clock.ms += 120_000;
    overlay.begin('purchase_flow', 'req-1');
    assert.equal(await h.query.run('foreground'), 'blocked', 'purchase sheet overlay');
    overlay.end('req-1');
    overlay.begin('rewarded_ad', 'ad-1');
    assert.equal(await h.query.run('foreground'), 'blocked', 'rewarded ad overlay');
    overlay.end('ad-1');
    flags.purchaseActive = true;
    assert.equal(await h.query.run('foreground'), 'blocked', 'purchase flow in flight');
    flags.purchaseActive = false;
    flags.modalOpen = true;
    assert.equal(await h.query.run('foreground'), 'blocked', 'shop modal open');
    flags.modalOpen = false;
    assert.equal(h.calls(), 1, 'nothing ran while blocked');
    assert.equal(await h.query.run('foreground'), 'ran', 'the window was not consumed by the blocked attempts');
    assert.equal(h.calls(), 2);
});

test('foreground re-query: one query at a time, only for a ready provider that can deliver purchases, a throwing blocker / provider is safe', async () => {
    const h = queryHarness();
    await h.query.run('startup');
    h.clock.ms += 120_000;
    const first = h.query.run('foreground');
    assert.equal(h.query.isRunning(), true);
    assert.equal(await h.query.run('foreground'), 'in_progress');
    assert.equal(await first, 'ran');
    assert.equal(h.query.isRunning(), false);

    const unready = queryHarness({ store: new MockPurchaseService({ initialStatus: 'uninitialized', products: [] }) });
    assert.equal(await unready.query.run('startup'), 'not_ready');
    assert.equal(unready.calls(), 0);

    const noop = new FounderStoreQuery({ purchases: new NoOpPurchaseService(), now: () => 0, isBlocked: () => false });
    assert.equal(await noop.run('startup'), 'unsupported', 'NoOp / providers without deliveries are never queried');

    const throwingBlocker = queryHarness({ blocked: () => { throw new Error('boom'); } });
    assert.equal(await throwingBlocker.query.run('foreground'), 'blocked', 'fail closed');

    const throwing = mockStore();
    throwing.restorePurchases = async () => { throw new Error('store down'); };
    const failing = queryHarness({ store: throwing });
    assert.equal(await failing.query.run('startup'), 'ran');
    assert.deepEqual(failing.results, [{ trigger: 'startup', ok: false }], 'a throwing provider is a failed query');
    failing.clock.ms += 10;
    assert.equal(await failing.query.run('foreground'), 'throttled', 'failures count against the window (no hammering)');
});

test('foreground re-query picks up a purchase completed outside the app: the delivery restores ownership with zero Surges, and a failed query afterwards keeps it', async () => {
    const ctx = await start(withWorkerBot());
    const store = mockStore({ restore: 'not_owned' });
    const { flow, order } = makeFlow(ctx, store);
    await flow.refresh();
    const clock = { ms: 5_000_000 };
    const query = new FounderStoreQuery({ purchases: store, now: () => clock.ms, isBlocked: () => flow.isPurchaseActive(), onResult: (_t, result) => { flow.reportStoreQuery(result); } });
    assert.equal(await query.run('startup'), 'ran');
    assert.equal(isFounderPackOwned(snapshot(ctx)), false);
    // the player bought it elsewhere: the next foreground query reports it owned
    store.setRestoreMode('owned');
    clock.ms += 61_000;
    assert.equal(await query.run('foreground'), 'ran');
    await settle();
    await flow.refresh();
    assert.equal(isFounderPackOwned(snapshot(ctx)), true);
    assert.equal(charges(ctx), 0);
    assert.deepEqual(order, ['reconcile:true']);
    assert.equal(flow.getState().offer, 'owned');
    // later the store is unreachable: nothing is revoked
    store.setRestoreMode('error');
    clock.ms += 61_000;
    await query.run('foreground');
    await settle();
    assert.equal(isFounderPackOwned(snapshot(ctx)), true);
    assert.equal(charges(ctx), 0);
    assert.deepEqual(order, ['reconcile:true'], 'the failed query reached no session command');
});

// ---------------------------------------------------------------- debug script / build selection

test('debug_purchase.json restore mode: allow-listed, bounded, a mock field, passed to the mock store', async () => {
    for (const mode of ['owned', 'not_owned', 'error'] as const) {
        assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ price: PRICE, restore: mode }))!.restore, mode);
    }
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ price: PRICE }))!.restore, undefined);
    for (const bad of ['yes', 1, null, true, ['owned']]) assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ price: PRICE, restore: bad })), null);
    const script = parseDebugPurchaseScriptFile(JSON.stringify({ price: PRICE, restore: 'owned' }))!;
    const selection = createBuildPurchaseService(true, script);
    assert.ok(selection.service instanceof MockPurchaseService);
    assert.equal(selection.source, 'mock');
    await selection.service.initialize();
    const got: PurchaseResult[] = [];
    selection.service.onPurchaseDelivery?.((result) => got.push(result));
    assert.equal((await selection.service.restorePurchases()).ok, true);
    assert.equal(got.length, 1);
    assert.equal(got[0].status, 'already_owned');
    // restore next to provider:play_billing: the mock field wins (never the real provider), and release never reads it
    const both = parseDebugPurchaseScriptFile(JSON.stringify({ provider: 'play_billing', restore: 'owned' }))!;
    assert.ok(createBuildPurchaseService(true, both, { androidTransport: {} as never }).service instanceof MockPurchaseService);
    assert.ok(createBuildPurchaseService(false, script).service instanceof NoOpPurchaseService);
});

// ---------------------------------------------------------------- source pins / wiring

test('wiring: startup + foreground queries go through FounderStoreQuery, the foreground one runs after the overlay skip, blocked by overlay / purchase / modal', () => {
    const bootstrap = code('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /new FounderStoreQuery\(\{/);
    assert.match(bootstrap, /isBlocked: \(\) => this\.platformOverlay\.isOverlayActive\(\) \|\| flow\.isPurchaseActive\(\) \|\| shop\.isOpen\(\)/);
    assert.match(bootstrap, /onResult: \(_trigger, result\) => \{ flow\.reportStoreQuery\(result\); \}/);
    assert.match(bootstrap, /void this\.founderStoreQuery\?\.run\('startup'\)/);
    assert.match(bootstrap, /void this\.founderStoreQuery\?\.run\('foreground'\)/);
    const show = bootstrap.slice(bootstrap.indexOf('private onGameShow()'));
    assert.ok(show.indexOf("overlay_show_skipped") < show.indexOf("founderStoreQuery?.run('foreground')"), 'an overlay-induced show never queries');
    assert.ok(show.indexOf('binding.resume()') < show.indexOf("founderStoreQuery?.run('foreground')"));
    assert.doesNotMatch(bootstrap, /purchases\.restorePurchases\(\)/, 'only FounderStoreQuery calls the store query');
    assert.match(code('assets/scripts/presentation/FounderStoreQuery.ts'), /this\.purchases\.restorePurchases\(\)/);
    // the flow never sends a revoke / owned:false report to the session
    const flowSource = code('assets/scripts/presentation/FounderShopFlow.ts');
    assert.doesNotMatch(flowSource, /owned: false/);
    assert.match(flowSource, /decideFounderReconciliation\(/);
});

test('pure modules: no cc, explicit .ts imports, no ctor parameter properties, metas with unique uuids; the save schema is unchanged', () => {
    const uuids = new Set<string>();
    for (const rel of ['assets/scripts/monetization/FounderReconciliation.ts', 'assets/scripts/presentation/FounderStoreQuery.ts']) {
        const source = code(rel);
        assert.doesNotMatch(source, new RegExp(String.raw`from\s+.c[c].`), rel);
        for (const match of source.matchAll(/^import (?!type)[^;]*from '(\.[^']*)'/gm)) assert.match(match[1], /\.ts$/, `${rel}: ${match[1]}`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|protected|readonly)\s/, rel);
        const meta = JSON.parse(read(`${rel}.meta`));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 2);
    assert.equal(CURRENT_SAVE_VERSION, 3);
    // FounderReconciliation is a decision only: it never touches state, persistence or a service
    assert.doesNotMatch(code('assets/scripts/monetization/FounderReconciliation.ts'), /import /);
});

// ---------------------------------------------------------------- seed, device checks, scenarios

test('seed: reinstall = a fresh save (nothing owned) + restore owned; local_owned_store_error = a real local grant + restore error', () => {
    assert.deepEqual([...AUT061_SEED_VARIANTS], ['reinstall', 'local_owned_store_error']);
    const fresh = buildAut061SeededState('reinstall', NOW_MS);
    assert.equal(isFounderPackOwned(fresh), false);
    assert.equal(getFounderSurgeChargesRemaining(fresh), 0);
    const local = buildAut061SeededState('local_owned_store_error', NOW_MS);
    assert.equal(isFounderPackOwned(local), true);
    assert.equal(isFounderRobotCosmeticOwned(local), true);
    assert.equal(getFounderSurgeChargesRemaining(local), 2);
    assert.equal(aut061RestoreMode('reinstall'), 'owned');
    assert.equal(aut061RestoreMode('local_owned_store_error'), 'error');
    for (const variant of AUT061_SEED_VARIANTS) {
        const script = parseDebugPurchaseScriptFile(buildAut061PurchaseScriptFile(variant))!;
        assert.ok(script, 'the seeded script parses');
        assert.equal(script.restore, aut061RestoreMode(variant));
        assert.equal(script.price, PRICE);
        const loaded = deserializeGameStateFromSaveJson(buildAut061SeededSave(variant, NOW_MS));
        assert.deepEqual(loaded.diagnostics, []);
        assert.equal(isFounderPackOwned(loaded.state!), variant !== 'reinstall');
    }
});

let seq = 0;
const ev = (tMs: number, payload: Record<string, unknown>): RestoreTimelineEvent => ({ tMs, event: { v: 1, seq: seq += 1, ...payload } as never });
const shopEv = (phase: string, payload: Record<string, unknown> = {}) => ev(seq, { evt: 'founder_shop', phase, ...payload });
const command = (type: string) => ev(seq, { evt: 'command_result', ok: true, command: { type }, eventTypes: [] });
const state = (owned: boolean, cosmetic: boolean, grantRecorded: boolean, surgeCharges: number, reason = 'x') => shopEv('state', { reason, owned, cosmetic, grantRecorded, surgeCharges });
const failing = (checks: ReturnType<typeof evaluateRestore>) => checks.filter((c) => !c.ok).map((c) => c.id);

const reinstallTimeline = (): RestoreTimelineEvent[] => [
    state(false, false, false, 0, 'session_ready'),
    shopEv('store_initialized', { status: 'ready', reason: null }),
    shopEv('store_query', { trigger: 'startup', ok: true, status: 'ready', reason: null }),
    shopEv('purchase_result', { status: 'already_owned', requestId: 'mock-restore:founder_pack', transactionId: 'mock-restore-order-founder_pack', duplicate: false }),
    shopEv('reconciliation', { reason: 'restored_from_store', actions: ['restore_entitlement'], surgeGrant: 'record_flag_only', restoreOnly: true }),
    command('reconcileFounderEntitlement'),
    shopEv('applied', { status: 'applied_saved', restoreOnly: true }),
    state(true, true, true, 0, 'applied'),
    shopEv('chip_shown', { state: 'owned', chipLabel: 'FOUNDER' }),
];

const errorTimeline = (): RestoreTimelineEvent[] => [
    state(true, true, true, 2, 'session_ready'),
    shopEv('chip_shown', { state: 'owned', chipLabel: 'FOUNDER' }),
    shopEv('store_initialized', { status: 'ready', reason: null }),
    shopEv('store_query', { trigger: 'startup', ok: false, status: 'failed', reason: 'mock_restore_error' }),
    shopEv('store_query_policy', { ok: false, reason: 'store_no_answer_keep_local', actions: [], revokes: false, localOwned: true }),
];

test('device checks: reinstall passes on a complete timeline and fails on a Surge grant, a missing restore, a purchase flow or an acknowledge', () => {
    assert.deepEqual(failing(evaluateRestore(reinstallTimeline(), 'reinstall')), []);
    const granted = reinstallTimeline().map((e) => (e.event.phase === 'state' && e.event.reason === 'applied' ? ev(1, { ...e.event, surgeCharges: 2 }) : e));
    assert.ok(failing(evaluateRestore(granted, 'reinstall')).includes('restore_entitlement_restored_zero_surges'));
    assert.ok(failing(evaluateRestore(granted, 'reinstall')).includes('restore_never_grants_surges_at_any_point'));
    assert.ok(failing(evaluateRestore(reinstallTimeline().filter((e) => e.event.phase !== 'reconciliation'), 'reinstall')).includes('restore_reconciled_from_store'));
    assert.ok(failing(evaluateRestore([...reinstallTimeline(), command('grantFounderPack')], 'reinstall')).includes('restore_no_purchase_flow'));
    assert.ok(failing(evaluateRestore([...reinstallTimeline(), shopEv('acknowledged')], 'reinstall')).includes('restore_no_acknowledge'));
    assert.ok(failing(evaluateRestore([...reinstallTimeline(), ev(9, { evt: 'error', context: 'x' })], 'reinstall')).includes('restore_no_errors'));
    assert.ok(failing(evaluateRestore(reinstallTimeline().filter((e) => e.event.phase !== 'chip_shown'), 'reinstall')).includes('restore_chip_owned'));
    assert.ok(failing(evaluateRestore([], 'reinstall')).length > 0, 'an empty timeline never passes');
});

test('device checks: local owned + store error passes only when nothing changed (no reconcile, no revoke, 2 charges kept, chip Owned)', () => {
    assert.deepEqual(failing(evaluateRestore(errorTimeline(), 'local_owned_store_error')), []);
    const revoked = [...errorTimeline(), state(false, true, true, 2, 'later')];
    assert.ok(failing(evaluateRestore(revoked, 'local_owned_store_error')).includes('restore_still_owned_after_failed_query'));
    assert.ok(failing(evaluateRestore([...errorTimeline(), command('reconcileFounderEntitlement')], 'local_owned_store_error')).includes('restore_no_reconcile_command'));
    assert.ok(failing(evaluateRestore(errorTimeline().map((e) => (e.event.phase === 'store_query' ? ev(1, { ...e.event, ok: true }) : e)), 'local_owned_store_error')).includes('restore_store_query_failed'));
    assert.ok(failing(evaluateRestore(errorTimeline().map((e) => (e.event.phase === 'store_query_policy' ? ev(1, { ...e.event, revokes: true }) : e)), 'local_owned_store_error')).includes('restore_policy_keeps_local'));
    assert.ok(failing(evaluateRestore(errorTimeline().filter((e) => e.event.phase !== 'chip_shown'), 'local_owned_store_error')).includes('restore_chip_owned'));
});

test('reveal scenarios are registered and wired through cli.ts AND reveal_capture.ts to evaluateRevealTimeline', () => {
    const wanted = { 'aut061-restore-reinstall': 'reinstall', 'aut061-restore-store-error': 'local_owned_store_error' };
    for (const [id, expectation] of Object.entries(wanted)) {
        const scenario = REVEAL_SCENARIOS[id];
        assert.ok(scenario, id);
        assert.equal(scenario.expectRestore, expectation, id);
        assert.equal(scenario.trigger, 'none', 'no taps');
    }
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /expectRestore: scenario\.expectRestore/);
    assert.match(cli, /seed-aut061/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /expectRestore: options\.expectRestore/);
    assert.match(capture, /evaluateRestore\(events, options\.expectRestore\)/);
    assert.match(read('package.json'), /"device:seed-aut061"/);
    // the evaluator actually runs the restore checks
    const checks = evaluateRevealTimeline(reinstallTimeline(), { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 5, expectRestore: 'reinstall' });
    assert.ok(checks.some((c) => c.id === 'restore_entitlement_restored_zero_surges' && c.ok));
    const bad = evaluateRevealTimeline([], { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 5, expectRestore: 'reinstall' });
    assert.ok(bad.some((c) => c.id.startsWith('restore_') && !c.ok));
});
