import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import {
    OFFLINE_DOUBLE_CLAIM_KEY,
    OFFLINE_DOUBLE_MULTIPLIER,
    OFFLINE_DOUBLE_RULES,
    ROLLING_WINDOW_MS,
    evaluateOfflineDoubleEligibility,
} from '../assets/scripts/monetization/RewardedEligibility.ts';
import { getRewardedClaimHistory, recordRewardedClaim } from '../assets/scripts/monetization/RewardedClaimHistory.ts';
import { collectOfflineProgress, createOfflineProgressPreviewFromUtc } from '../assets/scripts/offline/index.ts';
import {
    CURRENT_SAVE_VERSION,
    InMemorySaveStorage,
    SAVE_MAIN_NAME,
    SAVE_TEMP_NAME,
    serializeGameStateToSaveJson,
} from '../assets/scripts/persistence/index.ts';
import { cloneGameState } from '../assets/scripts/state/StateClone.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { RewardClaimLedger } from '../assets/scripts/services/RewardClaimLedger.ts';
import { buildAut051SeededState } from '../tools/device/seed_aut051.ts';

const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

function saveText(state: ReturnType<typeof buildAut051SeededState>, savedAtMs: number): string {
    return serializeGameStateToSaveJson(state, {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: '0.1.0-test',
        contentVersion: repo.contentVersion,
        savedAtUtc: iso(savedAtMs),
    });
}

interface StartOptions {
    absenceSeconds?: number;
    claimsMs?: number[];
    storage?: InMemorySaveStorage;
    ledger?: { tryConsume(id: string): boolean };
}

async function start(options: StartOptions = {}) {
    const absence = (options.absenceSeconds ?? 3 * 3600) * 1000;
    const state = buildAut051SeededState('first');
    for (const t of options.claimsMs ?? []) {
        state.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY] = recordRewardedClaim(state, OFFLINE_DOUBLE_CLAIM_KEY, t);
    }
    const storage = options.storage ?? new InMemorySaveStorage({ [SAVE_MAIN_NAME]: saveText(state, NOW_MS - absence) });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    assert.equal(boot.startup.ok, true);
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, boot, session: boot.startup.session, state };
}

const proof = (requestId: string, over: Record<string, unknown> = {}) => ({
    requestId,
    placementId: OFFLINE_DOUBLE_CLAIM_KEY,
    status: 'rewarded',
    rewardVerified: true,
    ...over,
});

function mainSaves(storage: InMemorySaveStorage): number {
    return storage.operationLog().filter((o) => o.operation === 'replace' && o.toName === SAVE_MAIN_NAME).length;
}

// ---- offline service multiplier ------------------------------------------------------------

test('multiplier 1 (default) is identical to the previous behaviour', () => {
    const state = buildAut051SeededState('first');
    const preview = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: iso(NOW_MS - 3 * HOUR), currentUtcIso: iso(NOW_MS),
    });
    const a = collectOfflineProgress(repo, state, { preview });
    const b = collectOfflineProgress(repo, state, { preview }, { rewardMultiplier: 1 });
    assert.deepEqual(a, b);
    assert.equal('rewardMultiplier' in (a as any).criticalSaveRequest, false);
});

test('multiplier 2 grants exactly 2x the normal applied reward, robots untouched, stats follow', () => {
    const state = buildAut051SeededState('first');
    const preview = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: iso(NOW_MS - 3 * HOUR), currentUtcIso: iso(NOW_MS),
    }) as any;
    assert.equal(preview.status, 'preview_ready');
    const normal = collectOfflineProgress(repo, state, { preview }) as any;
    const doubled = collectOfflineProgress(repo, state, { preview }, { rewardMultiplier: 2 }) as any;
    const normalGain = normal.state.run.industrialOutput - state.run.industrialOutput;
    assert.ok(normalGain > 0);
    assert.equal(doubled.state.run.industrialOutput - state.run.industrialOutput, 2 * normalGain);
    assert.equal(doubled.state.run.statistics.industrialOutputEarned - state.run.statistics.industrialOutputEarned, 2 * normalGain);
    assert.equal(doubled.state.lifetime.industrialOutputEarned - state.lifetime.industrialOutputEarned, 2 * normalGain);
    assert.equal(doubled.state.run.robotsBuilt, normal.state.run.robotsBuilt);
    assert.equal(doubled.criticalSaveRequest.robotsBuiltDelta, normal.criticalSaveRequest.robotsBuiltDelta);
    assert.equal(doubled.criticalSaveRequest.rewardMultiplier, 2);
    assert.equal(doubled.criticalSaveRequest.grantedIndustrialOutput, 2 * normalGain);
});

test('multiplier is applied after the withheld assisted-batch subtraction and never scales batch timers', () => {
    const state = buildAut051SeededState('first');
    state.run.assistedBatches.assembly_station = { remainingSeconds: 600, durationSeconds: 600 } as any;
    const preview = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: iso(NOW_MS - 3 * HOUR), currentUtcIso: iso(NOW_MS),
    }) as any;
    if (preview.assistedBatchSettlements.length === 0) return; // config without assisted batches: nothing to withhold
    // The session advanced the batch after the preview: the settlement is withheld.
    const advanced = cloneGameState(state);
    advanced.run.assistedBatches.assembly_station.remainingSeconds = 300;
    const normal = collectOfflineProgress(repo, advanced, { preview }) as any;
    const doubled = collectOfflineProgress(repo, advanced, { preview }, { rewardMultiplier: 2 }) as any;
    const normalGain = normal.state.run.industrialOutput - advanced.run.industrialOutput;
    assert.equal(doubled.state.run.industrialOutput - advanced.run.industrialOutput, 2 * normalGain);
    assert.deepEqual(doubled.state.run.assistedBatches, normal.state.run.assistedBatches);
});

test('invalid multipliers are invalid_config and never mutate', () => {
    const state = buildAut051SeededState('first');
    const before = JSON.stringify(state);
    const preview = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: iso(NOW_MS - 3 * HOUR), currentUtcIso: iso(NOW_MS),
    });
    for (const bad of [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = collectOfflineProgress(repo, state, { preview }, { rewardMultiplier: bad });
        assert.equal(result.status, 'invalid_config');
        assert.equal(JSON.stringify(state), before);
    }
});

// ---- constants / offer ------------------------------------------------------------------------

test('constants and offer', async () => {
    assert.equal(OFFLINE_DOUBLE_MULTIPLIER, 2);
    assert.equal(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded.offline_double');
    const { session } = await start();
    const preview = session.getPendingOfflinePreview() as any;
    const offer = session.getOfflineDoubleOffer()!;
    assert.equal(offer.multiplier, 2);
    assert.equal(offer.projectedReward, 2 * preview.totalIndustrialOutputReward);
    assert.deepEqual(offer.eligibility, evaluateOfflineDoubleEligibility({
        nowUtcMs: NOW_MS, hasCollectibleReport: true, effectiveOfflineSeconds: preview.effectiveOfflineSeconds, claimTimestampsUtcMs: [],
    }));
    assert.equal(offer.eligibility.eligible, true);
    await session.collectPendingOffline();
    assert.equal(session.getOfflineDoubleOffer(), null);
});

// ---- coordinator grant --------------------------------------------------------------------------

test('verified rewarded ad grants exactly 2x once, one critical save, claim durable after reload', async () => {
    const control = await start();
    const controlBefore = control.session.getStateSnapshot().run.industrialOutput;
    await control.session.collectPendingOffline();
    const normalGain = control.session.getStateSnapshot().run.industrialOutput - controlBefore;

    const ctx = await start();
    const before = ctx.session.getStateSnapshot();
    const savesBefore = mainSaves(ctx.storage);
    const result = await ctx.session.collectPendingOfflineWithRewardedBonus(proof('r1')) as any;
    assert.equal(result.status, 'collected_saved');
    assert.equal(result.bonusGranted, true);
    assert.equal(mainSaves(ctx.storage) - savesBefore, 1);
    const after = ctx.session.getStateSnapshot();
    assert.equal(after.run.industrialOutput - before.run.industrialOutput, 2 * normalGain);
    const claim = after.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY];
    assert.equal(claim.claimCount, 1);
    assert.equal(claim.recentClaimUtcMs.length, 1);
    assert.equal(claim.recentClaimUtcMs[0], NOW_MS);
    assert.equal(ctx.session.getPendingOfflinePreview(), null);
    assert.equal(result.collect.criticalSaveRequest.rewardMultiplier, 2);

    // second invocation (same or new id) cannot grant again: nothing pending.
    assert.equal((await ctx.session.collectPendingOfflineWithRewardedBonus(proof('r1'))).status, 'no_pending_preview');
    assert.equal((await ctx.session.collectPendingOfflineWithRewardedBonus(proof('r2'))).status, 'no_pending_preview');

    // durable after reload
    const reloaded = await start({ storage: ctx.storage });
    const state = reloaded.session.getStateSnapshot();
    assert.equal(state.run.industrialOutput, after.run.industrialOutput);
    assert.equal(state.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY].claimCount, 1);
    assert.equal(reloaded.session.getPendingOfflinePreview(), null);
});

test('simultaneous invocations grant exactly one bonus', async () => {
    const ctx = await start();
    const before = ctx.session.getStateSnapshot().run.industrialOutput;
    const [a, b] = await Promise.all([
        ctx.session.collectPendingOfflineWithRewardedBonus(proof('same')),
        ctx.session.collectPendingOfflineWithRewardedBonus(proof('same')),
    ]) as any[];
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ['collected_saved', 'no_pending_preview']);
    const claim = ctx.session.getStateSnapshot().monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY];
    assert.equal(claim.claimCount, 1);
    assert.ok(ctx.session.getStateSnapshot().run.industrialOutput > before);
});

test('non-granting proofs change nothing; free collect then equals the control', async () => {
    const control = await start();
    await control.session.collectPendingOffline();
    const controlState = control.session.getStateSnapshot();

    const ctx = await start();
    const savesBefore = mainSaves(ctx.storage);
    const pendingBefore = ctx.session.getPendingOfflinePreview();
    const snapshotBefore = JSON.stringify(ctx.session.getStateSnapshot());
    const cases: Array<[Record<string, unknown>, string]> = [
        [{ status: 'closed', rewardVerified: false }, 'not_rewarded'],
        [{ status: 'failed', rewardVerified: false }, 'not_rewarded'],
        [{ status: 'unavailable', rewardVerified: false }, 'not_rewarded'],
        [{ status: 'timeout', rewardVerified: false }, 'not_rewarded'],
        [{ status: 'rewarded', rewardVerified: false }, 'not_verified'],
        [{ duplicate: true }, 'duplicate'],
        [{ placementId: 'rewarded.extended_overclock' }, 'wrong_placement'],
        [{ requestId: '' }, 'bad_request_id'],
        [{ requestId: '   ' }, 'bad_request_id'],
    ];
    for (const [over, reason] of cases) {
        const r = await ctx.session.collectPendingOfflineWithRewardedBonus(proof('x', over)) as any;
        assert.equal(r.status, 'bonus_not_granted');
        assert.equal(r.reason, reason);
    }
    assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshotBefore);
    assert.equal(ctx.session.getPendingOfflinePreview(), pendingBefore);
    assert.equal(mainSaves(ctx.storage), savesBefore);

    // a closed ad never burns an id: the same id can still be granted afterwards
    const ok = await ctx.session.collectPendingOfflineWithRewardedBonus(proof('x')) as any;
    assert.equal(ok.status, 'collected_saved');

    // control: full free reward with no ad attempt
    const free = await start();
    await free.session.collectPendingOffline();
    assert.equal(free.session.getStateSnapshot().run.industrialOutput, controlState.run.industrialOutput);
    const ctx2 = await start();
    await ctx2.session.collectPendingOfflineWithRewardedBonus(proof('y', { status: 'closed', rewardVerified: false }));
    await ctx2.session.collectPendingOffline();
    assert.equal(ctx2.session.getStateSnapshot().run.industrialOutput, controlState.run.industrialOutput);
    assert.equal(ctx2.session.getStateSnapshot().monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY], undefined);
});

test('a replayed request id (ledger) is a no-op duplicate', async () => {
    const ledger = new RewardClaimLedger();
    const ctx = await start({ ledger });
    // construct with ledger through startup options
    const { LifecycleSessionCoordinator } = await import('../assets/scripts/lifecycle/index.ts');
    const started = await LifecycleSessionCoordinator.startup({
        configRepository: ctx.boot.configRepository,
        persistence: (ctx.session as any).persistence,
        timeService: ctx.clock,
        rewardClaimLedger: ledger,
    });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    ledger.tryConsume('seen');
    const r = await started.session.collectPendingOfflineWithRewardedBonus(proof('seen')) as any;
    assert.equal(r.status, 'bonus_not_granted');
    assert.equal(r.reason, 'duplicate');
    assert.notEqual(started.session.getPendingOfflinePreview(), null);
});

test('eligibility boundaries are enforced at grant time', async () => {
    const minSeconds = OFFLINE_DOUBLE_RULES.minimumOfflineMinutes! * 60;
    const short = await start({ absenceSeconds: minSeconds - 1 });
    assert.equal(short.session.getOfflineDoubleOffer()!.eligibility.reason, 'below_min_offline');
    assert.equal(((await short.session.collectPendingOfflineWithRewardedBonus(proof('a'))) as any).reason, 'ineligible');

    const exact = await start({ absenceSeconds: minSeconds });
    assert.equal(exact.session.getOfflineDoubleOffer()!.eligibility.eligible, true);
    assert.equal((await exact.session.collectPendingOfflineWithRewardedBonus(proof('a'))).status, 'collected_saved');

    const quota = await start({ claimsMs: [NOW_MS - 3 * HOUR, NOW_MS - 2 * HOUR, NOW_MS - HOUR] });
    assert.equal(quota.session.getOfflineDoubleOffer()!.eligibility.reason, 'quota_reached');
    assert.equal(((await quota.session.collectPendingOfflineWithRewardedBonus(proof('a'))) as any).reason, 'ineligible');

    const aged = await start({ claimsMs: [NOW_MS - ROLLING_WINDOW_MS, NOW_MS - 2 * HOUR, NOW_MS - HOUR] });
    assert.equal(aged.session.getOfflineDoubleOffer()!.eligibility.eligible, true);
    assert.equal((await aged.session.collectPendingOfflineWithRewardedBonus(proof('a'))).status, 'collected_saved');
    assert.equal(aged.session.getStateSnapshot().monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY].recentClaimUtcMs.length, 3);

    const future = await start({ claimsMs: [NOW_MS + HOUR] });
    assert.equal(future.session.getOfflineDoubleOffer()!.eligibility.reason, 'suspicious_time');
    assert.equal(((await future.session.collectPendingOfflineWithRewardedBonus(proof('a'))) as any).reason, 'ineligible');
});

test('persistence failure after apply: reward and claim stay in memory, bonusGranted true', async () => {
    const ctx = await start();
    ctx.storage.failNext({ operation: 'replace', fromName: SAVE_TEMP_NAME, toName: SAVE_MAIN_NAME, mode: 'after_delete_destination', message: 'boom' });
    const before = ctx.session.getStateSnapshot().run.industrialOutput;
    const r = await ctx.session.collectPendingOfflineWithRewardedBonus(proof('p')) as any;
    assert.equal(r.status, 'collected_persistence_failed');
    assert.equal(r.bonusGranted, true);
    const state = ctx.session.getStateSnapshot();
    assert.ok(state.run.industrialOutput > before);
    assert.equal(state.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY].claimCount, 1);
});

test('a new request id after a closed ad can be granted', async () => {
    const ctx = await start();
    assert.equal(((await ctx.session.collectPendingOfflineWithRewardedBonus(proof('a1', { status: 'closed', rewardVerified: false }))) as any).status, 'bonus_not_granted');
    const r = await ctx.session.collectPendingOfflineWithRewardedBonus(proof('a2')) as any;
    assert.equal(r.status, 'collected_saved');
    assert.equal(r.bonusGranted, true);
});

test('crash before the save leaves the preview pending and no claim', async () => {
    const ctx = await start();
    const savedBefore = ctx.storage.getFile(SAVE_MAIN_NAME);
    // the apply happens in memory; "kill" = a fresh session over the unchanged storage
    ctx.storage.failNext({ operation: 'write', name: SAVE_TEMP_NAME, mode: 'before', message: 'killed' });
    await ctx.session.collectPendingOfflineWithRewardedBonus(proof('k'));
    ctx.storage.setFile(SAVE_MAIN_NAME, savedBefore!);
    const reloaded = await start({ storage: ctx.storage });
    assert.notEqual(reloaded.session.getPendingOfflinePreview(), null);
    assert.equal(reloaded.session.getStateSnapshot().monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY], undefined);
    assert.deepEqual(getRewardedClaimHistory(reloaded.session.getStateSnapshot(), OFFLINE_DOUBLE_CLAIM_KEY), []);
});
