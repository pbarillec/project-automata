const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const economyModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/economy/index.ts')).href;
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
const runtimeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/runtime/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

let repositoryPromise;
let economyModulePromise;

async function economyModule() {
    if (economyModulePromise === undefined) {
        economyModulePromise = import(economyModuleUrl);
    }

    return economyModulePromise;
}

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

async function assertBreakthroughEligible(state, breakthroughId) {
    const repo = await repository();
    const { evaluateBreakthroughEligibility } = await import(progressionModuleUrl);
    const eligibility = evaluateBreakthroughEligibility(repo, state, breakthroughId);
    assert.equal(eligibility.status, 'eligible');
    assert.deepEqual(eligibility.lockedRequirements, []);
    assert.equal(eligibility.isAffordable, true);
}

test('Robots Built rate is exactly 0.005 times Robot Line level for representative levels', async () => {
    const { calculateRobotsBuiltPerSecond } = await economyModule();

    assert.equal(calculateRobotsBuiltPerSecond(0), 0);
    assert.equal(calculateRobotsBuiltPerSecond(1), 0.005);
    assert.equal(calculateRobotsBuiltPerSecond(10), 0.05);
    assert.equal(calculateRobotsBuiltPerSecond(25), 0.125);
    assert.equal(calculateRobotsBuiltPerSecond(50), 0.25);
    assert.equal(calculateRobotsBuiltPerSecond(100), 0.5);
});

test('elapsed Robots Built calculation multiplies rate by elapsed seconds without rounding', async () => {
    const {
        calculateRobotsBuiltForElapsedSeconds,
        calculateRobotsBuiltFromRobotLineElapsedSeconds,
    } = await economyModule();

    assert.equal(calculateRobotsBuiltForElapsedSeconds(0.05, 0), 0);
    assert.equal(calculateRobotsBuiltForElapsedSeconds(0.05, 20), 1);
    assert.equal(calculateRobotsBuiltForElapsedSeconds(0.125, 2.5), 0.3125);
    assert.equal(calculateRobotsBuiltFromRobotLineElapsedSeconds(25, 800), 100);
});

test('Robots Built partitioning is equivalent within documented tolerance', async () => {
    const {
        calculateRobotsBuiltForElapsedSeconds,
        isRobotsBuiltApproximatelyEqual,
    } = await economyModule();
    const rate = 0.005 * 37;

    const singleStep = calculateRobotsBuiltForElapsedSeconds(rate, 600);
    const tenSteps = Array.from({ length: 10 }, () => calculateRobotsBuiltForElapsedSeconds(rate, 60))
        .reduce((sum, built) => sum + built, 0);
    const unevenSteps = [0.1, 0.2, 1.7, 13, 585]
        .map((seconds) => calculateRobotsBuiltForElapsedSeconds(rate, seconds))
        .reduce((sum, built) => sum + built, 0);

    assert.equal(isRobotsBuiltApproximatelyEqual(singleStep, tenSteps), true);
    assert.equal(isRobotsBuiltApproximatelyEqual(singleStep, unevenSteps), true);
});

test('invalid Robots Built inputs fail deterministically', async () => {
    const {
        RobotsBuiltInputError,
        calculateRobotsBuiltForElapsedSeconds,
        calculateRobotsBuiltPerSecond,
        resolveCrossedRobotsBuiltThresholds,
    } = await economyModule();

    assert.throws(() => calculateRobotsBuiltPerSecond(-1), RobotsBuiltInputError);
    assert.throws(() => calculateRobotsBuiltPerSecond(1.5), /non-negative safe integer/);
    assert.throws(() => calculateRobotsBuiltPerSecond(Number.POSITIVE_INFINITY), /non-negative safe integer/);
    assert.throws(() => calculateRobotsBuiltForElapsedSeconds(-1, 1), /non-negative finite number/);
    assert.throws(() => calculateRobotsBuiltForElapsedSeconds(Number.NaN, 1), /non-negative finite number/);
    assert.throws(() => calculateRobotsBuiltForElapsedSeconds(1, -1), /non-negative finite number/);
    assert.throws(() => calculateRobotsBuiltForElapsedSeconds(1, Number.POSITIVE_INFINITY), /non-negative finite number/);
    assert.throws(() => calculateRobotsBuiltForElapsedSeconds(Number.MAX_VALUE, 2), /exceeds JavaScript Number range/);
    assert.throws(() => resolveCrossedRobotsBuiltThresholds(10, 9), /greater than or equal/);
});

test('runtime advances authoritative fractional Robots Built from Robot Line level', async () => {
    const state = await freshState();
    setProducerLevel(state, 'robot_line', 25);
    state.run.currentEraId = 'automated_factory';
    const runtime = await createRuntime(state);

    assert.equal(runtime.getRobotsBuiltPerSecond(), 0.125);
    assert.equal(runtime.calculateRobotsBuiltForElapsedSeconds(2.5), 0.3125);

    const result = runtime.advanceAutomation(2.5);
    assert.equal(result.ok, true);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.robotsBuilt, 0.3125);
    assert.equal(snapshot.run.statistics.robotsBuiltPeak, 0.3125);
    assert.equal(snapshot.lifetime.robotsBuilt, 0.3125);
});

test('runtime Robots Built accumulation is deterministic across tick partitions', async () => {
    const { isRobotsBuiltApproximatelyEqual } = await economyModule();
    const singleState = await freshState();
    const partitionedState = await freshState();
    setProducerLevel(singleState, 'robot_line', 50);
    setProducerLevel(partitionedState, 'robot_line', 50);

    const singleRuntime = await createRuntime(singleState);
    const partitionedRuntime = await createRuntime(partitionedState);

    singleRuntime.advanceAutomation(4000);
    for (const seconds of [0.1, 0.2, 1.7, 13, 45, 3940]) {
        partitionedRuntime.advanceAutomation(seconds);
    }

    assert.equal(isRobotsBuiltApproximatelyEqual(
        singleRuntime.getStateSnapshot().run.robotsBuilt,
        partitionedRuntime.getStateSnapshot().run.robotsBuilt,
    ), true);
});

test('invalid runtime elapsed time and invalid Robot Line levels leave state unchanged', async () => {
    const invalidElapsedRuntime = await createRuntime(await freshState());
    const invalidElapsedBefore = JSON.stringify(invalidElapsedRuntime.getStateSnapshot());
    const invalidElapsed = invalidElapsedRuntime.advanceAutomation(-1);
    assert.equal(invalidElapsed.ok, false);
    assert.equal(invalidElapsed.reason, 'invalid_elapsed_seconds');
    assert.equal(JSON.stringify(invalidElapsedRuntime.getStateSnapshot()), invalidElapsedBefore);

    const invalidLevelState = await freshState();
    setProducerLevel(invalidLevelState, 'robot_line', Number.MAX_SAFE_INTEGER + 1);
    const invalidLevelRuntime = await createRuntime(invalidLevelState);
    const invalidLevelBefore = JSON.stringify(invalidLevelRuntime.getStateSnapshot());
    const invalidLevel = invalidLevelRuntime.advanceAutomation(1);
    assert.equal(invalidLevel.ok, false);
    assert.equal(invalidLevel.reason, 'execution_error');
    assert.equal(JSON.stringify(invalidLevelRuntime.getStateSnapshot()), invalidLevelBefore);
});

test('crossing Robots Built thresholds emits threshold events without automatic Breakthrough purchase', async () => {
    const state = await freshState();
    setProducerLevel(state, 'robot_line', 10);
    state.run.currentEraId = 'automated_factory';
    state.run.industrialOutput = 3000000;
    const runtime = await createRuntime(state);

    const result = runtime.advanceAutomation(200);
    assert.equal(result.ok, true);
    assert.deepEqual(result.events.filter((event) => event.type === 'robotsBuiltThresholdReached'), [
        {
            type: 'robotsBuiltThresholdReached',
            threshold: 1,
            previousAmount: 0,
            newAmount: 10,
        },
        {
            type: 'robotsBuiltThresholdReached',
            threshold: 10,
            previousAmount: 0,
            newAmount: 10,
        },
    ]);

    const snapshot = runtime.getStateSnapshot();
    assert.equal(snapshot.run.robotsBuilt, 10);
    assert.deepEqual(snapshot.run.purchasedBreakthroughIds, []);
    await assertBreakthroughEligible(snapshot, 'factory_control_system');
});

test('Breakthrough requirements observe accumulated Robots Built at 100 and 1000 thresholds', async () => {
    const automatedCellState = await freshState();
    setProducerLevel(automatedCellState, 'robot_line', 25);
    automatedCellState.run.currentEraId = 'automated_factory';
    automatedCellState.run.industrialOutput = 25000000;
    const automatedCellRuntime = await createRuntime(automatedCellState);
    automatedCellRuntime.advanceAutomation(800);
    const automatedCellSnapshot = automatedCellRuntime.getStateSnapshot();
    assert.equal(automatedCellSnapshot.run.robotsBuilt, 100);
    assert.deepEqual(automatedCellSnapshot.run.purchasedBreakthroughIds, []);
    await assertBreakthroughEligible(automatedCellSnapshot, 'automated_cell_architecture');

    const advancedState = await freshState();
    setProducerLevel(advancedState, 'robot_line', 50);
    setProducerLevel(advancedState, 'automated_cell', 25);
    advancedState.run.currentEraId = 'automated_factory';
    advancedState.run.industrialOutput = 1000000000;
    const advancedRuntime = await createRuntime(advancedState);
    advancedRuntime.advanceAutomation(4000);
    const advancedSnapshot = advancedRuntime.getStateSnapshot();
    assert.equal(advancedSnapshot.run.robotsBuilt, 1000);
    assert.deepEqual(advancedSnapshot.run.purchasedBreakthroughIds, []);
    await assertBreakthroughEligible(advancedSnapshot, 'advanced_robotics');
});
