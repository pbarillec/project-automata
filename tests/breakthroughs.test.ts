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

function setProducerLevel(state, producerId, level) {
    state.run.producers[producerId] = {
        level,
        isUnlocked: level > 0,
        isBuilt: level > 0,
    };
}

test('Auto Feeder distinguishes locked, insufficient and successful purchase states', async () => {
    const repo = await repository();
    const { evaluateBreakthroughEligibility, purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 1500;
    setProducerLevel(state, 'fabricator', 14);

    const lockedBefore = JSON.stringify(state);
    const lockedPurchase = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(lockedPurchase.status, 'locked');
    assert.equal(lockedPurchase.lockedRequirements[0].requirement.type, 'producerLevel');
    assert.equal(lockedPurchase.lockedRequirements[0].currentValue, 14);
    assert.equal(JSON.stringify(state), lockedBefore);

    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 1499;
    const eligible = evaluateBreakthroughEligibility(repo, state, 'auto_feeder');
    assert.equal(eligible.status, 'eligible');
    assert.equal(eligible.isAffordable, false);

    const insufficientBefore = JSON.stringify(state);
    const insufficientPurchase = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.deepEqual(insufficientPurchase, {
        status: 'insufficient_balance',
        breakthroughId: 'auto_feeder',
        cost: 1500,
        balance: 1499,
    });
    assert.equal(JSON.stringify(state), insufficientBefore);

    state.run.industrialOutput = 2000;
    const success = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(success.status, 'success');
    assert.equal(success.cost, 1500);
    assert.equal(success.state.run.industrialOutput, 500);
    assert.deepEqual(success.state.run.purchasedBreakthroughIds, ['auto_feeder']);
    assert.deepEqual(success.state.run.automation.fabricator, {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'auto_feeder',
    });
    assert.equal(success.state.run.statistics.industrialOutputSpent, 1500);
    assert.equal(success.state.run.statistics.breakthroughsPurchased, 1);
    assert.equal(success.state.lifetime.breakthroughsPurchased, 1);
});

test('duplicate purchase never deducts currency or reapplies effects', async () => {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 2000;
    setProducerLevel(state, 'fabricator', 15);

    const first = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(first.status, 'success');
    first.state.run.industrialOutput = 1000000;

    const beforeDuplicate = JSON.stringify(first.state);
    const duplicate = purchaseBreakthrough(repo, first.state, 'auto_feeder');

    assert.deepEqual(duplicate, {
        status: 'already_owned',
        breakthroughId: 'auto_feeder',
    });
    assert.equal(JSON.stringify(first.state), beforeDuplicate);
});

test('Worker Bot applies assembly automation, production modifier and First Robot flag', async () => {
    const repo = await repository();
    const { calculateModifiedProducerOutput } = await import(economyModuleUrl);
    const { createBreakthroughModifierSet, purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 75000;
    setProducerLevel(state, 'assembly_station', 10);

    const result = purchaseBreakthrough(repo, state, 'worker_bot');
    assert.equal(result.status, 'success');
    assert.deepEqual(result.state.run.automation.assembly_station, {
        isAutomated: true,
        isOfflineEligible: false,
        unlockedByBreakthroughId: 'worker_bot',
    });
    assert.equal(result.state.run.progressionFlags.first_robot, true);

    const modifierSet = createBreakthroughModifierSet(repo, result.state);
    assert.equal(calculateModifiedProducerOutput(repo.getProducer('assembly_station'), 10, modifierSet), 180);
});

test('Robotic Logistics requires Worker Bot plus both producer level thresholds', async () => {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 250000;
    setProducerLevel(state, 'fabricator', 25);
    setProducerLevel(state, 'assembly_station', 14);

    const locked = purchaseBreakthrough(repo, state, 'robotic_logistics');
    assert.equal(locked.status, 'locked');
    assert.deepEqual(locked.lockedRequirements.map((item) => item.requirement), [
        { type: 'breakthroughOwned', breakthroughId: 'worker_bot' },
        { type: 'producerLevel', producerId: 'assembly_station', level: 15 },
    ]);

    state.run.purchasedBreakthroughIds.push('worker_bot');
    setProducerLevel(state, 'assembly_station', 15);
    const success = purchaseBreakthrough(repo, state, 'robotic_logistics');
    assert.equal(success.status, 'success');
    assert.deepEqual(success.state.run.purchasedBreakthroughIds, ['worker_bot', 'robotic_logistics']);
});

test('Factory Control uses robots built requirement and global ModifierSet effect', async () => {
    const repo = await repository();
    const { calculateModifiedProducerOutput, resolveEffectiveProductionModifiers } = await import(economyModuleUrl);
    const { createBreakthroughModifierSet, purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 3000000;
    state.run.robotsBuilt = 9;
    setProducerLevel(state, 'robot_line', 10);

    const locked = purchaseBreakthrough(repo, state, 'factory_control_system');
    assert.equal(locked.status, 'locked');
    assert.deepEqual(locked.lockedRequirements.map((item) => item.requirement), [
        { type: 'robotsBuilt', count: 10 },
    ]);

    state.run.robotsBuilt = 10;
    const success = purchaseBreakthrough(repo, state, 'factory_control_system');
    assert.equal(success.status, 'success');

    const modifierSet = createBreakthroughModifierSet(repo, success.state);
    assert.equal(resolveEffectiveProductionModifiers(modifierSet).globalMultiplier, 2);
    assert.equal(calculateModifiedProducerOutput(repo.getProducer('robot_line'), 10, modifierSet), 3000);
});

test('construction effects create Level 1 producers without charging producer base cost or reducing existing levels', async () => {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 25000000;
    state.run.robotsBuilt = 100;
    setProducerLevel(state, 'robot_line', 25);

    const result = purchaseBreakthrough(repo, state, 'automated_cell_architecture');
    assert.equal(result.status, 'success');
    assert.equal(result.state.run.industrialOutput, 0);
    assert.deepEqual(result.state.run.producers.automated_cell, {
        level: 1,
        isUnlocked: true,
        isBuilt: true,
    });

    const alreadyBuilt = await freshState();
    alreadyBuilt.run.industrialOutput = 25000000;
    alreadyBuilt.run.robotsBuilt = 100;
    setProducerLevel(alreadyBuilt, 'robot_line', 25);
    setProducerLevel(alreadyBuilt, 'automated_cell', 5);

    const secondResult = purchaseBreakthrough(repo, alreadyBuilt, 'automated_cell_architecture');
    assert.equal(secondResult.status, 'success');
    assert.equal(secondResult.state.run.producers.automated_cell.level, 5);
});

test('Advanced Robotics constructs the complex at Level 1 and applies the explicit era transition', async () => {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    state.run.industrialOutput = 1000000000;
    state.run.robotsBuilt = 1000;
    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);

    const result = purchaseBreakthrough(repo, state, 'advanced_robotics');
    assert.equal(result.status, 'success');
    assert.deepEqual(result.state.run.producers.advanced_robotics_complex, {
        level: 1,
        isUnlocked: true,
        isBuilt: true,
    });
    assert.equal(result.state.run.currentEraId, 'robotics_complex');
});

test('all six standard run breakthroughs can purchase from data-defined baselines', async () => {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    let state = await freshState();

    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 1500;
    let result = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(result.status, 'success');
    state = result.state;

    setProducerLevel(state, 'assembly_station', 10);
    state.run.industrialOutput = 75000;
    result = purchaseBreakthrough(repo, state, 'worker_bot');
    assert.equal(result.status, 'success');
    state = result.state;

    setProducerLevel(state, 'fabricator', 25);
    setProducerLevel(state, 'assembly_station', 15);
    state.run.industrialOutput = 250000;
    result = purchaseBreakthrough(repo, state, 'robotic_logistics');
    assert.equal(result.status, 'success');
    state = result.state;

    setProducerLevel(state, 'robot_line', 10);
    state.run.robotsBuilt = 10;
    state.run.industrialOutput = 3000000;
    result = purchaseBreakthrough(repo, state, 'factory_control_system');
    assert.equal(result.status, 'success');
    state = result.state;

    setProducerLevel(state, 'robot_line', 25);
    state.run.robotsBuilt = 100;
    state.run.industrialOutput = 25000000;
    result = purchaseBreakthrough(repo, state, 'automated_cell_architecture');
    assert.equal(result.status, 'success');
    state = result.state;

    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);
    state.run.robotsBuilt = 1000;
    state.run.industrialOutput = 1000000000;
    result = purchaseBreakthrough(repo, state, 'advanced_robotics');
    assert.equal(result.status, 'success');
    state = result.state;

    assert.deepEqual(state.run.purchasedBreakthroughIds, [
        'auto_feeder',
        'worker_bot',
        'robotic_logistics',
        'factory_control_system',
        'automated_cell_architecture',
        'advanced_robotics',
    ]);
    assert.equal(state.run.currentEraId, 'robotics_complex');
    assert.equal(state.run.producers.automated_cell.level, 25);
    assert.equal(state.run.producers.advanced_robotics_complex.level, 1);
});
