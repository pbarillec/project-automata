import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { OFFLINE_DOUBLE_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { recordRewardedClaim } from '../assets/scripts/monetization/RewardedClaimHistory.ts';
import {
    CURRENT_SAVE_VERSION,
    InMemorySaveStorage,
    SAVE_MAIN_NAME,
    serializeGameStateToSaveJson,
} from '../assets/scripts/persistence/index.ts';
import { MockAdsService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { createBuildAdsService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { DEBUG_ADS_FILE, DEBUG_ADS_MAX_STEPS, parseDebugAdsScriptFile } from '../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { OfflineDoubleFlow } from '../assets/scripts/presentation/OfflineDoubleFlow.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { resolveOfflineDoubleOutcome } from '../assets/scripts/presentation/OfflineReportViewModel.ts';
import { formatOfflineDoubleNotGranted, formatOfflineDoubleTexts } from '../assets/scripts/presentation/OfflineReportText.ts';
import { getDefaultTextCatalogue } from '../assets/scripts/localization/index.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { buildAut051SeededState } from '../tools/device/seed_aut051.ts';
import { AUT055_ABSENCE_SECONDS, buildAut055AdsScriptFile, buildAut055SeededSave, seedAut055 } from '../tools/device/seed_aut055.ts';
import { evaluateOfflineDouble, geometryChecks } from '../tools/device/offline_double_checks.ts';
import { REVEAL_SCENARIOS } from '../tools/device/reveal_capture.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = OFFLINE_DOUBLE_CLAIM_KEY;

async function start(options: { absenceSeconds?: number; withClaims?: boolean } = {}) {
    const state = buildAut051SeededState('first');
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, {
            saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: 'test',
            savedAtUtc: iso(NOW_MS - (options.absenceSeconds ?? 3 * 3600) * 1000),
        }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    const session = boot.startup.session;
    const calls = { suspend: 0, resume: 0 };
    const origSuspend = session.suspend.bind(session);
    const origResume = session.resume.bind(session);
    session.suspend = async () => { calls.suspend += 1; return origSuspend(); };
    session.resume = () => { calls.resume += 1; return origResume(); };
    return { storage, clock, boot, session, calls };
}

function makeFlow(ctx: Awaited<ReturnType<typeof start>>, ads = createBuildAdsService(true)) {
    const diag: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    let changes = 0;
    const binding = new FactoryWorldStateBinding({
        session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: null, hud: null, panel: null,
    });
    const flow = new OfflineDoubleFlow({
        ads,
        session: {
            getOfflineDoubleOffer: () => binding.getOfflineDoubleOffer(),
            collectPendingOfflineWithRewardedBonus: (proof) => binding.collectOfflineReportWithBonus(proof),
        },
        now: () => NOW_MS,
        onChange: () => { changes += 1; },
        onDiagnostic: (phase, payload) => diag.push({ phase, payload }),
    });
    return { flow, ads, diag, changes: () => changes };
}

const claimCount = (ctx: Awaited<ReturnType<typeof start>>) => ctx.session.getStateSnapshot().monetization.rewardedClaims[KEY]?.claimCount ?? 0;

// ---- flow --------------------------------------------------------------------------------------

test('flow: offered, verified rewarded ad grants x2 once and the card can close', async () => {
    const ctx = await start();
    const { flow, diag } = makeFlow(ctx);
    const before = ctx.session.getStateSnapshot().run.industrialOutput;
    const state = await flow.refreshOffer();
    assert.equal(state.offer, true);
    assert.equal(state.blockedBy, null);
    assert.ok(state.projectedReward > 0);
    assert.equal(await flow.start(), 'granted');
    assert.equal(claimCount(ctx), 1);
    const gain = ctx.session.getStateSnapshot().run.industrialOutput - before;
    const granted = diag.find((d) => d.phase === 'granted')!.payload;
    assert.equal(granted.multiplier, 2);
    assert.equal(granted.grantedReward, gain);
    assert.equal(granted.baseReward, gain / 2);
    assert.equal(granted.claimCount, 1);
    assert.equal(granted.saveOk, true);
    assert.deepEqual(diag.map((d) => d.phase).filter((p) => p !== 'offer'), ['ad_started', 'ad_result', 'granted']);
    assert.equal(diag.find((d) => d.phase === 'offer')!.payload.claimsInWindow, 0);
    assert.equal(ctx.calls.suspend + ctx.calls.resume, 0, 'the mock flow never suspends or resumes the session');
    // Nothing is pending any more: the late collect is a no-op.
    assert.equal(await flow.start(), 'stale');
    assert.equal(claimCount(ctx), 1);
});

for (const outcome of ['closed', 'failed', 'unavailable', 'timeout'] as const) {
    test(`flow: ${outcome} grants nothing, keeps the free collect intact`, async () => {
        const ctx = await start();
        const ads = createBuildAdsService(true, { offlineDouble: [outcome], duplicateCallback: false });
        const { flow, diag } = makeFlow(ctx, ads);
        await flow.refreshOffer();
        const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
        assert.equal(await flow.start(), 'not_granted');
        assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
        assert.notEqual(ctx.session.getPendingOfflinePreview(), null);
        assert.equal(claimCount(ctx), 0);
        assert.equal(diag.find((d) => d.phase === 'ad_result')!.payload.rewardVerified, false);
        assert.equal(diag.find((d) => d.phase === 'not_granted')!.payload.reason, 'not_rewarded');
        // The free COLLECT still pays the full normal reward.
        const control = await start();
        await control.session.collectPendingOffline();
        await ctx.session.collectPendingOffline();
        assert.equal(ctx.session.getStateSnapshot().run.industrialOutput, control.session.getStateSnapshot().run.industrialOutput);
        assert.equal(claimCount(ctx), 0);
    });
}

test('flow: a manual (timeout) ad can be released later; a retry with a new request id can still be granted', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true) as MockAdsService;
    ads.enqueueOutcomes(KEY, { outcome: 'timeout', manual: true });
    const { flow, diag } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    const pending = flow.start();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(flow.getState().inFlight, true);
    const requestId = String(diag.find((d) => d.phase === 'ad_started')!.payload.requestId);
    assert.equal(ads.gate.release(requestId), true);
    assert.equal(await pending, 'not_granted');
    assert.equal(flow.getState().inFlight, false);
    assert.equal(flow.getState().offer, true);
    assert.equal(await flow.start(), 'granted');
    assert.equal(claimCount(ctx), 1);
    const ids = ads.calls.filter((c) => c.method === 'showRewarded').map((c) => c.requestId);
    assert.equal(new Set(ids).size, 2, 'each attempt has its own request id');
});

test('flow: duplicate ad callback never grants twice', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true, { offlineDouble: ['rewarded'], duplicateCallback: true }) as MockAdsService;
    const { flow } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    assert.equal(await flow.start(), 'granted');
    const dup = ads.deliveries.find((d) => d.duplicate === true)!;
    assert.ok(dup, 'the mock delivered a duplicate callback');
    const replay = await ctx.session.collectPendingOfflineWithRewardedBonus(dup);
    assert.equal(replay.status, 'no_pending_preview');
    assert.equal(claimCount(ctx), 1);
});

test('flow: second start while an ad is in flight is a no-op', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true) as MockAdsService;
    ads.enqueueOutcomes(KEY, { outcome: 'rewarded', manual: true });
    const { flow, diag } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    const first = flow.start();
    assert.equal(await flow.start(), null);
    await Promise.resolve();
    await Promise.resolve();
    ads.gate.release(String(diag.find((d) => d.phase === 'ad_started')!.payload.requestId));
    assert.equal(await first, 'granted');
    assert.equal(ads.calls.filter((c) => c.method === 'showRewarded').length, 1);
    assert.equal(claimCount(ctx), 1);
});

test('flow: a free COLLECT during the ad makes the late verified result a harmless stale no-op', async () => {
    const ctx = await start();
    const ads = createBuildAdsService(true) as MockAdsService;
    ads.enqueueOutcomes(KEY, { outcome: 'rewarded', manual: true });
    const { flow, diag } = makeFlow(ctx, ads);
    await flow.refreshOffer();
    const pending = flow.start();
    await Promise.resolve();
    await Promise.resolve();
    await ctx.session.collectPendingOffline();
    const after = ctx.session.getStateSnapshot().run.industrialOutput;
    ads.gate.release(String(diag.find((d) => d.phase === 'ad_started')!.payload.requestId));
    assert.equal(await pending, 'stale');
    assert.equal(ctx.session.getStateSnapshot().run.industrialOutput, after);
    assert.equal(claimCount(ctx), 0);
});

test('flow: ad unavailable -> blockedBy ad; player ineligible -> blockedBy player (player wins); NoOp -> no offer', async () => {
    const ctx = await start();
    const unavailable = createBuildAdsService(true) as MockAdsService;
    unavailable.setPlacement(KEY, { available: false });
    const a = await makeFlow(ctx, unavailable).flow.refreshOffer();
    assert.deepEqual([a.offer, a.blockedBy], [false, 'ad']);

    const short = await start({ absenceSeconds: 20 * 60 });
    const both = createBuildAdsService(true) as MockAdsService;
    both.setPlacement(KEY, { available: false });
    const p = await makeFlow(short, both).flow.refreshOffer();
    assert.deepEqual([p.offer, p.blockedBy], [false, 'player']);
    const p2 = await makeFlow(short).flow.refreshOffer();
    assert.deepEqual([p2.offer, p2.blockedBy], [false, 'player']);
    assert.equal(p2.eligibility!.reason, 'below_min_offline');

    const noop = createBuildAdsService(false);
    const n = await makeFlow(ctx, noop).flow.refreshOffer();
    assert.equal(n.offer, false);
    const result = await noop.showRewarded({ placementId: KEY, requestId: 'x' });
    assert.equal(result.rewardVerified, false);
    assert.equal(result.status, 'unavailable');
    assert.equal((await noop.getRewardedAvailability(KEY)).available, false);
});

test('flow: quota reached hides the offer; no pending preview hides it too', async () => {
    const state = buildAut051SeededState('first');
    for (const hours of [4, 5, 6]) state.monetization.rewardedClaims[KEY] = recordRewardedClaim(state, KEY, NOW_MS - hours * HOUR);
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: 'test', savedAtUtc: iso(NOW_MS - 3 * HOUR) }),
    });
    const boot = await bootstrapGameSession({ storage, timeService: new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 }) });
    if (!boot.startup.ok) throw new Error('startup');
    const ctx = { storage, clock: null, boot, session: boot.startup.session, calls: { suspend: 0, resume: 0 } } as never as Awaited<ReturnType<typeof start>>;
    const { flow } = makeFlow(ctx);
    const state1 = await flow.refreshOffer();
    assert.deepEqual([state1.offer, state1.blockedBy, state1.eligibility!.reason], [false, 'player', 'quota_reached']);
    await ctx.session.collectPendingOffline();
    const state2 = await flow.refreshOffer();
    assert.equal(state2.offer, false);
    assert.equal(state2.eligibility, null);
});

test('flow: errors from the ad provider or the session map to error and clear the in-flight flag', async () => {
    const ctx = await start();
    const throwingAds = createBuildAdsService(true) as MockAdsService;
    throwingAds.showRewarded = () => { throw new Error('boom'); };
    const f1 = makeFlow(ctx, throwingAds).flow;
    await f1.refreshOffer();
    assert.equal(await f1.start(), 'error');
    assert.equal(f1.getState().inFlight, false);
    assert.equal(claimCount(ctx), 0);
    const f2 = new OfflineDoubleFlow({
        ads: createBuildAdsService(true),
        session: { getOfflineDoubleOffer: () => null, collectPendingOfflineWithRewardedBonus: async () => { throw new Error('boom'); } },
        now: () => 1,
    });
    assert.equal(await f2.start(), 'error');
});

test('flow source: pure, no cc, no suspend / resume, no direct state mutation', () => {
    const source = read('assets/scripts/presentation/OfflineDoubleFlow.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /from\s+['"]cc['"]/);
    assert.doesNotMatch(source, /\bsuspend\b|\bresume\b/);
    assert.doesNotMatch(source, /GameState|industrialOutput|rewardedClaims\[[^\]]+\]\s*=/);
    assert.match(source, /canOfferRewarded/);
});

// ---- outcome mapping / text -----------------------------------------------------------------------

test('resolveOfflineDoubleOutcome maps every flow result', () => {
    assert.equal(resolveOfflineDoubleOutcome('granted'), 'close');
    assert.equal(resolveOfflineDoubleOutcome('not_granted'), 'keep_not_granted');
    assert.equal(resolveOfflineDoubleOutcome('stale'), 'close_stale');
    assert.equal(resolveOfflineDoubleOutcome('error'), 'keep_retry');
    assert.equal(resolveOfflineDoubleOutcome(null), 'keep_retry');
});

test('x2 texts come from the catalogue and match en.json', () => {
    const parsed = JSON.parse(read('localization/en.json'));
    const catalogue = getDefaultTextCatalogue();
    assert.equal(parsed.entries['offline.double.button'], 'COLLECT ×2 — {value}');
    assert.equal(parsed.entries['offline.double.tag'], 'Rewarded Ad');
    assert.equal(parsed.entries['offline.double.not_granted'], 'No bonus this time. You can still collect.');
    const texts = formatOfflineDoubleTexts(2_400_000, catalogue);
    assert.match(texts.button, /^COLLECT ×2 — 2\.4\d*M$/);
    assert.equal(texts.tag, 'Rewarded Ad');
    assert.equal(formatOfflineDoubleNotGranted(catalogue), 'No bonus this time. You can still collect.');
    // The embedded catalogue is generated from localization/ (drift is also pinned by embedded_text_catalogue.test.ts).
    for (const key of ['offline.double.button', 'offline.double.tag', 'offline.double.not_granted']) assert.equal(catalogue.template(key), parsed.entries[key]);
});

// ---- provider injection ---------------------------------------------------------------------------

test('createBuildAdsService: release is NoOp (unavailable), DEBUG is a ready mock with an immediate rewarded default', async () => {
    const release = createBuildAdsService(false, { offlineDouble: ['rewarded'], duplicateCallback: false });
    assert.equal(release instanceof MockAdsService, false);
    assert.equal((await release.getRewardedAvailability(KEY)).available, false);
    const shown = await release.showRewarded({ placementId: KEY, requestId: 'r' });
    assert.equal(shown.rewardVerified, false);

    const debug = createBuildAdsService(true);
    assert.ok(debug instanceof MockAdsService);
    assert.equal((await debug.getRewardedAvailability(KEY)).available, true);
    const ok = await debug.showRewarded({ placementId: KEY, requestId: 'r' });
    assert.deepEqual([ok.status, ok.rewardVerified], ['rewarded', true]);

    const scripted = createBuildAdsService(true, { offlineDouble: ['closed', 'failed'], duplicateCallback: false });
    assert.equal((await scripted.showRewarded({ placementId: KEY, requestId: 'a' })).status, 'closed');
    assert.equal((await scripted.showRewarded({ placementId: KEY, requestId: 'b' })).status, 'failed');
    assert.equal((await scripted.showRewarded({ placementId: KEY, requestId: 'c' })).status, 'rewarded');
});

test('source scan: MockAdsService is referenced in presentation / app only by BuildPlatformServices; bootstrap uses the DEBUG factory', () => {
    const roots = ['presentation', 'app', 'camera', 'settings', 'localization'];
    for (const root of roots) {
        for (const name of fs.readdirSync(path.join(repoRoot, 'assets/scripts', root))) {
            if (!name.endsWith('.ts') || name === 'BuildPlatformServices.ts') continue;
            const source = read(`assets/scripts/${root}/${name}`);
            assert.doesNotMatch(source, /MockAdsService|createMockPlatformServices|MockPlatformProviders/, `${root}/${name}`);
        }
    }
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /createBuildAdsService\(DEBUG === true, this\.readDebugAdsScript\(\)\)/);
    assert.doesNotMatch(bootstrap, /NoOpAdsService|AndroidAdsService/);
    // The ads script file is read only under DEBUG and enabled diagnostics, and deleted after reading.
    const reader = bootstrap.slice(bootstrap.indexOf('private readDebugAdsScript'), bootstrap.indexOf('private activateSessionBinding'));
    assert.match(reader, /DEBUG !== true \|\| !isDeviceDiagnosticsEnabled\(\)/);
    assert.match(reader, /port\.remove\(DEBUG_ADS_FILE\)/);
    assert.equal((bootstrap.match(/DEBUG_ADS_FILE/g) ?? []).length, 3, 'import + read + remove only');
    assert.match(bootstrap, /binding\.collectOfflineReportWithBonus\(proof\)/);
});

test('debug ads script parser: allow-listed outcomes only', () => {
    assert.equal(DEBUG_ADS_FILE, 'debug_ads.json');
    assert.deepEqual(parseDebugAdsScriptFile('{"offlineDouble":["closed","rewarded"],"duplicateCallback":true}'), { offlineDouble: ['closed', 'rewarded'], duplicateCallback: true });
    assert.deepEqual(parseDebugAdsScriptFile('{"offlineDouble":[]}'), { offlineDouble: [], duplicateCallback: false });
    for (const bad of [undefined, '', '{', 'null', '[]', '{}', '{"offlineDouble":"rewarded"}', '{"offlineDouble":["granted"]}', '{"offlineDouble":[1]}', '{"offlineDouble":["rewarded"],"duplicateCallback":"yes"}', JSON.stringify({ offlineDouble: new Array(DEBUG_ADS_MAX_STEPS + 1).fill('rewarded') })]) {
        assert.equal(parseDebugAdsScriptFile(bad), null, String(bad));
    }
    assert.equal(DEBUG_ADS_MAX_STEPS, 4);
});

test('layer rules: lifecycle / offline / monetization import no platform, services (ads) or cc; every new script has a unique meta', () => {
    for (const rel of ['lifecycle/LifecycleSessionCoordinator.ts', 'offline/OfflineService.ts', 'monetization/RewardedEligibility.ts', 'monetization/RewardedClaimHistory.ts']) {
        const source = read(`assets/scripts/${rel}`);
        const specs = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
        for (const spec of specs) {
            assert.notEqual(spec, 'cc', rel);
            assert.equal(/(^|\/)platform(\/|$)/.test(spec), false, `${rel}: ${spec}`);
            assert.equal(/services\/(Ads|Purchase|Entitlement|Analytics)/.test(spec), false, `${rel}: ${spec}`);
        }
    }
    const uuids = new Set<string>();
    for (const name of ['OfflineDoubleFlow', 'BuildPlatformServices', 'DebugAdsScriptFile']) {
        const metaPath = `assets/scripts/presentation/${name}.ts.meta`;
        const meta = JSON.parse(read(metaPath));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^[0-9a-f-]{36}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 3);
    // No other meta in the repo reuses these uuids.
    const all = new Map<string, string>();
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.meta')) {
                const id = JSON.parse(fs.readFileSync(full, 'utf8')).uuid as string;
                if (uuids.has(id)) all.set(id, `${all.get(id) ?? ''}${full};`);
            }
        }
    };
    walk(path.join(repoRoot, 'assets'));
    for (const [id, owners] of all) assert.equal(owners.split(';').filter(Boolean).length, 1, `${id} reused: ${owners}`);
});

test('controller wiring: submits through the flow, owns no economy math, scale visibility, outline by fillRect not stroke', () => {
    const source = read('assets/scripts/presentation/OfflineReportController.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(source, /public onDoublePressed\(\)/);
    assert.match(source, /handler\.handler = 'onDoublePressed'/);
    assert.doesNotMatch(source, /\.stroke\(\)/);
    assert.doesNotMatch(source, /industrialOutput|rewardMultiplier|projectedReward \*|multiplier/i);
    assert.doesNotMatch(source, /addComponent\(Sprite\)|\.active\s*=/);
    assert.match(source, /COLLECT_IN_FLIGHT_ALPHA/);
    assert.equal((source.match(/\.on\(Node\.EventType\.TOUCH_/g) ?? []).length, 8);
});

// ---- device tooling --------------------------------------------------------------------------------

test('seed_aut055: variants, ads script, stale files removed, scenarios and CLI registered', async () => {
    const calls: string[] = [];
    const written: Record<string, string> = {};
    const driver = {
        forceStop: async () => { calls.push('forceStop'); },
        appDataDirectory: async () => '/data/user/0/pkg',
        removeAppFiles: async (_pkg: string, paths: string[]) => { calls.push(`remove:${paths.map((p) => p.split('/').pop()).join(',')}`); },
        writeAppFile: async (_pkg: string, p: string, text: string) => { calls.push(`write:${p.split('/').pop()}`); written[p.split('/').pop()!] = text; },
        launch: async () => { calls.push('launch'); },
    };
    await seedAut055(driver as never, 'pkg', 'act', 'ready', 'closed', () => new Date(NOW_MS));
    assert.deepEqual(calls, ['forceStop', 'remove:save_main.json,save_backup.json,save_temp.json,debug_command.json,debug_ads.json', 'write:save_main.json', 'write:debug_ads.json', 'launch']);
    assert.equal(written['debug_ads.json'], buildAut055AdsScriptFile('closed'));
    assert.deepEqual(parseDebugAdsScriptFile(written['debug_ads.json']), { offlineDouble: ['closed'], duplicateCallback: false });
    assert.deepEqual(AUT055_ABSENCE_SECONDS, { ready: 10_800, short_ineligible: 1_200, quota: 10_800 });
    assert.ok(AUT055_ABSENCE_SECONDS.short_ineligible > 60 && AUT055_ABSENCE_SECONDS.short_ineligible < 30 * 60);
    // Seeded saves load into a real session with the expected offer.
    for (const [variant, eligible, reason] of [['ready', true, 'ok'], ['short_ineligible', false, 'below_min_offline'], ['quota', false, 'quota_reached']] as const) {
        const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: buildAut055SeededSave(variant, NOW_MS) });
        const boot = await bootstrapGameSession({ storage, timeService: new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 }) });
        if (!boot.startup.ok) throw new Error('startup');
        const offer = boot.startup.session.getOfflineDoubleOffer()!;
        assert.deepEqual([offer.eligibility.eligible, offer.eligibility.reason], [eligible, reason], variant);
    }
    for (const id of ['aut055-success', 'aut055-closed', 'aut055-failed', 'aut055-ineligible']) {
        assert.ok(REVEAL_SCENARIOS[id], id);
        assert.equal(REVEAL_SCENARIOS[id].trigger, 'none');
    }
    assert.deepEqual(['aut055-success', 'aut055-closed', 'aut055-failed', 'aut055-ineligible'].map((id) => REVEAL_SCENARIOS[id].expectOfflineDouble), ['success', 'closed', 'failed', 'ineligible']);
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /seed-aut055 \[--variant ready\|short_ineligible\|quota\] \[--outcome rewarded\|closed\|failed\]/);
    assert.match(cli, /expectOfflineDouble: scenario\.expectOfflineDouble/);
    assert.match(read('package.json'), /"device:seed-aut055": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-aut055"/);
    assert.match(read('tools/device/reveal_capture.ts'), /expectOfflineDouble: options\.expectOfflineDouble/);
});

function ev(tMs: number, evt: string, fields: Record<string, unknown>) {
    return { tMs, event: { v: 1, seq: tMs, evt, ...fields } as never };
}

const LAYOUT = {
    screen: { w: 1080, h: 2412 },
    safeArea: { x: 0, y: 0, w: 1080, h: 2412 },
    rects: {
        OfflineReportCard: { x: 60, y: 900, w: 960, h: 657 },
        OfflineReportCollect: { x: 80, y: 1100, w: 920, h: 96 },
        OfflineReportDouble: { x: 80, y: 968, w: 920, h: 114 },
    },
};

test('offline_double_checks: geometry and per-scenario event chains', () => {
    const layout = ev(10, 'ui_layout', LAYOUT);
    assert.ok(geometryChecks({ screen: LAYOUT.screen, safeArea: LAYOUT.safeArea, rects: LAYOUT.rects }).every((c) => c.ok), 'good geometry');
    const tooSmall = geometryChecks({ ...LAYOUT, rects: { ...LAYOUT.rects, OfflineReportDouble: { ...LAYOUT.rects.OfflineReportDouble, h: 60 } } });
    assert.equal(tooSmall.find((c) => c.id === 'double_height_units')!.ok, false);
    const overlapping = geometryChecks({ ...LAYOUT, rects: { ...LAYOUT.rects, OfflineReportDouble: { ...LAYOUT.rects.OfflineReportDouble, y: 1050 } } });
    assert.equal(overlapping.find((c) => c.id === 'double_below_collect_no_overlap')!.ok, false);

    const offer = ev(5, 'offline_double', { phase: 'offer', eligible: true, reason: 'ok', adAvailable: true, blockedBy: null, projectedReward: 2000, claimsInWindow: 0 });
    const shown = ev(6, 'offline_report', { phase: 'shown', reward: 1000 });
    const claims0 = ev(1, 'offline_double', { phase: 'claims', claimCount: 0, claimsInWindow: 0 });
    const marker = ev(100, 'capture_marker', { phase: 'relaunch' });
    const success = [claims0, offer, shown, layout, ev(20, 'offline_report', { phase: 'double_tapped' }), ev(21, 'offline_double', { phase: 'ad_started', requestId: 'offline_double:1:1' }),
        ev(22, 'offline_double', { phase: 'ad_result', status: 'rewarded', rewardVerified: true, duplicate: false }),
        ev(23, 'offline_double', { phase: 'granted', baseReward: 1000, grantedReward: 2000, multiplier: 2, claimCount: 1, saveOk: true }),
        ev(24, 'offline_report', { phase: 'hidden', reason: 'double_granted' }), marker, ev(120, 'offline_double', { phase: 'claims', claimCount: 1, claimsInWindow: 1 })];
    const ok = evaluateOfflineDouble(success, 'success');
    assert.ok(ok.every((c) => c.ok), JSON.stringify(ok.filter((c) => !c.ok)));
    const wrong = success.map((e) => (e.event.phase === 'granted' ? ev(e.tMs, 'offline_double', { phase: 'granted', baseReward: 1000, grantedReward: 1500, multiplier: 2, claimCount: 1, saveOk: true }) : e));
    assert.equal(evaluateOfflineDouble(wrong, 'success').find((c) => c.id === 'double_granted_exactly_2x')!.ok, false);

    const closed = [claims0, offer, shown, layout, ev(20, 'offline_report', { phase: 'double_tapped' }), ev(21, 'offline_double', { phase: 'ad_started', requestId: 'r' }),
        ev(22, 'offline_double', { phase: 'ad_result', status: 'closed', rewardVerified: false, duplicate: false }),
        ev(23, 'offline_double', { phase: 'not_granted', reason: 'not_rewarded' }), ev(30, 'offline_report', { phase: 'collect_tapped' }),
        ev(31, 'offline_report', { phase: 'collect_result', status: 'collected_saved', saveOk: true }), marker, ev(120, 'offline_double', { phase: 'claims', claimCount: 0, claimsInWindow: 0 })];
    const closedChecks = evaluateOfflineDouble(closed, 'closed');
    assert.ok(closedChecks.every((c) => c.ok), JSON.stringify(closedChecks.filter((c) => !c.ok)));

    const ineligible = [ev(5, 'offline_double', { phase: 'offer', eligible: false, reason: 'below_min_offline', adAvailable: true, blockedBy: 'player', projectedReward: 20, claimsInWindow: 0 }), shown,
        ev(10, 'ui_layout', { ...LAYOUT, rects: { OfflineReportCard: LAYOUT.rects.OfflineReportCard, OfflineReportCollect: LAYOUT.rects.OfflineReportCollect, OfflineReportDouble: null } }),
        ev(30, 'offline_report', { phase: 'collect_result', status: 'collected_saved', saveOk: true })];
    const inel = evaluateOfflineDouble(ineligible, 'ineligible');
    assert.ok(inel.every((c) => c.ok), JSON.stringify(inel.filter((c) => !c.ok)));
});
