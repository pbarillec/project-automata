// AUT-071 error handling and recovery matrix: ADS / IAP / MISSING ASSET / FLOW LIVENESS cells (real session + real Android ads provider with injected timers).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { ANDROID_ADS_RESULT_EVENT, ANDROID_ADS_RESULT_TIMEOUT_MS, AndroidAdsService, type AndroidAdsTransport } from '../assets/scripts/platform/android/AndroidAdsService.ts';
import { MockPurchaseService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { CURRENT_SAVE_VERSION, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_TEMP_NAME, serializeGameStateToSaveJson } from '../assets/scripts/persistence/index.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { ExtendedOverclockFlow } from '../assets/scripts/presentation/ExtendedOverclockFlow.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { FounderShopFlow } from '../assets/scripts/presentation/FounderShopFlow.ts';
import { OfflineDoubleFlow } from '../assets/scripts/presentation/OfflineDoubleFlow.ts';
import { PRODUCTS } from '../assets/scripts/services/PlatformServiceTypes.ts';
import type { PurchaseResult } from '../assets/scripts/services/PurchaseService.ts';
import { PlatformOverlayTracker } from '../assets/scripts/services/PlatformOverlay.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import type { GameState } from '../assets/scripts/state/index.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';
import { buildAut051SeededState } from '../tools/device/seed_aut051.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n/g, '\n');
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

// ------------------------------------------------------------------------------------------------ shared fakes

class FakeAdsTransport implements AndroidAdsTransport {
    public readonly calls: Array<{ method: string; args: string[] }> = [];
    public readonly handlers = new Set<(payload: string) => void>();
    public responses = new Map<string, string | (() => string)>();

    public callString(method: string, _signature: string, ...args: string[]): string {
        this.calls.push({ method, args });
        const response = this.responses.get(method);
        const value = typeof response === 'function' ? response() : response;
        return value ?? '{"ok":false,"status":"unavailable","reason":"no_response"}';
    }

    public subscribe(_event: string, handler: (payload: string) => void): () => void {
        this.handlers.add(handler);
        return () => { this.handlers.delete(handler); };
    }

    public lastRequestId(): string {
        const call = [...this.calls].reverse().find((entry) => entry.method === 'showRewarded');
        return JSON.parse(call!.args[0]).requestId as string;
    }

    public showCalls(): number { return this.calls.filter((entry) => entry.method === 'showRewarded').length; }

    public result(placementId: string, status: string, rewardVerified: boolean, requestId = this.lastRequestId()): void {
        const payload = JSON.stringify({ status, placementId, requestId, rewardVerified });
        for (const handler of [...this.handlers]) handler(payload);
    }
}

function makeAds(options: { available?: boolean; show?: string | (() => string); init?: string } = {}) {
    const transport = new FakeAdsTransport();
    transport.responses.set('initializeAds', options.init ?? '{"ok":true,"status":"ready"}');
    transport.responses.set('getRewardedAvailability', options.available === false ? '{"available":false,"status":"unavailable","reason":"no_fill"}' : '{"available":true,"status":"ready"}');
    transport.responses.set('showRewarded', options.show ?? '{"status":"started"}');
    const timers: Array<{ delay: number; fire: () => void; cancelled: boolean }> = [];
    const overlay = new PlatformOverlayTracker();
    const service = new AndroidAdsService({
        transport,
        overlay,
        schedule: (callback, delay) => {
            const timer = { delay, fire: callback, cancelled: false };
            timers.push(timer);
            return () => { timer.cancelled = true; };
        },
    });
    return { transport, service, timers, overlay };
}

// ------------------------------------------------------------------------------------------------ offline double (rewarded x2) end to end

function offlineSave(state: GameState, absenceSeconds = 3 * 3600): InMemorySaveStorage {
    return new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS - absenceSeconds * 1000) }),
    });
}

async function startOffline(storage = offlineSave(buildAut051SeededState('first'))) {
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, session: boot.startup.session };
}

function offlineFlow(ads: ReturnType<typeof makeAds>, session: Awaited<ReturnType<typeof startOffline>>['session']) {
    const changes: boolean[] = [];
    const flow = new OfflineDoubleFlow({
        ads: ads.service,
        session: { getOfflineDoubleOffer: () => session.getOfflineDoubleOffer(), collectPendingOfflineWithRewardedBonus: (proof) => session.collectPendingOfflineWithRewardedBonus(proof) },
        now: () => NOW_MS,
        onChange: () => changes.push(true),
    });
    return { flow, changes };
}

const claims = (session: { getStateSnapshot(): GameState }, key: string) => session.getStateSnapshot().monetization.rewardedClaims[key]?.claimCount ?? 0;

test('AUT-071 ADS SDK init failure: ads stay closed, no x2 offer, no ad is ever shown, the free COLLECT works', async () => {
    const ads = makeAds({ available: false, init: '{"ok":false,"status":"failed","reason":"sdk_init_failed"}' });
    const { session } = await startOffline();
    const { flow } = offlineFlow(ads, session);

    const init = await ads.service.initialize();
    const state = await flow.refreshOffer();

    assert.equal(init.status, 'failed');
    assert.equal(state.offer, false);
    assert.equal(state.blockedBy, 'ad');
    assert.equal(ads.transport.showCalls(), 0, 'no ad was requested');
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 0);
    const collect = await session.collectPendingOffline();
    assert.equal(collect.status, 'collected_saved');
});

test('AUT-071 ADS ad unavailable / no network (immediate terminal native answer): nothing granted, the flow returns to ready, the free COLLECT works', async () => {
    for (const answer of ['{"status":"unavailable","reason":"no_network"}', '{"status":"failed","reason":"load_failed"}']) {
        const ads = makeAds({ show: answer });
        const { session } = await startOffline();
        const { flow } = offlineFlow(ads, session);
        await flow.refreshOffer();

        const outcome = await flow.start();

        assert.equal(outcome, 'not_granted', answer);
        assert.equal(flow.getState().inFlight, false);
        assert.equal(ads.overlay.isOverlayActive(), false);
        assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 0);
        assert.notEqual(session.getPendingOfflinePreview(), null, 'the report is still collectable');
        assert.equal((await session.collectPendingOffline()).status, 'collected_saved');
    }
});

test('AUT-071 ADS show fail (native call throws): resolves failed, no grant, flow ready, overlay released', async () => {
    const ads = makeAds();
    ads.transport.responses.set('showRewarded', () => { throw new Error('native boom'); });
    const { session } = await startOffline();
    const { flow } = offlineFlow(ads, session);
    await flow.refreshOffer();

    assert.equal(await flow.start(), 'not_granted');
    assert.equal(flow.getState().inFlight, false);
    assert.equal(ads.overlay.isOverlayActive(), false);
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 0);
});

test('AUT-071 ADS closed early / unverified reward: no grant without verified proof, state returns to ready, a later verified attempt still works', async () => {
    const ads = makeAds();
    const { session } = await startOffline();
    const { flow } = offlineFlow(ads, session);
    await flow.refreshOffer();

    const closedAttempt = flow.start();
    await flush();
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'closed', false);
    assert.equal(await closedAttempt, 'not_granted');
    const unverifiedAttempt = flow.start();
    await flush();
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', false); // rewarded status but the native side did not verify
    assert.equal(await unverifiedAttempt, 'not_granted');
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 0);
    assert.equal(flow.getState().offer, true);

    const good = flow.start();
    await flush();
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true);
    assert.equal(await good, 'granted');
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 1);
});

test('AUT-071 ADS duplicate callbacks (the same verified result delivered three times) grant exactly once', async () => {
    const ads = makeAds();
    const { session } = await startOffline();
    const { flow } = offlineFlow(ads, session);
    await flow.refreshOffer();
    const before = session.getStateSnapshot().run.industrialOutput;

    const attempt = flow.start();
    await flush();
    for (let i = 0; i < 3; i += 1) ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true);
    assert.equal(await attempt, 'granted');
    const after = session.getStateSnapshot().run.industrialOutput;

    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 1);
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true); // another one, later
    await flush();
    assert.equal(session.getStateSnapshot().run.industrialOutput, after);
    assert.ok(after > before);
});

test('AUT-071 ADS callback after timeout: the watchdog ends the attempt (not granted), the late verified callback is ignored, a new attempt can still be granted', async () => {
    const ads = makeAds();
    const { session } = await startOffline();
    const { flow } = offlineFlow(ads, session);
    await flow.refreshOffer();

    const hung = flow.start();
    await flush();
    assert.equal(flow.getState().inFlight, true);
    assert.equal(ads.overlay.isOverlayActive(), true);
    assert.equal(ads.timers.length, 1);
    assert.equal(ads.timers[0].delay, ANDROID_ADS_RESULT_TIMEOUT_MS);
    const lateRequestId = ads.transport.lastRequestId();
    ads.timers[0].fire(); // injected-clock watchdog

    assert.equal(await hung, 'not_granted');
    assert.equal(flow.getState().inFlight, false);
    assert.equal(ads.overlay.isOverlayActive(), false);
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true, lateRequestId); // arrives after the timeout
    await flush();
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 0, 'a late callback never grants');
    assert.notEqual(session.getPendingOfflinePreview(), null);

    const retry = flow.start();
    await flush();
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true);
    assert.equal(await retry, 'granted');
});

test('AUT-071 ADS app killed during the ad: nothing was granted or claimed, the relaunch shows the same report and the x2 offer again', async () => {
    const ads = makeAds();
    const first = await startOffline();
    const { flow } = offlineFlow(ads, first.session);
    await flow.refreshOffer();
    const preview = first.session.getPendingOfflinePreview();
    void flow.start(); // the ad is on screen and never reports back: the process dies here
    await flush();

    const relaunch = await startOffline(first.storage);
    const relaunchAds = makeAds();
    const { flow: relaunchFlow } = offlineFlow(relaunchAds, relaunch.session);

    assert.equal(relaunch.session.getPendingOfflinePreview()?.totalIndustrialOutputReward, preview?.totalIndustrialOutputReward);
    assert.equal(claims(relaunch.session, OFFLINE_DOUBLE_CLAIM_KEY), 0);
    assert.equal((await relaunchFlow.refreshOffer()).offer, true);
});

test('AUT-071 ADS a free COLLECT while the ad hangs is never blocked by the ad flow, and the abandoned ad then cannot double-grant', async () => {
    const ads = makeAds();
    const { session } = await startOffline();
    const { flow } = offlineFlow(ads, session);
    await flow.refreshOffer();
    const hung = flow.start();
    await flush();

    const collect = await session.collectPendingOffline();
    assert.equal(collect.status, 'collected_saved');
    const afterCollect = session.getStateSnapshot().run.industrialOutput;
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true);

    assert.equal(await hung, 'stale');
    assert.equal(session.getStateSnapshot().run.industrialOutput, afterCollect);
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 0);
});

test('AUT-071 ADS a failed save after the verified x2 keeps the reward in memory, claims once, and never grants a second time', async () => {
    const ads = makeAds();
    const { session, storage } = await startOffline();
    const { flow } = offlineFlow(ads, session);
    await flow.refreshOffer();
    storage.failNext({ operation: 'write', name: SAVE_TEMP_NAME, message: 'EIO' });

    const attempt = flow.start();
    await flush();
    ads.transport.result(OFFLINE_DOUBLE_CLAIM_KEY, 'rewarded', true);

    assert.equal(await attempt, 'granted');
    assert.equal(claims(session, OFFLINE_DOUBLE_CLAIM_KEY), 1);
    assert.equal(session.getPendingOfflinePreview(), null);
    assert.equal((await session.collectPendingOfflineWithRewardedBonus({ requestId: 'again', placementId: OFFLINE_DOUBLE_CLAIM_KEY, status: 'rewarded', rewardVerified: true })).status, 'no_pending_preview');
});

// ------------------------------------------------------------------------------------------------ extended overclock chip end to end

async function startExtended() {
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(buildAut047SeededState('ready'), { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS) }),
    });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, clock, session: boot.startup.session };
}

function extendedFlow(ads: ReturnType<typeof makeAds>, session: Awaited<ReturnType<typeof startExtended>>['session']) {
    return new ExtendedOverclockFlow({
        ads: ads.service,
        session: { getExtendedOverclockOffer: () => session.getExtendedOverclockOffer(), activateExtendedOverclockWithProof: (proof) => session.activateExtendedOverclockWithRewardedProof(proof) },
        now: () => NOW_MS,
    });
}

const boostIds = (session: { getStateSnapshot(): GameState }) => Object.keys(session.getStateSnapshot().boosts.activeBoosts);

test('AUT-071 ADS Extended Overclock chip: unavailable ad hides the offer, show failure / timeout / late callback never boost, the chip returns to ready', async () => {
    const { session } = await startExtended();

    const unavailable = makeAds({ available: false });
    const hidden = await extendedFlow(unavailable, session).refreshOffer();
    assert.equal(hidden.offer, false);
    assert.equal(unavailable.transport.showCalls(), 0);

    const failing = makeAds({ show: '{"status":"failed","reason":"show_failed"}' });
    const failFlow = extendedFlow(failing, session);
    await failFlow.refreshOffer();
    assert.equal(await failFlow.start(), 'not_granted');
    assert.equal(failFlow.getState().inFlight, false);
    assert.deepEqual(boostIds(session).filter((id) => id.includes('extended')), []);

    const hanging = makeAds();
    const flow = extendedFlow(hanging, session);
    await flow.refreshOffer();
    const hung = flow.start();
    await flush();
    assert.equal(flow.getState().inFlight, true);
    const requestId = hanging.transport.lastRequestId();
    hanging.timers[0].fire();
    assert.equal(await hung, 'not_granted');
    assert.equal(flow.getState().inFlight, false);
    hanging.transport.result(EXTENDED_OVERCLOCK_CLAIM_KEY, 'rewarded', true, requestId);
    await flush();
    assert.deepEqual(boostIds(session).filter((id) => id.includes('extended')), []);
    assert.equal(claims(session, EXTENDED_OVERCLOCK_CLAIM_KEY), 0);
    assert.equal((await flow.refreshOffer({ forceAdRead: true })).offer, true, 'ready again');

    const retry = flow.start();
    await flush();
    hanging.transport.result(EXTENDED_OVERCLOCK_CLAIM_KEY, 'rewarded', true);
    assert.equal(await retry, 'granted');
    assert.equal(claims(session, EXTENDED_OVERCLOCK_CLAIM_KEY), 1);
});

test('AUT-071 ADS Extended Overclock duplicate callbacks and an app killed during the ad grant nothing extra', async () => {
    const first = await startExtended();
    const ads = makeAds();
    const flow = extendedFlow(ads, first.session);
    await flow.refreshOffer();
    const attempt = flow.start();
    await flush();
    for (let i = 0; i < 3; i += 1) ads.transport.result(EXTENDED_OVERCLOCK_CLAIM_KEY, 'rewarded', true);
    assert.equal(await attempt, 'granted');
    assert.equal(claims(first.session, EXTENDED_OVERCLOCK_CLAIM_KEY), 1);

    // Killed during an ad on a second, unclaimed device state: nothing is persisted by merely showing the ad.
    const second = await startExtended();
    const killedAds = makeAds();
    const killedFlow = extendedFlow(killedAds, second.session);
    await killedFlow.refreshOffer();
    const saveBefore = second.storage.getFile(SAVE_MAIN_NAME);
    void killedFlow.start();
    await flush();
    assert.equal(second.storage.getFile(SAVE_MAIN_NAME), saveBefore);
    assert.equal(claims(second.session, EXTENDED_OVERCLOCK_CLAIM_KEY), 0);
});

// ------------------------------------------------------------------------------------------------ iap: killed between payment and grant, failed save

const PRICE = '1,99 EUR';

test('AUT-071 IAP app killed between payment and grant, then a failed save: redelivery grants once, acknowledges only after the durable save', async () => {
    const buyState = (): GameState => { const state = buildAut047SeededState('ready'); return state; };
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(buildAut047SeededState('ready'), { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS) }),
    });
    void buyState;
    const completed = (): PurchaseResult => ({ status: 'completed', productId: PRODUCTS.founderPack, requestId: 'store:order-9', transactionId: 'order-9', purchaseToken: 'token-9' });
    const log: string[] = [];

    async function launch() {
        const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
        const boot = await bootstrapGameSession({ storage, timeService: clock });
        if (!boot.startup.ok) throw new Error('startup failed');
        const binding = new FactoryWorldStateBinding({ session: boot.startup.session as never, configRepository: boot.configRepository, automation: null, hud: null, panel: null });
        const store = new MockPurchaseService({ initialStatus: 'ready', products: [{ productId: PRODUCTS.founderPack, type: 'durable', available: true, localizedPrice: PRICE }] });
        const flow = new FounderShopFlow({
            purchases: store,
            session: {
                getFounderOfferStatus: () => binding.getFounderOfferStatus(),
                applyFounderPackPurchase: async (request) => { log.push('apply'); return binding.applyFounderPackPurchase(request); },
                reconcileFounderEntitlement: async (report) => binding.reconcileFounderEntitlement(report),
            },
            entitlementSource: 'store',
            now: () => NOW_MS,
            acknowledge: () => { log.push('ack'); },
        });
        return { session: boot.startup.session, flow };
    }
    const charges = (session: { getStateSnapshot(): GameState }) => Object.entries(session.getStateSnapshot().meta.accountFeatureUnlocks).filter(([key, value]) => key.includes('surge') && value === true).length;

    // Launch 1: payment succeeded, the process dies before anything was applied (storage untouched).
    const killed = await launch();
    assert.equal(killed.session.getStateSnapshot().meta.accountFeatureUnlocks[PRODUCTS.founderPack], undefined);

    // Launch 2: the store redelivers, but the durable save fails -> applied in memory, NOT acknowledged.
    const second = await launch();
    storage.failNext({ operation: 'write', name: SAVE_TEMP_NAME, message: 'ENOSPC' });
    assert.equal(await second.flow.deliver(completed()), 'not_saved');
    assert.equal(log.includes('ack'), false, 'no acknowledge before a durable save');

    // Launch 3 (killed again before any later save): redelivery now succeeds, grants exactly once and acknowledges after the save.
    const third = await launch();
    const outcome = await third.flow.deliver(completed());
    assert.equal(outcome, 'purchased');
    assert.equal(log.filter((entry) => entry === 'ack').length, 1);
    assert.ok(log.lastIndexOf('apply') < log.indexOf('ack'));
    const grantedCharges = charges(third.session);
    assert.ok(grantedCharges >= 1);

    // Launch 4: a further redelivery is a harmless no-op (already owned): no second grant.
    const fourth = await launch();
    assert.equal(charges(fourth.session), grantedCharges);
    await fourth.flow.deliver(completed());
    assert.equal(charges(fourth.session), grantedCharges, 'never granted twice');
});

// ------------------------------------------------------------------------------------------------ missing visual asset

function walk(directory: string): string[] {
    return readdirSync(path.join(repoRoot, directory), { withFileTypes: true }).flatMap((entry) => {
        const relative = `${directory}/${entry.name}`;
        return entry.isDirectory() ? walk(relative) : entry.name.endsWith('.ts') ? [relative] : [];
    });
}

test('AUT-071 MISSING ASSET every prefab instantiate() in presentation is behind a null guard with a logged non-fatal diagnostic (skip, never throw)', () => {
    const offenders: string[] = [];
    let guarded = 0;
    for (const file of walk('assets/scripts/presentation')) {
        if (file.endsWith('/AssetRobotSpike.ts') || file.endsWith('/CameraSpikeBootstrap.ts')) continue; // AUT-031 / AUT-032 spikes are not part of the session path
        const lines = read(file).split('\n');
        lines.forEach((line, index) => {
            const match = /\binstantiate\(([\w.]+)\)/.exec(line);
            if (!match || /^\s*(import|\/\/|\*)/.test(line)) return;
            const variable = match[1].split('.').pop()!;
            const window = lines.slice(Math.max(0, index - 14), index).join('\n');
            const nullGuarded = new RegExp(`!\\s*(this\\.)?${variable}\\b`).test(window);
            const warned = /(console|Log)\.(warn|error)\(/.test(window);
            if (nullGuarded && warned) guarded += 1;
            else offenders.push(`${file}:${index + 1} instantiate(${match[1]})`);
        });
    }
    assert.deepEqual(offenders, []);
    assert.ok(guarded >= 15, `expected the known instantiate sites to be pinned, found ${guarded}`);
});

test('AUT-071 MISSING ASSET audio and fonts cannot fail the session: the shipped audio service is silent and no runtime loader exists', () => {
    const silent = read('assets/scripts/platform/noop/SilentAudioService.ts');
    assert.equal(/\bthrow\b/.test(silent), false);
    assert.match(silent, /no audio asset ships/i);
    const offenders: string[] = [];
    for (const file of walk('assets/scripts')) {
        if (/^assets\/scripts\/(presentation\/(AutomataIdentity|TextFit|LabelFit)|settings\/)/.test(file)) continue;
        const source = read(file);
        if (/\b(resources|assetManager)\.(load|loadAny|loadDir)\b|\bAudioSource\b|\bAudioClip\b|\bTTFFont\b|\bBitmapFont\b|\bloadRemote\b/.test(source)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], 'a runtime asset loader needs its own failure path (and a test) before it is added');
});

// ------------------------------------------------------------------------------------------------ deadlock / flow liveness

test('AUT-071 LIVENESS every async flow handler in a modal / chip / card controller also handles rejection (no stuck in-flight flag)', () => {
    const controllers: Array<[string, RegExp[]]> = [
        ['assets/scripts/presentation/OfflineReportController.ts', [/emitter\(\)\.then\(\(result\) => this\.onCollectResult\(result\), \(\) => this\.onCollectResult\(null\)\)/,/flow\.start\(\)\.then\(\(result\) => this\.onDoubleResult\(result\), \(\) => this\.onDoubleResult\('error'\)\)/]],
        ['assets/scripts/presentation/RebootController.ts', [/emitter\(command\)\.then\(\(result\) => this\.onRebootResult\(result\), \(\) => this\.onRebootResult\(null\)\)/]],
        ['assets/scripts/presentation/PermanentUpgradeController.ts', [/\(\) => this\.onPurchaseResult\(row, null\)\)/]],
        ['assets/scripts/presentation/ExtendedOverclockController.ts', [/flow\.start\(\)\.then\(\(result\) => this\.onStartFinished\(result\), \(\) => this\.onStartFinished\('error'\)\)/]],
        ['assets/scripts/presentation/FounderShopController.ts', [/\}, \(\) => \{\s*this\.render\(\);/]],
    ];
    for (const [file, patterns] of controllers) {
        const source = read(file);
        for (const pattern of patterns) assert.ok(pattern.test(source), `${file} must handle a rejected flow (${pattern})`);
    }
});

test('AUT-071 LIVENESS every modal has a way out that never depends on the flow: CLOSE / cancel and a tap on the dim backdrop', () => {
    for (const file of ['FounderShopController', 'PermanentUpgradeController', 'SettingsController']) {
        const source = read(`assets/scripts/presentation/${file}.ts`);
        assert.match(source, /public onClosePressed\(\): void \{\s*this\.closePanel\(/, `${file} CLOSE`);
        assert.match(source, /backdrop/i);
    }
    const reboot = read('assets/scripts/presentation/RebootController.ts');
    assert.match(reboot, /closePanel\('cancel'\)/);
    assert.match(reboot, /if \(!this\.open \|\| this\.inFlight\) return;/, 'only an in-flight Reboot is inert, and that command always settles');
    const offline = read('assets/scripts/presentation/OfflineReportController.ts');
    assert.match(offline, /\(\) => finish\(null\)/, 'the silent auto-collect also settles on rejection');
});

test('AUT-071 LIVENESS the platform watchdogs are in the provider layer: ads result backstop, billing timeouts, consent start timeout, overlay backstop', () => {
    assert.match(read('assets/scripts/platform/android/AndroidAdsService.ts'), /ANDROID_ADS_RESULT_TIMEOUT_MS = 120_000/);
    const billing = read('assets/scripts/platform/android/AndroidPurchaseService.ts');
    assert.match(billing, /ANDROID_BILLING_PURCHASE_TIMEOUT_MS/);
    assert.match(billing, /ANDROID_BILLING_OPERATION_TIMEOUT_MS/);
    assert.match(read('assets/scripts/services/ConsentCoordinator.ts'), /[Tt]imeout/);
});
