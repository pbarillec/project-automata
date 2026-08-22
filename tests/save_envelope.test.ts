const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const persistenceModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/persistence/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

const metadata = Object.freeze({
    saveVersion: 1,
    gameVersion: '0.1.0-test',
    contentVersion: '0.1.0-aut-010',
    savedAtUtc: '2026-08-22T08:30:45.123Z',
});

async function persistenceModule() {
    return import(persistenceModuleUrl);
}

async function stateModule() {
    return import(stateModuleUrl);
}

async function freshState() {
    const { createFreshGameState } = await stateModule();
    return createFreshGameState();
}

async function representativeState() {
    const state = await freshState();

    state.run.industrialOutput = 1234567.89;
    state.run.producers.fabricator = {
        level: 42,
        isUnlocked: true,
        isBuilt: true,
    };
    state.run.producers.assembly_station = {
        level: 12,
        isUnlocked: true,
        isBuilt: true,
    };
    state.run.producers.robot_line = {
        level: 7,
        isUnlocked: true,
        isBuilt: true,
    };
    state.run.automation.fabricator = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'auto_feeder',
    };
    state.run.automation.assembly_station = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'worker_bot',
    };
    state.run.purchasedBreakthroughIds.push('auto_feeder', 'worker_bot', 'robotic_logistics');
    state.run.currentEraId = 'automated_factory';
    state.run.robotsBuilt = 14.25;
    state.run.statistics = {
        industrialOutputEarned: 3000000,
        industrialOutputSpent: 1765432.11,
        manualProductionActions: 123,
        producerLevelsPurchased: 61,
        breakthroughsPurchased: 3,
        robotsBuiltPeak: 14.25,
    };
    state.run.prestigePowerPeak = 9876.5;
    state.run.progressionFlags.first_robot = true;

    state.meta.civilizationNumber = 2;
    state.meta.aiCores = 9;
    state.meta.lifetimeAiCoresEarned = 14;
    state.meta.permanentUpgradeRanks.industrial_scaling = 2;
    state.meta.permanentUpgradeRanks.worker_templates = 1;
    state.meta.accountFeatureUnlocks.free_overclock = true;
    state.meta.durableEntitlements.founder_pack = {
        owned: true,
        source: 'fixture_store',
        lastKnownValidUtcMs: 1787366400000,
    };
    state.meta.cosmeticOwnership.founder_robot = true;

    state.boosts.activeBoosts.free_overclock = {
        boostId: 'free_overclock',
        remainingSeconds: 37.5,
        cooldownSeconds: 240,
        source: 'free',
        requestId: null,
        effect: {
            type: 'productionMultiplier',
            multiplier: 2,
        },
        isSuspended: false,
        suspendedByBoostId: null,
    };
    state.boosts.cooldowns.extended_overclock = {
        remainingSeconds: 123,
    };
    state.boosts.consumedCharges.founder_surge = 1;

    state.monetization.rewardedClaims['rewarded.extended_overclock'] = {
        placementId: 'rewarded.extended_overclock',
        claimCount: 2,
        lastClaimUtcMs: 1787366500000,
    };
    state.monetization.pendingAdRequests.req_ad_1 = {
        requestId: 'req_ad_1',
        createdUtcMs: 1787366510000,
    };
    state.monetization.pendingPurchaseRequests.req_purchase_1 = {
        requestId: 'req_purchase_1',
        createdUtcMs: 1787366520000,
    };
    state.monetization.productMetadataCache.founder_pack = {
        productId: 'founder_pack',
        localizedPrice: '$2.99',
        updatedUtcMs: 1787366530000,
    };

    state.settings.musicVolume = 0.75;
    state.settings.sfxVolume = 0.5;
    state.settings.vibrationEnabled = true;
    state.settings.languageCode = 'en';
    state.settings.reducedMotion = true;

    state.lifetime = {
        industrialOutputEarned: 9000000,
        manualProductionActions: 999,
        producerLevelsPurchased: 222,
        breakthroughsPurchased: 11,
        robotsBuilt: 44.5,
        rebootsCompleted: 1,
        highestCivilizationReached: 2,
    };

    return state;
}

test('fresh GameState serializes and deserializes to equivalent persisted authoritative state', async () => {
    const { serializeGameStateToSaveJson, assertDeserializeGameStateFromSaveJson } = await persistenceModule();
    const state = await freshState();

    const text = serializeGameStateToSaveJson(state, metadata);
    const result = assertDeserializeGameStateFromSaveJson(text);

    assert.deepEqual(result.state, state);
    assert.deepEqual(result.envelope.payload, state);
    assert.equal(result.envelope.saveVersion, metadata.saveVersion);
    assert.equal(result.envelope.gameVersion, metadata.gameVersion);
    assert.equal(result.envelope.contentVersion, metadata.contentVersion);
    assert.equal(result.envelope.savedAtUtc, metadata.savedAtUtc);
});

test('representative mid-run GameState round-trips across all persisted domains', async () => {
    const { serializeGameStateToSaveJson, assertDeserializeGameStateFromSaveJson } = await persistenceModule();
    const state = await representativeState();

    const result = assertDeserializeGameStateFromSaveJson(serializeGameStateToSaveJson(state, metadata));

    assert.deepEqual(result.state.run, state.run);
    assert.deepEqual(result.state.meta, state.meta);
    assert.deepEqual(result.state.boosts, state.boosts);
    assert.deepEqual(result.state.monetization, state.monetization);
    assert.deepEqual(result.state.settings, state.settings);
    assert.deepEqual(result.state.lifetime, state.lifetime);
});

test('serialization is deterministic for identical state and explicit metadata', async () => {
    const { serializeGameStateToSaveJson } = await persistenceModule();
    const state = await representativeState();

    const first = serializeGameStateToSaveJson(state, metadata);
    const second = serializeGameStateToSaveJson(state, metadata);

    assert.equal(first, second);
    assert.deepEqual(JSON.parse(first), JSON.parse(second));
});

test('save payload excludes derived projections and configuration definitions', async () => {
    const { serializeGameStateToSaveJson } = await persistenceModule();
    const state = await representativeState();
    const text = serializeGameStateToSaveJson(state, metadata);
    const envelope = JSON.parse(text);
    const payloadText = JSON.stringify(envelope.payload);

    for (const forbiddenField of [
        'totalProductionPerSecond',
        'nextProducerCost',
        'milestoneMultipliers',
        'canAfford',
        'nextGoal',
        'resolvedModifiers',
        'prestigePreview',
    ]) {
        assert.equal(payloadText.includes(forbiddenField), false, `${forbiddenField} should not be persisted`);
    }

    for (const configField of [
        'baseCost',
        'costGrowth',
        'baseProductionPerLevel',
        'displayNameKey',
        'rankCosts',
        'p0PrestigePower',
    ]) {
        assert.equal(payloadText.includes(configField), false, `${configField} config data should not be embedded`);
    }
});

test('invalid JSON, missing envelope fields and unsupported saveVersion are rejected deterministically', async () => {
    const { deserializeGameStateFromSaveJson, serializeGameStateToSaveJson } = await persistenceModule();
    const invalidJson = deserializeGameStateFromSaveJson('{');
    assert.deepEqual(invalidJson.diagnostics.map((diagnostic) => diagnostic.code), ['SAVE_INVALID_JSON']);

    const missing = deserializeGameStateFromSaveJson(JSON.stringify({ payload: await freshState() }));
    assert.deepEqual(missing.diagnostics.map((diagnostic) => diagnostic.path), [
        '$.contentVersion',
        '$.gameVersion',
        '$.integrity',
        '$.savedAtUtc',
        '$.saveVersion',
    ]);

    const envelope = JSON.parse(serializeGameStateToSaveJson(await freshState(), metadata));
    envelope.saveVersion = 2;
    const unsupported = deserializeGameStateFromSaveJson(JSON.stringify(envelope));
    assert.deepEqual(unsupported.diagnostics.map((diagnostic) => diagnostic.code), [
        'SAVE_UNSUPPORTED_VERSION',
    ]);
});

test('invalid metadata types and non-canonical UTC timestamps are rejected', async () => {
    const { deserializeGameStateFromSaveJson, serializeGameStateToSaveJson } = await persistenceModule();
    const base = JSON.parse(serializeGameStateToSaveJson(await freshState(), metadata));

    base.gameVersion = 123;
    base.contentVersion = '';
    base.savedAtUtc = '2026-08-22T08:30:45Z';

    const result = deserializeGameStateFromSaveJson(JSON.stringify(base));

    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
        '$.contentVersion',
        '$.gameVersion',
        '$.savedAtUtc',
    ]);
});

test('malformed payload domains are rejected through GameState validation', async () => {
    const { deserializeGameStateFromSaveJson, serializeGameStateToSaveJson } = await persistenceModule();
    const envelope = JSON.parse(serializeGameStateToSaveJson(await freshState(), metadata));
    envelope.payload.run.producers.fabricator = {
        level: -1,
        isUnlocked: true,
        isBuilt: true,
    };
    envelope.integrity.payloadHash = '00000000';

    const result = deserializeGameStateFromSaveJson(JSON.stringify(envelope));

    assert.equal(result.state, undefined);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'STATE_INVALID_NON_NEGATIVE_INTEGER'));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path === '$.payload.run.producers.fabricator.level'));
});

test('unknown top-level, integrity and payload fields follow strict rejection policy', async () => {
    const { deserializeGameStateFromSaveJson, serializeGameStateToSaveJson } = await persistenceModule();
    const envelope = JSON.parse(serializeGameStateToSaveJson(await freshState(), metadata));
    envelope.extraTopLevel = true;
    envelope.integrity.extraIntegrity = true;
    envelope.payload.run.extraPayload = true;

    const result = deserializeGameStateFromSaveJson(JSON.stringify(envelope));

    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'SAVE_UNKNOWN_FIELD' && diagnostic.path === '$.extraTopLevel'));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'SAVE_UNKNOWN_FIELD' && diagnostic.path === '$.integrity.extraIntegrity'));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'STATE_UNKNOWN_FIELD' && diagnostic.path === '$.payload.run.extraPayload'));
});

test('payload integrity hash is deterministic and detects accidental payload changes', async () => {
    const { deserializeGameStateFromSaveJson, serializeGameStateToSaveJson } = await persistenceModule();
    const envelope = JSON.parse(serializeGameStateToSaveJson(await freshState(), metadata));
    const originalHash = envelope.integrity.payloadHash;

    envelope.payload.run.industrialOutput = 1;
    const result = deserializeGameStateFromSaveJson(JSON.stringify(envelope));

    assert.equal(/^[0-9a-f]{8}$/.test(originalHash), true);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ['SAVE_PAYLOAD_HASH_MISMATCH']);
});

test('deserialized state does not share mutable references with returned envelope payload', async () => {
    const { serializeGameStateToSaveJson, assertDeserializeGameStateFromSaveJson } = await persistenceModule();
    const state = await representativeState();
    const result = assertDeserializeGameStateFromSaveJson(serializeGameStateToSaveJson(state, metadata));

    assert.notEqual(result.state, result.envelope.payload);
    assert.notEqual(result.state.run, result.envelope.payload.run);
    assert.notEqual(result.state.run.purchasedBreakthroughIds, result.envelope.payload.run.purchasedBreakthroughIds);

    result.state.run.producers.fabricator.level = 999;
    result.state.run.purchasedBreakthroughIds.push('fixture_new_breakthrough');
    result.state.meta.permanentUpgradeRanks.industrial_scaling = 9;

    assert.equal(result.envelope.payload.run.producers.fabricator.level, 42);
    assert.deepEqual(result.envelope.payload.run.purchasedBreakthroughIds, ['auto_feeder', 'worker_bot', 'robotic_logistics']);
    assert.equal(result.envelope.payload.meta.permanentUpgradeRanks.industrial_scaling, 2);
});
