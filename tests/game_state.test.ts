const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

async function stateModule() {
    return import(stateModuleUrl);
}

async function collectTypeScriptSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectTypeScriptSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.ts')) {
            return [];
        }

        return [entryPath];
    }));

    return nestedSources.flat().sort();
}

test('fresh state is a valid Civilization #1 with safe empty defaults', async () => {
    const { createFreshGameState, validateGameState } = await stateModule();
    const state = createFreshGameState();
    const result = validateGameState(state);

    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.value, state);
    assert.equal(state.meta.civilizationNumber, 1);
    assert.equal(state.lifetime.highestCivilizationReached, 1);
    assert.equal(state.run.industrialOutput, 0);
    assert.deepEqual(state.run.producers, {});
    assert.deepEqual(state.run.automation, {});
    assert.deepEqual(state.run.purchasedBreakthroughIds, []);
    assert.equal(state.run.currentEraId, null);
    assert.equal(state.run.robotsBuilt, 0);
    assert.equal(state.run.prestigePowerPeak, 0);
    assert.deepEqual(state.meta.permanentUpgradeRanks, {});
    assert.deepEqual(state.boosts.activeBoosts, {});
    assert.deepEqual(state.monetization.pendingPurchaseRequests, {});
});

test('run-scoped state and persistent meta state stay explicitly separated', async () => {
    const { createFreshGameState } = await stateModule();
    const state = createFreshGameState();

    state.run.industrialOutput = 250;
    state.run.producers.fixture_fabricator = {
        level: 3,
        isUnlocked: true,
        isBuilt: true,
    };
    state.run.purchasedBreakthroughIds.push('fixture_basic_automation');

    state.meta.aiCores = 2;
    state.meta.lifetimeAiCoresEarned = 5;
    state.meta.permanentUpgradeRanks.fixture_upgrade = 1;

    assert.equal('industrialOutput' in state.meta, false);
    assert.equal('producers' in state.meta, false);
    assert.equal('purchasedBreakthroughIds' in state.meta, false);
    assert.equal('aiCores' in state.run, false);
    assert.equal('permanentUpgradeRanks' in state.run, false);
});

test('derived economic and UI values are not stored by fresh authoritative state', async () => {
    const { createFreshGameState } = await stateModule();
    const state = createFreshGameState();
    const serialized = JSON.stringify(state);

    for (const deferredField of [
        'totalProductionPerSecond',
        'nextProducerCost',
        'milestoneMultipliers',
        'canAfford',
        'nextGoal',
        'visualTier',
        'effectiveTemporaryMultiplier',
    ]) {
        assert.equal(serialized.includes(deferredField), false, `${deferredField} should not be stored`);
    }
});

test('deep clone produces independent nested collections', async () => {
    const { createFreshGameState, cloneGameState } = await stateModule();
    const original = createFreshGameState();
    original.run.producers.fixture_fabricator = {
        level: 1,
        isUnlocked: true,
        isBuilt: true,
    };
    original.run.automation.fixture_fabricator = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'fixture_basic_automation',
    };
    original.run.purchasedBreakthroughIds.push('fixture_basic_automation');
    original.meta.permanentUpgradeRanks.fixture_upgrade = 1;
    original.boosts.activeBoosts.fixture_overclock = {
        boostId: 'fixture_overclock',
        remainingSeconds: 30,
        source: 'free',
        requestId: null,
    };

    const clone = cloneGameState(original);

    assert.notEqual(clone, original);
    assert.notEqual(clone.run, original.run);
    assert.notEqual(clone.run.producers, original.run.producers);
    assert.notEqual(clone.run.purchasedBreakthroughIds, original.run.purchasedBreakthroughIds);
    assert.notEqual(clone.meta.permanentUpgradeRanks, original.meta.permanentUpgradeRanks);
    assert.notEqual(clone.boosts.activeBoosts.fixture_overclock, original.boosts.activeBoosts.fixture_overclock);

    clone.run.producers.fixture_fabricator.level = 9;
    clone.run.purchasedBreakthroughIds.push('fixture_second_breakthrough');
    clone.meta.permanentUpgradeRanks.fixture_upgrade = 3;
    clone.boosts.activeBoosts.fixture_overclock.remainingSeconds = 5;

    assert.equal(original.run.producers.fixture_fabricator.level, 1);
    assert.deepEqual(original.run.purchasedBreakthroughIds, ['fixture_basic_automation']);
    assert.equal(original.meta.permanentUpgradeRanks.fixture_upgrade, 1);
    assert.equal(original.boosts.activeBoosts.fixture_overclock.remainingSeconds, 30);
});

test('validation rejects invalid civilization numbers deterministically', async () => {
    const { createFreshGameState, validateGameState, formatStateDiagnostic } = await stateModule();
    const state = createFreshGameState();
    state.meta.civilizationNumber = 0;

    const result = validateGameState(state);

    assert.equal(result.value, undefined);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ['STATE_INVALID_POSITIVE_INTEGER']);
    assert.match(formatStateDiagnostic(result.diagnostics[0]), /meta\.civilizationNumber/);
});

test('validation rejects negative and non-finite balances or counters', async () => {
    const { createFreshGameState, validateGameState } = await stateModule();
    const state = createFreshGameState();
    state.run.industrialOutput = -1;
    state.meta.aiCores = Number.POSITIVE_INFINITY;
    state.run.statistics.manualProductionActions = -2;

    const result = validateGameState(state);

    assert.equal(result.value, undefined);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), [
        '$.meta.aiCores',
        '$.run.industrialOutput',
        '$.run.statistics.manualProductionActions',
    ]);
});

test('validation rejects malformed nested collections', async () => {
    const { createFreshGameState, validateGameState } = await stateModule();
    const state = createFreshGameState();
    state.run.producers = [];
    state.run.purchasedBreakthroughIds = ['fixture_basic_automation', 'fixture_basic_automation'];
    state.meta.permanentUpgradeRanks = new Map([['fixture_upgrade', 1]]);

    const result = validateGameState(state);

    assert.equal(result.value, undefined);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
        'STATE_EXPECTED_RECORD',
        'STATE_EXPECTED_RECORD',
        'STATE_DUPLICATE_ID',
    ]);
});

test('validation rejects stored derived state fields', async () => {
    const { createFreshGameState, validateGameState } = await stateModule();
    const state = createFreshGameState();
    state.run.totalProductionPerSecond = 12;

    const result = validateGameState(state);

    assert.equal(result.value, undefined);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
        'STATE_DERIVED_FIELD',
        'STATE_UNKNOWN_FIELD',
    ]);
});

test('state modules do not import Cocos, scenes, platform providers or native bridges', async () => {
    const sourceFiles = await collectTypeScriptSources(path.join(repoRoot, 'assets', 'scripts', 'state'));

    assert.ok(sourceFiles.length > 0, 'expected state TypeScript sources');

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);

        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${relativePath} imports Cocos runtime`);
        assert.equal(/assets[\\/]scenes|assets[\\/]ui/.test(source), false, `${relativePath} imports scene or UI code`);
        assert.equal(/platform|native\.reflection|AutomataPlatformBridge|com\.google|BillingClient|MobileAds/.test(source), false, `${relativePath} imports platform/native code`);
    }
});
