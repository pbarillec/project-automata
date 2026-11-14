import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import {
    EXTENDED_OVERCLOCK_CLAIM_KEY,
    EXTENDED_OVERCLOCK_RULES,
    ROLLING_WINDOW_MS,
} from '../assets/scripts/monetization/RewardedEligibility.ts';
import { getRewardedClaimHistory, recordRewardedClaim } from '../assets/scripts/monetization/RewardedClaimHistory.ts';
import {
    CURRENT_SAVE_VERSION,
    InMemorySaveStorage,
    SAVE_MAIN_NAME,
    serializeGameStateToSaveJson,
} from '../assets/scripts/persistence/index.ts';
import {
    EXTENDED_OVERCLOCK_BOOST_ID,
    EXTENDED_OVERCLOCK_DURATION_SECONDS,
    EXTENDED_OVERCLOCK_MULTIPLIER,
    EXTENDED_OVERCLOCK_SOURCE,
    FREE_OVERCLOCK_BOOST_ID,
    activateExtendedOverclock,
    activateFreeOverclock,
    advanceTemporaryBoosts,
    getEffectiveTemporaryProductionMultiplier,
} from '../assets/scripts/progression/index.ts';
import { GameRuntime } from '../assets/scripts/runtime/index.ts';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import { cloneGameState } from '../assets/scripts/state/StateClone.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';

const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const KEY = EXTENDED_OVERCLOCK_CLAIM_KEY;
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const iso = (ms: number) => new Date(ms).toISOString();

const unlocked = (): GameState => buildAut047SeededState('ready');
const withClaims = (state: GameState, ...ms: number[]): GameState => {
    for (const t of ms) state.monetization.rewardedClaims[KEY] = recordRewardedClaim(state, KEY, t);
    return state;
};
const activate = (runtime: GameRuntime, requestId = 'extended_overclock:1:1', claimedAtUtcMs = NOW_MS) =>
    runtime.execute({ type: 'activateExtendedOverclock', requestId, claimedAtUtcMs });
const advance = (runtime: GameRuntime, seconds: number) => runtime.execute({ type: 'advanceAutomation', elapsedSeconds: seconds });
const types = (events: readonly { type: string }[]) => events.map((e) => e.type);

test('constants: id, multiplier, duration, source and claim key are defined once', () => {
    assert.equal(EXTENDED_OVERCLOCK_BOOST_ID, 'extended_overclock');
    assert.equal(EXTENDED_OVERCLOCK_MULTIPLIER, 2);
    assert.equal(EXTENDED_OVERCLOCK_DURATION_SECONDS, 600);
    assert.equal(EXTENDED_OVERCLOCK_SOURCE, 'rewarded');
    assert.equal(KEY, 'rewarded.extended_overclock');
});

test('success: x2 for 600 s, source rewarded, request id stored, claim recorded in the same commit, events in order', () => {
    const runtime = new GameRuntime(repo, unlocked());
    const baseRate = runtime.getAutomatedProductionPerSecond();
    const result = activate(runtime, 'extended_overclock:42:1');
    assert.equal(result.ok, true);
    assert.deepEqual(types(result.events), ['temporaryBoostActivated']);
    const event = result.events[0] as Record<string, unknown>;
    assert.deepEqual({ boostId: event.boostId, multiplier: event.multiplier, durationSeconds: event.durationSeconds, source: event.source, cooldownSeconds: event.cooldownSeconds, requestId: event.requestId },
        { boostId: 'extended_overclock', multiplier: 2, durationSeconds: 600, source: 'rewarded', cooldownSeconds: 0, requestId: 'extended_overclock:42:1' });
    const state = runtime.getStateSnapshot();
    const boost = state.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID];
    assert.equal(boost.remainingSeconds, 600);
    assert.equal(boost.requestId, 'extended_overclock:42:1');
    assert.equal(boost.isSuspended, false);
    assert.equal(boost.suspendedByBoostId, null);
    assert.deepEqual(state.monetization.rewardedClaims[KEY], { placementId: KEY, claimCount: 1, lastClaimUtcMs: NOW_MS, recentClaimUtcMs: [NOW_MS] });
    assert.equal(getEffectiveTemporaryProductionMultiplier(state.boosts), 2);
    assert.equal(runtime.getAutomatedProductionPerSecond(), baseRate * 2);
});

test('the command is parsed strictly (non-empty request id, finite non-negative claim time)', () => {
    const runtime = new GameRuntime(repo, unlocked());
    const before = JSON.stringify(runtime.getStateSnapshot());
    for (const bad of [
        { type: 'activateExtendedOverclock' },
        { type: 'activateExtendedOverclock', requestId: '', claimedAtUtcMs: NOW_MS },
        { type: 'activateExtendedOverclock', requestId: 7, claimedAtUtcMs: NOW_MS },
        { type: 'activateExtendedOverclock', requestId: 'r', claimedAtUtcMs: -1 },
        { type: 'activateExtendedOverclock', requestId: 'r', claimedAtUtcMs: Number.NaN },
        { type: 'activateExtendedOverclock', requestId: 'r', claimedAtUtcMs: Number.POSITIVE_INFINITY },
        { type: 'activateExtendedOverclock', requestId: 'r', claimedAtUtcMs: '1' },
    ]) {
        const result = runtime.execute(bad as never);
        assert.equal(result.ok, false);
        assert.equal((result as { reason: string }).reason, 'malformed_command');
    }
    assert.equal(JSON.stringify(runtime.getStateSnapshot()), before);
});

test('locked (Free Overclock not unlocked): rejected, no mutation, no claim', () => {
    const runtime = new GameRuntime(repo, createFreshGameState());
    const before = runtime.getStateSnapshot();
    const result = activate(runtime);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, 'boost_locked');
    assert.deepEqual(runtime.getStateSnapshot(), before);
    assert.equal(before.monetization.rewardedClaims[KEY], undefined);
});

test('already active (suspended or not): rejected, no second claim, state untouched', () => {
    const runtime = new GameRuntime(repo, unlocked());
    assert.equal(activate(runtime, 'a').ok, true);
    const before = runtime.getStateSnapshot();
    const second = activate(runtime, 'b', NOW_MS + 2 * HOUR);
    assert.equal(second.ok, false);
    assert.equal((second as { reason: string }).reason, 'boost_already_active');
    assert.deepEqual(runtime.getStateSnapshot(), before);
    assert.equal(before.monetization.rewardedClaims[KEY].claimCount, 1);

    const suspendedExtended = cloneGameState(before);
    suspendedExtended.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].isSuspended = true;
    suspendedExtended.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].suspendedByBoostId = 'fixture';
    assert.equal(activateExtendedOverclock(suspendedExtended, 'c').status, 'already_active');
});

test('quota 3 per rolling 24 h: rejected with rewarded_not_eligible / quota_reached and nothing mutated; the oldest claim ages out after 24 h', () => {
    const claims = [NOW_MS - 5 * HOUR, NOW_MS - 3 * HOUR, NOW_MS - 2 * HOUR];
    const runtime = new GameRuntime(repo, withClaims(unlocked(), ...claims));
    const before = runtime.getStateSnapshot();
    const result = activate(runtime);
    assert.equal(result.ok, false);
    const rejected = result as { reason: string; details?: { reason?: string; nextEligibleAtUtc?: number | null } };
    assert.equal(rejected.reason, 'rewarded_not_eligible');
    assert.equal(rejected.details?.reason, 'quota_reached');
    assert.equal(rejected.details?.nextEligibleAtUtc, claims[0] + ROLLING_WINDOW_MS);
    assert.deepEqual(runtime.getStateSnapshot(), before);
    assert.equal(before.monetization.rewardedClaims[KEY].claimCount, 3);

    // After the oldest claim leaves the window (24 h exactly counts as outside) the same state is eligible again.
    const later = new GameRuntime(repo, withClaims(unlocked(), ...claims));
    const accepted = activate(later, 'later', claims[0] + ROLLING_WINDOW_MS);
    assert.equal(accepted.ok, true);
    assert.deepEqual(getRewardedClaimHistory(later.getStateSnapshot(), KEY), [claims[1], claims[2], claims[0] + ROLLING_WINDOW_MS]);
});

test('minimum interval: 59 min after the last claim is rejected (min_interval), 60 min is accepted', () => {
    const tooSoon = new GameRuntime(repo, withClaims(unlocked(), NOW_MS - 59 * MIN));
    const before = tooSoon.getStateSnapshot();
    const rejected = activate(tooSoon) as { ok: boolean; reason: string; details?: { reason?: string; nextEligibleAtUtc?: number } };
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'rewarded_not_eligible');
    assert.equal(rejected.details?.reason, 'min_interval');
    assert.equal(rejected.details?.nextEligibleAtUtc, NOW_MS - 59 * MIN + EXTENDED_OVERCLOCK_RULES.minimumIntervalMinutes! * MIN);
    assert.deepEqual(tooSoon.getStateSnapshot(), before);

    const ok = new GameRuntime(repo, withClaims(unlocked(), NOW_MS - 60 * MIN));
    assert.equal(activate(ok).ok, true);
    assert.equal(ok.getStateSnapshot().monetization.rewardedClaims[KEY].claimCount, 2);
});

test('suspicious clock fails closed: a claim in the future rejects with suspicious_time and never mutates', () => {
    const runtime = new GameRuntime(repo, withClaims(unlocked(), NOW_MS + 5 * MIN));
    const before = runtime.getStateSnapshot();
    const result = activate(runtime) as { ok: boolean; reason: string; details?: { reason?: string; nextEligibleAtUtc?: number | null } };
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'rewarded_not_eligible');
    assert.equal(result.details?.reason, 'suspicious_time');
    assert.equal(result.details?.nextEligibleAtUtc, null);
    assert.deepEqual(runtime.getStateSnapshot(), before);
});

test('effective multiplier with Free active + Extended is 2 (never 4) and production equals a lone Free x2', () => {
    const free = new GameRuntime(repo, unlocked());
    assert.equal(free.execute({ type: 'activateFreeOverclock' }).ok, true);
    const lone = free.getAutomatedProductionPerSecond();
    const base = new GameRuntime(repo, unlocked()).getAutomatedProductionPerSecond();
    assert.equal(lone, base * 2);

    const both = new GameRuntime(repo, unlocked());
    assert.equal(both.execute({ type: 'activateFreeOverclock' }).ok, true);
    const result = activate(both);
    assert.equal(result.ok, true);
    assert.deepEqual(types(result.events), ['temporaryBoostSuspended', 'temporaryBoostActivated']);
    const state = both.getStateSnapshot();
    const suspended = state.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID];
    assert.equal(suspended.isSuspended, true);
    assert.equal(suspended.suspendedByBoostId, EXTENDED_OVERCLOCK_BOOST_ID);
    assert.equal(suspended.remainingSeconds, 60);
    assert.equal(getEffectiveTemporaryProductionMultiplier(state.boosts), 2);
    assert.equal(both.getAutomatedProductionPerSecond(), lone);
});

test('Free suspend / resume: Free 30 s -> Extended -> 600 s -> Free resumes with 30 s -> 30 s -> Free expires -> normal 240 s cooldown', () => {
    const runtime = new GameRuntime(repo, unlocked());
    assert.equal(runtime.execute({ type: 'activateFreeOverclock' }).ok, true);
    advance(runtime, 30);
    assert.equal(runtime.getStateSnapshot().boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 30);
    assert.equal(activate(runtime).ok, true);

    // While Extended runs the Free timer is frozen.
    advance(runtime, 599);
    let boosts = runtime.getStateSnapshot().boosts;
    assert.equal(boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 30);
    assert.equal(boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].isSuspended, true);
    assert.equal(boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].remainingSeconds, 1);

    const crossing = advance(runtime, 1);
    assert.deepEqual(types(crossing.events).filter((t) => t.startsWith('temporaryBoost')), ['temporaryBoostExpired', 'temporaryBoostResumed']);
    boosts = runtime.getStateSnapshot().boosts;
    assert.equal(boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID], undefined);
    assert.equal(boosts.cooldowns[EXTENDED_OVERCLOCK_BOOST_ID], undefined, 'Extended has no cooldown');
    assert.equal(boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].isSuspended, false);
    assert.equal(boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].suspendedByBoostId, null);
    assert.equal(boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 30);
    const resumed = crossing.events.find((e) => e.type === 'temporaryBoostResumed') as unknown as { boostId: string; remainingSeconds: number };
    assert.deepEqual({ boostId: resumed.boostId, remainingSeconds: resumed.remainingSeconds }, { boostId: FREE_OVERCLOCK_BOOST_ID, remainingSeconds: 30 });

    const finish = advance(runtime, 30);
    assert.deepEqual(types(finish.events).filter((t) => t.startsWith('temporaryBoost')), ['temporaryBoostExpired']);
    boosts = runtime.getStateSnapshot().boosts;
    assert.deepEqual(boosts.activeBoosts, {});
    assert.equal(boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 240);
});

test('a single advance of 700 s crosses both boundaries: Extended expiry, Free resume + expiry, cooldown ticking, production per segment', () => {
    const runtime = new GameRuntime(repo, unlocked());
    const baseRate = new GameRuntime(repo, unlocked()).getAutomatedProductionPerSecond();
    assert.equal(runtime.execute({ type: 'activateFreeOverclock' }).ok, true);
    advance(runtime, 30);
    assert.equal(activate(runtime).ok, true);
    const startIo = runtime.getStateSnapshot().run.industrialOutput;
    const result = advance(runtime, 700);
    const boostEvents = types(result.events).filter((t) => t.startsWith('temporaryBoost'));
    assert.deepEqual(boostEvents, ['temporaryBoostExpired', 'temporaryBoostResumed', 'temporaryBoostExpired']);
    const state = runtime.getStateSnapshot();
    assert.deepEqual(state.boosts.activeBoosts, {});
    // Free expired 30 s after the resume (t = 630); 70 s of the 240 s cooldown have run.
    assert.ok(Math.abs(state.boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds - 170) < 1e-9);
    const expectedGain = baseRate * 2 * 630 + baseRate * 70;
    assert.ok(Math.abs((state.run.industrialOutput - startIo) - expectedGain) <= expectedGain * 1e-9, `${state.run.industrialOutput - startIo} vs ${expectedGain}`);
});

test('Free Overclock in cooldown keeps ticking while Extended runs', () => {
    const runtime = new GameRuntime(repo, unlocked());
    runtime.execute({ type: 'activateFreeOverclock' });
    advance(runtime, 60);
    assert.equal(runtime.getStateSnapshot().boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 240);
    assert.equal(activate(runtime).ok, true);
    advance(runtime, 100);
    const boosts = runtime.getStateSnapshot().boosts;
    assert.equal(boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 140);
    assert.equal(boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].remainingSeconds, 500);
    assert.equal(boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID], undefined);
});

test('Free Overclock cannot start while Extended is active (boost_suspended), even when it is READY', () => {
    const runtime = new GameRuntime(repo, unlocked());
    assert.equal(activate(runtime).ok, true);
    const before = runtime.getStateSnapshot();
    const result = runtime.execute({ type: 'activateFreeOverclock' });
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, 'boost_suspended');
    assert.deepEqual(runtime.getStateSnapshot(), before);
    assert.equal(activateFreeOverclock(before).status, 'suspended');
});

test('auto-resume only follows the suspender that expired (a fixture suspender that never existed leaves the boost suspended)', () => {
    const state = unlocked();
    state.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID] = {
        boostId: FREE_OVERCLOCK_BOOST_ID, remainingSeconds: 30, cooldownSeconds: 240, source: 'free', requestId: null,
        effect: { type: 'productionMultiplier', multiplier: 2 }, isSuspended: true, suspendedByBoostId: 'fixture',
    };
    const advanced = advanceTemporaryBoosts(state.boosts, 999);
    assert.equal(advanced.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].isSuspended, true);
    assert.deepEqual(advanced.events, []);
});

test('save / load round trip keeps Extended active, Free suspended with its suspender link, and the claim', async () => {
    const runtime = new GameRuntime(repo, withClaims(unlocked(), NOW_MS - 2 * HOUR));
    runtime.execute({ type: 'activateFreeOverclock' });
    advance(runtime, 12);
    assert.equal(activate(runtime).ok, true);
    advance(runtime, 100);
    const state = runtime.getStateSnapshot();
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS - 1000) }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    assert.equal(boot.startup.ok, true);
    if (!boot.startup.ok) return;
    const loaded = boot.startup.session.getStateSnapshot();
    assert.deepEqual(loaded.boosts, state.boosts);
    assert.equal(loaded.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].suspendedByBoostId, EXTENDED_OVERCLOCK_BOOST_ID);
    assert.equal(loaded.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 48);
    assert.equal(loaded.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].remainingSeconds, 500);
    assert.deepEqual(loaded.monetization.rewardedClaims[KEY], state.monetization.rewardedClaims[KEY]);
    assert.equal(loaded.monetization.rewardedClaims[KEY].claimCount, 2);
});

test('a closed app freezes the boost timers: an offline absence and its collect never touch them', async () => {
    const runtime = new GameRuntime(repo, unlocked());
    assert.equal(activate(runtime).ok, true);
    advance(runtime, 100);
    const state = runtime.getStateSnapshot();
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS - 3 * 3600 * 1000) }),
    });
    const boot = await bootstrapGameSession({ storage, timeService: new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 }) });
    assert.equal(boot.startup.ok, true);
    if (!boot.startup.ok) return;
    const session = boot.startup.session;
    assert.notEqual(session.getPendingOfflinePreview(), null);
    assert.deepEqual(session.getStateSnapshot().boosts, state.boosts);
    await session.collectPendingOffline();
    const after = session.getStateSnapshot().boosts;
    assert.equal(after.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID].remainingSeconds, 500);
    assert.deepEqual(after, state.boosts);
});
