const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');

async function importModule(relativePath) {
    return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

async function collectTypeScriptSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectTypeScriptSources(entryPath);
        }

        return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    }));

    return nestedSources.flat().sort();
}

test('mock rewarded ads support success, failure and unavailable outcomes', async () => {
    const { MockAdsService } = await importModule('assets/scripts/platform/mock/MockPlatformProviders.ts');
    const { REWARDED_PLACEMENTS } = await importModule('assets/scripts/services/PlatformServiceTypes.ts');

    const ads = new MockAdsService();
    assert.equal((await ads.initialize()).status, 'ready');
    assert.equal((await ads.getRewardedAvailability(REWARDED_PLACEMENTS.offlineDouble)).available, true);

    const success = await ads.showRewarded({
        placementId: REWARDED_PLACEMENTS.offlineDouble,
        requestId: 'reward-success',
    });
    assert.equal(success.status, 'rewarded');
    assert.equal(success.rewardVerified, true);

    ads.setPlacement(REWARDED_PLACEMENTS.extendedOverclock, {
        available: true,
        showResult: 'failed',
        reason: 'forced_failure',
    });

    const failure = await ads.showRewarded({
        placementId: REWARDED_PLACEMENTS.extendedOverclock,
        requestId: 'reward-failure',
    });
    assert.equal(failure.status, 'failed');
    assert.equal(failure.rewardVerified, false);
    assert.equal(failure.reason, 'forced_failure');

    ads.setPlacement(REWARDED_PLACEMENTS.offlineDouble, {
        available: false,
        reason: 'forced_unavailable',
    });

    const unavailable = await ads.showRewarded({
        placementId: REWARDED_PLACEMENTS.offlineDouble,
        requestId: 'reward-unavailable',
    });
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.rewardVerified, false);
    assert.equal(unavailable.reason, 'forced_unavailable');
});

test('mock purchase provider returns deterministic product and purchase states', async () => {
    const { MockPurchaseService } = await importModule('assets/scripts/platform/mock/MockPlatformProviders.ts');
    const { PRODUCTS } = await importModule('assets/scripts/services/PlatformServiceTypes.ts');

    const purchases = new MockPurchaseService({
        products: [{
            productId: PRODUCTS.founderPack,
            type: 'durable',
            available: true,
            localizedPrice: '$0.00',
        }],
    });

    assert.equal((await purchases.initialize()).status, 'ready');

    const details = await purchases.queryProductDetails([PRODUCTS.founderPack, 'missing_product']);
    assert.equal(details.ok, false);
    assert.equal(details.products.length, 1);
    assert.deepEqual(details.missingProductIds, ['missing_product']);

    const completed = await purchases.purchase({
        productId: PRODUCTS.founderPack,
        requestId: 'purchase-success',
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.transactionId, 'mock-purchase-success');

    const missing = await purchases.purchase({
        productId: 'missing_product',
        requestId: 'purchase-missing',
    });
    assert.equal(missing.status, 'failed');
    assert.equal(missing.reason, 'mock_product_missing');
});

test('mock entitlement provider toggles ownership without store dependencies', async () => {
    const { MockEntitlementService } = await importModule('assets/scripts/platform/mock/MockPlatformProviders.ts');
    const { ENTITLEMENTS } = await importModule('assets/scripts/services/PlatformServiceTypes.ts');

    const entitlements = new MockEntitlementService();
    assert.equal((await entitlements.initialize()).status, 'ready');
    assert.equal((await entitlements.getEntitlementStatus(ENTITLEMENTS.founderPack)).owned, false);

    entitlements.setMockEntitlement(ENTITLEMENTS.founderPack, true);
    const owned = await entitlements.getEntitlementStatus(ENTITLEMENTS.founderPack);

    assert.equal(owned.owned, true);
    assert.equal(owned.source, 'mock');
});

test('no-op providers are deterministic and unavailable', async () => {
    const {
        NoOpAdsService,
        NoOpPurchaseService,
        NoOpEntitlementService,
    } = await importModule('assets/scripts/platform/noop/NoOpPlatformProviders.ts');
    const {
        ENTITLEMENTS,
        PRODUCTS,
        REWARDED_PLACEMENTS,
    } = await importModule('assets/scripts/services/PlatformServiceTypes.ts');

    const ads = new NoOpAdsService();
    const purchases = new NoOpPurchaseService();
    const entitlements = new NoOpEntitlementService();

    assert.equal((await ads.initialize()).status, 'unavailable');
    assert.equal((await ads.getRewardedAvailability(REWARDED_PLACEMENTS.offlineDouble)).available, false);
    assert.equal((await ads.showRewarded({
        placementId: REWARDED_PLACEMENTS.offlineDouble,
        requestId: 'noop-ad',
    })).status, 'unavailable');

    assert.equal((await purchases.initialize()).status, 'unavailable');
    assert.equal((await purchases.queryProductDetails([PRODUCTS.founderPack])).ok, false);
    assert.equal((await purchases.purchase({
        productId: PRODUCTS.founderPack,
        requestId: 'noop-purchase',
    })).status, 'unavailable');

    assert.equal((await entitlements.initialize()).status, 'unavailable');
    assert.equal((await entitlements.getEntitlementStatus(ENTITLEMENTS.founderPack)).owned, false);
});

test('service contracts and testable providers do not import Cocos or native SDKs', async () => {
    const safeRoots = [
        path.join(repoRoot, 'assets', 'scripts', 'services'),
        path.join(repoRoot, 'assets', 'scripts', 'platform', 'mock'),
        path.join(repoRoot, 'assets', 'scripts', 'platform', 'noop'),
    ];
    const sourceFiles = (await Promise.all(safeRoots.map(collectTypeScriptSources))).flat();

    assert.ok(sourceFiles.length > 0, 'expected platform service source files');

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);

        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${relativePath} imports Cocos runtime`);
        assert.equal(/native\.reflection|AutomataPlatformBridge/.test(source), false, `${relativePath} imports native bridge`);
        assert.equal(/com\.google|BillingClient|MobileAds/.test(source), false, `${relativePath} imports Google SDK types`);
    }
});

test('Android provider is the only TypeScript layer using Cocos native reflection', async () => {
    const platformFiles = await collectTypeScriptSources(path.join(repoRoot, 'assets', 'scripts', 'platform'));
    const filesImportingCocos = [];

    for (const sourceFile of platformFiles) {
        const source = await readFile(sourceFile, 'utf8');
        if (/from\s+['"]cc['"]/.test(source)) {
            filesImportingCocos.push(path.relative(repoRoot, sourceFile).replace(/\\/g, '/'));
        }
    }

    assert.deepEqual(filesImportingCocos, ['assets/scripts/platform/android/AndroidNativeBridge.ts']);

    const bridgeSource = await readFile(
        path.join(repoRoot, 'assets', 'scripts', 'platform', 'android', 'AndroidNativeBridge.ts'),
        'utf8',
    );
    assert.match(bridgeSource, /callStaticMethod/);
    assert.match(bridgeSource, /com\/cocos\/game\/AutomataPlatformBridge/);
});

