import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import {
    applyFounderPackPurchase,
    applyFounderStoreReport,
    getFounderSurgeChargesRemaining,
    hasFirstWorkerBot,
    hasFounderSurgeGrantBeenRecorded,
    isFounderPackOwned,
    isFounderRobotCosmeticOwned,
    resolveFounderOfferStatus,
} from '../assets/scripts/monetization/FounderOffer.ts';
import {
    CURRENT_SAVE_VERSION,
    InMemorySaveStorage,
    SAVE_MAIN_NAME,
    deserializeGameStateFromSaveJson,
    serializeGameStateToSaveJson,
} from '../assets/scripts/persistence/index.ts';
import { GameRuntime } from '../assets/scripts/runtime/index.ts';
import { ENTITLEMENTS } from '../assets/scripts/services/PlatformServiceTypes.ts';
import {
    FOUNDER_ENTITLEMENT_ID,
    FOUNDER_ROBOT_COSMETIC_ID,
    FOUNDER_SURGE_CHARGE_FLAGS,
    FOUNDER_SURGE_DURATION_SECONDS,
    FOUNDER_SURGE_GRANTED_FLAG,
    FOUNDER_SURGE_MULTIPLIER,
    FOUNDER_SURGE_QUANTITY,
} from '../assets/scripts/state/FounderOfferKeys.ts';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import { validateGameState } from '../assets/scripts/state/StateValidation.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';
import { buildAut049SeededState } from '../tools/device/seed_aut049.ts';

const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const codes = (state: unknown) => validateGameState(state).diagnostics.map((d) => d.code);

function withWorkerBot(): GameState {
    const state = createFreshGameState();
    state.run.progressionFlags.first_robot = true;
    return state;
}

function grantCommand(requestId = 'txn-1', at = NOW_MS) {
    return { type: 'grantFounderPack', requestId, source: 'store', grantedAtUtcMs: at } as const;
}

/** Simulates the later activation task consuming both charges (slots false, grant flag stays true). */
function consumeAllCharges(state: GameState): void {
    for (const flag of FOUNDER_SURGE_CHARGE_FLAGS) state.meta.accountFeatureUnlocks[flag] = false;
}

test('constants: entitlement id matches the service constant; surge contents mirror MONETIZATION section 12', () => {
    assert.equal(FOUNDER_ENTITLEMENT_ID, ENTITLEMENTS.founderPack);
    assert.equal(FOUNDER_SURGE_QUANTITY, 2);
    assert.equal(FOUNDER_SURGE_CHARGE_FLAGS.length, FOUNDER_SURGE_QUANTITY);
    assert.equal(FOUNDER_SURGE_MULTIPLIER, 2.0);
    assert.equal(FOUNDER_SURGE_DURATION_SECONDS, 1800);
});

test('availability: locked before the First Worker Bot, available after, owned wins, store outage is a plain input', () => {
    const fresh = createFreshGameState();
    assert.equal(hasFirstWorkerBot(fresh), false);
    assert.equal(resolveFounderOfferStatus(fresh), 'locked');
    assert.equal(resolveFounderOfferStatus(fresh, { storeUnavailable: true }), 'locked', 'nothing to sell yet: lock wins over a store outage');

    const viaBreakthrough = createFreshGameState();
    viaBreakthrough.run.purchasedBreakthroughIds.push('worker_bot');
    assert.equal(resolveFounderOfferStatus(viaBreakthrough), 'available');

    const viaFlag = withWorkerBot();
    assert.equal(resolveFounderOfferStatus(viaFlag), 'available');
    assert.equal(resolveFounderOfferStatus(viaFlag, { storeUnavailable: false }), 'available');
    assert.equal(resolveFounderOfferStatus(viaFlag, { storeUnavailable: true }), 'unavailable_store');

    const afterReboot = createFreshGameState();
    afterReboot.meta.civilizationNumber = 2;
    assert.equal(resolveFounderOfferStatus(afterReboot), 'available', 'stays available through and after the first Reboot');

    const owned = applyFounderPackPurchase(createFreshGameState(), { source: 'mock', grantedAtUtcMs: NOW_MS });
    const ownedBeforeUnlock = createFreshGameState();
    ownedBeforeUnlock.meta = owned.meta;
    assert.equal(resolveFounderOfferStatus(ownedBeforeUnlock, { storeUnavailable: true }), 'owned');
});

test('purchase grants entitlement, Founder Robot cosmetic and two Surge charges, with distinct flags; input is not mutated', () => {
    const state = withWorkerBot();
    const before = JSON.stringify(state);
    const result = applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS });
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(result.outcome, { entitlementGranted: true, cosmeticGranted: true, surgesGranted: 2, changed: true });
    assert.deepEqual(result.meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID], { owned: true, source: 'store', lastKnownValidUtcMs: NOW_MS });
    assert.equal(result.meta.cosmeticOwnership[FOUNDER_ROBOT_COSMETIC_ID], true);
    assert.equal(result.meta.accountFeatureUnlocks[FOUNDER_SURGE_GRANTED_FLAG], true);
    for (const flag of FOUNDER_SURGE_CHARGE_FLAGS) assert.equal(result.meta.accountFeatureUnlocks[flag], true);
    // Entitlement and consumable-grant flags live in different records under different keys.
    assert.notEqual(FOUNDER_ENTITLEMENT_ID, FOUNDER_SURGE_GRANTED_FLAG);
    assert.equal(FOUNDER_SURGE_GRANTED_FLAG in result.meta.durableEntitlements, false);
    assert.equal(FOUNDER_ENTITLEMENT_ID in result.meta.accountFeatureUnlocks, false);
    const next: GameState = { ...state, meta: result.meta };
    assert.equal(isFounderPackOwned(next), true);
    assert.equal(isFounderRobotCosmeticOwned(next), true);
    assert.equal(hasFounderSurgeGrantBeenRecorded(next), true);
    assert.equal(getFounderSurgeChargesRemaining(next), 2);
    assert.deepEqual(codes(next), []);
});

test('runtime command: grants once, replay and a different transaction id never add Surges', () => {
    const runtime = new GameRuntime(repo, withWorkerBot());
    const first = runtime.execute(grantCommand('txn-1'));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.events, [{
        type: 'founderPackApplied', origin: 'purchase', requestId: 'txn-1',
        entitlementGranted: true, cosmeticGranted: true, surgesGranted: 2, changed: true,
    }]);
    const afterFirst = runtime.getStateSnapshot();
    assert.equal(getFounderSurgeChargesRemaining(afterFirst), 2);

    for (const id of ['txn-1', 'txn-2']) {
        const replay = runtime.execute(grantCommand(id, NOW_MS));
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        const event = replay.events[0];
        assert.equal(event.type, 'founderPackApplied');
        if (event.type !== 'founderPackApplied') return;
        assert.equal(event.surgesGranted, 0);
        assert.equal(event.entitlementGranted, false);
        assert.equal(event.cosmeticGranted, false);
        assert.equal(event.changed, false);
    }
    assert.deepEqual(runtime.getStateSnapshot(), afterFirst);
    assert.equal(getFounderSurgeChargesRemaining(runtime.getStateSnapshot()), 2);
});

test('consumed Surges never return on replay or restore, while the entitlement stays', () => {
    const state = withWorkerBot();
    const granted = applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS });
    const consumed: GameState = { ...state, meta: granted.meta };
    consumeAllCharges(consumed);
    assert.equal(getFounderSurgeChargesRemaining(consumed), 0);
    assert.deepEqual(codes(consumed), []);

    const replay = applyFounderPackPurchase(consumed, { source: 'store', grantedAtUtcMs: NOW_MS + 1000 });
    assert.equal(replay.outcome.surgesGranted, 0);
    const restore = applyFounderStoreReport(consumed, { owned: true, source: 'store', reportedAtUtcMs: NOW_MS + 2000 });
    assert.equal(restore.outcome.surgesGranted, 0);
    for (const meta of [replay.meta, restore.meta]) {
        assert.equal(getFounderSurgeChargesRemaining({ ...consumed, meta }), 0);
        assert.equal(isFounderPackOwned({ ...consumed, meta }), true);
        assert.equal(hasFounderSurgeGrantBeenRecorded({ ...consumed, meta }), true);
    }
});

test('replay keeps the original source and only moves lastKnownValidUtcMs forward', () => {
    const state = withWorkerBot();
    const first = applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS });
    const owned: GameState = { ...state, meta: first.meta };
    const later = applyFounderStoreReport(owned, { owned: true, source: 'mock', reportedAtUtcMs: NOW_MS + 5000 });
    assert.deepEqual(later.meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID], { owned: true, source: 'store', lastKnownValidUtcMs: NOW_MS + 5000 });
    const earlier = applyFounderStoreReport(owned, { owned: true, source: 'mock', reportedAtUtcMs: NOW_MS - 5000 });
    assert.equal(earlier.meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID].lastKnownValidUtcMs, NOW_MS, 'a regressed clock never moves it back');
    assert.equal(earlier.outcome.changed, false);
});

test('restore on a fresh/lost save: entitlement + cosmetic return, the grant flag is recorded, NO Surges are granted', () => {
    const lost = createFreshGameState();
    const result = applyFounderStoreReport(lost, { owned: true, source: 'store', reportedAtUtcMs: NOW_MS });
    assert.deepEqual(result.outcome, { entitlementGranted: true, cosmeticGranted: true, surgesGranted: 0, changed: true });
    const restored: GameState = { ...lost, meta: result.meta };
    assert.equal(isFounderPackOwned(restored), true);
    assert.equal(isFounderRobotCosmeticOwned(restored), true);
    assert.equal(hasFounderSurgeGrantBeenRecorded(restored), true);
    assert.equal(getFounderSurgeChargesRemaining(restored), 0);
    assert.deepEqual(codes(restored), []);
    // A later purchase-style redelivery cannot mint Surges either.
    assert.equal(applyFounderPackPurchase(restored, { source: 'store', grantedAtUtcMs: NOW_MS }).outcome.surgesGranted, 0);
});

test('restore repairs a missing cosmetic or entitlement without touching the Surge inventory', () => {
    const state = withWorkerBot();
    const granted: GameState = { ...state, meta: applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS }).meta };
    state.meta = granted.meta;
    state.meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[0]] = false;
    delete state.meta.cosmeticOwnership[FOUNDER_ROBOT_COSMETIC_ID];
    const repaired = applyFounderStoreReport(state, { owned: true, source: 'store', reportedAtUtcMs: NOW_MS + 1 });
    assert.equal(repaired.outcome.cosmeticGranted, true);
    assert.equal(repaired.outcome.entitlementGranted, false);
    assert.equal(repaired.outcome.surgesGranted, 0);
    assert.equal(repaired.meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[0]], false);
    assert.equal(repaired.meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[1]], true);

    delete state.meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID];
    const entitlementBack = applyFounderStoreReport(state, { owned: true, source: 'store', reportedAtUtcMs: NOW_MS + 1 });
    assert.equal(entitlementBack.outcome.entitlementGranted, true);
    assert.equal(entitlementBack.outcome.surgesGranted, 0);
});

test('not-owned, unknown and failed reports never revoke and never change state', () => {
    const state = withWorkerBot();
    state.meta = applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS }).meta;
    for (const owned of [false, null]) {
        const result = applyFounderStoreReport(state, { owned, source: 'store', reportedAtUtcMs: NOW_MS + 10 });
        assert.deepEqual(result.meta, state.meta);
        assert.equal(result.outcome.changed, false);
    }
    const none = applyFounderStoreReport(createFreshGameState(), { owned: false, source: 'store', reportedAtUtcMs: NOW_MS });
    assert.deepEqual(none.meta, createFreshGameState().meta);
});

test('invalid timestamps throw and malformed runtime commands are rejected without changing state', () => {
    assert.throws(() => applyFounderPackPurchase(createFreshGameState(), { source: 'store', grantedAtUtcMs: Number.NaN }), RangeError);
    assert.throws(() => applyFounderStoreReport(createFreshGameState(), { owned: true, source: 'store', reportedAtUtcMs: -1 }), RangeError);
    const runtime = new GameRuntime(repo, withWorkerBot());
    const before = runtime.getStateSnapshot();
    const bad: unknown[] = [
        { ...grantCommand(), requestId: '' },
        { ...grantCommand(), requestId: 5 },
        { ...grantCommand(), source: 'cheat' },
        { ...grantCommand(), grantedAtUtcMs: -1 },
        { ...grantCommand(), grantedAtUtcMs: Number.POSITIVE_INFINITY },
        { type: 'reconcileFounderEntitlement', owned: 'yes', source: 'store', reportedAtUtcMs: 1 },
        { type: 'reconcileFounderEntitlement', owned: true, source: 'store', reportedAtUtcMs: Number.NaN },
        { type: 'reconcileFounderEntitlement', owned: true, source: 'x', reportedAtUtcMs: 1 },
    ];
    for (const command of bad) {
        const result = runtime.execute(command);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.reason, 'malformed_command');
    }
    assert.deepEqual(runtime.getStateSnapshot(), before);
});

test('runtime reconcile command: restore emits an event once; not-owned and repeated reports are silent', () => {
    const runtime = new GameRuntime(repo, createFreshGameState());
    const report = (owned: boolean | null, at = NOW_MS) =>
        runtime.execute({ type: 'reconcileFounderEntitlement', owned, source: 'store', reportedAtUtcMs: at });
    for (const owned of [false, null]) {
        const silent = report(owned);
        assert.equal(silent.ok && silent.events.length, 0);
    }
    const restored = report(true);
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.deepEqual(restored.events, [{
        type: 'founderPackApplied', origin: 'restore', requestId: null,
        entitlementGranted: true, cosmeticGranted: true, surgesGranted: 0, changed: true,
    }]);
    const again = report(true);
    assert.equal(again.ok && again.events.length, 0);
    assert.equal(getFounderSurgeChargesRemaining(runtime.getStateSnapshot()), 0);
});

test('ownership and Surge flags survive a Reboot (meta is not reset)', () => {
    const seeded = buildAut049SeededState('reboot');
    const runtime = new GameRuntime(repo, seeded);
    assert.equal(runtime.execute(grantCommand()).ok, true);
    const reboot = runtime.rebootCivilizationConfirmed();
    assert.equal(reboot.ok, true, 'seeded state is Reboot-eligible');
    const after = runtime.getStateSnapshot();
    assert.equal(after.meta.civilizationNumber, 2);
    assert.equal(isFounderPackOwned(after), true);
    assert.equal(isFounderRobotCosmeticOwned(after), true);
    assert.equal(getFounderSurgeChargesRemaining(after), 2);
    assert.equal(runtime.execute(grantCommand('txn-again')).ok, true);
    assert.equal(getFounderSurgeChargesRemaining(runtime.getStateSnapshot()), 2);
});

test('save/reload round trip through the real SaveEnvelope keeps entitlement, cosmetic, grant flag and consumed charges', () => {
    assert.equal(CURRENT_SAVE_VERSION, 3, 'AUT-058 does not bump the save version');
    const state = withWorkerBot();
    state.meta = applyFounderPackPurchase(state, { source: 'store', grantedAtUtcMs: NOW_MS }).meta;
    state.meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[1]] = false; // one Surge consumed
    const metadata = { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: 'test', savedAtUtc: iso(NOW_MS) };
    const result = deserializeGameStateFromSaveJson(serializeGameStateToSaveJson(state, metadata));
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.state, state);
    const loaded = result.state!;
    assert.equal(isFounderPackOwned(loaded), true);
    assert.equal(isFounderRobotCosmeticOwned(loaded), true);
    assert.equal(getFounderSurgeChargesRemaining(loaded), 1);
    // Replay after reload: still exactly one charge, never two.
    assert.equal(applyFounderPackPurchase(loaded, { source: 'store', grantedAtUtcMs: NOW_MS + 1 }).outcome.surgesGranted, 0);
});

test('an older save without any Founder keys loads unchanged (strictly additive: no migration needed)', () => {
    const state = createFreshGameState();
    const result = deserializeGameStateFromSaveJson(serializeGameStateToSaveJson(state, {
        saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: 'test', savedAtUtc: iso(NOW_MS),
    }));
    assert.equal(result.migration!.migrated, false);
    assert.equal(isFounderPackOwned(result.state!), false);
    assert.equal(getFounderSurgeChargesRemaining(result.state!), 0);
});

test('validation: charges require the grant flag and only the two known slots exist', () => {
    const base = createFreshGameState();
    assert.deepEqual(codes(base), []);

    const withoutGrant = createFreshGameState();
    withoutGrant.meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[0]] = true;
    assert.deepEqual(codes(withoutGrant), ['STATE_FOUNDER_CHARGE_WITHOUT_GRANT']);

    const consumedWithoutGrant = createFreshGameState();
    consumedWithoutGrant.meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[0]] = false;
    assert.deepEqual(codes(consumedWithoutGrant), [], 'a consumed slot needs no grant flag');

    const extraSlot = createFreshGameState();
    extraSlot.meta.accountFeatureUnlocks[FOUNDER_SURGE_GRANTED_FLAG] = true;
    extraSlot.meta.accountFeatureUnlocks['founder_factory_pack.surge_charge_3'] = true;
    assert.deepEqual(codes(extraSlot), ['STATE_FOUNDER_UNKNOWN_CHARGE_SLOT']);

    const badTypes = createFreshGameState();
    (badTypes.meta.accountFeatureUnlocks as Record<string, unknown>)[FOUNDER_SURGE_GRANTED_FLAG] = 'yes';
    assert.equal(codes(badTypes).length > 0, true);

    const badEntitlement = createFreshGameState();
    (badEntitlement.meta.durableEntitlements as Record<string, unknown>)[FOUNDER_ENTITLEMENT_ID] = { owned: true, source: 'store' };
    assert.equal(codes(badEntitlement).length > 0, true);

    const runtimeGuard = () => new GameRuntime(repo, withoutGrant);
    assert.throws(runtimeGuard);
});

async function startSession(state: GameState) {
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, {
            saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS),
        }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, session: boot.startup.session };
}

const mainSaves = (storage: InMemorySaveStorage) =>
    storage.operationLog().filter((o) => o.operation === 'replace' && o.toName === SAVE_MAIN_NAME).length;

test('coordinator: generic submit cannot grant or restore; the dedicated purchase path saves critically exactly once and survives reload', async () => {
    const ctx = await startSession(buildAut047SeededState('ready'));
    const generic = await ctx.session.execute(grantCommand());
    assert.equal(generic.execution.ok, false);
    const genericRestore = await ctx.session.execute({ type: 'reconcileFounderEntitlement', owned: true, source: 'store', reportedAtUtcMs: NOW_MS });
    assert.equal(genericRestore.execution.ok, false);
    assert.equal(isFounderPackOwned(ctx.session.getStateSnapshot()), false);

    const savesBefore = mainSaves(ctx.storage);
    const result = await ctx.session.applyFounderPackPurchase({ requestId: 'txn-1', source: 'store' });
    assert.equal(result.status, 'applied_saved');
    if (result.status !== 'applied_saved') return;
    assert.equal(result.save.intent, 'critical');
    assert.equal(result.save.reason, 'founder_entitlement');
    assert.equal(mainSaves(ctx.storage) - savesBefore, 1);
    assert.equal(ctx.session.getFounderSurgeChargesRemaining(), 2);

    const replay = await ctx.session.applyFounderPackPurchase({ requestId: 'txn-1', source: 'store' });
    assert.equal(replay.status, 'already_applied');
    assert.equal(mainSaves(ctx.storage) - savesBefore, 1, 'a replay writes nothing');
    const restore = await ctx.session.reconcileFounderEntitlement({ owned: true, source: 'store' });
    assert.equal(restore.status, 'already_applied');
    const notOwned = await ctx.session.reconcileFounderEntitlement({ owned: null, source: 'store' });
    assert.equal(notOwned.status, 'already_applied');
    assert.equal(ctx.session.getFounderSurgeChargesRemaining(), 2);

    const reloaded = await bootstrapGameSession({ storage: ctx.storage, timeService: ctx.clock });
    assert.equal(reloaded.startup.ok, true);
    if (!reloaded.startup.ok) return;
    const loaded = reloaded.startup.session.getStateSnapshot();
    assert.equal(isFounderPackOwned(loaded), true);
    assert.equal(getFounderSurgeChargesRemaining(loaded), 2);
});

test('coordinator: restore on a lost save restores ownership with a critical save and zero Surges', async () => {
    const ctx = await startSession(buildAut047SeededState('ready'));
    const result = await ctx.session.reconcileFounderEntitlement({ owned: true, source: 'store' });
    assert.equal(result.status, 'applied_saved');
    const state = ctx.session.getStateSnapshot();
    assert.equal(isFounderPackOwned(state), true);
    assert.equal(isFounderRobotCosmeticOwned(state), true);
    assert.equal(getFounderSurgeChargesRemaining(state), 0);
    const rejected = await ctx.session.applyFounderPackPurchase({ requestId: '', source: 'store' });
    assert.equal(rejected.status, 'rejected');
});
