const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir, stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const scriptsRoot = path.join(repoRoot, 'assets', 'scripts');

async function importModule(relativePath) {
    return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

async function collectTypeScriptSources(directoryPath) {
    let entries;
    try {
        entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
        return [];
    }
    const nested = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            return collectTypeScriptSources(entryPath);
        }
        return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    }));
    return nested.flat().sort();
}

const P = 'assets/scripts/platform/mock/MockPlatformProviders.ts';
const T = 'assets/scripts/services/PlatformServiceTypes.ts';
const FOUNDER = { productId: 'founder_pack', type: 'durable', available: true, localizedPrice: '$0.00' };
const OFFLINE = 'rewarded.offline_double';
const OVERCLOCK = 'rewarded.extended_overclock';

async function readyAds(options) {
    const { MockAdsService } = await importModule(P);
    const ads = new MockAdsService(options);
    await ads.initialize();
    return ads;
}

async function readyPurchases(options) {
    const { MockPurchaseService } = await importModule(P);
    const purchases = new MockPurchaseService({ products: [FOUNDER], ...(options ?? {}) });
    await purchases.initialize();
    return purchases;
}

test('scripted ads cover rewarded, closed, failed, unavailable and timeout', async () => {
    const ads = await readyAds();
    ads.enqueueOutcomes(OFFLINE,
        { outcome: 'rewarded' },
        { outcome: 'closed' },
        { outcome: 'failed', reason: 'sdk_error' },
        { outcome: 'unavailable' },
        { outcome: 'timeout' });

    const results = [];
    for (let i = 0; i < 5; i += 1) {
        results.push(await ads.showRewarded({ placementId: OFFLINE, requestId: `ad-${i}` }));
    }

    assert.deepEqual(results.map((r) => r.status), ['rewarded', 'closed', 'failed', 'unavailable', 'timeout']);
    assert.deepEqual(results.map((r) => r.rewardVerified), [true, false, false, false, false]);
    assert.equal(results[2].reason, 'sdk_error');
    assert.equal(results[1].reason, 'mock_rewarded_closed');
    assert.equal(ads.script.pending(OFFLINE), 0);

    // queue exhausted: falls back to option behaviour (rewarded by default)
    assert.equal((await ads.showRewarded({ placementId: OFFLINE, requestId: 'ad-after' })).status, 'rewarded');
});

test('ad outcome queues are ordered per placement and independent', async () => {
    const ads = await readyAds();
    ads.enqueueOutcomes(OFFLINE, { outcome: 'failed' }, { outcome: 'rewarded' });
    ads.enqueueOutcomes(OVERCLOCK, { outcome: 'closed' });

    assert.equal((await ads.showRewarded({ placementId: OVERCLOCK, requestId: 'a' })).status, 'closed');
    assert.equal((await ads.showRewarded({ placementId: OFFLINE, requestId: 'b' })).status, 'failed');
    assert.equal((await ads.showRewarded({ placementId: OFFLINE, requestId: 'c' })).status, 'rewarded');
    assert.deepEqual(ads.calls.filter((c) => c.method === 'showRewarded').map((c) => c.requestId), ['a', 'b', 'c']);
});

test('manual gate gives a deterministic ad timeout without real timers', async () => {
    const ads = await readyAds();
    ads.enqueueOutcomes(OFFLINE, { outcome: 'timeout', manual: true });

    let settled = false;
    const pending = ads.showRewarded({ placementId: OFFLINE, requestId: 'slow' }).then((r) => {
        settled = true;
        return r;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(ads.gate.isHeld('slow'), true);

    assert.equal(ads.gate.release('slow'), true);
    assert.equal(ads.gate.release('slow'), false);
    const result = await pending;
    assert.equal(result.status, 'timeout');
    assert.equal(result.rewardVerified, false);
});

test('scripted purchases cover every outcome', async () => {
    const purchases = await readyPurchases();
    purchases.enqueueOutcomes('founder_pack',
        { outcome: 'completed' },
        { outcome: 'cancelled' },
        { outcome: 'pending' },
        { outcome: 'failed' },
        { outcome: 'timeout' },
        { outcome: 'already_owned' },
        { outcome: 'unavailable' });

    const results = [];
    for (let i = 0; i < 7; i += 1) {
        results.push(await purchases.purchase({ productId: 'founder_pack', requestId: `p-${i}` }));
    }

    assert.deepEqual(results.map((r) => r.status),
        ['completed', 'cancelled', 'pending', 'failed', 'timeout', 'already_owned', 'unavailable']);
    assert.equal(results[0].transactionId, 'mock-p-0');
    assert.deepEqual(results.slice(1).map((r) => r.transactionId), Array(6).fill(undefined));

    const missing = await purchases.purchase({ productId: 'nope', requestId: 'p-missing' });
    assert.equal(missing.status, 'failed');
    assert.equal(missing.reason, 'mock_product_missing');

    // option behaviour still works with the new statuses
    const optioned = await readyPurchases({ purchaseResults: { founder_pack: 'already_owned' } });
    assert.equal((await optioned.purchase({ productId: 'founder_pack', requestId: 'o' })).status, 'already_owned');
});

test('manual gate gives a deterministic purchase timeout', async () => {
    const purchases = await readyPurchases();
    purchases.enqueueOutcomes('founder_pack', { outcome: 'timeout', manual: true });
    const pending = purchases.purchase({ productId: 'founder_pack', requestId: 'slow-buy' });
    await Promise.resolve();
    assert.equal(purchases.gate.release('slow-buy'), true);
    assert.equal((await pending).status, 'timeout');
});

test('duplicate requestId returns the memoized result flagged duplicate', async () => {
    const ads = await readyAds();
    ads.enqueueOutcomes(OFFLINE, { outcome: 'rewarded' }, { outcome: 'failed' });

    const first = await ads.showRewarded({ placementId: OFFLINE, requestId: 'same' });
    const second = await ads.showRewarded({ placementId: OFFLINE, requestId: 'same' });
    assert.equal(first.duplicate, undefined);
    assert.equal(second.duplicate, true);
    assert.equal(second.status, 'rewarded');
    assert.equal(ads.script.pending(OFFLINE), 1, 'duplicate must not consume the script');

    const purchases = await readyPurchases();
    const p1 = await purchases.purchase({ productId: 'founder_pack', requestId: 'buy' });
    const p2 = await purchases.purchase({ productId: 'founder_pack', requestId: 'buy' });
    assert.equal(p1.duplicate, undefined);
    assert.equal(p2.duplicate, true);
    assert.equal(p2.transactionId, p1.transactionId);
    assert.equal(p2.status, 'completed');
});

test('duplicateCallback modifier delivers the same result twice, the second flagged', async () => {
    const ads = await readyAds();
    ads.enqueueOutcomes(OFFLINE, { outcome: 'rewarded', duplicateCallback: true });
    await ads.showRewarded({ placementId: OFFLINE, requestId: 'dup-cb' });
    assert.equal(ads.deliveries.length, 2);
    assert.equal(ads.deliveries[0].duplicate, undefined);
    assert.equal(ads.deliveries[1].duplicate, true);

    const purchases = await readyPurchases();
    purchases.enqueueOutcomes('founder_pack', { outcome: 'completed', duplicateCallback: true, transactionId: 'tx-1' });
    await purchases.purchase({ productId: 'founder_pack', requestId: 'dup-buy' });
    assert.equal(purchases.deliveries.length, 2);
    assert.equal(purchases.deliveries[0].transactionId, 'tx-1');
    assert.equal(purchases.deliveries[1].transactionId, 'tx-1');
    assert.equal(purchases.deliveries[1].duplicate, true);
});

test('RewardClaimLedger grants a requestId exactly once', async () => {
    const { RewardClaimLedger, createIdempotentRewardGuard } =
        await importModule('assets/scripts/services/RewardClaimLedger.ts');

    const ledger = new RewardClaimLedger();
    assert.equal(ledger.tryConsume('r1'), true);
    assert.equal(ledger.tryConsume('r1'), false);
    assert.equal(ledger.tryConsume('r2'), true);
    assert.equal(ledger.size, 2);

    const guard = createIdempotentRewardGuard();
    assert.equal(guard('x'), true);
    assert.equal(guard('x'), false);
    assert.equal(createIdempotentRewardGuard()('x'), true, 'guards are independent');
});

test('entitlements: owned, not owned, uninitialized and reconcile', async () => {
    const { MockEntitlementService } = await importModule(P);
    const entitlements = new MockEntitlementService({ ownedEntitlementIds: ['entitlement.founder_pack'] });

    const before = await entitlements.getEntitlementStatus('entitlement.founder_pack');
    assert.equal(before.owned, false);
    assert.equal(before.reason, 'uninitialized');
    assert.equal((await entitlements.reconcileEntitlements()).ok, false);

    await entitlements.initialize();
    assert.equal((await entitlements.getEntitlementStatus('entitlement.founder_pack')).owned, true);
    assert.equal((await entitlements.getEntitlementStatus('entitlement.other')).owned, false);
    assert.equal((await entitlements.reconcileEntitlements()).ok, true);
});

test('analytics: mock records, failures never propagate, NoOp is silent', async () => {
    const { MockAnalyticsService } = await importModule('assets/scripts/platform/mock/MockAnalyticsService.ts');
    const { NoOpAnalyticsService } = await importModule('assets/scripts/platform/noop/NoOpAnalyticsService.ts');

    const analytics = new MockAnalyticsService();
    assert.equal(analytics.getStatus().status, 'uninitialized');
    await analytics.initialize();
    analytics.track('era_reached', { era: 2 });
    analytics.track('first_robot');
    assert.deepEqual(analytics.events.map((e) => e.eventId), ['era_reached', 'first_robot']);
    assert.deepEqual(analytics.events[0].params, { era: 2 });

    analytics.failNext();
    assert.doesNotThrow(() => analytics.track('lost_event'));
    analytics.track('after_failure');
    assert.equal(analytics.swallowedFailures, 1);
    assert.equal(analytics.events.length, 3);

    const throwing = new MockAnalyticsService({ throwOnTrack: true });
    assert.doesNotThrow(() => throwing.track('x', { a: true }));
    assert.equal(throwing.events.length, 0);
    assert.equal(throwing.swallowedFailures, 1);

    const noop = new NoOpAnalyticsService();
    assert.equal((await noop.initialize()).status, 'unavailable');
    assert.equal(noop.track('era_reached', { era: 1 }), undefined);
});

test('analytics event catalogue ids are unique snake_case and cover the design list', async () => {
    const { ANALYTICS_EVENTS } = await importModule('assets/scripts/services/AnalyticsEvents.ts');
    const ids = Object.values(ANALYTICS_EVENTS);

    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
        assert.match(id, /^[a-z]+(_[a-z]+)*$/);
    }
    for (const expected of [
        'producer_unlock', 'breakthrough_purchase', 'era_reached', 'first_robot', 'reboot_preview',
        'reboot_completed', 'offline_report_shown', 'offline_collected', 'rewarded_opportunity',
        'rewarded_start', 'rewarded_complete', 'rewarded_failure', 'purchase_start', 'purchase_complete',
        'purchase_cancel', 'purchase_failure', 'purchase_restore',
    ]) {
        assert.ok(ids.includes(expected), `missing ${expected}`);
    }
});

test('capabilities for the mock and no-op factories', async () => {
    const { createMockPlatformServices } = await importModule('assets/scripts/platform/mock/MockPlatformServices.ts');
    const { createNoOpPlatformServices } = await importModule('assets/scripts/platform/noop/NoOpPlatformServices.ts');
    const { NO_PLATFORM_CAPABILITIES } = await importModule('assets/scripts/services/PlatformCapabilities.ts');

    assert.deepEqual(createMockPlatformServices().capabilities, {
        platform: 'editor',
        rewardedAds: true,
        billing: true,
        restorePurchases: true,
        analytics: true,
        fullscreenOverlays: false,
    });
    assert.equal(createMockPlatformServices({ capabilities: { billing: false } }).capabilities.billing, false);

    const noop = createNoOpPlatformServices();
    assert.deepEqual(noop.capabilities, NO_PLATFORM_CAPABILITIES);
    assert.equal(noop.capabilities.platform, 'noop');
    for (const key of ['rewardedAds', 'billing', 'restorePurchases', 'analytics', 'fullscreenOverlays']) {
        assert.equal(noop.capabilities[key], false);
    }
});

test('overlay tracker: begin/end, duplicate and unknown end, classify, unsubscribe', async () => {
    const { PlatformOverlayTracker } = await importModule('assets/scripts/services/PlatformOverlay.ts');
    const tracker = new PlatformOverlayTracker();
    const events = [];
    const unsubscribe = tracker.subscribe((e) => events.push(e));

    assert.equal(tracker.isOverlayActive(), false);
    assert.equal(tracker.classifyBackground(), 'user_absence');

    tracker.begin('rewarded_ad', 'r1');
    tracker.begin('rewarded_ad', 'r1');
    tracker.begin('purchase_flow', 'r2');
    assert.equal(tracker.activeCount, 2);
    assert.equal(tracker.classifyBackground(), 'overlay');

    tracker.end('unknown');
    tracker.end('r1');
    tracker.end('r1');
    assert.equal(tracker.activeCount, 1);
    assert.equal(tracker.isOverlayActive(), true);

    unsubscribe();
    tracker.end('r2');
    assert.equal(tracker.isOverlayActive(), false);
    assert.equal(tracker.classifyBackground(), 'user_absence');

    assert.deepEqual(events, [
        { phase: 'begin', kind: 'rewarded_ad', requestId: 'r1' },
        { phase: 'begin', kind: 'purchase_flow', requestId: 'r2' },
        { phase: 'end', kind: 'rewarded_ad', requestId: 'r1' },
    ]);

    tracker.subscribe(() => { throw new Error('listener'); });
    assert.doesNotThrow(() => tracker.begin('rewarded_ad', 'r3'));
});

test('mock providers emit overlay begin/end around show and purchase, also on failure', async () => {
    const { createMockPlatformServices } = await importModule('assets/scripts/platform/mock/MockPlatformServices.ts');
    const services = createMockPlatformServices({ purchases: { products: [FOUNDER] } });
    await services.ads.initialize();
    await services.purchases.initialize();

    const events = [];
    services.overlay.subscribe((e) => events.push(`${e.phase}:${e.kind}:${e.requestId}:${services.overlay.activeCount}`));

    services.ads.enqueueOutcomes(OFFLINE, { outcome: 'failed' }, { outcome: 'unavailable' });
    await services.ads.showRewarded({ placementId: OFFLINE, requestId: 'ad1' });
    await services.ads.showRewarded({ placementId: OFFLINE, requestId: 'ad2' });
    await services.ads.showRewarded({ placementId: OFFLINE, requestId: 'ad1' });
    services.purchases.enqueueOutcomes('founder_pack', { outcome: 'cancelled' });
    await services.purchases.purchase({ productId: 'founder_pack', requestId: 'buy1' });

    assert.deepEqual(events, [
        'begin:rewarded_ad:ad1:1',
        'end:rewarded_ad:ad1:0',
        'begin:purchase_flow:buy1:1',
        'end:purchase_flow:buy1:0',
    ]);
    assert.equal(services.overlay.isOverlayActive(), false);

    services.ads.enqueueOutcomes(OFFLINE, { outcome: 'timeout', manual: true });
    const pending = services.ads.showRewarded({ placementId: OFFLINE, requestId: 'held' });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(services.overlay.classifyBackground(), 'overlay');
    services.ads.gate.release('held');
    await pending;
    assert.equal(services.overlay.classifyBackground(), 'user_absence');
});

test('aggregate mock and no-op factories run end to end without network', async () => {
    const { createMockPlatformServices } = await importModule('assets/scripts/platform/mock/MockPlatformServices.ts');
    const { createNoOpPlatformServices } = await importModule('assets/scripts/platform/noop/NoOpPlatformServices.ts');

    const mock = createMockPlatformServices({
        purchases: { products: [FOUNDER] },
        entitlements: { ownedEntitlementIds: ['entitlement.founder_pack'] },
    });
    for (const service of [mock.ads, mock.purchases, mock.entitlements, mock.analytics]) {
        assert.equal((await service.initialize()).status, 'ready');
    }
    assert.equal((await mock.ads.getRewardedAvailability(OFFLINE)).available, true);
    assert.equal((await mock.purchases.queryProductDetails(['founder_pack'])).ok, true);
    assert.equal((await mock.purchases.purchase({ productId: 'founder_pack', requestId: 'agg' })).status, 'completed');
    assert.equal((await mock.ads.showRewarded({ placementId: OFFLINE, requestId: 'agg-ad' })).status, 'rewarded');
    assert.equal((await mock.entitlements.getEntitlementStatus('entitlement.founder_pack')).owned, true);
    mock.analytics.track('purchase_complete', { productId: 'founder_pack' });
    assert.equal(mock.analytics.events.length, 1);
    assert.ok(mock.ads.calls.length > 0 && mock.purchases.calls.length > 0);

    const noop = createNoOpPlatformServices();
    for (const service of [noop.ads, noop.purchases, noop.entitlements, noop.analytics]) {
        assert.equal((await service.initialize()).status, 'unavailable');
    }
    assert.equal((await noop.purchases.purchase({ productId: 'founder_pack', requestId: 'n' })).status, 'unavailable');
    assert.doesNotThrow(() => noop.analytics.track('era_reached'));
});

test('core gameplay layers never import platform services, native SDKs or cc', async () => {
    const coreDirs = ['config', 'domain', 'state', 'economy', 'progression', 'runtime', 'persistence',
        'time', 'offline', 'lifecycle', 'simulation'];
    const files = (await Promise.all(coreDirs.map((d) => collectTypeScriptSources(path.join(scriptsRoot, d))))).flat();
    assert.ok(files.length > 20, 'expected core sources');

    for (const file of files) {
        const source = await readFile(file, 'utf8');
        const rel = path.relative(repoRoot, file);
        const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

        for (const spec of specifiers) {
            assert.equal(spec === 'cc', false, `${rel} imports cc`);
            assert.equal(/(^|\/)platform(\/|$)/.test(spec), false, `${rel} imports platform/ (${spec})`);
            assert.equal(/services\/(Ads|Purchase|Entitlement|Analytics)/.test(spec), false, `${rel} imports monetization service (${spec})`);
        }
        assert.equal(/native\.reflection|AutomataPlatformBridge/.test(source), false, `${rel} references native bridge`);
        assert.equal(/com\.google|BillingClient|MobileAds/.test(source), false, `${rel} references Google SDK`);
    }
});

test('only presentation, app, platform and services import platform/', async () => {
    const files = await collectTypeScriptSources(scriptsRoot);
    const allowed = ['presentation', 'app', 'platform', 'services'];

    for (const file of files) {
        const topDir = path.relative(scriptsRoot, file).split(path.sep)[0];
        if (allowed.includes(topDir)) {
            continue;
        }
        const source = await readFile(file, 'utf8');
        const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
        for (const spec of specifiers) {
            assert.equal(/(^|\/)platform(\/|$)/.test(spec), false,
                `${path.relative(repoRoot, file)} imports platform/ (${spec})`);
        }
    }
});

test('new service, mock and no-op files stay free of cc and native SDKs', async () => {
    const roots = ['services', path.join('platform', 'mock'), path.join('platform', 'noop')]
        .map((d) => path.join(scriptsRoot, d));
    const files = (await Promise.all(roots.map(collectTypeScriptSources))).flat();
    for (const required of ['AnalyticsService', 'PlatformOverlay', 'MockPlatformScript', 'NoOpAnalyticsService']) {
        assert.ok(files.some((f) => path.basename(f) === `${required}.ts`), `${required}.ts scanned`);
    }
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${file} imports cc`);
        assert.equal(/setTimeout|setInterval|fetch\(|XMLHttpRequest/.test(source), false, `${file} uses timers/network`);
    }
    await stat(path.join(scriptsRoot, 'platform', 'android', 'AndroidNativeBridge.ts'));
    // AUT-057: the pure Android ads provider is free of cc and native class names (its backstop timer is injected; the default timer is its only timer use).
    const androidAds = await readFile(path.join(scriptsRoot, 'platform', 'android', 'AndroidAdsService.ts'), 'utf8');
    assert.equal(/from\s+['"]cc['"]/.test(androidAds), false, 'AndroidAdsService imports cc');
    assert.equal(/native\.reflection|AutomataPlatformBridge/.test(androidAds), false, 'AndroidAdsService names the native bridge');
});
