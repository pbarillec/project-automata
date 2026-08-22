const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const runtimeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/runtime/index.ts')).href;
const simulationModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/simulation/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

let repositoryPromise;
let runtimeModulePromise;
let simulationModulePromise;
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

async function simulationModule() {
    if (simulationModulePromise === undefined) {
        simulationModulePromise = import(simulationModuleUrl);
    }

    return simulationModulePromise;
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

function setProducerLevel(state, producerId, level) {
    state.run.producers[producerId] = {
        level,
        isUnlocked: level > 0,
        isBuilt: level > 0,
    };
}

function summarizeReport(report) {
    return {
        finalSummary: report.finalSummary,
        checkpoints: report.checkpoints.map((checkpoint) => ({
            id: checkpoint.id,
            timeSeconds: checkpoint.observation.timeSeconds,
            producerLevels: checkpoint.observation.producerLevels,
            eraId: checkpoint.observation.eraId,
            prestigePower: checkpoint.observation.prestigePower,
            projectedAiCoreReward: checkpoint.observation.projectedAiCoreReward,
        })),
    };
}

test('advanceActiveSession uses the real runtime production path for active elapsed seconds', async () => {
    const repo = await repository();
    const { GameRuntime } = await runtimeModule();
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 10);

    const runtime = new GameRuntime(repo, state);
    const result = runtime.execute({ type: 'advanceActiveSession', elapsedSeconds: 3 });

    assert.equal(result.ok, true);
    assert.equal(runtime.getStateSnapshot().run.industrialOutput, 60);
    assert.deepEqual(result.events.map((event) => event.type), [
        'productionGranted',
        'industrialOutputChanged',
    ]);
});

test('headless simulator advances active time equivalently to direct GameRuntime commands', async () => {
    const repo = await repository();
    const { GameRuntime } = await runtimeModule();
    const { HeadlessSimulator } = await simulationModule();
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 10);

    const runtime = new GameRuntime(repo, state);
    const simulator = new HeadlessSimulator(repo, { initialState: state });

    const direct = runtime.advanceActiveSession(7.5);
    const simulated = simulator.advanceTime(7.5);

    assert.equal(direct.ok, true);
    assert.equal(simulated.ok, true);
    assert.deepEqual(simulator.getStateSnapshot(), runtime.getStateSnapshot());
    assert.equal(simulator.simulatedTimeSeconds, 7.5);
});

test('advanceUntil reaches deterministic conditions and fails explicitly when guards exhaust', async () => {
    const repo = await repository();
    const { HeadlessSimulator, SimulationGuardError } = await simulationModule();
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 10);
    const simulator = new HeadlessSimulator(repo, { initialState: state });

    const result = simulator.advanceUntil(
        (snapshot) => snapshot.state.run.industrialOutput >= 100,
        {
            maxSimulatedSeconds: 10,
            maxIterations: 10,
            stepSeconds: 1,
        },
    );

    assert.equal(result.reached, true);
    assert.equal(simulator.getStateSnapshot().run.industrialOutput, 100);
    assert.throws(() => simulator.advanceUntil(
        () => false,
        {
            maxSimulatedSeconds: 1,
            maxIterations: 1,
            stepSeconds: 1,
        },
    ), SimulationGuardError);
});

test('Civilization #1 active reference scenario reaches all major checkpoints once', async () => {
    const repo = await repository();
    const { PRESTIGE_FRONTIER_LEVEL, runCivilizationOneActiveReferenceScenario } = await simulationModule();
    const { report } = runCivilizationOneActiveReferenceScenario(repo);
    const expectedCheckpointIds = [
        'fabricator_level_10',
        'auto_feeder',
        'assembly_station',
        'worker_bot',
        'robotic_logistics',
        'robot_line_era_ii',
        'factory_control_system',
        'automated_cell',
        'robotics_complex_era_iii',
        'prestige_frontier',
    ];

    assert.deepEqual(report.checkpoints.map((checkpoint) => checkpoint.id), expectedCheckpointIds);
    assert.equal(new Set(report.checkpoints.map((checkpoint) => checkpoint.id)).size, report.checkpoints.length);
    assert.equal(report.finalSummary.eraId, 'robotics_complex');
    assert.equal(report.finalSummary.producerLevels.advanced_robotics_complex, PRESTIGE_FRONTIER_LEVEL);
    assert.equal(report.finalSummary.purchasedBreakthroughIds.includes('advanced_robotics'), true);
    assert.equal(report.finalSummary.projectedAiCoreReward, 5);
    assert.equal(report.finalSummary.prestigePower, report.finalSummary.productionPerSecond);
});

test('reference scenario is reproducible for identical inputs', async () => {
    const repo = await repository();
    const { runCivilizationOneActiveReferenceScenario } = await simulationModule();

    const first = runCivilizationOneActiveReferenceScenario(repo).report;
    const second = runCivilizationOneActiveReferenceScenario(repo).report;

    assert.deepEqual(summarizeReport(second), summarizeReport(first));
});

test('reference scenario is materially invariant to deterministic wait partition changes', async () => {
    const repo = await repository();
    const { runCivilizationOneActiveReferenceScenario } = await simulationModule();

    const sixtySecond = runCivilizationOneActiveReferenceScenario(repo, { maxWaitStepSeconds: 60 }).report;
    const thirtySecond = runCivilizationOneActiveReferenceScenario(repo, { maxWaitStepSeconds: 30 }).report;

    assert.equal(thirtySecond.finalSummary.eraId, sixtySecond.finalSummary.eraId);
    assert.deepEqual(thirtySecond.finalSummary.producerLevels, sixtySecond.finalSummary.producerLevels);
    assert.deepEqual(
        thirtySecond.checkpoints.map((checkpoint) => checkpoint.id),
        sixtySecond.checkpoints.map((checkpoint) => checkpoint.id),
    );
    assert.ok(
        Math.abs(thirtySecond.finalSummary.prestigePower - sixtySecond.finalSummary.prestigePower) <= 1e-6,
        'Prestige Power should not depend on wait partition.',
    );
    assert.ok(
        Math.abs(thirtySecond.finalSummary.simulatedActiveSeconds - sixtySecond.finalSummary.simulatedActiveSeconds) <= 300,
        'Active timing should remain within one Free Overclock cycle.',
    );
});

test('Free Overclock production does not inflate recorded Prestige Power', async () => {
    const repo = await repository();
    const { runCivilizationOneActiveReferenceScenario } = await simulationModule();
    const { report } = runCivilizationOneActiveReferenceScenario(repo);

    assert.ok(
        report.events.some((entry) => entry.event.type === 'temporaryBoostActivated' && entry.event.boostId === 'free_overclock'),
        'reference scenario should use the real Free Overclock command after unlock',
    );
    assert.ok(
        report.observations.some((observation) => observation.productionPerSecond > observation.prestigePower),
        'at least one boosted observation should show online production above prestige power',
    );
    assert.equal(report.finalSummary.prestigePower, 100690200);
    assert.equal(report.finalSummary.projectedAiCoreReward, 5);
});
