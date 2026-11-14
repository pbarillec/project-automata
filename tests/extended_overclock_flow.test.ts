import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { recordRewardedClaim } from '../assets/scripts/monetization/RewardedClaimHistory.ts';
import { CURRENT_SAVE_VERSION, InMemorySaveStorage, SAVE_MAIN_NAME, serializeGameStateToSaveJson } from '../assets/scripts/persistence/index.ts';
import { EXTENDED_OVERCLOCK_BOOST_ID } from '../assets/scripts/progression/index.ts';
import { MockAdsService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { NoOpAdsService } from '../assets/scripts/platform/noop/NoOpPlatformProviders.ts';
import { createBuildAdsService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { DEBUG_ADS_MAX_STEPS, parseDebugAdsScriptFile } from '../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { EXTENDED_OVERCLOCK_AD_AVAILABILITY_TTL_MS, ExtendedOverclockFlow } from '../assets/scripts/presentation/ExtendedOverclockFlow.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const KEY = EXTENDED_OVERCLOCK_CLAIM_KEY;
const iso = (ms: number) => new Date(ms).toISOString();
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

async function start(options: { claimsMs?: number[]; absenceSeconds?: number } = {}) {
    const state = buildAut047SeededState('ready');
    for (const t of options.claimsMs ?? []) state.monetization.rewardedClaims[KEY] = recordRewardedClaim(state, KEY, t);
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, {
            saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion,
            savedAtUtc: iso(NOW_MS - (options.absenceSeconds ?? 0) * 1000),
        }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, boot, session: boot.startup.session };
}
type Ctx = Awaited<ReturnType<typeof start>>;

function makeFlow(ctx: Ctx, ads: MockAdsService | NoOpAdsService = createBuildAdsService(true) as MockAdsService, nowRef = { ms: NOW_MS }) {
    const diag: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const fanOuts: unknown[][] = [];
    let changes = 0;
    const binding = new FactoryWorldStateBinding({
        session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: {
            syncAutomationState: () => undefined,
            consumeDomainEvents: (_state, events) => { fanOuts.push([...events]); },
        }, hud: null, panel: null,
    });
    const flow = new ExtendedOverclockFlow({
        ads,
        session: {
            getExtendedOverclockOffer: () => binding.getExtendedOverclockOffer(),
            activateExtendedOverclockWithProof: (proof) => binding.activateExtendedOverclockWithProof(proof),
        },
        now: () => nowRef.ms,
        onChange: () => { changes += 1; },
        onDiagnostic: (phase, payload) => diag.push({ phase, payload }),
    });
    return { flow, ads, diag, fanOuts, binding, changes: () => changes, nowRef };
}

const claimCount = (ctx: Ctx) => ctx.session.getStateSnapshot().monetization.rewardedClaims[KEY]?.claimCount ?? 0;

test('flow: offered, a verified rewarded ad grants Extended Overclock once; the grant fans out the boost events and hides the offer', async () => {
    const ctx = await start();
    const { flow, diag, fanOuts } = makeFlow(ctx);
    const state = await flow.refreshOffer();
    assert.deepEqual([state.offer, state.blockedBy, state.adAvailable], [true, null, true]);
    assert.equal(await flow.start(), 'granted');
    assert.equal(claimCount(ctx), 1);
    assert.ok(ctx.session.getStateSnapshot().boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID]);
    assert.deepEqual(diag.map((d) => d.phase).filter((p) => p !== 'offer'), ['ad_started', 'ad_result', 'granted']);
    const granted = diag.find((d) => d.phase === 'granted')!.payload;
    assert.deepEqual({ multiplier: granted.multiplier, durationSeconds: granted.durationSeconds, claimCount: granted.claimCount, saveOk: granted.saveOk }, { multiplier: 2, durationSeconds: 600, claimCount: 1, saveOk: true });
    assert.match(String(diag.find((d) => d.phase === 'ad_started')!.payload.requestId), /^extended_overclock:\d+:1$/);
    assert.equal(fanOuts.length, 1, 'the AUT-047 impulse path receives the boost events once');
    assert.deepEqual(fanOuts[0].map((e) => (e as { type: string }).type), ['temporaryBoostActivated']);
    // After the grant the re-read offer is hidden (already active).
    const after = flow.getState();
    assert.equal(after.offer, false);
    assert.equal(after.blockedBy, 'player', 'the claim just made also triggers the minimum interval; the player reason wins');
});

test('flow: the four canOfferRewarded combinations (player reason wins)', async () => {
    const eligible = await start();
    const ad = (available: boolean) => { const a = createBuildAdsService(true) as MockAdsService; a.setPlacement(KEY, { available }); return a; };
    const a = await makeFlow(eligible, ad(true)).flow.refreshOffer();
    assert.deepEqual([a.offer, a.blockedBy], [true, null]);
    const b = await makeFlow(eligible, ad(false)).flow.refreshOffer();
    assert.deepEqual([b.offer, b.blockedBy], [false, 'ad']);
    const quota = await start({ claimsMs: [NOW_MS - 4 * HOUR, NOW_MS - 3 * HOUR, NOW_MS - 2 * HOUR] });
    const c = await makeFlow(quota, ad(true)).flow.refreshOffer();
    assert.deepEqual([c.offer, c.blockedBy, c.eligibility?.reason], [false, 'player', 'quota_reached']);
    const d = await makeFlow(quota, ad(false)).flow.refreshOffer();
    assert.deepEqual([d.offer, d.blockedBy], [false, 'player']);
});

test('flow: activation gates (already active / Free locked / offline pending) hide the offer without touching eligibility', async () => {
    const active = await start();
    await active.session.activateExtendedOverclockWithRewardedProof({ requestId: 'r', placementId: KEY, status: 'rewarded', rewardVerified: true });
    const a = await makeFlow(active).flow.refreshOffer();
    assert.equal(a.offer, false);
    assert.ok(a.blockedBy === 'player' || a.blockedBy === 'active');

    const pending = await start({ absenceSeconds: 3 * 3600 });
    const b = await makeFlow(pending).flow.refreshOffer();
    assert.deepEqual([b.offer, b.blockedBy], [false, 'active']);
});

for (const outcome of ['closed', 'failed', 'unavailable', 'timeout'] as const) {
    test(`flow: ${outcome} grants nothing, changes no state, and the offer is re-read`, async () => {
        const ctx = await start();
        const ads = createBuildAdsService(true, { offlineDouble: [], extendedOverclock: [outcome], duplicateCallback: false }) as MockAdsService;
        const { flow, diag, fanOuts } = makeFlow(ctx, ads);
        await flow.refreshOffer();
        const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
        assert.equal(await flow.start(), 'not_granted');
        assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
        assert.equal(claimCount(ctx), 0);
        assert.equal(fanOuts.length, 0, 'not_granted fans out nothing');
        assert.equal(diag.find((d) => d.phase === 'ad_result')!.payload.rewardVerified, false);
        assert.equal(diag.find((d) => d.phase === 'not_granted')!.payload.reason, 'not_rewarded');
        assert.equal(diag.filter((d) => d.phase === 'offer').length, 2, 'the offer is re-read after the attempt');
        assert.equal(flow.getState().inFlight, false);
    });
}

test('flow: a second start while an ad is in flight returns null (no second ad); the chip is inert meanwhile', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true) as MockAdsService;
    ads.enqueueOutcomes(KEY, { outcome: 'rewarded', manual: true });
    const { flow, diag } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    const first = flow.start();
    assert.equal(await flow.start(), null);
    assert.equal(flow.getState().inFlight, true);
    await Promise.resolve();
    await Promise.resolve();
    ads.gate.release(String(diag.find((d) => d.phase === 'ad_started')!.payload.requestId));
    assert.equal(await first, 'granted');
    assert.equal(ads.calls.filter((c) => c.method === 'showRewarded').length, 1);
    assert.equal(claimCount(ctx), 1);
    assert.equal(flow.getState().inFlight, false);
});

test('flow: a duplicate ad callback never grants twice', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true, { offlineDouble: [], extendedOverclock: ['rewarded'], duplicateCallback: true }) as MockAdsService;
    const { flow } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    assert.equal(await flow.start(), 'granted');
    const duplicate = ads.deliveries.find((d) => d.duplicate === true)!;
    assert.ok(duplicate, 'the mock delivered a duplicate callback');
    const replay = await ctx.session.activateExtendedOverclockWithRewardedProof(duplicate);
    assert.equal(replay.status, 'not_granted');
    assert.equal(claimCount(ctx), 1);
});

test('flow: a verified result that lands after Extended became active another way is a harmless stale no-op', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true) as MockAdsService;
    ads.enqueueOutcomes(KEY, { outcome: 'rewarded', manual: true });
    const { flow, diag } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    const pending = flow.start();
    await Promise.resolve();
    await Promise.resolve();
    // A different verified proof activates it while the first ad is still showing.
    await ctx.session.activateExtendedOverclockWithRewardedProof({ requestId: 'other', placementId: KEY, status: 'rewarded', rewardVerified: true });
    const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
    ads.gate.release(String(diag.find((d) => d.phase === 'ad_started')!.payload.requestId));
    assert.equal(await pending, 'stale');
    assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
    assert.equal(claimCount(ctx), 1);
});

test('flow: the ad availability is cached for 5 s and re-read after every attempt', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true) as MockAdsService;
    const { flow, nowRef } = makeFlow(ctx, ads);
    let reads = 0;
    const original = ads.getRewardedAvailability.bind(ads);
    ads.getRewardedAvailability = (async (id: string) => { reads += 1; return original(id); }) as never;
    const availabilityReads = () => reads;
    await flow.refreshOffer();
    await flow.refreshOffer();
    assert.equal(availabilityReads(), 1);
    nowRef.ms += EXTENDED_OVERCLOCK_AD_AVAILABILITY_TTL_MS - 1;
    await flow.refreshOffer();
    assert.equal(availabilityReads(), 1);
    nowRef.ms += 1;
    await flow.refreshOffer();
    assert.equal(availabilityReads(), 2);
    ads.enqueueOutcomes(KEY, { outcome: 'closed' });
    await flow.start();
    assert.equal(availabilityReads(), 4, 'after the attempt: the start() read plus the forced re-read');
});

test('flow: the latest refresh wins (a slow stale refresh never overwrites a newer state)', async () => {
    const ctx = await start();
    const { flow } = makeFlow(ctx);
    const first = flow.refreshOffer();
    const second = flow.refreshOffer();
    await Promise.all([first, second]);
    assert.equal(flow.getState().offer, true);
});

test('flow: a throwing session or ad provider degrades to hidden / error, never throws', async () => {
    const throwingAds = { getRewardedAvailability: async () => { throw new Error('boom'); }, showRewarded: async () => { throw new Error('boom'); } } as never;
    const ctx = await start();
    const { flow } = makeFlow(ctx, throwingAds);
    const state = await flow.refreshOffer();
    assert.deepEqual([state.offer, state.blockedBy, state.adAvailable], [false, 'ad', false]);
    const broken = new ExtendedOverclockFlow({ ads: createBuildAdsService(true), session: { getExtendedOverclockOffer: () => { throw new Error('x'); }, activateExtendedOverclockWithProof: async () => null }, now: () => NOW_MS });
    assert.equal((await broken.refreshOffer()).offer, false);
    assert.equal(await broken.start(), 'error');
});

test('flow: NoOp ads never offer (release builds), and createBuildAdsService(false) is NoOp for both placements', async () => {
    const ctx = await start();
    const noop = createBuildAdsService(false);
    assert.ok(noop instanceof NoOpAdsService);
    assert.equal((await noop.getRewardedAvailability(KEY)).available, false);
    assert.equal((await noop.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, false);
    const state = await makeFlow(ctx, noop as NoOpAdsService).flow.refreshOffer();
    assert.deepEqual([state.offer, state.blockedBy], [false, 'ad']);
    const debug = createBuildAdsService(true);
    assert.ok(debug instanceof MockAdsService);
    assert.equal((await debug.getRewardedAvailability(KEY)).available, true);
    assert.equal((await debug.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, true);
    // The mock exists only behind the DEBUG factory.
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /createBuildAdsService\(DEBUG === true, this\.readDebugAdsScript\(\), \{/);
    assert.doesNotMatch(read('assets/scripts/presentation/ExtendedOverclockController.ts'), /MockAdsService|NoOpAdsService/);
});

test('debug ads script: extendedOverclock is optional, old offlineDouble-only files still parse, at least one array is required', () => {
    assert.deepEqual(parseDebugAdsScriptFile('{"offlineDouble":["closed"]}'), { offlineDouble: ['closed'], extendedOverclock: [], duplicateCallback: false });
    assert.deepEqual(parseDebugAdsScriptFile('{"extendedOverclock":["rewarded","closed"]}'), { offlineDouble: [], extendedOverclock: ['rewarded', 'closed'], duplicateCallback: false });
    assert.deepEqual(parseDebugAdsScriptFile('{"offlineDouble":["rewarded"],"extendedOverclock":["failed"],"duplicateCallback":true}'), { offlineDouble: ['rewarded'], extendedOverclock: ['failed'], duplicateCallback: true });
    for (const bad of ['{}', '{"duplicateCallback":true}', '{"extendedOverclock":"rewarded"}', '{"extendedOverclock":["granted"]}', '{"extendedOverclock":[1]}', JSON.stringify({ extendedOverclock: new Array(DEBUG_ADS_MAX_STEPS + 1).fill('rewarded') }), '{"extendedOverclock":["rewarded"],"duplicateCallback":"yes"}']) {
        assert.equal(parseDebugAdsScriptFile(bad), null, bad);
    }
});

test('createBuildAdsService enqueues the extendedOverclock steps on the extended placement only, duplicateCallback applies to both', async () => {
    const ads = createBuildAdsService(true, { offlineDouble: ['closed'], extendedOverclock: ['failed', 'rewarded'], duplicateCallback: false }) as MockAdsService;
    assert.equal((await ads.showRewarded({ placementId: KEY, requestId: 'a' })).status, 'failed');
    assert.equal((await ads.showRewarded({ placementId: KEY, requestId: 'b' })).status, 'rewarded');
    assert.equal((await ads.showRewarded({ placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId: 'c' })).status, 'closed');
    const dup = createBuildAdsService(true, { offlineDouble: ['rewarded'], extendedOverclock: ['rewarded'], duplicateCallback: true }) as MockAdsService;
    await dup.showRewarded({ placementId: KEY, requestId: 'd' });
    await dup.showRewarded({ placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId: 'e' });
    assert.equal(dup.deliveries.filter((x) => x.duplicate === true).length, 2);
});

test('binding: extended overclock methods guard like the others (no support -> null / no fan-out; not_granted fans out nothing)', async () => {
    const minimal = new FactoryWorldStateBinding({ session: { getStateSnapshot: () => ({}) } as never, configRepository: repo, automation: null, hud: null, panel: null });
    assert.equal(minimal.getExtendedOverclockOffer(), null);
    assert.equal(await minimal.activateExtendedOverclockWithProof({ requestId: 'x', placementId: KEY, status: 'rewarded', rewardVerified: true }), null);
    const errors: string[] = [];
    const throwing = new FactoryWorldStateBinding({
        session: { getStateSnapshot: () => ({}), getExtendedOverclockOffer: () => { throw new Error('x'); }, activateExtendedOverclockWithRewardedProof: async () => { throw new Error('y'); } } as never,
        configRepository: repo, automation: null, hud: null, panel: null, reportError: (context) => errors.push(context),
    });
    assert.equal(throwing.getExtendedOverclockOffer(), null);
    assert.equal(await throwing.activateExtendedOverclockWithProof({ requestId: 'x', placementId: KEY, status: 'rewarded', rewardVerified: true }), null);
    assert.deepEqual(errors, ['extended_overclock_offer', 'activate_extended_overclock']);
});

test('binding: a grant reports the command result (DEBUG command_result path) and keeps the HUD views refreshing', async () => {
    const ctx = await start();
    const reported: Array<{ type: string; ok: boolean }> = [];
    const hudRefreshes: unknown[] = [];
    const binding = new FactoryWorldStateBinding({
        session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: null,
        hud: { refresh: (vm) => hudRefreshes.push(vm) }, panel: null,
        reportCommandResult: (command, result) => reported.push({ type: command.type, ok: result.execution.ok }),
    });
    const result = await binding.activateExtendedOverclockWithProof({ requestId: 'r1', placementId: KEY, status: 'rewarded', rewardVerified: true });
    assert.equal(result?.status, 'activated_saved');
    assert.deepEqual(reported, [{ type: 'activateExtendedOverclock', ok: true }]);
    assert.equal(hudRefreshes.length, 1);
    assert.equal((hudRefreshes[0] as { extendedOverclock: { active: boolean; remainingFormatted: string } }).extendedOverclock.active, true);
    assert.equal((hudRefreshes[0] as { extendedOverclock: { remainingFormatted: string } }).extendedOverclock.remainingFormatted, '10:00');
    const rejected = await binding.activateExtendedOverclockWithProof({ requestId: 'r2', placementId: KEY, status: 'rewarded', rewardVerified: true });
    assert.equal(rejected?.status, 'not_granted');
    assert.equal(hudRefreshes.length, 1);
    assert.equal(reported.length, 1);
});

test('flow source: pure (no cc), no GameCommand and no state write; the controller never touches state either', () => {
    const flow = read('assets/scripts/presentation/ExtendedOverclockFlow.ts');
    assert.doesNotMatch(flow, /from\s+['"]cc['"]/);
    assert.doesNotMatch(flow, /GameCommand|\.boosts|monetization\./);
    const controller = read('assets/scripts/presentation/ExtendedOverclockController.ts');
    const code = controller.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /GameState|GameCommand|\.boosts\b|rewardedClaims|commandEmitter/);
});
