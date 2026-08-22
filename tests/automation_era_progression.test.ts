const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
const runtimeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/runtime/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

let repositoryPromise;

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
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

async function freshState() {
    const { createFreshGameState } = await import(stateModuleUrl);
    return createFreshGameState();
}

async function createRuntime(initialState) {
    const repo = await repository();
    const { GameRuntime } = await import(runtimeModuleUrl);
    return new GameRuntime(repo, initialState);
}

function setProducerLevel(state, producerId, level) {
    state.run.producers[producerId] = {
        level,
        isUnlocked: level > 0,
        isBuilt: level > 0,
    };
}

function grantRobotLineConstructionRequirements(state) {
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics'];
    setProducerLevel(state, 'fabricator', 50);
    setProducerLevel(state, 'assembly_station', 25);
}

test('fresh Civilization #1 remains Manual Workshop with no unintended automation', async () => {
    const repo = await repository();
    const { calculateAutomatedProductionPerSecond, resolveEffectiveProducerAutomationState } = await import(progressionModuleUrl);
    const state = await freshState();

    assert.equal(state.meta.civilizationNumber, 1);
    assert.equal(state.run.currentEraId, 'manual_workshop');
    assert.equal(calculateAutomatedProductionPerSecond(repo, state), 0);
    assert.deepEqual(resolveEffectiveProducerAutomationState(repo, state, 'fabricator'), {
        isAutomated: false,
        isOfflineEligible: false,
        unlockedByBreakthroughId: null,
    });
});

test('Auto Feeder and Worker Bot resolve automation only through configured effects', async () => {
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    setProducerLevel(state, 'assembly_station', 10);
    state.run.industrialOutput = 76500;
    const runtime = await createRuntime(state);

    assert.equal(runtime.getAutomatedProductionPerSecond(), 0);

    const autoFeeder = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
    assert.equal(autoFeeder.ok, true);
    assert.equal(runtime.getAutomatedProductionPerSecond(), 37.5);

    const workerBot = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'worker_bot' });
    assert.equal(workerBot.ok, true);
    assert.equal(runtime.getStateSnapshot().run.automation.assembly_station.isAutomated, true);
    assert.equal(runtime.getAutomatedProductionPerSecond(), 397.5);
});

test('automation tick grants time-based production without buying strategic progression', async () => {
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    setProducerLevel(state, 'assembly_station', 10);
    state.run.industrialOutput = 1500;
    const runtime = await createRuntime(state);
    runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });

    const result = runtime.advanceAutomation(2);
    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map((event) => event.type), [
        'productionGranted',
        'industrialOutputChanged',
    ]);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.industrialOutput, 75);
    assert.equal(snapshot.run.producers.assembly_station.level, 10);
    assert.deepEqual(snapshot.run.purchasedBreakthroughIds, ['auto_feeder']);
    assert.equal(snapshot.run.currentEraId, 'manual_workshop');
});

test('non-automated producers are excluded from automation production', async () => {
    const repo = await repository();
    const { calculateAutomatedProductionPerSecond } = await import(progressionModuleUrl);
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    setProducerLevel(state, 'assembly_station', 10);

    assert.equal(calculateAutomatedProductionPerSecond(repo, state), 0);

    state.run.automation.fabricator = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'auto_feeder',
    };

    assert.equal(calculateAutomatedProductionPerSecond(repo, state), 30);
});

test('Robot Line construction is the authoritative Era II transition', async () => {
    const insufficientState = await freshState();
    grantRobotLineConstructionRequirements(insufficientState);
    insufficientState.run.industrialOutput = 499999;
    const insufficientRuntime = await createRuntime(insufficientState);

    const insufficient = insufficientRuntime.execute({ type: 'buyProducerLevels', producerId: 'robot_line', quantity: 1 });
    assert.equal(insufficient.ok, false);
    assert.equal(insufficient.reason, 'insufficient_balance');
    assert.equal(insufficientRuntime.getStateSnapshot().run.producers.robot_line, undefined);
    assert.equal(insufficientRuntime.getStateSnapshot().run.currentEraId, 'manual_workshop');

    const state = await freshState();
    grantRobotLineConstructionRequirements(state);
    state.run.industrialOutput = 500000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'buyProducerLevels', producerId: 'robot_line', quantity: 1 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map((event) => event.type), [
        'industrialOutputChanged',
        'producerLevelsPurchased',
        'producerConstructed',
        'automationStateChanged',
        'eraChanged',
    ]);
    assert.equal(result.events[1].cost, 500000);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.industrialOutput, 0);
    assert.equal(snapshot.run.currentEraId, 'automated_factory');
    assert.equal(snapshot.run.producers.robot_line.level, 1);
    assert.deepEqual(snapshot.run.automation.robot_line, {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: null,
    });
});

test('Robot Line max construction uses the authoritative Era II construction cost', async () => {
    const insufficientState = await freshState();
    grantRobotLineConstructionRequirements(insufficientState);
    insufficientState.run.industrialOutput = 499999;
    const insufficientRuntime = await createRuntime(insufficientState);

    const insufficient = insufficientRuntime.execute({ type: 'buyMaxProducerLevels', producerId: 'robot_line' });
    assert.equal(insufficient.ok, false);
    assert.equal(insufficient.reason, 'no_affordable_levels');
    assert.equal(insufficientRuntime.getStateSnapshot().run.producers.robot_line, undefined);

    const state = await freshState();
    grantRobotLineConstructionRequirements(state);
    state.run.industrialOutput = 500000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'buyMaxProducerLevels', producerId: 'robot_line' });
    assert.equal(result.ok, true);
    assert.equal(result.events[1].quantity, 1);
    assert.equal(result.events[1].cost, 500000);
    assert.equal(runtime.getStateSnapshot().run.producers.robot_line.level, 1);
    assert.equal(runtime.getStateSnapshot().run.currentEraId, 'automated_factory');
});

test('Robot Line construction does not occur automatically when requirements become reachable', async () => {
    const state = await freshState();
    grantRobotLineConstructionRequirements(state);
    state.run.industrialOutput = 100000;
    const runtime = await createRuntime(state);

    const result = runtime.advanceAutomation(60);
    assert.equal(result.ok, true);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.producers.robot_line, undefined);
    assert.equal(snapshot.run.currentEraId, 'manual_workshop');
    assert.deepEqual(snapshot.run.purchasedBreakthroughIds, ['auto_feeder', 'worker_bot', 'robotic_logistics']);
});

test('Robot Line construction remains locked before explicit construction requirements', async () => {
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 50);
    setProducerLevel(state, 'assembly_station', 25);
    state.run.industrialOutput = 50000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'buyProducerLevels', producerId: 'robot_line', quantity: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'locked_producer');
    assert.equal(runtime.getStateSnapshot().run.producers.robot_line, undefined);
});

test('Advanced Robotics reaches Era III through the configured construction and Era effects', async () => {
    const state = await freshState();
    state.run.currentEraId = 'automated_factory';
    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);
    state.run.robotsBuilt = 1000;
    state.run.industrialOutput = 1000000000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' });
    assert.equal(result.ok, true);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.currentEraId, 'robotics_complex');
    assert.equal(snapshot.run.producers.advanced_robotics_complex.level, 1);
    assert.equal(snapshot.run.automation.advanced_robotics_complex.isAutomated, true);
});

test('Era resolution is monotonic and idempotent', async () => {
    const repo = await repository();
    const { applyEraTransition } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.currentEraId = 'robotics_complex';

    const lower = applyEraTransition(repo, state, 'automated_factory');
    assert.equal(lower.changed, false);
    assert.equal(state.run.currentEraId, 'robotics_complex');

    const same = applyEraTransition(repo, state, 'robotics_complex');
    assert.equal(same.changed, false);
    assert.equal(state.run.currentEraId, 'robotics_complex');
});

test('leveling an already constructed Robot Line does not re-emit Era II transition', async () => {
    const state = await freshState();
    grantRobotLineConstructionRequirements(state);
    setProducerLevel(state, 'robot_line', 1);
    state.run.automation.robot_line = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: null,
    };
    state.run.currentEraId = 'automated_factory';
    state.run.industrialOutput = 100000;
    const runtime = await createRuntime(state);

    const result = runtime.execute({ type: 'buyProducerLevels', producerId: 'robot_line', quantity: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.events.some((event) => event.type === 'eraChanged'), false);
    assert.equal(runtime.getStateSnapshot().run.currentEraId, 'automated_factory');
});
