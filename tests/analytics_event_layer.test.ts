const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const scriptsRoot = path.join(repoRoot, 'assets', 'scripts');

async function importModule(relativePath) {
    return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

async function readText(relativePath) {
    return (await readFile(path.join(repoRoot, relativePath), 'utf8')).replace(/\r\n/g, '\n');
}

async function collect(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return collect(full);
        return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    }));
    return nested.flat().sort();
}

const load = async () => ({
    events: await importModule('assets/scripts/services/AnalyticsEvents.ts'),
    validator: await importModule('assets/scripts/services/AnalyticsValidator.ts'),
    mapper: await importModule('assets/scripts/services/AnalyticsEventMapper.ts'),
    trackerModule: await importModule('assets/scripts/services/AnalyticsTracker.ts'),
    observerModule: await importModule('assets/scripts/presentation/AnalyticsObserver.ts'),
    debugModule: await importModule('assets/scripts/platform/mock/DebugAnalyticsService.ts'),
    mockModule: await importModule('assets/scripts/platform/mock/MockAnalyticsService.ts'),
    noopModule: await importModule('assets/scripts/platform/noop/NoOpAnalyticsService.ts'),
});

function makeObserver(m, options = {}) {
    const service = new m.debugModule.DebugAnalyticsService();
    const diagnostics = [];
    const tracker = new m.trackerModule.AnalyticsTracker(service, { validation: 'strict', onDiagnostic: (d) => diagnostics.push(d), ...options });
    return { service, tracker, diagnostics, observer: new m.observerModule.AnalyticsObserver(tracker) };
}

const ids = (service) => service.events.map((e) => e.eventId);

// ---------------------------------------------------------------- catalogue

test('catalogue: ids are unique snake_case and every id has a schema with snake_case params', async () => {
    const { events } = await load();
    const values = Object.values(events.ANALYTICS_EVENTS);
    assert.equal(new Set(values).size, values.length);
    assert.deepEqual([...values].sort(), Object.keys(events.ANALYTICS_EVENT_SCHEMAS).sort());
    for (const id of values) {
        assert.match(id, /^[a-z][a-z0-9_]*$/);
        for (const name of Object.keys(events.ANALYTICS_EVENT_SCHEMAS[id].params)) assert.match(name, /^[a-z][a-z0-9_]*$/);
    }
});

test('catalogue: no schema carries price, currency, token or transaction parameters', async () => {
    const { events } = await load();
    for (const schema of Object.values(events.ANALYTICS_EVENT_SCHEMAS)) {
        for (const name of Object.keys(schema.params)) assert.doesNotMatch(name, /price|currency|token|transaction|email|device|user/);
    }
});

test('offline durations are bucketed', async () => {
    const { events } = await load();
    assert.equal(events.bucketOfflineSeconds(0), 'lt_1m');
    assert.equal(events.bucketOfflineSeconds(59), 'lt_1m');
    assert.equal(events.bucketOfflineSeconds(60), '1_5m');
    assert.equal(events.bucketOfflineSeconds(299), '1_5m');
    assert.equal(events.bucketOfflineSeconds(300), '5_30m');
    assert.equal(events.bucketOfflineSeconds(1800), '30m_2h');
    assert.equal(events.bucketOfflineSeconds(7200), '2_8h');
    assert.equal(events.bucketOfflineSeconds(28800), 'gt_8h');
    assert.equal(events.bucketOfflineSeconds(Number.NaN), 'lt_1m');
});

// ---------------------------------------------------------------- validation

test('validation: valid events pass; missing, unknown, wrong type, bad value, too long, out of range are rejected', async () => {
    const { validator } = await load();
    const v = validator.validateAnalyticsEvent;
    assert.equal(v('era_reached', { era_id: 'era_2' }).ok, true);
    assert.equal(v('first_robot', {}).ok, true);
    assert.deepEqual(v('era_reached', {}).issues.map((i) => i.code), ['missing_param']);
    assert.deepEqual(v('era_reached', { era_id: 'era_2', extra: 1 }).issues.map((i) => i.code), ['unknown_param']);
    assert.deepEqual(v('era_reached', { era_id: 5 }).issues.map((i) => i.code), ['invalid_type']);
    assert.deepEqual(v('era_reached', { era_id: 'era 2' }).issues.map((i) => i.code), ['invalid_value']);
    assert.deepEqual(v('era_reached', { era_id: 'x'.repeat(65) }).issues.map((i) => i.code), ['too_long']);
    assert.deepEqual(v('rewarded_opportunity', { placement: 'nope' }).issues.map((i) => i.code), ['invalid_value']);
    assert.deepEqual(v('reboot_completed', { civilization: 0, ai_cores_granted: 1 }).issues.map((i) => i.code), ['out_of_range']);
    assert.deepEqual(v('reboot_completed', { civilization: 1.5, ai_cores_granted: 1 }).issues.map((i) => i.code), ['invalid_type']);
    assert.deepEqual(v('offline_collected', { absence_bucket: 'lt_1m', cap_applied: 'yes', doubled: false }).issues.map((i) => i.code), ['invalid_type']);
    assert.deepEqual(v('not_an_event', {}).issues.map((i) => i.code), ['unknown_event']);
});

test('validation: price strings and non-opaque ids are rejected', async () => {
    const { validator } = await load();
    const v = validator.validateAnalyticsEvent;
    assert.equal(v('purchase_start', { product: 'founder_pack', request_id: '$4.99' }).ok, false);
    assert.equal(v('purchase_complete', { product: 'founder_pack', price: '$4.99' }).ok, false);
    assert.equal(v('purchase_start', { product: 'founder_pack', request_id: 'founder_pack:1700000000000:1' }).ok, true);
});

test('debug tracker: invalid events are reported as non-fatal diagnostics and not forwarded', async () => {
    const m = await load();
    const { service, tracker, diagnostics } = makeObserver(m);
    tracker.track('era_reached', {});
    tracker.track('era_reached', { era_id: 'era_2' });
    assert.deepEqual(ids(service), ['era_reached']);
    assert.equal(tracker.rejected, 1);
    const invalid = diagnostics.find((d) => d.kind === 'invalid');
    assert.equal(invalid.issues[0].code, 'missing_param');
});

test('release tracker (validation off): sanitizes to capped primitives and never throws', async () => {
    const m = await load();
    const service = new m.debugModule.DebugAnalyticsService();
    const tracker = new m.trackerModule.AnalyticsTracker(service, { validation: 'off' });
    tracker.track('era_reached', { era_id: 'e'.repeat(200), nested: { a: 1 }, nan: Number.NaN, ok: true });
    assert.equal(service.events.length, 1);
    assert.equal(service.events[0].params.era_id.length, 64);
    assert.deepEqual(Object.keys(service.events[0].params).sort(), ['era_id', 'ok']);
});

// ---------------------------------------------------------------- domain mapping

test('mapper: every in-scope domain event maps to a schema-valid analytics event', async () => {
    const m = await load();
    const domain = [
        { type: 'producerConstructed', producerId: 'fabricator', level: 1, source: 'breakthrough' },
        { type: 'breakthroughPurchased', breakthroughId: 'bt_1', cost: 10 },
        { type: 'eraChanged', oldEraId: 'era_1', newEraId: 'era_2' },
        { type: 'firstRobotProduced' },
        { type: 'civilizationChanged', oldCivilization: 1, newCivilization: 2, reason: 'reboot' },
        { type: 'rebootCompleted', oldCivilization: 1, newCivilization: 2, aiCoresGranted: 3, prestigePower: 1.5 },
        { type: 'permanentUpgradePurchased', upgradeId: 'up_1', previousRank: 0, newRank: 1, cost: 1 },
        { type: 'founderPackApplied', origin: 'purchase', requestId: 'founder_pack:1:1', entitlementGranted: true, cosmeticGranted: true, surgesGranted: 3, changed: true },
        { type: 'founderPackApplied', origin: 'restore', requestId: null, entitlementGranted: true, cosmeticGranted: false, surgesGranted: 0, changed: true },
    ];
    const expected = ['producer_unlock', 'breakthrough_purchase', 'era_reached', 'first_robot', 'civilization_reached', 'reboot_completed', 'permanent_upgrade_purchase', 'purchase_complete', 'purchase_restore'];
    const drafts = m.mapper.mapDomainEvents(domain);
    assert.deepEqual(drafts.map((d) => d.eventId), expected);
    for (const d of drafts) assert.equal(m.validator.validateAnalyticsEvent(d.eventId, d.params).ok, true, d.eventId);
    assert.deepEqual(drafts[2].params, { era_id: 'era_2' });
    assert.deepEqual(drafts[7].params, { product: 'founder_pack', request_id: 'founder_pack:1:1' });
});

test('mapper: unrelated domain events and replayed founder deliveries map to nothing', async () => {
    const { mapper } = await load();
    assert.deepEqual(mapper.mapDomainEvents([
        { type: 'industrialOutputChanged', previousAmount: 0, newAmount: 1, delta: 1, reason: 'manual_production' },
        { type: 'productionGranted', source: 'manual', amount: 1 },
        { type: 'founderPackApplied', origin: 'purchase', requestId: 'r', entitlementGranted: false, cosmeticGranted: false, surgesGranted: 0, changed: false },
    ]), []);
});

test('observer: domain events reach the provider in order', async () => {
    const m = await load();
    const { service, observer } = makeObserver(m);
    observer.observeDomainEvents([
        { type: 'firstRobotProduced' },
        { type: 'eraChanged', oldEraId: 'era_1', newEraId: 'era_2' },
    ]);
    observer.observeDomainEvents([{ type: 'rebootCompleted', oldCivilization: 1, newCivilization: 2, aiCoresGranted: 3, prestigePower: 1 }]);
    assert.deepEqual(ids(service), ['first_robot', 'era_reached', 'reboot_completed']);
});

// ---------------------------------------------------------------- rewarded

test('rewarded: opportunity is de-duplicated, then start / complete carry the opaque request id', async () => {
    const m = await load();
    const { service, observer } = makeObserver(m);
    const offered = { eligible: true, reason: 'ok', adAvailable: true, blockedBy: null };
    observer.observeRewardedPhase('offline_double', 'offer', offered);
    observer.observeRewardedPhase('offline_double', 'offer', offered);
    observer.observeRewardedPhase('offline_double', 'ad_started', { requestId: 'offline_double:1:1' });
    observer.observeRewardedPhase('offline_double', 'ad_result', { status: 'rewarded', rewardVerified: true, duplicate: false });
    assert.deepEqual(service.events, [
        { eventId: 'rewarded_opportunity', params: { placement: 'offline_double' } },
        { eventId: 'rewarded_start', params: { placement: 'offline_double', request_id: 'offline_double:1:1' } },
        { eventId: 'rewarded_complete', params: { placement: 'offline_double', request_id: 'offline_double:1:1' } },
    ]);
});

test('rewarded: failed / closed / timeout / unverified -> failure; unavailable at offer and at show; per-placement state; duplicates ignored', async () => {
    const m = await load();
    const { service, observer, diagnostics } = makeObserver(m);
    const p = 'extended_overclock';
    observer.observeRewardedPhase(p, 'offer', { eligible: true, reason: 'ok', adAvailable: false, blockedBy: 'ad' });
    observer.observeRewardedPhase(p, 'offer', { eligible: true, reason: 'ok', adAvailable: false, blockedBy: 'ad' });
    observer.observeRewardedPhase(p, 'offer', { eligible: false, reason: 'cooldown', adAvailable: true, blockedBy: 'player' });
    for (const status of ['closed', 'failed', 'timeout']) {
        observer.observeRewardedPhase(p, 'ad_started', { requestId: `r:${status}` });
        observer.observeRewardedPhase(p, 'ad_result', { status, rewardVerified: false, duplicate: false });
    }
    observer.observeRewardedPhase(p, 'ad_started', { requestId: 'r:unv' });
    observer.observeRewardedPhase(p, 'ad_result', { status: 'rewarded', rewardVerified: false, duplicate: false });
    observer.observeRewardedPhase(p, 'ad_result', { status: 'unavailable', rewardVerified: false, duplicate: false });
    observer.observeRewardedPhase(p, 'ad_result', { status: 'rewarded', rewardVerified: true, duplicate: true });
    assert.deepEqual(ids(service), [
        'rewarded_unavailable',
        'rewarded_start', 'rewarded_failure',
        'rewarded_start', 'rewarded_failure',
        'rewarded_start', 'rewarded_failure',
        'rewarded_start', 'rewarded_failure',
        'rewarded_unavailable',
    ]);
    assert.deepEqual(service.events.filter((e) => e.eventId === 'rewarded_failure').map((e) => e.params.reason), ['closed', 'failed', 'timeout', 'unverified']);
    assert.equal(service.events[0].params.stage, 'offer');
    assert.equal(service.events.at(-1).params.stage, 'show');
    assert.equal(diagnostics.filter((d) => d.kind === 'invalid').length, 0);
});

// ---------------------------------------------------------------- purchase

test('purchase: offer impression once per session, start, cancel, failure, pending, apply rejection; price never leaves the flow', async () => {
    const m = await load();
    const { service, observer, diagnostics } = makeObserver(m);
    const refresh = { offer: 'available', store: 'ready', priceShown: true, price: '$4.99', pending: false };
    observer.observePurchasePhase('refresh', { offer: 'available', store: 'loading', priceShown: false, price: null, pending: false });
    observer.observePurchasePhase('refresh', refresh);
    observer.observePurchasePhase('refresh', refresh);
    observer.observePurchasePhase('purchase_started', { requestId: 'founder_pack:1:1' });
    observer.observePurchasePhase('purchase_result', { status: 'cancelled', requestId: 'founder_pack:1:1', transactionId: null, duplicate: false, reason: null });
    observer.observePurchasePhase('purchase_result', { status: 'failed', requestId: 'founder_pack:1:2', transactionId: 'GPA.123', duplicate: false, reason: 'x' });
    observer.observePurchasePhase('purchase_result', { status: 'timeout', requestId: 'founder_pack:1:3', transactionId: null, duplicate: false, reason: null });
    observer.observePurchasePhase('purchase_result', { status: 'completed', requestId: 'founder_pack:1:4', transactionId: 'GPA.9', duplicate: false, reason: null });
    observer.observePurchasePhase('purchase_result', { status: 'failed', requestId: 'founder_pack:1:2', transactionId: null, duplicate: true, reason: null });
    observer.observePurchasePhase('pending', { requestId: 'founder_pack:1:5' });
    observer.observePurchasePhase('applied', { status: 'rejected', restoreOnly: false, requestId: 'founder_pack:1:6' });
    observer.observePurchasePhase('applied', { status: 'applied_saved', restoreOnly: false, requestId: 'founder_pack:1:7' });
    assert.deepEqual(ids(service), ['purchase_offer_shown', 'purchase_start', 'purchase_cancel', 'purchase_failure', 'purchase_failure', 'purchase_pending', 'purchase_failure']);
    assert.deepEqual(service.events.filter((e) => e.eventId === 'purchase_failure').map((e) => e.params.reason), ['failed', 'timeout', 'apply_rejected']);
    assert.doesNotMatch(JSON.stringify(service.events), /4\.99|GPA|price|transaction/);
    assert.equal(diagnostics.filter((d) => d.kind === 'invalid').length, 0);
});

// ---------------------------------------------------------------- offline

test('offline: report shown / collected / auto-collected with bucketed durations and no exact seconds', async () => {
    const m = await load();
    const { service, observer, diagnostics } = makeObserver(m);
    observer.observeOfflineSignal({ kind: 'shown', reason: 'startup', rawSeconds: 4000, capApplied: false });
    observer.observeOfflineSignal({ kind: 'collected', rawSeconds: 4000, capApplied: false, doubled: true, saveOk: null });
    observer.observeOfflineSignal({ kind: 'collected', rawSeconds: 90000, capApplied: true, doubled: false, saveOk: true });
    observer.observeOfflineSignal({ kind: 'auto_collected', rawSeconds: 30, saveOk: false });
    assert.deepEqual(service.events, [
        { eventId: 'offline_report_shown', params: { reason: 'startup', absence_bucket: '30m_2h', cap_applied: false } },
        { eventId: 'offline_collected', params: { absence_bucket: '30m_2h', cap_applied: false, doubled: true } },
        { eventId: 'offline_collected', params: { absence_bucket: 'gt_8h', cap_applied: true, doubled: false, saved: true } },
        { eventId: 'offline_auto_collected', params: { absence_bucket: 'lt_1m', saved: false } },
    ]);
    assert.equal(diagnostics.filter((d) => d.kind === 'invalid').length, 0);
});

// ---------------------------------------------------------------- non-authoritative

test('provider failure is non-authoritative: throws are swallowed, counted, and the tracker disables itself after repeated failures', async () => {
    const m = await load();
    const mock = new m.mockModule.MockAnalyticsService();
    // A provider whose track throws OUT of the service (a badly behaved provider).
    const throwing = { initialize: async () => ({ kind: 'analytics', status: 'ready' }), getStatus: () => ({ kind: 'analytics', status: 'ready' }), track() { throw new Error('boom'); } };
    const diagnostics = [];
    const tracker = new m.trackerModule.AnalyticsTracker(throwing, { validation: 'strict', maxConsecutiveFailures: 3, onDiagnostic: (d) => diagnostics.push(d) });
    const observer = new m.observerModule.AnalyticsObserver(tracker);
    for (let i = 0; i < 5; i++) assert.doesNotThrow(() => observer.observeDomainEvents([{ type: 'firstRobotProduced' }]));
    assert.equal(tracker.providerFailures, 3);
    assert.equal(tracker.isEnabled(), false);
    assert.ok(diagnostics.some((d) => d.kind === 'disabled' && d.reason === 'too_many_failures'));
    // The mock provider also swallows its own failures.
    mock.failNext(1);
    assert.doesNotThrow(() => mock.track('first_robot'));
});

test('a throwing diagnostics sink never propagates', async () => {
    const m = await load();
    const service = new m.debugModule.DebugAnalyticsService();
    const tracker = new m.trackerModule.AnalyticsTracker(service, { validation: 'strict', onDiagnostic: () => { throw new Error('sink'); } });
    assert.doesNotThrow(() => tracker.track('first_robot'));
    assert.doesNotThrow(() => tracker.track('bogus'));
    assert.equal(service.events.length, 1);
});

test('init failure and init timeout disable analytics without rejecting or blocking', async () => {
    const m = await load();
    const failing = { initialize: async () => { throw new Error('init'); }, getStatus: () => ({ kind: 'analytics', status: 'failed' }), track() { /* none */ } };
    const t1 = new m.trackerModule.AnalyticsTracker(failing);
    await t1.initialize();
    assert.equal(t1.isEnabled(), false);

    const hanging = { initialize: () => new Promise(() => { /* never */ }), getStatus: () => ({ kind: 'analytics', status: 'initializing' }), track() { /* none */ } };
    const t2 = new m.trackerModule.AnalyticsTracker(hanging, { initTimeoutMs: 20, startTimer: (ms, fire) => { const h = setTimeout(fire, ms); return () => clearTimeout(h); } });
    await t2.initialize();
    assert.equal(t2.isEnabled(), false);

    const noop = new m.noopModule.NoOpAnalyticsService();
    const t3 = new m.trackerModule.AnalyticsTracker(noop);
    await t3.initialize();
    assert.equal(t3.isEnabled(), true);
    assert.doesNotThrow(() => t3.track('first_robot'));
});

test('debug provider keeps a bounded ring and swallows a throwing sink', async () => {
    const { debugModule } = await load();
    const seen = [];
    const service = new debugModule.DebugAnalyticsService((e) => { seen.push(e.eventId); });
    for (let i = 0; i < debugModule.DEBUG_ANALYTICS_MAX_BUFFERED + 10; i++) service.track('first_robot');
    assert.equal(service.events.length, debugModule.DEBUG_ANALYTICS_MAX_BUFFERED);
    assert.equal(seen.length, debugModule.DEBUG_ANALYTICS_MAX_BUFFERED + 10);
    const throwing = new debugModule.DebugAnalyticsService(() => { throw new Error('sink'); });
    assert.doesNotThrow(() => throwing.track('first_robot'));
});

// ---------------------------------------------------------------- source scan

const CC_IMPORT = new RegExp(['from', String.fromCharCode(92) + 's+.c', 'c.'].join(''));
const ANALYTICS_PROVIDER_REFERENCES = /\b(AnalyticsService|AnalyticsTracker|DebugAnalyticsService|NoOpAnalyticsService|MockAnalyticsService)\b/;
const VENDOR_SDKS = /firebase|gameanalytics|appsflyer|adjust\.com|amplitude|mixpanel|unityanalytics|google-analytics|flurry|facebook\.sdk|cc\.sys\.__.*analytics/i;

test('source scan: no domain / UI script calls an analytics provider or vendor SDK directly', async () => {
    const files = await collect(scriptsRoot);
    const allowed = new Set([
        'services/AnalyticsService.ts',
        'services/AnalyticsTracker.ts',
        'services/AnalyticsEventMapper.ts',
        'services/AnalyticsValidator.ts',
        'services/AnalyticsEvents.ts',
        'services/PlatformServices.ts',
        'services/PlatformServiceTypes.ts',
        'services/index.ts',
        'platform/mock/MockAnalyticsService.ts',
        'platform/mock/DebugAnalyticsService.ts',
        'platform/mock/index.ts',
        'platform/noop/index.ts',
        'platform/mock/MockPlatformServices.ts',
        'platform/mock/MockPlatformProviders.ts',
        'platform/noop/NoOpAnalyticsService.ts',
        'platform/noop/NoOpPlatformServices.ts',
        'presentation/AnalyticsObserver.ts',
        'presentation/BuildPlatformServices.ts',
    ]);
    for (const file of files) {
        const rel = path.relative(scriptsRoot, file).split(path.sep).join('/');
        const text = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
        assert.doesNotMatch(text, VENDOR_SDKS, `${rel} references a vendor analytics SDK`);
        if (allowed.has(rel)) continue;
        assert.doesNotMatch(text, ANALYTICS_PROVIDER_REFERENCES, `${rel} must not reference an analytics provider / tracker (use the AnalyticsObserver at the platform boundary)`);
        assert.doesNotMatch(text, /\banalytics\w*\.track\(/, `${rel} must not call analytics.track directly`);
    }
});

test('source scan: only the AnalyticsObserver reaches the tracker and the bootstrap holds the observer, not a provider', async () => {
    const bootstrap = await readText('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /new AnalyticsObserver\(/);
    assert.doesNotMatch(bootstrap, /platform\/(mock|noop)\/\w*Analytics/);
    assert.doesNotMatch(bootstrap, /\.track\(/);
    const observer = await readText('assets/scripts/presentation/AnalyticsObserver.ts');
    assert.doesNotMatch(observer, CC_IMPORT);
    // Pure core: the analytics modules never import cc, and the domain / runtime never import analytics.
    for (const file of ['services/AnalyticsEvents.ts', 'services/AnalyticsValidator.ts', 'services/AnalyticsEventMapper.ts', 'services/AnalyticsTracker.ts', 'platform/mock/DebugAnalyticsService.ts']) {
        assert.doesNotMatch(await readText(`assets/scripts/${file}`), CC_IMPORT, file);
    }
    for (const dir of ['domain', 'runtime', 'economy', 'progression', 'state', 'persistence', 'offline', 'lifecycle', 'config', 'monetization']) {
        for (const file of await collect(path.join(scriptsRoot, dir))) {
            assert.doesNotMatch((await readFile(file, 'utf8')), /[Aa]nalytics/, `${dir}/${path.basename(file)} must not mention analytics`);
        }
    }
});

test('no save-schema change and the analytics DEBUG event is declared and captured by default', async () => {
    const diagnostics = await importModule('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.ok(diagnostics.DEVICE_EVENT_TYPES.includes('analytics'));
    const reveal = await importModule('tools/device/reveal_capture.ts');
    assert.ok(reveal.DEFAULT_REVEAL_EVENT_TYPES.includes('analytics'));
});
