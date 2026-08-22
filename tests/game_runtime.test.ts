const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const economyModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/economy/index.ts')).href;
const runtimeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/runtime/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

let repositoryPromise;
let runtimeModulePromise;
let stateModulePromise;

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
}

async function runtimeModule() {
    if (runtimeModulePromise === undefined) {
        runtimeModulePromise = import(runtimeModuleUrl);
    }

    return runtimeModulePromise;
}

async function freshState() {
    if (stateModulePromise === undefined) {
        stateModulePromise = import(stateModuleUrl);
    }

    const { createFreshGameState } = await stateModulePromise;
    return createFreshGameState();
}

async function collectJsonSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectJsonSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            return [];
        }

        return [{
            filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'),
            text: await readFile(entryPath, 'utf8'),
        }];
    }));

    return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function createRuntime(initialState) {
    const repo = await repository();
    const { GameRuntime } = await runtimeModule();
    return new GameRuntime(repo, initialState);
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

function setProducerLevel(state, producerId, level) {
    state.run.producers[producerId] = {
        level,
        isUnlocked: level > 0,
        isBuilt: level > 0,
    };
}

function assertRejectedWithoutMutation(runtime, command, expectedReason) {
    const before = JSON.stringify(runtime.getStateSnapshot());
    const result = runtime.execute(command);

    assert.equal(result.ok, false);
    assert.equal(result.reason, expectedReason);
    assert.deepEqual(result.events, []);
    assert.equal(JSON.stringify(runtime.getStateSnapshot()), before);
}

test('manual production command grants one Industrial Output and emits deterministic events', async () => {
    const runtime = await createRuntime(await freshState());

    const result = runtime.execute({ type: 'manualProduce' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events, [
        {
            type: 'productionGranted',
            source: 'manual',
            amount: 1,
        },
        {
            type: 'industrialOutputChanged',
            previousAmount: 0,
            newAmount: 1,
            delta: 1,
            reason: 'manual_production',
        },
    ]);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.industrialOutput, 1);
    assert.equal(snapshot.run.statistics.industrialOutputEarned, 1);
    assert.equal(snapshot.run.statistics.manualProductionActions, 1);
    assert.equal(snapshot.lifetime.industrialOutputEarned, 1);
    assert.equal(snapshot.lifetime.manualProductionActions, 1);
});

test('runtime snapshots do not expose mutable internal state by reference', async () => {
    const runtime = await createRuntime(await freshState());
    runtime.execute({ type: 'manualProduce' });

    const snapshot = runtime.getStateSnapshot();
    snapshot.run.industrialOutput = 999;
    snapshot.run.producers.fabricator = {
        level: 100,
        isUnlocked: true,
        isBuilt: true,
    };

    const nextSnapshot = runtime.getStateSnapshot();
    assert.equal(nextSnapshot.run.industrialOutput, 1);
    assert.equal(nextSnapshot.run.producers.fabricator, undefined);
});

test('malformed and invalid commands reject deterministically without mutating state', async () => {
    const runtime = await createRuntime(await freshState());

    assertRejectedWithoutMutation(runtime, null, 'malformed_command');
    assertRejectedWithoutMutation(runtime, { type: 'missing' }, 'malformed_command');
    assertRejectedWithoutMutation(runtime, { type: 'buyProducerLevels', producerId: '', quantity: 1 }, 'invalid_producer_id');
    assertRejectedWithoutMutation(runtime, { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 0 }, 'invalid_quantity');
    assertRejectedWithoutMutation(runtime, { type: 'buyProducerLevels', producerId: 'missing', quantity: 1 }, 'invalid_producer_id');
});

test('producer level purchase deducts AUT-008 cost once and emits milestones in ascending order', async () => {
    const repo = await repository();
    const { calculateProducerPurchaseCost } = await import(economyModuleUrl);
    const state = await freshState();
    const fabricator = repo.getProducer('fabricator');
    const purchase = calculateProducerPurchaseCost(fabricator, 0, 10);
    state.run.industrialOutput = purchase.cost + 5;

    const runtime = await createRuntime(state);
    const result = runtime.execute({ type: 'buyProducerLevels', producerId: 'fabricator', quantity: 10 });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map((event) => event.type), [
        'industrialOutputChanged',
        'producerLevelsPurchased',
        'producerConstructed',
        'producerMilestoneReached',
    ]);
    assert.deepEqual(result.events.filter((event) => event.type === 'producerMilestoneReached').map((event) => event.threshold), [10]);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.industrialOutput, 5);
    assert.deepEqual(snapshot.run.producers.fabricator, {
        level: 10,
        isUnlocked: true,
        isBuilt: true,
    });
    assert.equal(snapshot.run.statistics.industrialOutputSpent, purchase.cost);
    assert.equal(snapshot.run.statistics.producerLevelsPurchased, 10);
    assert.equal(snapshot.lifetime.producerLevelsPurchased, 10);
});

test('insufficient producer purchase and unaffordable MAX leave state unchanged', async () => {
    const state = await freshState();
    state.run.industrialOutput = 9;
    const runtime = await createRuntime(state);

    assertRejectedWithoutMutation(runtime, { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 }, 'insufficient_balance');
    assertRejectedWithoutMutation(runtime, { type: 'buyMaxProducerLevels', producerId: 'fabricator' }, 'no_affordable_levels');
});

test('buy MAX purchases exactly the AUT-008 resolved quantity and cost', async () => {
    const repo = await repository();
    const { calculateMaxAffordableProducerPurchase, calculateProducerPurchaseCost } = await import(economyModuleUrl);
    const state = await freshState();
    const fabricator = repo.getProducer('fabricator');
    const seedPurchase = calculateProducerPurchaseCost(fabricator, 0, 3);
    const maxPurchase = calculateMaxAffordableProducerPurchase(fabricator, 3, 100);

    setProducerLevel(state, 'fabricator', 3);
    state.run.industrialOutput = 100;
    const runtime = await createRuntime(state);
    const result = runtime.execute({ type: 'buyMaxProducerLevels', producerId: 'fabricator' });

    assert.equal(result.ok, true);
    assert.equal(result.events.find((event) => event.type === 'producerLevelsPurchased').quantity, maxPurchase.quantity);
    assert.equal(result.events.find((event) => event.type === 'producerLevelsPurchased').cost, maxPurchase.cost);
    assert.equal(runtime.getStateSnapshot().run.producers.fabricator.level, seedPurchase.nextLevel + maxPurchase.quantity);
    assert.equal(runtime.getStateSnapshot().run.industrialOutput, 100 - maxPurchase.cost);
});

test('multi-milestone purchase event order is deterministic and ascending', async () => {
    const repo = await repository();
    const { calculateProducerPurchaseCost } = await import(economyModuleUrl);
    const state = await freshState();
    const fabricator = repo.getProducer('fabricator');
    const purchase = calculateProducerPurchaseCost(fabricator, 9, 91);

    setProducerLevel(state, 'fabricator', 9);
    state.run.industrialOutput = purchase.cost;
    const runtime = await createRuntime(state);
    const result = runtime.execute({ type: 'buyProducerLevels', producerId: 'fabricator', quantity: 91 });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.filter((event) => event.type === 'producerMilestoneReached').map((event) => event.threshold), [
        10,
        25,
        50,
        100,
    ]);
});

test('Breakthrough command reuses AUT-012 rejection and success semantics with effect events', async () => {
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 2000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events, [
        {
            type: 'industrialOutputChanged',
            previousAmount: 2000,
            newAmount: 500,
            delta: -1500,
            reason: 'breakthrough_purchase',
        },
        {
            type: 'breakthroughPurchased',
            breakthroughId: 'auto_feeder',
            cost: 1500,
        },
        {
            type: 'automationStateChanged',
            producerId: 'fabricator',
            isAutomated: true,
            isOfflineEligible: true,
            unlockedByBreakthroughId: 'auto_feeder',
        },
    ]);
    assert.deepEqual(runtime.getStateSnapshot().run.purchasedBreakthroughIds, ['auto_feeder']);

    assertRejectedWithoutMutation(runtime, { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' }, 'breakthrough_already_owned');
});

test('locked and insufficient Breakthrough commands reject with no events or state mutation', async () => {
    const lockedRuntime = await createRuntime(await freshState());
    assertRejectedWithoutMutation(lockedRuntime, { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' }, 'locked_breakthrough');

    const insufficient = await freshState();
    setProducerLevel(insufficient, 'fabricator', 15);
    insufficient.run.industrialOutput = 1499;
    const insufficientRuntime = await createRuntime(insufficient);
    assertRejectedWithoutMutation(insufficientRuntime, { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' }, 'insufficient_breakthrough_balance');
    assertRejectedWithoutMutation(insufficientRuntime, { type: 'purchaseBreakthrough', breakthroughId: 'missing' }, 'unknown_breakthrough');
});

test('Worker Bot emits progression flag and first robot events from AUT-012 effects', async () => {
    const state = await freshState();
    setProducerLevel(state, 'assembly_station', 10);
    state.run.industrialOutput = 75000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'worker_bot' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map((event) => event.type), [
        'industrialOutputChanged',
        'breakthroughPurchased',
        'automationStateChanged',
        'progressionFlagChanged',
        'firstRobotProduced',
    ]);
    assert.equal(runtime.getStateSnapshot().run.progressionFlags.first_robot, true);
});

test('construction and era effects emit descriptive events without duplicating Breakthrough effects', async () => {
    const state = await freshState();
    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);
    state.run.robotsBuilt = 1000;
    state.run.industrialOutput = 1000000000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map((event) => event.type), [
        'industrialOutputChanged',
        'breakthroughPurchased',
        'producerConstructed',
        'eraChanged',
    ]);
    assert.equal(runtime.getStateSnapshot().run.producers.advanced_robotics_complex.level, 1);
    assert.equal(runtime.getStateSnapshot().run.currentEraId, 'robotics_complex');
});

test('fresh Civilization #1 micro-run reaches first milestone and Auto Feeder through runtime commands only', async () => {
    const runtime = await createRuntime(await freshState());

    for (let index = 0; index < 2000; index += 1) {
        const manual = runtime.execute({ type: 'manualProduce' });
        assert.equal(manual.ok, true);
    }

    const buy = runtime.execute({ type: 'buyProducerLevels', producerId: 'fabricator', quantity: 15 });
    assert.equal(buy.ok, true);
    assert.deepEqual(buy.events.filter((event) => event.type === 'producerMilestoneReached').map((event) => event.threshold), [10]);

    const breakthrough = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
    assert.equal(breakthrough.ok, true);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.producers.fabricator.level, 15);
    assert.deepEqual(snapshot.run.purchasedBreakthroughIds, ['auto_feeder']);
    assert.equal(snapshot.run.automation.fabricator.isAutomated, true);
});

test('runtime production query composes milestones and Breakthrough ModifierSet without frame assumptions', async () => {
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 1500;
    const runtime = await createRuntime(state);

    assert.equal(runtime.getProductionPerSecond(), 30);
    runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
    assert.equal(runtime.getProductionPerSecond(), 37.5);
    assert.equal(runtime.calculateProductionForElapsedSeconds(2.5), 93.75);
});

test('runtime modules stay pure TypeScript without Cocos, scene, UI, platform or native imports', async () => {
    const sourceRoots = [
        path.join(repoRoot, 'assets', 'scripts', 'domain'),
        path.join(repoRoot, 'assets', 'scripts', 'runtime'),
    ];

    const sourceFiles = (await Promise.all(sourceRoots.map(collectTypeScriptSources))).flat();
    assert.ok(sourceFiles.length > 0, 'expected runtime TypeScript sources');

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);

        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${relativePath} imports Cocos runtime`);
        assert.equal(/assets[\\/]scenes|assets[\\/]ui/.test(source), false, `${relativePath} imports scene or UI code`);
        assert.equal(/platform|services|native\.reflection|AutomataPlatformBridge|com\.google|BillingClient|MobileAds/.test(source), false, `${relativePath} imports platform/native code`);
    }
});
