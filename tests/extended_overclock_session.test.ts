import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { recordRewardedClaim } from '../assets/scripts/monetization/RewardedClaimHistory.ts';
import {
    CURRENT_SAVE_VERSION,
    InMemorySaveStorage,
    SAVE_MAIN_NAME,
    SAVE_TEMP_NAME,
    serializeGameStateToSaveJson,
} from '../assets/scripts/persistence/index.ts';
import { EXTENDED_OVERCLOCK_BOOST_ID, FREE_OVERCLOCK_BOOST_ID } from '../assets/scripts/progression/index.ts';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { RewardClaimLedger } from '../assets/scripts/services/RewardClaimLedger.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const KEY = EXTENDED_OVERCLOCK_CLAIM_KEY;
const iso = (ms: number) => new Date(ms).toISOString();
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

interface StartOptions { absenceSeconds?: number; claimsMs?: number[]; state?: GameState; ledger?: { tryConsume(id: string): boolean } }

async function start(options: StartOptions = {}) {
    const state = options.state ?? buildAut047SeededState('ready');
    for (const t of options.claimsMs ?? []) state.monetization.rewardedClaims[KEY] = recordRewardedClaim(state, KEY, t);
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, {
            saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion,
            savedAtUtc: iso(NOW_MS - (options.absenceSeconds ?? 0) * 1000),
        }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock, ...(options.ledger ? { rewardClaimLedger: options.ledger } : {}) } as never);
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, boot, session: boot.startup.session };
}

type Ctx = Awaited<ReturnType<typeof start>>;
const proof = (requestId: string, over: Record<string, unknown> = {}) => ({ requestId, placementId: KEY, status: 'rewarded', rewardVerified: true, ...over });
const mainSaves = (storage: InMemorySaveStorage) => storage.operationLog().filter((o) => o.operation === 'replace' && o.toName === SAVE_MAIN_NAME).length;
const claimCount = (ctx: Ctx) => ctx.session.getStateSnapshot().monetization.rewardedClaims[KEY]?.claimCount ?? 0;
const boostIds = (ctx: Ctx) => Object.keys(ctx.session.getStateSnapshot().boosts.activeBoosts);

test('a verified rewarded proof starts Extended Overclock: boost + claim + ONE critical save with the new reason, timestamp = time service now', async () => {
    const ctx = await start();
    assert.equal(ctx.session.getPendingOfflinePreview(), null);
    const offer = ctx.session.getExtendedOverclockOffer();
    assert.equal(offer.eligibility.eligible, true);
    assert.equal(offer.activeBlocked, false);
    assert.equal(offer.blockedReason, null);
    const savesBefore = mainSaves(ctx.storage);
    const result = await ctx.session.activateExtendedOverclockWithRewardedProof(proof('req-1'));
    assert.equal(result.status, 'activated_saved');
    if (result.status !== 'activated_saved') return;
    assert.equal(result.save.intent, 'critical');
    assert.equal(result.save.reason, 'extended_overclock_activation');
    assert.equal(mainSaves(ctx.storage) - savesBefore, 1);
    assert.deepEqual(result.execution.events.map((e) => e.type), ['temporaryBoostActivated']);
    const state = ctx.session.getStateSnapshot();
    assert.equal(state.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].requestId, 'req-1');
    assert.equal(state.monetization.rewardedClaims[KEY].lastClaimUtcMs, NOW_MS);
    assert.equal(claimCount(ctx), 1);
    // The offer now reports the activation gate (already active); the claim is durable across a reload.
    const after = ctx.session.getExtendedOverclockOffer();
    assert.equal(after.activeBlocked, true);
    assert.equal(after.blockedReason, 'active');
    const reloaded = await bootstrapGameSession({ storage: ctx.storage, timeService: ctx.clock });
    assert.equal(reloaded.startup.ok, true);
    if (!reloaded.startup.ok) return;
    assert.equal(reloaded.startup.session.getStateSnapshot().monetization.rewardedClaims[KEY].claimCount, 1);
    assert.ok(reloaded.startup.session.getStateSnapshot().boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID]);
});

for (const [label, over, reason] of [
    ['closed', { status: 'closed', rewardVerified: false }, 'not_rewarded'],
    ['failed', { status: 'failed', rewardVerified: false }, 'not_rewarded'],
    ['unavailable', { status: 'unavailable', rewardVerified: false }, 'not_rewarded'],
    ['timeout', { status: 'timeout', rewardVerified: false }, 'not_rewarded'],
    ['rewarded but not verified', { rewardVerified: false }, 'not_verified'],
    ['duplicate:true', { duplicate: true }, 'duplicate'],
    ['wrong placement (offline double key)', { placementId: OFFLINE_DOUBLE_CLAIM_KEY }, 'wrong_placement'],
    ['empty request id', { requestId: '  ' }, 'bad_request_id'],
] as const) {
    test(`bad proof (${label}): not_granted, no state change, no save, no ledger burn`, async () => {
        const ledger = new RewardClaimLedger();
        const ctx = await start({ ledger });
        const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
        const saves = mainSaves(ctx.storage);
        const result = await ctx.session.activateExtendedOverclockWithRewardedProof(proof(label === 'empty request id' ? '  ' : 'req-x', over) as never);
        assert.deepEqual({ status: result.status, reason: (result as { reason?: string }).reason }, { status: 'not_granted', reason });
        assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
        assert.equal(mainSaves(ctx.storage), saves);
        // The same request id is still usable afterwards: proof failures never burn the ledger.
        if (label !== 'empty request id') {
            const retry = await ctx.session.activateExtendedOverclockWithRewardedProof(proof('req-x'));
            assert.equal(retry.status, 'activated_saved');
        }
    });
}

test('a null / undefined proof is not_granted', async () => {
    const ctx = await start();
    assert.equal((await ctx.session.activateExtendedOverclockWithRewardedProof(null as never) as { reason?: string }).reason, 'not_rewarded');
    assert.equal((await ctx.session.activateExtendedOverclockWithRewardedProof(undefined as never) as { reason?: string }).reason, 'not_rewarded');
});

test('the same request id twice: one claim, one boost, one critical save', async () => {
    const ctx = await start();
    const saves = mainSaves(ctx.storage);
    assert.equal((await ctx.session.activateExtendedOverclockWithRewardedProof(proof('same'))).status, 'activated_saved');
    const second = await ctx.session.activateExtendedOverclockWithRewardedProof(proof('same'));
    // Already active is checked before the ledger, so the replay never reaches it; either way nothing changes.
    assert.equal(second.status, 'not_granted');
    assert.equal(claimCount(ctx), 1);
    assert.equal(mainSaves(ctx.storage) - saves, 1);
    assert.deepEqual(boostIds(ctx), [EXTENDED_OVERCLOCK_BOOST_ID]);
});

test('a replayed request id after the boost ended is rejected as duplicate by the ledger (no second claim)', async () => {
    const ctx = await start();
    assert.equal((await ctx.session.activateExtendedOverclockWithRewardedProof(proof('replay'))).status, 'activated_saved');
    await ctx.session.execute({ type: 'advanceAutomation', elapsedSeconds: 600 });
    assert.deepEqual(boostIds(ctx), []);
    // Make it eligible again by time (a later claim moment) without touching the ledger.
    ctx.clock.advanceUtcSeconds(2 * 3600);
    assert.equal(ctx.session.getExtendedOverclockOffer().eligibility.eligible, true);
    assert.deepEqual(await ctx.session.activateExtendedOverclockWithRewardedProof(proof('replay')), { status: 'not_granted', reason: 'duplicate' });
    assert.equal(claimCount(ctx), 1);
});

test('ineligible by quota or by the 60 minute interval: not_granted with no state change and no ledger burn', async () => {
    const quota = await start({ claimsMs: [NOW_MS - 4 * HOUR, NOW_MS - 3 * HOUR, NOW_MS - 2 * HOUR] });
    assert.equal(quota.session.getExtendedOverclockOffer().eligibility.reason, 'quota_reached');
    const quotaSnapshot = JSON.stringify(quota.session.getStateSnapshot());
    assert.deepEqual(await quota.session.activateExtendedOverclockWithRewardedProof(proof('q')), { status: 'not_granted', reason: 'ineligible' });
    assert.equal(JSON.stringify(quota.session.getStateSnapshot()), quotaSnapshot);

    const interval = await start({ claimsMs: [NOW_MS - 20 * MIN] });
    assert.equal(interval.session.getExtendedOverclockOffer().eligibility.reason, 'min_interval');
    assert.deepEqual(await interval.session.activateExtendedOverclockWithRewardedProof(proof('i')), { status: 'not_granted', reason: 'ineligible' });
    assert.equal(claimCount(interval), 1);
});

test('Free Overclock locked: offer is activeBlocked(locked) and the proof is not_granted(locked)', async () => {
    const ctx = await start({ state: createFreshGameState() });
    const offer = ctx.session.getExtendedOverclockOffer();
    assert.equal(offer.activeBlocked, true);
    assert.equal(offer.blockedReason, 'locked');
    assert.deepEqual(await ctx.session.activateExtendedOverclockWithRewardedProof(proof('l')), { status: 'not_granted', reason: 'locked' });
    assert.equal(claimCount(ctx), 0);
});

test('already active: offer blocked and the proof is not_granted(already_active)', async () => {
    const ctx = await start();
    await ctx.session.activateExtendedOverclockWithRewardedProof(proof('first'));
    assert.deepEqual(await ctx.session.activateExtendedOverclockWithRewardedProof(proof('second')), { status: 'not_granted', reason: 'already_active' });
    assert.equal(claimCount(ctx), 1);
});

test('a pending offline preview blocks the offer and the activation', async () => {
    const ctx = await start({ absenceSeconds: 3 * 3600 });
    assert.notEqual(ctx.session.getPendingOfflinePreview(), null);
    const offer = ctx.session.getExtendedOverclockOffer();
    assert.equal(offer.activeBlocked, true);
    assert.equal(offer.blockedReason, 'offline_pending');
    const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
    assert.deepEqual(await ctx.session.activateExtendedOverclockWithRewardedProof(proof('p')), { status: 'not_granted', reason: 'offline_pending' });
    assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
    await ctx.session.collectPendingOffline();
    assert.equal(ctx.session.getExtendedOverclockOffer().activeBlocked, false);
    assert.equal((await ctx.session.activateExtendedOverclockWithRewardedProof(proof('p'))).status, 'activated_saved');
});

test('the generic execute() path can never grant Extended Overclock', async () => {
    const ctx = await start();
    const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
    const saves = mainSaves(ctx.storage);
    const result = await ctx.session.execute({ type: 'activateExtendedOverclock', requestId: 'forged', claimedAtUtcMs: NOW_MS }, { requestOrdinarySave: true });
    assert.equal(result.execution.ok, false);
    assert.equal(result.save, null);
    assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
    assert.equal(mainSaves(ctx.storage), saves);
});

test('persistence failure: activated_persistence_failed keeps the boost and the claim in memory and still returns the events', async () => {
    const ctx = await start();
    ctx.storage.failNext({ operation: 'replace', fromName: SAVE_TEMP_NAME, toName: SAVE_MAIN_NAME, mode: 'after_delete_destination', message: 'boom' });
    const result = await ctx.session.activateExtendedOverclockWithRewardedProof(proof('pf'));
    assert.equal(result.status, 'activated_persistence_failed');
    if (result.status !== 'activated_persistence_failed') return;
    assert.equal(result.save.ok, false);
    assert.deepEqual(result.execution.events.map((e) => e.type), ['temporaryBoostActivated']);
    assert.ok(ctx.session.getStateSnapshot().boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID]);
    assert.equal(claimCount(ctx), 1);
});

test('Free Overclock active when the ad completes: suspended with its remaining preserved, events Suspended then Activated', async () => {
    const state = buildAut047SeededState('ready');
    state.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID] = {
        boostId: FREE_OVERCLOCK_BOOST_ID, remainingSeconds: 30, cooldownSeconds: 240, source: 'free', requestId: null,
        effect: { type: 'productionMultiplier', multiplier: 2 }, isSuspended: false, suspendedByBoostId: null,
    };
    const ctx = await start({ state });
    const result = await ctx.session.activateExtendedOverclockWithRewardedProof(proof('fa'));
    assert.equal(result.status, 'activated_saved');
    if (result.status !== 'activated_saved') return;
    assert.deepEqual(result.execution.events.map((e) => e.type), ['temporaryBoostSuspended', 'temporaryBoostActivated']);
    const free = ctx.session.getStateSnapshot().boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID];
    assert.deepEqual({ s: free.isSuspended, by: free.suspendedByBoostId, r: free.remainingSeconds }, { s: true, by: EXTENDED_OVERCLOCK_BOOST_ID, r: 30 });
});

// ---- layer / boundary rules ---------------------------------------------------------------------

test('layer rules: lifecycle / runtime / progression / monetization import no platform, services or cc; ads code never touches game state or boosts', () => {
    for (const rel of ['lifecycle/LifecycleSessionCoordinator.ts', 'runtime/GameRuntime.ts', 'progression/TemporaryBoosts.ts', 'monetization/RewardedEligibility.ts', 'monetization/RewardedClaimHistory.ts']) {
        const source = read(`assets/scripts/${rel}`);
        const specs = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
        for (const spec of specs) {
            assert.notEqual(spec, 'cc', rel);
            assert.equal(/(^|\/)platform(\/|$)/.test(spec), false, `${rel}: ${spec}`);
            assert.equal(/(^|\/)services(\/|$)/.test(spec), false, `${rel}: ${spec}`);
        }
    }
    for (const rel of ['services/AdsService.ts', 'platform/mock/MockPlatformProviders.ts', 'platform/noop/NoOpPlatformProviders.ts']) {
        const source = read(`assets/scripts/${rel}`);
        assert.doesNotMatch(source, /GameState|activeBoosts|BoostState|TemporaryBoosts|multiplier/i, rel);
    }
});

test('the boost id, multiplier, duration and source are defined only in TemporaryBoosts.ts', () => {
    for (const rel of ['runtime/GameRuntime.ts', 'lifecycle/LifecycleSessionCoordinator.ts', 'presentation/ExtendedOverclockFlow.ts', 'presentation/HudViewModel.ts']) {
        const source = read(`assets/scripts/${rel}`);
        assert.doesNotMatch(source, /durationSeconds:\s*600|'extended_overclock'\s*,\s*multiplier|=\s*600\b/, rel);
    }
    const boosts = read('assets/scripts/progression/TemporaryBoosts.ts');
    assert.match(boosts, /export const EXTENDED_OVERCLOCK_DURATION_SECONDS = 600;/);
});

test('new scripts have a .ts.meta with a unique uuid', () => {
    const uuids = new Set<string>();
    for (const rel of ['ExtendedOverclockController', 'ExtendedOverclockFlow', 'ExtendedOverclockLayout', 'ExtendedOverclockViewModel']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${rel}.ts.meta`));
        assert.match(meta.uuid, /^[0-9a-f-]{36}$/);
        assert.equal(uuids.has(meta.uuid), false, rel);
        uuids.add(meta.uuid);
    }
});
