import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    CONSENT_OVERLAY_ID,
    CONSENT_PRIVACY_RESULT_EVENT,
    CONSENT_STATE_EVENT,
    ConsentCoordinator,
    type ConsentTransport,
} from '../assets/scripts/services/ConsentCoordinator.ts';
import { ConsentGatedAdsService } from '../assets/scripts/services/ConsentGatedAdsService.ts';
import { INITIAL_CONSENT_STATE, type ConsentState } from '../assets/scripts/services/ConsentService.ts';
import { PlatformOverlayTracker } from '../assets/scripts/services/PlatformOverlay.ts';
import { MockConsentTransport } from '../assets/scripts/platform/mock/MockConsentTransport.ts';
import { MockAdsService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { NoOpConsentService } from '../assets/scripts/platform/noop/NoOpConsentService.ts';
import { NoOpAdsService } from '../assets/scripts/platform/noop/NoOpPlatformProviders.ts';
import { OverlayBackgroundGate } from '../assets/scripts/presentation/OverlayBackgroundGate.ts';
import { createBuildAdsService, createBuildConsentService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { DEBUG_CONSENT_PROVIDER_UMP_TEST, parseDebugConsentScriptFile } from '../assets/scripts/presentation/DebugConsentScriptFile.ts';
import { parseDebugAdsScriptFile } from '../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { createSettingsViewModel } from '../assets/scripts/presentation/SettingsViewModel.ts';
import {
    SETTINGS_ROW_COUNT,
    SETTINGS_ROW_COUNT_WITH_PRIVACY,
    computeSettingsRects,
    resolveSettingsPanelLayout,
    settingsPanelHeight,
} from '../assets/scripts/presentation/SettingsLayout.ts';
import { computeUiLayout, rectContains, rectsOverlap } from '../assets/scripts/presentation/UiLayout.ts';
import { DEFAULT_USER_SETTINGS } from '../assets/scripts/settings/UserSettings.ts';
import { createTextCatalogue } from '../assets/scripts/localization/index.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { CURRENT_SAVE_VERSION } from '../assets/scripts/persistence/index.ts';
import { AUT065_SEED_VARIANTS, buildAut065ConsentScriptFile, buildAut065SeededSave, isAut065SeedVariant } from '../tools/device/seed_aut065.ts';
import { evaluateConsent, type ConsentExpectation, type ConsentTimelineEvent } from '../tools/device/consent_checks.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateRevealTimeline } from '../tools/device/reveal_capture.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n/g, '\n');
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------- fakes

class FakeConsentTransport implements ConsentTransport {
    public readonly calls: Array<{ method: string; args: string[] }> = [];
    public readonly handlers = new Map<string, Set<(payload: string) => void>>();
    public responses = new Map<string, string>();
    public throwOn: string | null = null;

    public callString(method: string, _signature: string, ...args: string[]): string {
        this.calls.push({ method, args });
        if (this.throwOn === method) throw new Error('native boom');
        return this.responses.get(method) ?? '{"status":"unavailable","reason":"no_response"}';
    }

    public subscribe(event: string, handler: (payload: string) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();
        set.add(handler);
        this.handlers.set(event, set);
        return () => { set.delete(handler); };
    }

    public emit(event: string, payload: Record<string, unknown> | string): void {
        for (const handler of [...(this.handlers.get(event) ?? [])]) handler(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }

    public state(payload: Record<string, unknown>): void {
        this.emit(CONSENT_STATE_EVENT, payload);
    }

    public methods(): string[] { return this.calls.map((call) => call.method); }
}

const SETTLED_ANSWER = '{"status":"not_required","canRequestAds":true,"privacyOptionsRequired":false,"formVisible":false,"settled":true}';
const INITIAL_ANSWER = '{"status":"unknown","canRequestAds":false,"privacyOptionsRequired":false,"formVisible":false,"settled":false}';

function makeCoordinator(options: { overlay?: PlatformOverlayTracker; startTimeoutMs?: number; privacyTimeoutMs?: number } = {}) {
    const transport = new FakeConsentTransport();
    transport.responses.set('initializeConsent', INITIAL_ANSWER);
    const timers: Array<{ delay: number; fire: () => void; cancelled: boolean }> = [];
    const diagnostics: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const coordinator = new ConsentCoordinator({
        transport,
        overlay: options.overlay,
        startTimeoutMs: options.startTimeoutMs,
        privacyTimeoutMs: options.privacyTimeoutMs,
        schedule: (callback, delay) => {
            const timer = { delay, fire: callback, cancelled: false };
            timers.push(timer);
            return () => { timer.cancelled = true; };
        },
        onDiagnostic: (phase, payload) => diagnostics.push({ phase, payload }),
    });
    const fireNext = (delay?: number): boolean => {
        const timer = timers.find((candidate) => !candidate.cancelled && (delay === undefined || candidate.delay === delay));
        if (!timer) return false;
        timer.cancelled = true;
        timer.fire();
        return true;
    };
    return { transport, coordinator, timers, diagnostics, fireNext };
}

const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

// ---------------------------------------------------------------- ConsentCoordinator

test('consent: not_required settles, allows ads and has no privacy options', async () => {
    const { transport, coordinator } = makeCoordinator();
    const started = coordinator.start();
    assert.deepEqual(transport.methods(), ['initializeConsent']);
    assert.equal(coordinator.canRequestAds(), false, 'fail-closed until the provider answers');
    transport.state({ status: 'not_required', canRequestAds: true, privacyOptionsRequired: false, formVisible: false, settled: true });
    const state = await started;
    assert.equal(state.status, 'not_required');
    assert.equal(state.canRequestAds, true);
    assert.equal(state.privacyOptionsRequired, false);
    assert.equal(state.personalization, 'non_personalized');
    assert.equal(coordinator.isPrivacyOptionsRequired(), false);
});

test('consent: required shows the form as a platform overlay, then obtained allows ads and reveals the privacy options entry', async () => {
    const overlay = new PlatformOverlayTracker();
    const log: string[] = [];
    overlay.subscribe((event) => log.push(`${event.phase}:${event.kind}:${event.requestId}`));
    const { transport, coordinator } = makeCoordinator({ overlay });
    const seen: ConsentState[] = [];
    coordinator.subscribe((state) => seen.push(state));
    const started = coordinator.start();
    transport.state({ status: 'required', canRequestAds: false, privacyOptionsRequired: true, formVisible: true, settled: false });
    assert.equal(overlay.isOverlayActive(), true);
    assert.equal(coordinator.getState().formVisible, true);
    let settled = false;
    void started.then(() => { settled = true; });
    await tick();
    assert.equal(settled, false, 'start() does not resolve while the form is up');
    transport.state({ status: 'obtained', canRequestAds: true, privacyOptionsRequired: true, formVisible: false, settled: true });
    const state = await started;
    assert.equal(state.status, 'obtained');
    assert.equal(state.canRequestAds, true);
    assert.equal(state.privacyOptionsRequired, true);
    assert.deepEqual(log, [`begin:consent_form:${CONSENT_OVERLAY_ID}`, `end:consent_form:${CONSENT_OVERLAY_ID}`]);
    assert.deepEqual(seen.map((s) => [s.status, s.formVisible, s.canRequestAds]), [['required', true, false], ['obtained', false, true]]);
});

test('consent: required and declined keeps ads closed (fail-closed) and gameplay free', async () => {
    const { transport, coordinator } = makeCoordinator();
    const started = coordinator.start();
    transport.state({ status: 'required', canRequestAds: false, privacyOptionsRequired: true, formVisible: false, settled: true, reason: 'consent_not_given' });
    const state = await started;
    assert.equal(state.status, 'required');
    assert.equal(state.canRequestAds, false);
    assert.equal(state.reason, 'consent_not_given');
});

test('consent: unavailable never allows ads, even if the native side claims it (fail-closed)', async () => {
    const { transport, coordinator } = makeCoordinator();
    transport.responses.set('initializeConsent', '{"status":"unavailable","canRequestAds":true,"privacyOptionsRequired":false,"formVisible":false,"settled":true,"reason":"ads_not_configured"}');
    const state = await coordinator.start();
    assert.equal(state.status, 'unavailable');
    assert.equal(state.canRequestAds, false);
    assert.equal(state.reason, 'ads_not_configured');
});

test('consent: an error keeps the provider canRequestAds (stored consent) and never throws into the caller', async () => {
    const { transport, coordinator } = makeCoordinator();
    const started = coordinator.start();
    transport.state({ status: 'error', canRequestAds: true, privacyOptionsRequired: false, formVisible: false, settled: true, reason: 'update_error_2' });
    const state = await started;
    assert.equal(state.status, 'error');
    assert.equal(state.canRequestAds, true, 'a previous session consent still allows ads');
    const closed = makeCoordinator();
    const second = closed.coordinator.start();
    closed.transport.state({ status: 'error', canRequestAds: false, settled: true, reason: 'update_error_2' });
    assert.equal((await second).canRequestAds, false);
});

test('consent: a native call that throws, malformed JSON and unknown statuses end as error, ads closed, no rejection', async () => {
    const thrown = makeCoordinator();
    thrown.transport.throwOn = 'initializeConsent';
    const a = await thrown.coordinator.start();
    assert.equal(a.status, 'error');
    assert.equal(a.reason, 'android_native_call_failed');
    assert.equal(a.canRequestAds, false);

    const malformed = makeCoordinator();
    malformed.transport.responses.set('initializeConsent', 'not json');
    const b = await malformed.coordinator.start();
    assert.equal(b.status, 'error');
    assert.equal(b.canRequestAds, false);

    const unknown = makeCoordinator();
    const pending = unknown.coordinator.start();
    unknown.transport.state({ status: 'weird', canRequestAds: true, settled: true });
    const c = await pending;
    assert.equal(c.status, 'error');
    assert.equal(c.reason, 'android_unknown_consent_status');
});

test('consent: no answer within the start timeout -> error / consent_timeout, ads closed, start resolves (never blocks)', async () => {
    const { coordinator, timers, fireNext, diagnostics } = makeCoordinator();
    const started = coordinator.start();
    assert.ok(timers.some((timer) => timer.delay === 20_000), 'the production start timeout is armed');
    assert.equal(coordinator.getState().status, 'unknown');
    assert.equal(coordinator.canRequestAds(), false);
    assert.equal(fireNext(20_000), true);
    const state = await started;
    assert.equal(state.status, 'error');
    assert.equal(state.reason, 'consent_timeout');
    assert.equal(state.canRequestAds, false);
    assert.ok(diagnostics.some((entry) => entry.phase === 'timeout'));
});

test('consent: a late native answer after the timeout still applies (consent can only improve the state)', async () => {
    const { transport, coordinator, fireNext } = makeCoordinator();
    const started = coordinator.start();
    fireNext(20_000);
    await started;
    transport.state({ status: 'not_required', canRequestAds: true, privacyOptionsRequired: false, formVisible: false, settled: true });
    assert.equal(coordinator.getState().status, 'not_required');
    assert.equal(coordinator.canRequestAds(), true);
});

test('consent: the start timeout never fires under a visible form (the player is reading it)', async () => {
    const { transport, coordinator, timers, fireNext } = makeCoordinator();
    const started = coordinator.start();
    transport.state({ status: 'required', formVisible: true, settled: false, privacyOptionsRequired: true });
    fireNext(20_000);
    assert.equal(coordinator.getState().status, 'required', 'no timeout under the form');
    assert.ok(timers.filter((timer) => !timer.cancelled && timer.delay === 20_000).length >= 1, 'the timer is re-armed');
    transport.state({ status: 'obtained', canRequestAds: true, privacyOptionsRequired: true, formVisible: false, settled: true });
    assert.equal((await started).status, 'obtained');
});

test('consent: start is idempotent (one native initialize), subscribes once, and is synchronous-light (non-blocking)', async () => {
    const { transport, coordinator } = makeCoordinator();
    const first = coordinator.start();
    const second = coordinator.start();
    assert.equal(first, second);
    assert.equal(transport.methods().filter((method) => method === 'initializeConsent').length, 1);
    assert.equal(transport.handlers.get(CONSENT_STATE_EVENT)?.size, 1);
    assert.equal(coordinator.getState().status, 'unknown', 'the call returned without waiting for UMP');
    transport.state({ status: 'not_required', canRequestAds: true, settled: true });
    await first;
});

test('consent: the overlay gate treats the consent form as an overlay, not an absence (hide / show skipped)', async () => {
    const overlay = new PlatformOverlayTracker();
    const gate = new OverlayBackgroundGate();
    const { transport, coordinator } = makeCoordinator({ overlay });
    const started = coordinator.start();
    transport.state({ status: 'required', formVisible: true, settled: false, privacyOptionsRequired: true });
    assert.equal(overlay.classifyBackground(), 'overlay');
    assert.equal(gate.onHide(overlay.classifyBackground() === 'overlay'), 'skip', 'the form pauses the activity: no suspend');
    transport.state({ status: 'obtained', canRequestAds: true, formVisible: false, settled: true, privacyOptionsRequired: true });
    await started;
    assert.equal(overlay.isOverlayActive(), false, 'the overlay ended before the show event');
    assert.equal(gate.onShow(), 'skip', 'the one-shot flag skips the matching resume / offline report even after the overlay ended');
});

test('consent: a form that never reports its end releases the overlay through the backstop', async () => {
    const overlay = new PlatformOverlayTracker();
    const { transport, coordinator, fireNext } = makeCoordinator({ overlay });
    void coordinator.start();
    transport.state({ status: 'required', formVisible: true, settled: false });
    assert.equal(overlay.isOverlayActive(), true);
    assert.equal(fireNext(10 * 60_000), true);
    assert.equal(overlay.isOverlayActive(), false);
});

// ---------------------------------------------------------------- privacy options

async function settledRequired() {
    const parts = makeCoordinator({ overlay: new PlatformOverlayTracker(), privacyTimeoutMs: 7_777 });
    const started = parts.coordinator.start();
    parts.transport.state({ status: 'obtained', canRequestAds: true, privacyOptionsRequired: true, formVisible: false, settled: true });
    await started;
    return parts;
}

test('privacy options: unavailable without a requirement, no native call', async () => {
    const { transport, coordinator } = makeCoordinator();
    const started = coordinator.start();
    transport.state({ status: 'not_required', canRequestAds: true, privacyOptionsRequired: false, settled: true });
    await started;
    const result = await coordinator.showPrivacyOptions();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'privacy_options_not_required');
    assert.deepEqual(transport.methods(), ['initializeConsent']);
});

test('privacy options: begins the overlay BEFORE the native call, ends it BEFORE resolving, one in flight', async () => {
    const parts = await settledRequired();
    const log: string[] = [];
    const overlay = (parts.coordinator as unknown as { overlay: PlatformOverlayTracker }).overlay;
    overlay.subscribe((event) => log.push(event.phase));
    parts.transport.responses.set('showPrivacyOptions', '{"status":"started"}');
    const first = parts.coordinator.showPrivacyOptions();
    const second = parts.coordinator.showPrivacyOptions();
    assert.equal(first, second, 'a second tap joins the in-flight form');
    assert.deepEqual(log, ['begin']);
    parts.transport.state({ status: 'obtained', canRequestAds: true, privacyOptionsRequired: true, formVisible: true, settled: true });
    parts.transport.state({ status: 'obtained', canRequestAds: true, privacyOptionsRequired: true, formVisible: false, settled: true });
    parts.transport.emit(CONSENT_PRIVACY_RESULT_EVENT, { status: 'dismissed' });
    const result = await first;
    assert.equal(result.status, 'dismissed');
    assert.deepEqual(log, ['begin', 'end']);
    assert.equal(parts.transport.methods().filter((method) => method === 'showPrivacyOptions').length, 1);
});

test('privacy options: an immediate native refusal resolves unavailable and ends the overlay; a throw resolves failed', async () => {
    const parts = await settledRequired();
    parts.transport.responses.set('showPrivacyOptions', '{"status":"unavailable","reason":"form_in_progress"}');
    const refused = await parts.coordinator.showPrivacyOptions();
    assert.deepEqual({ status: refused.status, reason: refused.reason }, { status: 'unavailable', reason: 'form_in_progress' });
    const overlay = (parts.coordinator as unknown as { overlay: PlatformOverlayTracker }).overlay;
    assert.equal(overlay.isOverlayActive(), false);
    parts.transport.throwOn = 'showPrivacyOptions';
    const thrown = await parts.coordinator.showPrivacyOptions();
    assert.equal(thrown.status, 'failed');
    assert.equal(overlay.isOverlayActive(), false);
});

test('privacy options: no result event -> timeout backstop resolves, overlay ended', async () => {
    const parts = await settledRequired();
    parts.transport.responses.set('showPrivacyOptions', '{"status":"started"}');
    const pending = parts.coordinator.showPrivacyOptions();
    assert.equal(parts.fireNext(7_777), true);
    assert.equal((await pending).status, 'timeout');
    const overlay = (parts.coordinator as unknown as { overlay: PlatformOverlayTracker }).overlay;
    assert.equal(overlay.isOverlayActive(), false);
});

// ---------------------------------------------------------------- mock transport (DEBUG path)

test('mock transport: every scripted state behaves like the native protocol under the real coordinator', async () => {
    const run = async (state: 'not_required' | 'required_obtained' | 'required_declined' | 'error', privacyOptions?: boolean) => {
        const coordinator = new ConsentCoordinator({ transport: new MockConsentTransport({ state, ...(privacyOptions === undefined ? {} : { privacyOptions }) }), schedule: () => () => undefined });
        return coordinator.start();
    };
    const notRequired = await run('not_required');
    assert.deepEqual([notRequired.status, notRequired.canRequestAds, notRequired.privacyOptionsRequired], ['not_required', true, false]);
    const obtained = await run('required_obtained');
    assert.deepEqual([obtained.status, obtained.canRequestAds, obtained.privacyOptionsRequired], ['obtained', true, true]);
    const declined = await run('required_declined');
    assert.deepEqual([declined.status, declined.canRequestAds, declined.privacyOptionsRequired], ['required', false, true]);
    const error = await run('error');
    assert.deepEqual([error.status, error.canRequestAds, error.privacyOptionsRequired], ['error', false, false]);
    const override = await run('not_required', true);
    assert.equal(override.privacyOptionsRequired, true, 'the script can force the privacy options entry');
});

test('mock transport: timeout never answers (the coordinator timeout applies); declined + privacy options flips to obtained', async () => {
    let fire: () => void = () => undefined;
    const coordinator = new ConsentCoordinator({ transport: new MockConsentTransport({ state: 'timeout' }), schedule: (callback) => { fire = callback; return () => undefined; }, startTimeoutMs: 4_000 });
    const started = coordinator.start();
    await tick();
    assert.equal(coordinator.getState().status, 'unknown');
    fire();
    const state = await started;
    assert.deepEqual([state.status, state.reason, state.canRequestAds], ['error', 'consent_timeout', false]);

    const declined = new ConsentCoordinator({ transport: new MockConsentTransport({ state: 'required_declined' }), overlay: new PlatformOverlayTracker(), schedule: () => () => undefined });
    await declined.start();
    assert.equal(declined.canRequestAds(), false);
    const result = await declined.showPrivacyOptions();
    assert.equal(result.status, 'dismissed');
    assert.equal(declined.canRequestAds(), true, 'the mock privacy form accepts');
});

// ---------------------------------------------------------------- ads gated by consent

class RecordingAds extends MockAdsService {
    public readonly log: string[] = [];
    public override async initialize() { this.log.push('initialize'); return super.initialize(); }
    public override async getRewardedAvailability(id: string) { this.log.push('availability'); return super.getRewardedAvailability(id); }
    public override async preloadRewarded(id: string) { this.log.push('preload'); return super.preloadRewarded(id); }
    public override async showRewarded(request: { placementId: string; requestId: string }) { this.log.push('show'); return super.showRewarded(request); }
}

test('ads gating: nothing reaches the provider until canRequestAds; x2 / Extended availability stays false; show resolves unavailable', async () => {
    const inner = new RecordingAds({ initialStatus: 'ready', placements: { [OFFLINE_DOUBLE_CLAIM_KEY]: { available: true }, [EXTENDED_OVERCLOCK_CLAIM_KEY]: { available: true } } });
    const parts = makeCoordinator();
    const gated = new ConsentGatedAdsService(inner, parts.coordinator);
    const started = parts.coordinator.start();
    const init = await gated.initialize();
    assert.deepEqual([init.status, init.reason], ['uninitialized', 'consent_pending']);
    for (const placement of [OFFLINE_DOUBLE_CLAIM_KEY, EXTENDED_OVERCLOCK_CLAIM_KEY]) {
        const availability = await gated.getRewardedAvailability(placement);
        assert.deepEqual([availability.available, availability.reason], [false, 'consent_pending']);
        assert.equal((await gated.preloadRewarded(placement)).ok, false);
    }
    const shown = await gated.showRewarded({ placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId: 'r1' });
    assert.deepEqual([shown.status, shown.rewardVerified, shown.reason], ['unavailable', false, 'consent_pending']);
    assert.equal(gated.getStatus().status, 'uninitialized');
    assert.deepEqual(inner.log, [], 'the ads provider was never touched');

    parts.transport.state({ status: 'required', canRequestAds: false, formVisible: false, settled: true });
    await started;
    assert.equal((await gated.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, false, 'declined stays closed');
    assert.deepEqual(inner.log, []);

    parts.transport.state({ status: 'obtained', canRequestAds: true, privacyOptionsRequired: true, formVisible: false, settled: true });
    assert.equal((await gated.initialize()).status, 'ready');
    assert.equal((await gated.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, true);
    assert.equal((await gated.showRewarded({ placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId: 'r2' })).status, 'rewarded');
    assert.deepEqual(inner.log, ['initialize', 'availability', 'show', 'availability'], 'the mock show re-checks its own availability');
});

test('ads gating: withdrawing consent closes an already-ready provider again', async () => {
    const inner = new RecordingAds({ initialStatus: 'ready', placements: { [OFFLINE_DOUBLE_CLAIM_KEY]: { available: true } } });
    const parts = makeCoordinator();
    const gated = new ConsentGatedAdsService(inner, parts.coordinator);
    const started = parts.coordinator.start();
    parts.transport.state({ status: 'obtained', canRequestAds: true, settled: true });
    await started;
    assert.equal((await gated.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, true);
    parts.transport.state({ status: 'required', canRequestAds: false, settled: true });
    assert.equal((await gated.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, false);
});

// ---------------------------------------------------------------- build selection

test('build selection: release uses UMP over the native transport, NoOp (unavailable, ads closed) without it; the debug script is never read in release', async () => {
    const transport = new FakeConsentTransport();
    const real = createBuildConsentService(false, { state: 'required_declined' }, { androidTransport: transport });
    assert.ok(real instanceof ConsentCoordinator);
    const none = createBuildConsentService(false, { state: 'not_required' }, {});
    assert.ok(none instanceof NoOpConsentService);
    const state = await none.start();
    assert.deepEqual([state.status, state.canRequestAds, state.privacyOptionsRequired], ['unavailable', false, false]);
    assert.equal((await none.showPrivacyOptions()).status, 'unavailable');
});

test('build selection: DEBUG default is a mock not_required, the script picks mock states, ump_test the real provider with the debug geography', async () => {
    const transport = new FakeConsentTransport();
    transport.responses.set('initializeConsent', SETTLED_ANSWER);
    const plain = createBuildConsentService(true, undefined, { androidTransport: transport });
    const plainState = await plain.start();
    assert.deepEqual([plainState.status, plainState.canRequestAds], ['not_required', true]);
    assert.deepEqual(transport.methods(), [], 'the default never touches the native transport');

    const declined = createBuildConsentService(true, parseDebugConsentScriptFile('{"state":"required_declined"}') ?? undefined, { androidTransport: transport });
    assert.equal((await declined.start()).canRequestAds, false);
    assert.deepEqual(transport.methods(), []);

    const ump = createBuildConsentService(true, parseDebugConsentScriptFile('{"provider":"ump_test","geography":"not_eea"}') ?? undefined, { androidTransport: transport });
    await ump.start();
    assert.deepEqual(transport.methods(), ['initializeConsent']);
    assert.deepEqual(JSON.parse(transport.calls[0].args[0]), { debugGeography: 'not_eea' });

    // mock fields win over provider; no transport falls back to the mock.
    const both = createBuildConsentService(true, { state: 'error', provider: DEBUG_CONSENT_PROVIDER_UMP_TEST, geography: 'eea' }, { androidTransport: transport });
    assert.equal((await both.start()).status, 'error');
    const fallback = createBuildConsentService(true, parseDebugConsentScriptFile('{"provider":"ump_test"}') ?? undefined, {});
    assert.equal((await fallback.start()).status, 'not_required');
});

test('build selection: the real AdMob test provider (admob_test) implies the real UMP with the device geography (no geography override)', async () => {
    const transport = new FakeConsentTransport();
    transport.responses.set('initializeConsent', SETTLED_ANSWER);
    const ads = parseDebugAdsScriptFile('{"provider":"admob_test"}') ?? undefined;
    const consent = createBuildConsentService(true, undefined, { androidTransport: transport }, ads);
    await consent.start();
    assert.deepEqual(transport.methods(), ['initializeConsent']);
    assert.deepEqual(JSON.parse(transport.calls[0].args[0]), {});
});

test('build selection: every ads provider is wrapped by the consent gate when a gate is passed (and untouched otherwise)', async () => {
    const parts = makeCoordinator();
    const gated = createBuildAdsService(true, undefined, { consent: parts.coordinator });
    assert.ok(gated instanceof ConsentGatedAdsService);
    assert.equal((await gated.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available, false, 'the DEBUG mock ads are closed until consent allows');
    const released = createBuildAdsService(false, undefined, { consent: parts.coordinator });
    assert.ok(released instanceof ConsentGatedAdsService);
    assert.equal((await released.initialize()).reason, 'consent_pending');
    const ungated = createBuildAdsService(false, undefined, {});
    assert.ok(ungated instanceof NoOpAdsService);
    const mock = createBuildAdsService(true, undefined, {});
    assert.ok(mock instanceof MockAdsService);
});

test('debug consent script parsing: allow-listed, geography only with ump_test, anything else is ignored', () => {
    assert.deepEqual({ ...parseDebugConsentScriptFile('{"state":"required_obtained","privacyOptions":true}') }, { state: 'required_obtained', privacyOptions: true });
    assert.deepEqual({ ...parseDebugConsentScriptFile('{"provider":"ump_test"}') }, { provider: 'ump_test', geography: 'eea' });
    assert.deepEqual({ ...parseDebugConsentScriptFile('{"provider":"ump_test","geography":"us_state"}') }, { provider: 'ump_test', geography: 'us_state' });
    for (const bad of [undefined, '', 'nope', '[]', '{}', '{"state":"granted"}', '{"privacyOptions":"yes"}', '{"provider":"admob"}', '{"geography":"eea"}', '{"provider":"ump_test","geography":"mars"}', '{"state":"error","geography":"eea"}']) {
        assert.equal(parseDebugConsentScriptFile(bad), null, String(bad));
    }
    for (const state of ['not_required', 'required_obtained', 'required_declined', 'error', 'timeout']) assert.notEqual(parseDebugConsentScriptFile(JSON.stringify({ state })), null, state);
});

// ---------------------------------------------------------------- Settings: Privacy options row

test('settings view model: the Privacy options row exists only when privacyOptionsRequired, is tappable, carries the action and no patch', () => {
    const without = createSettingsViewModel(DEFAULT_USER_SETTINGS);
    assert.deepEqual(without.rows.map((row) => row.id), ['music', 'sfx', 'vibration', 'language']);
    assert.ok(without.rows.every((row) => row.action === null));
    const off = createSettingsViewModel(DEFAULT_USER_SETTINGS, undefined, { privacyOptionsRequired: false });
    assert.equal(off.rows.length, 4);
    const withRow = createSettingsViewModel(DEFAULT_USER_SETTINGS, undefined, { privacyOptionsRequired: true });
    assert.deepEqual(withRow.rows.map((row) => row.id), ['music', 'sfx', 'vibration', 'language', 'privacy']);
    const privacy = withRow.rows[4];
    assert.deepEqual([privacy.label, privacy.valueText, privacy.tappable, privacy.on, privacy.patch, privacy.action, privacy.setting], ['Privacy options', 'OPEN', true, null, null, 'privacy_options', 'privacy']);
    // the first four rows are identical with or without the privacy row
    assert.deepEqual(withRow.rows.slice(0, 4), without.rows);
});

test('settings view model: the Privacy options strings are localized through the catalogue (no raw key, no missing text)', () => {
    const reports: unknown[] = [];
    const catalogue = createTextCatalogue(read('localization/en.json'), (report) => reports.push(report));
    const model = createSettingsViewModel(DEFAULT_USER_SETTINGS, catalogue, { privacyOptionsRequired: true });
    for (const text of [model.rows[4].label, model.rows[4].valueText]) assert.doesNotMatch(text, /\b[a-z_]+(\.[a-z0-9_]+)+\b/, text);
    assert.deepEqual(reports, []);
    const json = JSON.parse(read('localization/en.json')) as { entries: Record<string, string> };
    assert.equal(json.entries['settings.privacy'], 'Privacy options');
    assert.equal(json.entries['settings.privacy.open'], 'OPEN');
});

const SCREENS = [
    { name: '720x1280', w: 720, h: 1280, safe: undefined },
    { name: '1080x1920', w: 1080, h: 1920, safe: undefined },
    { name: '1080x2412', w: 1080, h: 2412, safe: undefined },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 } },
];

for (const screen of SCREENS) {
    test(`settings layout ${screen.name}: the 5-row panel (Privacy options) stays inside the factory band, clear of the HUD, rows >= 64 and non-overlapping`, () => {
        const safe = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
        const base = computeUiLayout({ w: screen.w, h: screen.h }, screen.safe);
        const four = computeSettingsRects({ w: screen.w, h: screen.h }, screen.safe);
        const five = computeSettingsRects({ w: screen.w, h: screen.h }, screen.safe, SETTINGS_ROW_COUNT_WITH_PRIVACY);
        assert.equal(four.rows.length, 4, 'the default layout is unchanged');
        assert.equal(five.rows.length, 5);
        assert.ok(rectContains(safe, five.panel, 1e-6), 'panel inside the safe area');
        assert.ok(rectContains(five.factoryBand, five.panel, 1e-6), 'panel inside the factory band');
        for (const rect of [base.hud, base.panel, ...Object.values(base.hudButtons), ...Object.values(base.buttons)]) assert.equal(rectsOverlap(five.panel, rect), false, 'panel overlaps a HUD / panel rect');
        const controls = [five.close, ...five.rows];
        for (const rect of controls) {
            assert.ok(rectContains(five.panel, rect, 1e-6), 'control inside the panel');
            assert.ok(rect.h / five.scale >= 64 - 1e-9, 'control >= 64 design units tall');
        }
        controls.forEach((a, i) => controls.slice(i + 1).forEach((b) => assert.equal(rectsOverlap(a, b), false, 'controls overlap')));
        assert.ok(Math.abs(five.panel.y + five.panel.h / 2 - (five.factoryBand.y + five.factoryBand.h / 2)) < 1e-6, 'centred in the factory band');
    });
}

test('settings layout: the privacy row grows the card by exactly one row + gap; the four-row layout is the unchanged default', () => {
    assert.equal(SETTINGS_ROW_COUNT, 4);
    assert.equal(settingsPanelHeight(), resolveSettingsPanelLayout().height);
    assert.equal(settingsPanelHeight(5) - settingsPanelHeight(4), 72 + 8);
    assert.ok(resolveSettingsPanelLayout(5).height <= 585, 'at most 75% of the 780-unit band at 1280');
});

test('Settings controller / bootstrap wiring: the row opens the platform form through a callback, no command, no direct native call, row visibility follows the consent provider', () => {
    const controller = strip(read('assets/scripts/presentation/SettingsController.ts'));
    assert.match(controller, /row\.action === 'privacy_options'/);
    assert.match(controller, /this\.onPrivacyOptionsRequested\?\.\(\);/);
    assert.match(controller, /privacyOptionsRequired: this\.privacyOptionsRequired\?\.\(\) === true/);
    assert.doesNotMatch(controller, /native\.|reflection|consent|Consent|GameCommand|commandEmitter|\.submit\(/);
    assert.match(controller, /SETTINGS_ROW_COUNT_WITH_PRIVACY/);
    const bootstrap = strip(read('assets/scripts/presentation/FactoryWorldBootstrap.ts'));
    assert.match(bootstrap, /controller\.privacyOptionsRequired = \(\) => this\.consent\?\.isPrivacyOptionsRequired\(\) === true;/);
    assert.match(bootstrap, /controller\.onPrivacyOptionsRequested = \(\) => this\.requestPrivacyOptions\(\);/);
    assert.match(bootstrap, /void this\.consent\?\.showPrivacyOptions\(\)\.catch\(\(\) => undefined\);/);
    assert.match(bootstrap, /this\.sessionWiring\?\.settings\.refresh\(\);/);
});

// ---------------------------------------------------------------- startup is non-blocking, wiring

test('bootstrap wiring: consent is chosen before ads and gates them, starts only AFTER session ready, never awaited on the startup path, shares the overlay tracker', () => {
    const bootstrap = strip(read('assets/scripts/presentation/FactoryWorldBootstrap.ts'));
    const sessionStart = bootstrap.slice(bootstrap.indexOf('private startPersistentSession('), bootstrap.indexOf('private readDebugAdsScript('));
    assert.ok(sessionStart.indexOf('this.consent = createBuildConsentService(') >= 0);
    assert.ok(sessionStart.indexOf('this.consent = createBuildConsentService(') < sessionStart.indexOf('this.offlineAds = createBuildAdsService('), 'consent before ads');
    assert.match(sessionStart, /createBuildAdsService\(DEBUG === true, debugAdsScript, \{[\s\S]*?consent: this\.consent,[\s\S]*?\}\)/);
    assert.match(sessionStart, /createBuildConsentService\(DEBUG === true, this\.readDebugConsentScript\(\), \{[\s\S]*?overlay: this\.platformOverlay[\s\S]*?\}, debugAdsScript\)/);
    assert.doesNotMatch(sessionStart, /consent\.start\(|startConsentProvider\(/, 'consent never starts on the startup path');
    const activate = bootstrap.slice(bootstrap.indexOf('private activateSessionBinding('), bootstrap.indexOf('private runDebugCommandFile('));
    const ready = activate.indexOf("this.emitSessionState('ready', status, null, binding.describe().autoFeederOwned);");
    const startConsent = activate.indexOf('this.startConsentProvider();');
    assert.ok(ready >= 0 && startConsent > ready, 'the consent flow starts after the session ready event');
    assert.ok(startConsent > activate.indexOf('game.on(Game.EVENT_HIDE'), 'lifecycle hooks (overlay gate) are registered before a form can appear');
    const start = bootstrap.slice(bootstrap.indexOf('private startConsentProvider('), bootstrap.indexOf('private startAdsProvider('));
    assert.match(start, /void consent\.start\(\)\.then\(/);
    assert.doesNotMatch(start, /await /, 'fire and forget');
    assert.match(start, /if \(state\.canRequestAds && this\.offlineAds\) this\.startAdsProvider\(this\.offlineAds\);/);
    const ads = bootstrap.slice(bootstrap.indexOf('private startAdsProvider('), bootstrap.indexOf('private async pollAdsAvailability('));
    assert.match(ads, /if \(this\.consent && !this\.consent\.canRequestAds\(\)\) return;\s*this\.adsProviderStarted = true;/, 'ads init is fail-closed on consent');
    assert.match(bootstrap, /this\.overlayGate\.onHide\(this\.platformOverlay\.classifyBackground\(\) === 'overlay'\)/, 'the same overlay gate covers the consent form');
    assert.equal((bootstrap.match(/new PlatformOverlayTracker\(\)/g) ?? []).length, 1, 'ONE shared tracker');
});

test('consent code is engine-free and only the native bridge / bootstrap reach the Android consent transport', () => {
    for (const file of ['assets/scripts/services/ConsentService.ts', 'assets/scripts/services/ConsentCoordinator.ts', 'assets/scripts/services/ConsentGatedAdsService.ts', 'assets/scripts/platform/mock/MockConsentTransport.ts', 'assets/scripts/platform/noop/NoOpConsentService.ts']) {
        const source = strip(read(file));
        assert.doesNotMatch(source, new RegExp(`from '${'c'}c'|native\\.reflection|com/cocos|AutomataPlatformBridge`), file);
    }
    assert.match(read('assets/scripts/platform/android/AndroidNativeBridge.ts'), /export function createAndroidConsentTransport\(\): ConsentTransport \| null/);
    for (const file of ['assets/scripts/runtime/GameRuntime.ts', 'assets/scripts/economy/index.ts']) {
        if (existsSync(path.join(repoRoot, file))) assert.doesNotMatch(read(file), /[Cc]onsent/, file);
    }
});

test('no save schema change, no new GameCommand, no economy / analytics catalogue change', () => {
    assert.equal(CURRENT_SAVE_VERSION, 3);
    assert.doesNotMatch(read('assets/scripts/domain/Commands.ts'), /[Cc]onsent/);
    assert.doesNotMatch(read('assets/scripts/state/GameState.ts'), /[Cc]onsent/);
    assert.doesNotMatch(read('assets/scripts/services/AnalyticsEvents.ts'), /consent/i, 'consent_state analytics was skipped (not trivial / catalogue is pinned)');
    for (const file of ['persistence', 'economy', 'progression', 'runtime', 'domain']) {
        // directory listing via the persistence index only: consent never enters the engine-free gameplay core
        assert.equal(existsSync(path.join(repoRoot, 'assets/scripts', file, 'ConsentService.ts')), false);
    }
});

// ---------------------------------------------------------------- native config scan

test('native config: UMP pinned to the version play-services-ads already resolves; consent controller is debug-guarded, overlay-first and id-free', () => {
    const gradle = read('native/engine/android/app/build.gradle');
    assert.match(gradle, /implementation 'com\.google\.android\.ump:user-messaging-platform:4\.0\.0'/);
    assert.match(gradle, /play-services-ads:25\.4\.0/, 'the ads pin is unchanged');

    const java = read('native/engine/android/app/src/com/cocos/game/AutomataConsentController.java');
    // Debug settings: inside the debuggable guard only.
    assert.equal((java.match(/setConsentDebugSettings\(/g) ?? []).length, 1);
    assert.equal((java.match(/setForceTesting\(/g) ?? []).length, 1);
    assert.equal((java.match(/setDebugGeography\(/g) ?? []).length, 1);
    const guardStart = java.indexOf('if (isDebuggable(activity) && geography != null');
    assert.ok(guardStart >= 0, 'debuggable guard present');
    const guardBlock = java.slice(guardStart, java.indexOf('            updateAnswered = false;'));
    assert.match(guardBlock, /setConsentDebugSettings\(/);
    assert.match(guardBlock, /setForceTesting\(true\)/);
    assert.match(java, /FLAG_DEBUGGABLE/);
    assert.doesNotMatch(java.slice(0, guardStart), /setConsentDebugSettings|setForceTesting|addTestDeviceHashedId/);
    assert.doesNotMatch(java.slice(java.indexOf('            updateAnswered = false;')), /setConsentDebugSettings|setForceTesting|addTestDeviceHashedId/);
    // No real ids and no AdMob app id handling in the consent controller; no hashed device ids committed.
    assert.doesNotMatch(java, /ca-app-pub-|setAdMobAppId|addTestDeviceHashedId/);
    // Fail-open / fail-closed + non-blocking bridge methods.
    assert.match(java, /static boolean canRequestAds\(\) \{\s*return canRequest;\s*\}/);
    assert.match(java, /private static volatile boolean canRequest = false;/);
    assert.match(java, /AutomataAdsController\.isConfigured\(\)/);
    assert.match(java, /UPDATE_WATCHDOG_MS = 15000L/);
    assert.match(java, /requestConsentInfoUpdate\(/);
    assert.match(java, /getPrivacyOptionsRequirementStatus\(\) == ConsentInformation\.PrivacyOptionsRequirementStatus\.REQUIRED/);
    assert.match(java, /UserMessagingPlatform\.showPrivacyOptionsForm\(/);
    assert.match(java, /UserMessagingPlatform\.loadConsentForm\(/);
    // Overlay first: the form is shown only after the state event (formVisible) was dispatched to the script.
    const show = java.slice(java.indexOf('private static void showConsentForm('), java.indexOf('private static void startPrivacyOptions('));
    assert.ok(show.indexOf('formVisible = true;') < show.indexOf('dispatchThen(EVENT_STATE'), 'formVisible is set before the dispatch');
    assert.ok(show.indexOf('dispatchThen(EVENT_STATE') < show.indexOf('form.show('), 'the form is shown only after the script was told');
    assert.match(java, /EVENT_STATE = "automata\.consent\.state"/);
    assert.match(java, /EVENT_PRIVACY_RESULT = "automata\.consent\.privacy_result"/);
    // Every UMP call hops to the UI thread; the bridge returns immediately.
    assert.match(java, /runOnUi\(new Runnable\(\) \{\s*@Override\s*public void run\(\) \{\s*startUpdate\(geography\);/);

    const bridge = read('native/engine/android/app/src/com/cocos/game/AutomataPlatformBridge.java');
    assert.match(bridge, /AutomataConsentController\.initialize\(optionsJson\)/);
    assert.match(bridge, /AutomataConsentController\.status\(\)/);
    assert.match(bridge, /AutomataConsentController\.showPrivacyOptions\(\)/);
});

test('native config: the ads controller consults the consent controller (init, load, availability) and stays non-personalized', () => {
    const java = read('native/engine/android/app/src/com/cocos/game/AutomataAdsController.java');
    assert.match(java, /private static boolean canRequestAds\(\) \{\s*return AutomataConsentController\.canRequestAds\(\);\s*\}/);
    assert.match(java, /extras\.putString\("npa", "1"\)/, 'MVP: ads stay non-personalized');
    assert.doesNotMatch(java, /npa", "0"|setTagForChildDirectedTreatment/);
    const init = java.slice(java.indexOf('static String initialize()'), java.indexOf('static String status()'));
    assert.ok(init.indexOf('if (!canRequestAds())') > init.indexOf('if (!configured)'), 'consent is checked after the config');
    assert.ok(init.indexOf('if (!canRequestAds())') < init.indexOf('sdkStatus = "initializing"'), 'the SDK is never initialised before consent allows it');
    assert.match(init, /consent_pending/);
    assert.match(java, /if \(!canRequestAds\(\)\) \{\s*placement\.state = IDLE;\s*placement\.reason = "consent_pending";/, 'loads are consent-gated');
    const reason = java.slice(java.indexOf('private static String unavailableReason('), java.indexOf('private static void runOnUi('));
    assert.match(reason, /if \(!canRequestAds\(\)\) \{\s*return "consent_pending";/);
    assert.match(java, /static void onConsentChanged\(\)/);
});

test('native config: no production id anywhere in the new sources, the manifest is unchanged and debug uses the sample ids only', () => {
    for (const file of ['native/engine/android/app/src/com/cocos/game/AutomataConsentController.java', 'assets/scripts/services/ConsentCoordinator.ts', 'assets/scripts/platform/mock/MockConsentTransport.ts', 'assets/scripts/presentation/DebugConsentScriptFile.ts', 'tools/device/seed_aut065.ts', 'tools/device/consent_checks.ts']) {
        for (const match of read(file).matchAll(/ca-app-pub-\d{16}[~/]\d{10}/g)) assert.ok(match[0].startsWith('ca-app-pub-3940256099942544'), `${file}: ${match[0]}`);
    }
    const manifest = read('native/engine/android/app/AndroidManifest.xml');
    assert.doesNotMatch(manifest, /ump|consent|AD_ID/i, 'AUT-065 needs no manifest change');
    assert.match(manifest, /android:value="\$\{ADMOB_APP_ID\}"/);
    const gradle = read('native/engine/android/app/build.gradle');
    const debugBlock = gradle.slice(gradle.indexOf('        debug {'));
    assert.match(debugBlock, /ADMOB_APP_ID: 'ca-app-pub-3940256099942544~3347511713'/);
});

// ---------------------------------------------------------------- device tooling

const ev = (seq: number, payload: Record<string, unknown>) => ({ v: 1, seq, ...payload }) as unknown as ConsentTimelineEvent['event'];
const at = (tMs: number, seq: number, payload: Record<string, unknown>): ConsentTimelineEvent => ({ tMs, event: ev(seq, payload) });
const consentEvent = (tMs: number, seq: number, phase: string, extra: Record<string, unknown> = {}) => at(tMs, seq, { evt: 'consent_state', phase, ...extra });
const overlayEvent = (tMs: number, seq: number, state: 'begin' | 'end') => at(tMs, seq, { evt: 'ads_state', phase: 'overlay', kind: 'consent_form', state, requestId: 'consent_form' });
const layout = (tMs: number, seq: number, rects: Record<string, unknown>) => at(tMs, seq, { evt: 'ui_layout', rects });
const rect = { x: 10, y: 10, w: 100, h: 50 };
const ready = (tMs: number, seq: number) => at(tMs, seq, { evt: 'session_state', phase: 'ready' });
const failing = (checks: ReadonlyArray<{ id: string; ok: boolean }>) => checks.filter((check) => !check.ok).map((check) => check.id);
const script = (extra: Record<string, unknown> = {}) => consentEvent(1, 0, 'script', { accepted: true, ...extra });

function timelineFor(expect: ConsentExpectation): ConsentTimelineEvent[] {
    const head = [script({ state: expect }), ready(2, 1), consentEvent(3, 2, 'init', { status: 'unknown' })];
    switch (expect) {
        case 'not_required':
            return [...head, consentEvent(4, 3, 'state', { status: 'not_required', canRequestAds: true, privacyOptionsRequired: false, formVisible: false }), at(5, 4, { evt: 'ads_state', phase: 'initialized', status: 'ready' }), layout(6, 5, { OfflineReportDouble: rect })];
        case 'required_obtained':
            return [...head, consentEvent(4, 3, 'state', { status: 'required', canRequestAds: false, formVisible: true }), overlayEvent(4, 4, 'begin'), overlayEvent(5, 5, 'end'), consentEvent(5, 6, 'state', { status: 'obtained', canRequestAds: true, formVisible: false }), at(6, 7, { evt: 'ads_state', phase: 'initialized', status: 'ready' }), layout(7, 8, { OfflineReportDouble: rect })];
        case 'required_declined':
            return [...head, consentEvent(4, 3, 'state', { status: 'required', canRequestAds: false, formVisible: true }), overlayEvent(4, 4, 'begin'), overlayEvent(5, 5, 'end'), consentEvent(5, 6, 'state', { status: 'required', canRequestAds: false, formVisible: false, reason: 'consent_declined' }), layout(7, 7, {})];
        case 'error':
            return [...head, consentEvent(4, 3, 'state', { status: 'error', canRequestAds: false, reason: 'mock_consent_error' }), layout(7, 4, {})];
        case 'timeout':
            return [...head, consentEvent(4, 3, 'timeout', { status: 'unknown' }), consentEvent(4, 4, 'state', { status: 'error', canRequestAds: false, reason: 'consent_timeout' }), layout(7, 5, {})];
        case 'privacy_row':
            return [...head, consentEvent(4, 3, 'state', { status: 'required', canRequestAds: false, formVisible: true }), overlayEvent(4, 4, 'begin'), overlayEvent(5, 5, 'end'), consentEvent(5, 6, 'state', { status: 'obtained', canRequestAds: true, privacyOptionsRequired: true }), layout(6, 7, { SettingsRow3: rect, SettingsRow4: rect }), consentEvent(7, 8, 'privacy_options_started'), overlayEvent(7, 9, 'begin'), overlayEvent(8, 10, 'end'), consentEvent(8, 11, 'privacy_options_result', { status: 'dismissed' })];
        case 'no_privacy_row':
            return [...head, consentEvent(4, 3, 'state', { status: 'not_required', canRequestAds: true }), layout(6, 4, { SettingsRow3: rect, SettingsRow4: null })];
        case 'ump_eea':
            return [...head, consentEvent(4, 3, 'state', { status: 'required', canRequestAds: false, formVisible: true }), overlayEvent(4, 4, 'begin'), overlayEvent(30, 5, 'end'), consentEvent(30, 6, 'state', { status: 'obtained', canRequestAds: true, privacyOptionsRequired: true }), layout(31, 7, {})];
    }
}

test('consent checks: every expectation passes on its own well-formed timeline', () => {
    for (const expect of ['not_required', 'required_obtained', 'required_declined', 'error', 'timeout', 'privacy_row', 'no_privacy_row', 'ump_eea'] as const) {
        assert.deepEqual(failing(evaluateConsent(timelineFor(expect), expect)), [], expect);
    }
});

test('consent checks: ads fail-closed violations, a blocking startup, an unbalanced overlay and a suspend during the form are caught', () => {
    // declined but ads initialised / x2 offered
    const leaked = [...timelineFor('required_declined'), at(8, 20, { evt: 'ads_state', phase: 'initialized', status: 'ready' }), layout(9, 21, { OfflineReportDouble: rect })];
    assert.ok(failing(evaluateConsent(leaked, 'required_declined')).includes('consent_ads_fail_closed'));
    // consent started before the session was ready (blocking startup)
    const early = timelineFor('not_required');
    const reordered = [early[0], early[2], early[1], ...early.slice(3)];
    assert.ok(failing(evaluateConsent(reordered, 'not_required')).includes('consent_started_after_session_ready'));
    // ads init BEFORE canRequestAds
    const premature = [early[0], early[1], early[2], at(3, 9, { evt: 'ads_state', phase: 'initialized', status: 'ready' }), ...early.slice(3)];
    assert.ok(failing(evaluateConsent(premature, 'not_required')).includes('consent_ads_init_after_allowed'));
    // unbalanced overlay / suspend during the form
    const unbalanced = timelineFor('required_obtained').filter((e) => !(e.event.evt === 'ads_state' && e.event.state === 'end'));
    assert.ok(failing(evaluateConsent(unbalanced, 'required_obtained')).includes('consent_overlay_bracket'));
    const suspended = timelineFor('required_obtained');
    suspended.splice(5, 0, at(4, 40, { evt: 'session_state', phase: 'suspended' }));
    assert.ok(failing(evaluateConsent(suspended, 'required_obtained')).includes('consent_overlay_no_session_suspend_resume'));
    // errors, missing privacy row, a privacy row that must be absent
    assert.ok(failing(evaluateConsent([...timelineFor('error'), at(9, 50, { evt: 'error' })], 'error')).includes('consent_no_errors'));
    assert.ok(failing(evaluateConsent(timelineFor('no_privacy_row').map((e) => e.event.evt === 'ui_layout' ? layout(6, 4, { SettingsRow3: rect, SettingsRow4: rect }) : e), 'no_privacy_row')).includes('consent_no_privacy_row'));
    assert.ok(failing(evaluateConsent(timelineFor('privacy_row').map((e) => e.event.evt === 'ui_layout' ? layout(6, 7, { SettingsRow3: rect }) : e), 'privacy_row')).includes('consent_privacy_row_shown'));
});

test('consent checks: the real UMP scenario reports ENVIRONMENT_BLOCKED (never PASS, never a code FAIL) when UMP cannot answer', () => {
    const blocked = (events: ConsentTimelineEvent[]) => evaluateConsent(events, 'ump_eea').filter((check) => !check.ok);
    const noInit = [script({ provider: 'ump_test' }), ready(2, 1)];
    assert.match(blocked(noInit)[blocked(noInit).length - 1].detail, /^ENVIRONMENT_BLOCKED: no consent init event/);
    const noState = [script({ provider: 'ump_test' }), ready(2, 1), consentEvent(3, 2, 'init')];
    assert.match(blocked(noState)[0].detail, /^ENVIRONMENT_BLOCKED/);
    const netError = [...noState, consentEvent(4, 3, 'state', { status: 'error', canRequestAds: false, reason: 'update_error_2' })];
    const netChecks = blocked(netError);
    assert.deepEqual(netChecks.map((check) => check.id), ['consent_environment']);
    assert.match(netChecks[0].detail, /^ENVIRONMENT_BLOCKED: UMP could not complete \(status=error reason=update_error_2\)/);
    const unavailable = [...noState, consentEvent(4, 3, 'state', { status: 'unavailable', canRequestAds: false, reason: 'ads_not_configured' })];
    assert.match(blocked(unavailable)[0].detail, /^ENVIRONMENT_BLOCKED: UMP is unavailable/);
    // mock scenarios are never environment-blocked
    assert.deepEqual(failing(evaluateConsent(timelineFor('error'), 'error')), []);
});

test('reveal capture: the consent expectation flows through evaluateRevealTimeline and the scenarios, cli and package script are wired', () => {
    const base = { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 1 };
    const checks = evaluateRevealTimeline(timelineFor('not_required') as never, { ...base, expectConsent: 'not_required' });
    assert.ok(checks.some((check) => check.id === 'consent_not_required_final' && check.ok));
    const bad = evaluateRevealTimeline([...timelineFor('required_declined'), at(8, 20, { evt: 'ads_state', phase: 'initialized' })] as never, { ...base, expectConsent: 'required_declined' });
    assert.ok(bad.some((check) => check.id === 'consent_ads_fail_closed' && !check.ok));
    assert.ok(!evaluateRevealTimeline(timelineFor('not_required') as never, base).some((check) => check.id.startsWith('consent_')), 'no expectation, no consent checks');

    const expected: Record<string, ConsentExpectation> = {
        'aut065-not-required': 'not_required', 'aut065-required-obtained': 'required_obtained', 'aut065-required-declined': 'required_declined', 'aut065-error': 'error',
        'aut065-timeout': 'timeout', 'aut065-privacy-row': 'privacy_row', 'aut065-no-privacy-row': 'no_privacy_row', 'aut065-ump-eea': 'ump_eea',
    };
    for (const [id, expectation] of Object.entries(expected)) {
        assert.equal(REVEAL_SCENARIOS[id]?.expectConsent, expectation, id);
        assert.equal(REVEAL_SCENARIOS[id]?.id, id);
    }
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /expectConsent: scenario\.expectConsent,/);
    assert.match(cli, /seed-aut065/);
    assert.match(cli, /ENVIRONMENT_BLOCKED/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /expectConsent: options\.expectConsent,/, 'runRevealCapture passes expectConsent to evaluateRevealTimeline');
    assert.match(capture, /evaluateConsent\(events, options\.expectConsent\)/);
    assert.match(capture, /options\.expectBilling \|\| options\.expectConsent\) checks\.splice\(1, 0, \{ id: 'trigger_sent'/);
    assert.match(read('package.json'), /"device:seed-aut065"/);
    assert.ok((DEFAULT_REVEAL_EVENT_TYPES as readonly string[]).includes('consent_state'));
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('consent_state'));
});

test('seed aut065: variants, scripts and saves', () => {
    assert.deepEqual([...AUT065_SEED_VARIANTS], ['not_required', 'required_obtained', 'required_declined', 'error', 'timeout', 'privacy_row', 'no_privacy_row', 'ump_eea']);
    assert.equal(isAut065SeedVariant('timeout'), true);
    assert.equal(isAut065SeedVariant('granted'), false);
    for (const variant of AUT065_SEED_VARIANTS) {
        const parsed = parseDebugConsentScriptFile(buildAut065ConsentScriptFile(variant));
        assert.notEqual(parsed, null, variant);
    }
    assert.deepEqual({ ...parseDebugConsentScriptFile(buildAut065ConsentScriptFile('ump_eea')) }, { provider: 'ump_test', geography: 'eea' });
    assert.equal(parseDebugConsentScriptFile(buildAut065ConsentScriptFile('privacy_row'))?.privacyOptions, true);
    assert.equal(parseDebugConsentScriptFile(buildAut065ConsentScriptFile('no_privacy_row'))?.state, 'not_required');
    const now = Date.UTC(2026, 10, 15);
    for (const variant of AUT065_SEED_VARIANTS) {
        const save = JSON.parse(buildAut065SeededSave(variant, now)) as { saveVersion?: number };
        assert.equal(typeof save, 'object', variant);
    }
    assert.notEqual(buildAut065SeededSave('not_required', now), buildAut065SeededSave('privacy_row', now), 'the settings variants use a save with no offline card');
});

test('new TypeScript files have a .meta with a unique uuid, and INITIAL_CONSENT_STATE is fail-closed', () => {
    const files = [
        'assets/scripts/services/ConsentService.ts', 'assets/scripts/services/ConsentCoordinator.ts', 'assets/scripts/services/ConsentGatedAdsService.ts',
        'assets/scripts/platform/mock/MockConsentTransport.ts', 'assets/scripts/platform/noop/NoOpConsentService.ts', 'assets/scripts/presentation/DebugConsentScriptFile.ts',
    ];
    const uuids = new Set<string>();
    for (const file of files) {
        assert.ok(existsSync(path.join(repoRoot, `${file}.meta`)), `${file}.meta`);
        const meta = JSON.parse(read(`${file}.meta`)) as { uuid: string; importer: string };
        assert.equal(meta.importer, 'typescript');
        assert.ok(!uuids.has(meta.uuid), `${file}: duplicate uuid`);
        uuids.add(meta.uuid);
    }
    assert.deepEqual({ ...INITIAL_CONSENT_STATE }, { status: 'unknown', canRequestAds: false, privacyOptionsRequired: false, formVisible: false, personalization: 'non_personalized' });
});
