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
let progressionModulePromise;
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

async function progressionModule() {
    if (progressionModulePromise === undefined) {
        progressionModulePromise = import(progressionModuleUrl);
    }

    return progressionModulePromise;
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

test('AI Core reward and required Prestige Power use authoritative square-root formulas', async () => {
    const {
        calculateAiCoreReward,
        calculateRequiredPrestigePowerForAiCores,
        calculateNextAiCoreProgress,
    } = await progressionModule();
    const p0 = 100000000;

    assert.equal(calculateAiCoreReward(0, p0), 0);
    assert.deepEqual([
        [1, 5],
        [2, 7],
        [4, 10],
        [9, 15],
        [16, 20],
        [25, 25],
        [100, 50],
    ].map(([multiple, reward]) => [multiple, calculateAiCoreReward(p0 * multiple, p0), reward]), [
        [1, 5, 5],
        [2, 7, 7],
        [4, 10, 10],
        [9, 15, 15],
        [16, 20, 20],
        [25, 25, 25],
        [100, 50, 50],
    ]);

    assert.equal(calculateRequiredPrestigePowerForAiCores(5, p0), p0);
    assert.equal(calculateRequiredPrestigePowerForAiCores(10, p0), p0 * 4);
    assert.equal(calculateRequiredPrestigePowerForAiCores(25, p0), p0 * 25);
    assert.deepEqual(calculateNextAiCoreProgress(p0, p0), {
        currentAiCoreReward: 5,
        nextAiCoreReward: 6,
        previousCoreRequiredPrestigePower: p0,
        nextCoreRequiredPrestigePower: p0 * (6 / 5) ** 2,
        remainingPrestigePowerForNextCore: p0 * (6 / 5) ** 2 - p0,
        progressToNextCore: 0,
    });
});

test('invalid prestige formula inputs fail instead of propagating NaN or Infinity', async () => {
    const {
        calculateAiCoreReward,
        calculateRequiredPrestigePowerForAiCores,
        calculateUpdatedPrestigePowerPeak,
    } = await progressionModule();

    assert.throws(() => calculateAiCoreReward(1, 0), /p0PrestigePower must be a positive finite number/);
    assert.throws(() => calculateAiCoreReward(Number.NaN, 1), /prestigePower must be a non-negative finite number/);
    assert.throws(() => calculateAiCoreReward(-1, 1), /prestigePower must be a non-negative finite number/);
    assert.throws(() => calculateRequiredPrestigePowerForAiCores(-1, 1), /targetAiCoreReward must be a non-negative safe integer/);
    assert.throws(() => calculateUpdatedPrestigePowerPeak(Number.POSITIVE_INFINITY, 1), /storedPrestigePowerPeak must be a non-negative finite number/);
});

test('prestige eligible production excludes temporary boosts but includes durable progression modifiers', async () => {
    const repo = await repository();
    const {
        activateFreeOverclock,
        calculateCurrentPrestigeEligibleProductionPerSecond,
        calculateOnlineProductionPerSecond,
        activateTemporaryProductionBoost,
    } = await progressionModule();
    const state = await freshState();

    setProducerLevel(state, 'fabricator', 25);
    setProducerLevel(state, 'assembly_station', 10);
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics'];
    state.meta.permanentUpgradeRanks = {
        optimized_fabrication: 1,
        industrial_scaling: 1,
    };

    const baseEligible = calculateCurrentPrestigeEligibleProductionPerSecond(repo, state);
    assert.equal(baseEligible, 25 * 2.2 * 2.2 * 1.25 * 2 * 1.25 + 10 * 12 * 2.2 * 1.5 * 2 * 1.25);

    const boostResult = activateTemporaryProductionBoost(state.boosts, {
        boostId: 'fixture_factory_surge',
        multiplier: 2,
        durationSeconds: 600,
        source: 'test',
    });
    assert.equal(boostResult.status, 'activated');
    state.boosts = boostResult.boosts;

    assert.equal(calculateCurrentPrestigeEligibleProductionPerSecond(repo, state), baseEligible);
    assert.equal(calculateOnlineProductionPerSecond(repo, state), baseEligible * 2);

    const freeOverclockState = await freshState();
    setProducerLevel(freeOverclockState, 'fabricator', 10);
    freeOverclockState.run.progressionFlags.first_robot = true;
    const freeOverclockInactiveEligible = calculateCurrentPrestigeEligibleProductionPerSecond(repo, freeOverclockState);
    const freeOverclockResult = activateFreeOverclock(freeOverclockState);
    assert.equal(freeOverclockResult.status, 'activated');
    freeOverclockState.boosts = freeOverclockResult.boosts;
    assert.equal(calculateCurrentPrestigeEligibleProductionPerSecond(repo, freeOverclockState), freeOverclockInactiveEligible);
    assert.equal(calculateOnlineProductionPerSecond(repo, freeOverclockState), freeOverclockInactiveEligible * 2);
});

test('runtime peak tracking is monotonic and ignores boost-only state changes', async () => {
    const repo = await repository();
    const { GameRuntime } = await import(runtimeModuleUrl);
    const { calculateProducerPurchaseCost } = await import(economyModuleUrl);
    const state = await freshState();
    const fabricator = repo.getProducer('fabricator');
    state.run.industrialOutput = calculateProducerPurchaseCost(fabricator, 0, 10).cost;

    const runtime = new GameRuntime(repo, state);
    const buyLevel10 = runtime.execute({ type: 'buyProducerLevels', producerId: 'fabricator', quantity: 10 });
    assert.equal(buyLevel10.ok, true);
    assert.equal(runtime.getStateSnapshot().run.prestigePowerPeak, 20);

    const snapshotWithHigherPeak = runtime.getStateSnapshot();
    snapshotWithHigherPeak.run.prestigePowerPeak = 999;
    snapshotWithHigherPeak.run.industrialOutput = calculateProducerPurchaseCost(fabricator, 10, 1).cost;
    const highPeakRuntime = new GameRuntime(repo, snapshotWithHigherPeak);
    const buyLevel11 = highPeakRuntime.execute({ type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 });
    assert.equal(buyLevel11.ok, true);
    assert.equal(highPeakRuntime.getStateSnapshot().run.prestigePowerPeak, 999);

    const boostState = await freshState();
    setProducerLevel(boostState, 'fabricator', 10);
    boostState.run.progressionFlags.first_robot = true;
    const boostRuntime = new GameRuntime(repo, boostState);
    const boostActivation = boostRuntime.execute({ type: 'activateFreeOverclock' });
    assert.equal(boostActivation.ok, true);
    assert.equal(boostRuntime.getProductionPerSecond(), 40);
    assert.equal(boostRuntime.getStateSnapshot().run.prestigePowerPeak, 0);
});

test('prestige preview is pure and uses stored peak with repository P0', async () => {
    const repo = await repository();
    const { createPrestigePreview } = await progressionModule();
    const state = await freshState();
    setProducerLevel(state, 'advanced_robotics_complex', 25);
    state.run.prestigePowerPeak = repo.getPrestigeConfig().p0PrestigePower;
    const before = JSON.stringify(state);

    const preview = createPrestigePreview(repo, state);

    assert.equal(preview.currentPrestigePower, repo.getPrestigeConfig().p0PrestigePower);
    assert.equal(preview.currentAiCoreReward, 5);
    assert.equal(preview.nextAiCoreReward, 6);
    assert.equal(preview.currentEligibleProductionPerSecond, 500000 * 25 * 4);
    assert.equal(preview.p0PrestigePower, repo.getPrestigeConfig().p0PrestigePower);
    assert.equal(JSON.stringify(state), before);
});
