import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ANDROID_ADS_RESULT_EVENT, ANDROID_ADS_RESULT_TIMEOUT_MS, AndroidAdsService, type AndroidAdsTransport } from '../assets/scripts/platform/android/AndroidAdsService.ts';
import { createBuildAdsService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { DEBUG_ADS_PROVIDER_ADMOB_TEST, parseDebugAdsScriptFile } from '../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { OverlayBackgroundGate } from '../assets/scripts/presentation/OverlayBackgroundGate.ts';
import { OfflineDoubleFlow } from '../assets/scripts/presentation/OfflineDoubleFlow.ts';
import { ExtendedOverclockFlow } from '../assets/scripts/presentation/ExtendedOverclockFlow.ts';
import { MockAdsService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { NoOpAdsService } from '../assets/scripts/platform/noop/NoOpPlatformProviders.ts';
import { PlatformOverlayTracker } from '../assets/scripts/services/PlatformOverlay.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { AUT057_SEED_VARIANTS, buildAut057AdsScriptFile, buildAut057SeededSave, isAut057SeedVariant } from '../tools/device/seed_aut057.ts';
import { evaluateAdmob, type AdmobTimelineEvent } from '../tools/device/admob_checks.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

class FakeTransport implements AndroidAdsTransport {
    public readonly calls: Array<{ method: string; args: string[] }> = [];
    public readonly handlers = new Map<string, Set<(payload: string) => void>>();
    public responses = new Map<string, string | (() => string)>();
    public throwOn: string | null = null;

    public callString(method: string, _signature: string, ...args: string[]): string {
        this.calls.push({ method, args });
        if (this.throwOn === method) throw new Error('native boom');
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

    public emit(event: string, payload: string): void {
        for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
    }

    public result(requestId: string, status: string, rewardVerified: boolean, extra: Record<string, unknown> = {}): void {
        this.emit(ANDROID_ADS_RESULT_EVENT, JSON.stringify({ status, placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId, rewardVerified, ...extra }));
    }
}

function makeService(options: { overlay?: PlatformOverlayTracker } = {}) {
    const transport = new FakeTransport();
    transport.responses.set('showRewarded', '{"status":"started"}');
    const timers: Array<{ delay: number; fire: () => void; cancelled: boolean }> = [];
    const diagnostics: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const service = new AndroidAdsService({
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

const req = (requestId: string, placementId = OFFLINE_DOUBLE_CLAIM_KEY) => ({ placementId, requestId });

test('android ads: started then a verified rewarded event resolves once with rewardVerified', async () => {
    const { transport, service } = makeService();
    const pending = service.showRewarded(req('r1'));
    assert.equal(transport.calls[0].method, 'showRewarded');
    assert.deepEqual(JSON.parse(transport.calls[0].args[0]), req('r1'));
    transport.result('r1', 'rewarded', true);
    const result = await pending;
    assert.deepEqual(result, { status: 'rewarded', placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId: 'r1', rewardVerified: true });
});

test('android ads: closed, failed and unavailable events never verify a reward', async () => {
    for (const status of ['closed', 'failed', 'unavailable', 'timeout']) {
        const { transport, service } = makeService();
        const pending = service.showRewarded(req(`r_${status}`));
        transport.result(`r_${status}`, status, true, { reason: 'x' }); // even a (bogus) true flag is ignored unless status is rewarded
        const result = await pending;
        assert.equal(result.status, status);
        assert.equal(result.rewardVerified, false, status);
    }
});

test('android ads: rewardVerified needs BOTH status rewarded AND native rewardVerified true', async () => {
    const { transport, service } = makeService();
    const pending = service.showRewarded(req('r1'));
    transport.result('r1', 'rewarded', false);
    const result = await pending;
    assert.equal(result.status, 'rewarded');
    assert.equal(result.rewardVerified, false);
    const missing = makeService();
    const second = missing.service.showRewarded(req('r2'));
    missing.transport.emit(ANDROID_ADS_RESULT_EVENT, JSON.stringify({ status: 'rewarded', requestId: 'r2' }));
    assert.equal((await second).rewardVerified, false);
});

test('android ads: an immediate terminal native answer resolves without waiting and ends the overlay', async () => {
    const overlay = new PlatformOverlayTracker();
    const log: string[] = [];
    overlay.subscribe((event) => log.push(`${event.phase}:${event.requestId}`));
    const { transport, service, timers } = makeService({ overlay });
    transport.responses.set('showRewarded', '{"status":"unavailable","requestId":"r1","reason":"ads_not_configured","rewardVerified":false}');
    const result = await service.showRewarded(req('r1'));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'ads_not_configured');
    assert.equal(result.rewardVerified, false);
    assert.deepEqual(log, ['begin:r1', 'end:r1']);
    assert.equal(overlay.isOverlayActive(), false);
    assert.equal(timers.length, 0);
});

test('android ads: overlay begins BEFORE the native call and ends BEFORE the promise resolves', async () => {
    const overlay = new PlatformOverlayTracker();
    const { transport, service } = makeService({ overlay });
    let activeDuringCall = false;
    transport.responses.set('showRewarded', () => { activeDuringCall = overlay.isOverlayActive(); return '{"status":"started"}'; });
    const pending = service.showRewarded(req('r1'));
    assert.equal(activeDuringCall, true);
    assert.equal(overlay.isOverlayActive(), true);
    let activeAtResolve: boolean | null = null;
    void pending.then(() => { activeAtResolve = overlay.isOverlayActive(); });
    transport.result('r1', 'rewarded', true);
    await pending;
    await Promise.resolve();
    assert.equal(activeAtResolve, false);
});

test('android ads: first result wins; a duplicate event is a no-op and a reused requestId is a duplicate with rewardVerified false', async () => {
    const { transport, service } = makeService();
    const pending = service.showRewarded(req('r1'));
    transport.result('r1', 'rewarded', true);
    transport.result('r1', 'rewarded', true); // duplicate callback: no pending entry left
    const first = await pending;
    assert.equal(first.rewardVerified, true);
    const again = await service.showRewarded(req('r1'));
    assert.equal(again.duplicate, true);
    assert.equal(again.rewardVerified, false);
    assert.equal(transport.calls.filter((c) => c.method === 'showRewarded').length, 1, 'no second native show for a reused id');
});

test('android ads: the JS backstop resolves timeout, ends the overlay and ignores a late event', async () => {
    const overlay = new PlatformOverlayTracker();
    const { transport, service, timers } = makeService({ overlay });
    const pending = service.showRewarded(req('r1'));
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, ANDROID_ADS_RESULT_TIMEOUT_MS);
    timers[0].fire();
    const result = await pending;
    assert.equal(result.status, 'timeout');
    assert.equal(result.rewardVerified, false);
    assert.equal(overlay.isOverlayActive(), false);
    transport.result('r1', 'rewarded', true); // late: never granted
    const replay = await service.showRewarded(req('r1'));
    assert.equal(replay.status, 'timeout');
    assert.equal(replay.rewardVerified, false);
    assert.equal(replay.duplicate, true);
});

test('android ads: the backstop timer is cancelled once the result arrives', async () => {
    const { transport, service, timers } = makeService();
    const pending = service.showRewarded(req('r1'));
    transport.result('r1', 'closed', false);
    await pending;
    assert.equal(timers[0].cancelled, true);
});

test('android ads: malformed JSON, unknown status and native exceptions resolve failed and never throw', async () => {
    const malformed = makeService();
    malformed.transport.responses.set('showRewarded', 'not json');
    assert.equal((await malformed.service.showRewarded(req('r1'))).status, 'failed');

    const unknown = makeService();
    const pendingUnknown = unknown.service.showRewarded(req('r2'));
    unknown.transport.result('r2', 'granted', true);
    const unknownResult = await pendingUnknown;
    assert.equal(unknownResult.status, 'failed');
    assert.equal(unknownResult.rewardVerified, false);

    const garbageEvent = makeService();
    const pendingGarbage = garbageEvent.service.showRewarded(req('r3'));
    garbageEvent.transport.emit(ANDROID_ADS_RESULT_EVENT, '{{{');
    garbageEvent.transport.emit(ANDROID_ADS_RESULT_EVENT, '[]');
    garbageEvent.transport.result('other', 'rewarded', true);
    garbageEvent.transport.result('r3', 'closed', false);
    assert.equal((await pendingGarbage).status, 'closed');

    const throwing = makeService();
    throwing.transport.throwOn = 'showRewarded';
    assert.equal((await throwing.service.showRewarded(req('r4'))).status, 'failed');
    throwing.transport.throwOn = 'getRewardedAvailability';
    assert.equal((await throwing.service.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, false);
    throwing.transport.throwOn = 'initializeAds';
    assert.equal((await throwing.service.initialize()).status, 'failed');
});

test('android ads: overlay is cleaned up on every path', async () => {
    for (const mode of ['rewarded', 'closed', 'failed', 'timeout', 'terminal', 'throw']) {
        const overlay = new PlatformOverlayTracker();
        const { transport, service, timers } = makeService({ overlay });
        if (mode === 'terminal') transport.responses.set('showRewarded', '{"status":"failed","reason":"x"}');
        if (mode === 'throw') transport.throwOn = 'showRewarded';
        const pending = service.showRewarded(req(`r_${mode}`));
        if (mode === 'rewarded') transport.result(`r_${mode}`, 'rewarded', true);
        if (mode === 'closed' || mode === 'failed') transport.result(`r_${mode}`, mode, false);
        if (mode === 'timeout') timers[0].fire();
        await pending;
        assert.equal(overlay.isOverlayActive(), false, mode);
    }
});

test('android ads: initialize, status, availability and preload map one native call each and expose reasons', async () => {
    const { transport, service, diagnostics } = makeService();
    transport.responses.set('initializeAds', '{"ok":true,"status":"initializing"}');
    transport.responses.set('getAdsStatus', '{"ok":true,"status":"ready"}');
    transport.responses.set('getRewardedAvailability', '{"available":false,"status":"unavailable","reason":"loading"}');
    transport.responses.set('preloadRewarded', '{"ok":true,"status":"ready"}');
    assert.equal((await service.initialize()).status, 'initializing');
    assert.equal(service.getStatus().status, 'ready');
    const availability = await service.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY);
    assert.deepEqual([availability.available, availability.reason], [false, 'loading']);
    assert.equal((await service.preloadRewarded(OFFLINE_DOUBLE_CLAIM_KEY)).ok, true);
    transport.responses.set('getRewardedAvailability', '{"available":true,"status":"ready"}');
    assert.equal((await service.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, true);
    assert.deepEqual(diagnostics.filter((d) => d.phase === 'availability').map((d) => d.payload.available), [false, true]);
    // Missing / junk responses never claim availability.
    transport.responses.set('getRewardedAvailability', 'junk');
    assert.equal((await service.getRewardedAvailability(EXTENDED_OVERCLOCK_CLAIM_KEY)).available, false);
});

test('android ads: a missing event bus degrades to the JS backstop instead of throwing', async () => {
    const transport: AndroidAdsTransport = {
        callString: () => '{"status":"started"}',
        subscribe: () => { throw new Error('no jsbBridgeWrapper'); },
    };
    const timers: Array<() => void> = [];
    const service = new AndroidAdsService({ transport, schedule: (cb) => { timers.push(cb); return () => undefined; } });
    const pending = service.showRewarded(req('r1'));
    timers[0]();
    assert.equal((await pending).status, 'timeout');
});

test('flows work with the async Android service: Offline Double grants once on a verified reward and never on close', async () => {
    for (const mode of ['rewarded', 'closed']) {
        const { transport, service } = makeService();
        transport.responses.set('getRewardedAvailability', '{"available":true,"status":"ready"}');
        const proofs: unknown[] = [];
        const flow = new OfflineDoubleFlow({
            ads: service,
            session: {
                getOfflineDoubleOffer: () => ({ eligibility: { placementId: OFFLINE_DOUBLE_CLAIM_KEY, eligible: true, reason: 'eligible', nextEligibleAtUtc: null, remainingQuota: 3, claimsInWindow: 0 }, multiplier: 2, projectedReward: 200 }) as never,
                collectPendingOfflineWithRewardedBonus: async (proof) => { proofs.push(proof); return { status: 'bonus_not_granted', reason: 'not_rewarded' } as never; },
            },
            now: () => 1_000,
        });
        assert.equal((await flow.refreshOffer()).offer, true);
        const started = flow.start();
        const requestId = JSON.parse(transport.calls.find((c) => c.method === 'showRewarded')!.args[0]).requestId as string;
        transport.result(requestId, mode, mode === 'rewarded');
        await started;
        assert.equal(proofs.length, 1);
        const proof = proofs[0] as { status: string; rewardVerified: boolean };
        assert.deepEqual([proof.status, proof.rewardVerified], [mode, mode === 'rewarded']);
    }
});

test('flows work with the async Android service: Extended Overclock hands the verified proof to the session once', async () => {
    const { transport, service } = makeService();
    transport.responses.set('getRewardedAvailability', '{"available":true,"status":"ready"}');
    const proofs: Array<{ status: string; rewardVerified: boolean; placementId: string }> = [];
    const flow = new ExtendedOverclockFlow({
        ads: service,
        session: {
            getExtendedOverclockOffer: () => ({ eligibility: { placementId: EXTENDED_OVERCLOCK_CLAIM_KEY, eligible: true, reason: 'eligible', nextEligibleAtUtc: null, remainingQuota: 3, claimsInWindow: 0 }, activeBlocked: false }) as never,
            activateExtendedOverclockWithProof: async (proof) => { proofs.push(proof as never); return null; },
        },
        now: () => 5_000,
    });
    assert.equal((await flow.refreshOffer()).offer, true);
    const started = flow.start();
    const call = transport.calls.find((c) => c.method === 'showRewarded')!;
    const { requestId, placementId } = JSON.parse(call.args[0]) as { requestId: string; placementId: string };
    assert.equal(placementId, EXTENDED_OVERCLOCK_CLAIM_KEY);
    transport.emit(ANDROID_ADS_RESULT_EVENT, JSON.stringify({ status: 'rewarded', placementId, requestId, rewardVerified: true }));
    await started;
    assert.equal(proofs.length, 1);
    assert.deepEqual([proofs[0].status, proofs[0].rewardVerified, proofs[0].placementId], ['rewarded', true, EXTENDED_OVERCLOCK_CLAIM_KEY]);
});

test('createBuildAdsService matrix: release / DEBUG default / DEBUG admob_test', () => {
    const transport = new FakeTransport();
    // Release.
    assert.ok(createBuildAdsService(false) instanceof NoOpAdsService);
    assert.ok(createBuildAdsService(false, undefined, { androidTransport: null }) instanceof NoOpAdsService);
    assert.ok(createBuildAdsService(false, undefined, { androidTransport: transport }) instanceof AndroidAdsService);
    // A DEBUG script never changes a release build.
    assert.ok(createBuildAdsService(false, { offlineDouble: [], extendedOverclock: [], duplicateCallback: false, provider: DEBUG_ADS_PROVIDER_ADMOB_TEST }) instanceof NoOpAdsService);
    // DEBUG: the mock stays the default, even with a transport.
    assert.ok(createBuildAdsService(true) instanceof MockAdsService);
    assert.ok(createBuildAdsService(true, undefined, { androidTransport: transport }) instanceof MockAdsService);
    assert.ok(createBuildAdsService(true, { offlineDouble: ['closed'], extendedOverclock: [], duplicateCallback: false }, { androidTransport: transport }) instanceof MockAdsService);
    // DEBUG + provider admob_test: the real Android provider; without a native bridge it stays the mock.
    const script = { offlineDouble: [], extendedOverclock: [], duplicateCallback: false, provider: DEBUG_ADS_PROVIDER_ADMOB_TEST } as const;
    assert.ok(createBuildAdsService(true, script, { androidTransport: transport }) instanceof AndroidAdsService);
    assert.ok(createBuildAdsService(true, script, { androidTransport: null }) instanceof MockAdsService);
});

test('debug ads script: provider admob_test is accepted alone, any other value is rejected, the old shape is unchanged', () => {
    assert.deepEqual(parseDebugAdsScriptFile('{"provider":"admob_test"}'), { offlineDouble: [], extendedOverclock: [], duplicateCallback: false, provider: 'admob_test' });
    assert.deepEqual(parseDebugAdsScriptFile('{"provider":"admob_test","offlineDouble":["closed"]}'), { offlineDouble: ['closed'], extendedOverclock: [], duplicateCallback: false, provider: 'admob_test' });
    assert.deepEqual(parseDebugAdsScriptFile('{"offlineDouble":["closed"]}'), { offlineDouble: ['closed'], extendedOverclock: [], duplicateCallback: false });
    for (const bad of ['{"provider":"admob"}', '{"provider":"mock"}', '{"provider":1}', '{"provider":null}', '{"provider":"ADMOB_TEST"}', '{}']) {
        assert.equal(parseDebugAdsScriptFile(bad), null, bad);
    }
});

test('OverlayBackgroundGate: overlay hide skips suspend, the matching show skips resume, absence still suspends / resumes, the flag is one-shot', () => {
    const gate = new OverlayBackgroundGate();
    // Genuine absence (no overlay): exactly the old behaviour.
    assert.equal(gate.onHide(false), 'suspend');
    assert.equal(gate.onShow(), 'resume');
    // Overlay hide: no suspend; the show closes it even when the tracker is already ended (the flag, not the tracker, decides).
    assert.equal(gate.onHide(true), 'skip');
    assert.equal(gate.isHideDuringOverlay(), true);
    assert.equal(gate.onShow(), 'skip');
    assert.equal(gate.isHideDuringOverlay(), false);
    assert.equal(gate.onShow(), 'resume'); // one-shot
    // A stale flag is cleared by the next hide without an overlay.
    assert.equal(gate.onHide(true), 'skip');
    assert.equal(gate.onHide(false), 'suspend');
    assert.equal(gate.onShow(), 'resume');
});

test('FactoryWorldBootstrap wiring: one shared overlay tracker, the gate guards hide / show, ads init runs once the session is ready', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /new PlatformOverlayTracker\(\)/);
    assert.equal((bootstrap.match(/new PlatformOverlayTracker\(\)/g) ?? []).length, 1);
    assert.match(bootstrap, /overlay: this\.platformOverlay/);
    assert.match(bootstrap, /this\.overlayGate\.onHide\(this\.platformOverlay\.classifyBackground\(\) === 'overlay'\) === 'skip'/);
    assert.match(bootstrap, /this\.overlayGate\.onShow\(\) === 'skip'/);
    const hide = bootstrap.slice(bootstrap.indexOf('private onGameHide()'), bootstrap.indexOf('private onGameShow()'));
    assert.ok(hide.indexOf("=== 'skip'") < hide.indexOf('binding.suspend()'), 'the gate runs before suspend');
    assert.ok(hide.indexOf("=== 'skip'") < hide.indexOf('boostPresentation?.onBackground()'), 'the gate runs before the boost look stops');
    const show = bootstrap.slice(bootstrap.indexOf('private onGameShow()'), bootstrap.indexOf('/** AUT-051: shows / refreshes'));
    assert.ok(show.indexOf("=== 'skip'") < show.indexOf('binding.resume()'), 'the gate runs before resume');
    assert.ok(show.indexOf("=== 'skip'") < show.indexOf("showOfflineReport('resumed')"), 'the gate runs before the offline report');
    // Ads are initialised after the session binding is active, never on the startup path.
    assert.match(bootstrap, /if \(offlineAds\) this\.startAdsProvider\(offlineAds\)/);
    const bootstrapStart = bootstrap.slice(bootstrap.indexOf('private startPersistentSession('), bootstrap.indexOf('bootstrapGameSession({'));
    assert.doesNotMatch(bootstrapStart, /\.initialize\(\)/);
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /'ads_state'/);
});

// ---------------------------------------------------------------------------------------------------- source scans

function trackedSourceFiles(roots: readonly string[], extensions: readonly string[]): string[] {
    const out: string[] = [];
    const walk = (directory: string) => {
        for (const entry of readdirSync(directory)) {
            if (entry === 'node_modules' || entry === 'temp' || entry === 'build' || entry === 'library') continue;
            const full = path.join(directory, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
        }
    };
    for (const root of roots) walk(path.join(repoRoot, root));
    return out;
}

test('no non-sample AdMob ID in tracked sources; Google sample IDs are the only ones allowed', () => {
    const files = trackedSourceFiles(['native/engine/android', 'assets/scripts', 'tools', 'tests'], ['.ts', '.java', '.xml', '.gradle', '.json', '.ps1', '.js', '.md', '.pro']);
    assert.ok(files.length > 50);
    const idPattern = /ca-app-pub-\d{16}[~/]\d{10}/g;
    for (const file of files) {
        for (const match of readFileSync(file, 'utf8').matchAll(idPattern)) {
            assert.ok(match[0].startsWith('ca-app-pub-3940256099942544'), `${path.relative(repoRoot, file)} contains a non-sample AdMob ID`);
        }
    }
});

test('native config: manifest placeholders, provider removal, gradle defaults, Java sample IDs and the debuggable guard', () => {
    const manifest = read('native/engine/android/app/AndroidManifest.xml');
    assert.match(manifest, /android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID" android:value="\$\{ADMOB_APP_ID\}"/);
    assert.match(manifest, /android:name="com\.projectautomata\.ads\.unit\.offline_double" android:value="\$\{ADMOB_UNIT_OFFLINE_DOUBLE\}"/);
    assert.match(manifest, /android:name="com\.projectautomata\.ads\.unit\.extended_overclock" android:value="\$\{ADMOB_UNIT_EXTENDED_OVERCLOCK\}"/);
    assert.match(manifest, /<provider android:name="com\.google\.android\.gms\.ads\.MobileAdsInitProvider" tools:node="remove"\s*\/>/);

    const gradle = read('native/engine/android/app/build.gradle');
    assert.match(gradle, /play-services-ads:25\.4\.0/);
    assert.doesNotMatch(gradle, /BuildConfig|buildConfigField/);
    const releaseBlock = gradle.slice(gradle.indexOf('        release {'), gradle.indexOf('        debug {'));
    const debugBlock = gradle.slice(gradle.indexOf('        debug {'));
    for (const name of ['ADMOB_APP_ID', 'ADMOB_UNIT_OFFLINE_DOUBLE', 'ADMOB_UNIT_EXTENDED_OVERCLOCK']) {
        assert.match(releaseBlock, new RegExp(`${name}: automataAdProperty\\('${name}', ''\\)`), `release ${name} defaults to empty`);
        assert.match(debugBlock, new RegExp(`${name}: 'ca-app-pub-3940256099942544`), `debug ${name} is the sample`);
    }
    assert.match(gradle, /System\.getenv\(name\)/);
    assert.match(gradle, /project\.findProperty\(name\)/);

    const java = read('native/engine/android/app/src/com/cocos/game/AutomataAdsController.java');
    assert.ok(java.includes('ca-app-pub-3940256099942544~3347511713'));
    assert.ok(java.includes('ca-app-pub-3940256099942544/5224354917'));
    assert.match(java, /FLAG_DEBUGGABLE/);
    assert.match(java, /ads_not_configured/);
    assert.match(java, /completed\.compareAndSet\(false, true\)/);
    assert.match(java, /extras\.putString\("npa", "1"\)/);
    assert.match(java, /private static boolean canRequestAds\(\)/);
    assert.doesNotMatch(java, /setTagForChildDirectedTreatment/);
    const earned = java.slice(java.indexOf('public void onUserEarnedReward'), java.indexOf('catch (Throwable t) {\n            finishShow(request, "failed", "show_exception"'));
    assert.doesNotMatch(earned, /finishShow|dispatch\(/, 'onUserEarnedReward only sets earned');
    assert.match(read('native/engine/android/app/src/com/cocos/game/AutomataPlatformBridge.java'), /AutomataAdsController\.show\(requestJson\)/);
});

test('the Android ads bridge is only reached from the platform layer and the bootstrap, never from gameplay code', () => {
    const scripts = trackedSourceFiles(['assets/scripts'], ['.ts']);
    for (const file of scripts) {
        const relative = path.relative(path.join(repoRoot, 'assets/scripts'), file).replace(/\\/g, '/');
        const source = readFileSync(file, 'utf8');
        if (/^(platform|presentation|app)\//.test(relative)) continue;
        assert.doesNotMatch(source, /AndroidAdsService|AndroidNativeBridge|automata\.ads\./, `${relative} reaches the Android ads provider`);
    }
    const pure = read('assets/scripts/platform/android/AndroidAdsService.ts');
    assert.doesNotMatch(pure, /from\s+['"]cc['"]/);
    assert.doesNotMatch(pure, /native\.reflection|AutomataPlatformBridge|com\.google|MobileAds|BillingClient/);
    assert.match(read('assets/scripts/platform/android/AndroidPlatformProviders.ts'), /export \{ AndroidAdsService \} from '\.\/AndroidAdsService'/);
    assert.match(read('assets/scripts/platform/android/AndroidNativeBridge.ts'), /addNativeEventListener/);
    assert.ok(statSync(path.join(repoRoot, 'assets/scripts/platform/android/AndroidAdsService.ts.meta')).isFile());
    assert.ok(statSync(path.join(repoRoot, 'assets/scripts/presentation/OverlayBackgroundGate.ts.meta')).isFile());
});

// ---------------------------------------------------------------------------------------------------- device tooling

const ev = (evt: string, extra: Record<string, unknown>, tMs = 0): AdmobTimelineEvent => ({ tMs, event: { v: 1, seq: 0, evt, ...extra } as never });

test('admob device checks: a complete rewarded run passes, a suspend during the overlay or a double result fails', () => {
    const good: AdmobTimelineEvent[] = [
        ev('ads_state', { phase: 'initialized', status: 'initializing' }),
        ev('ads_state', { phase: 'availability', placementId: 'rewarded.offline_double', available: true }),
        ev('offline_report', { phase: 'shown', reward: 10 }),
        ev('offline_double', { phase: 'ad_started', requestId: 'r1' }),
        ev('ads_state', { phase: 'overlay', state: 'begin', requestId: 'r1' }),
        ev('ads_state', { phase: 'native_started', requestId: 'r1' }),
        ev('ads_state', { phase: 'overlay_hide_skipped' }),
        ev('ads_state', { phase: 'ad_result', requestId: 'r1', status: 'rewarded', rewardVerified: true }),
        ev('ads_state', { phase: 'overlay', state: 'end', requestId: 'r1' }),
        ev('offline_double', { phase: 'granted', saveOk: true, claimCount: 1 }),
    ];
    assert.ok(evaluateAdmob(good, 'offline_double').every((check) => check.ok), JSON.stringify(evaluateAdmob(good, 'offline_double').filter((c) => !c.ok)));
    const suspended = [...good.slice(0, 6), ev('session_state', { phase: 'suspended' }), ...good.slice(6)];
    assert.equal(evaluateAdmob(suspended, 'offline_double').find((c) => c.id === 'admob_overlay_no_session_suspend_resume')?.ok, false);
    const doubled = [...good.slice(0, 8), ev('ads_state', { phase: 'ad_result', requestId: 'r1', status: 'rewarded', rewardVerified: true }), ...good.slice(8)];
    assert.equal(evaluateAdmob(doubled, 'offline_double').find((c) => c.id === 'admob_single_result_per_request')?.ok, false);
    // The outcome of a real ad is best-effort: a run without a result still passes the structural checks.
    const noResult = good.filter((e) => !(e.event.evt === 'ads_state' && (e.event.phase === 'ad_result' || (e.event.phase === 'overlay' && e.event.state === 'end'))) && !(e.event.evt === 'offline_double' && e.event.phase === 'granted'));
    assert.ok(evaluateAdmob(noResult, 'offline_double').every((check) => check.ok));
});

test('admob device checks: no-fill needs no x2 / chip, no ad and a working free COLLECT', () => {
    const base: AdmobTimelineEvent[] = [
        ev('ads_state', { phase: 'initialized', status: 'ready' }),
        ev('ads_state', { phase: 'availability', placementId: 'rewarded.offline_double', available: false, reason: 'network' }),
        ev('offline_report', { phase: 'shown', reward: 5 }),
        ev('offline_report', { phase: 'collect_result', status: 'collected_saved', saveOk: true }),
    ];
    assert.ok(evaluateAdmob(base, 'no_fill').every((c) => c.ok));
    const leaked = [...base, ev('ui_layout', { rects: { OfflineReportDouble: { x: 1, y: 1, w: 10, h: 10 } } })];
    assert.equal(evaluateAdmob(leaked, 'no_fill').find((c) => c.id === 'admob_nofill_x2_and_extended_hidden')?.ok, false);
});

test('seed_aut057: variants, ads script, saves; scenarios, CLI and npm script are registered', () => {
    assert.deepEqual([...AUT057_SEED_VARIANTS], ['offline_double', 'extended']);
    assert.equal(isAut057SeedVariant('extended'), true);
    assert.equal(isAut057SeedVariant('x'), false);
    assert.deepEqual(JSON.parse(buildAut057AdsScriptFile()), { provider: 'admob_test' });
    assert.equal(parseDebugAdsScriptFile(buildAut057AdsScriptFile())?.provider, 'admob_test');
    const now = Date.UTC(2026, 10, 14, 12, 0, 0);
    for (const variant of AUT057_SEED_VARIANTS) assert.ok(buildAut057SeededSave(variant, now).length > 100);
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /seed-aut057 \[--variant offline_double\|extended\]/);
    assert.match(cli, /aut057-offline-double\|aut057-extended\|aut057-no-fill\]/);
    assert.match(read('package.json'), /"device:seed-aut057": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-aut057"/);
    const reveal = read('tools/device/reveal_capture.ts');
    for (const id of ['aut057-offline-double', 'aut057-extended', 'aut057-no-fill']) assert.match(reveal, new RegExp(`'${id}': \\{ id: '${id}'`));
});
