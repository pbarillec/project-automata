const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
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

test('fresh Civilization #1 resolves deterministic initial Fabricator construction without mutating state', async () => {
    const repo = await repository();
    const { resolveNextGoal } = await progressionModule();
    const state = await freshState();
    const before = JSON.stringify(state);

    const first = resolveNextGoal(repo, state);
    const second = resolveNextGoal(repo, state);

    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(state), before);
    assert.equal(first.category, 'producer_build');
    assert.equal(first.id, 'producer_build:fabricator:level_1');
    assert.deepEqual(first.focusTarget, { kind: 'producer', producerId: 'fabricator' });
    assert.equal(first.affordability.state, 'unaffordable');
    assert.equal(first.affordability.cost, 10);
    assert.equal(first.blocking.state, 'unblocked');
});

test('early first-run resolver advances from Fabricator milestone to Auto Feeder to Assembly', async () => {
    const repo = await repository();
    const { resolveNextGoal } = await progressionModule();
    const state = await freshState();

    setProducerLevel(state, 'fabricator', 1);
    let goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'producer_milestone');
    assert.equal(goal.id, 'producer_milestone:fabricator:level_10');
    assert.equal(goal.progress.currentValue, 1);
    assert.equal(goal.progress.requiredValue, 10);

    setProducerLevel(state, 'fabricator', 10);
    goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'breakthrough');
    assert.equal(goal.id, 'breakthrough:auto_feeder');
    assert.equal(goal.eligibilityStatus, 'locked');
    assert.equal(goal.blocking.state, 'requirement_locked');
    assert.deepEqual(goal.blocking.requirements, [
        { type: 'producerLevel', producerId: 'fabricator', requiredLevel: 15, currentLevel: 10 },
    ]);

    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 1500;
    goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'breakthrough');
    assert.equal(goal.eligibilityStatus, 'eligible');
    assert.equal(goal.affordability.state, 'affordable');

    state.run.purchasedBreakthroughIds.push('auto_feeder');
    state.run.industrialOutput = 0;
    goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'producer_build');
    assert.equal(goal.id, 'producer_build:assembly_station:level_1');
    assert.equal(goal.affordability.cost, 1500);
});

test('owned Breakthroughs are skipped and the next unfinished milestone or Breakthrough is selected', async () => {
    const repo = await repository();
    const { resolveNextGoal } = await progressionModule();
    const state = await freshState();

    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    setProducerLevel(state, 'fabricator', 15);
    setProducerLevel(state, 'assembly_station', 1);

    let goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'producer_milestone');
    assert.equal(goal.id, 'producer_milestone:assembly_station:level_10');

    setProducerLevel(state, 'assembly_station', 10);
    goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'breakthrough');
    assert.equal(goal.id, 'breakthrough:worker_bot');
    assert.notEqual(goal.id, 'breakthrough:auto_feeder');
});

test('Robot Line construction resolves as Era II guidance with build blockers and affordability', async () => {
    const repo = await repository();
    const { resolveNextGoal } = await progressionModule();
    const state = await freshState();

    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics'];
    setProducerLevel(state, 'fabricator', 50);
    setProducerLevel(state, 'assembly_station', 25);
    state.run.industrialOutput = 499999;

    let goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'era');
    assert.equal(goal.id, 'era:automated_factory:producer_build:robot_line');
    assert.equal(goal.eraId, 'automated_factory');
    assert.deepEqual(goal.focusTarget, {
        kind: 'era',
        eraId: 'automated_factory',
        source: { kind: 'producer', producerId: 'robot_line' },
    });
    assert.equal(goal.affordability.state, 'unaffordable');
    assert.equal(goal.affordability.cost, 500000);
    assert.equal(goal.blocking.state, 'unblocked');

    state.run.industrialOutput = 500000;
    goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'era');
    assert.equal(goal.affordability.state, 'affordable');
});

test('Advanced Robotics resolves as Era III guidance using Breakthrough requirement blockers', async () => {
    const repo = await repository();
    const { resolveNextGoal } = await progressionModule();
    const state = await freshState();

    state.run.currentEraId = 'automated_factory';
    state.run.purchasedBreakthroughIds = [
        'auto_feeder',
        'worker_bot',
        'robotic_logistics',
        'factory_control_system',
        'automated_cell_architecture',
    ];
    setProducerLevel(state, 'fabricator', 50);
    setProducerLevel(state, 'assembly_station', 25);
    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);
    state.run.robotsBuilt = 999;
    state.run.industrialOutput = 1000000000;

    const goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'era');
    assert.equal(goal.id, 'era:robotics_complex:breakthrough:advanced_robotics');
    assert.equal(goal.eraId, 'robotics_complex');
    assert.equal(goal.blocking.state, 'requirement_locked');
    assert.deepEqual(goal.blocking.requirements, [
        { type: 'robotsBuilt', requiredCount: 1000, currentCount: 999 },
    ]);
    assert.equal(goal.affordability.state, 'affordable');
});

test('Reboot AI Core guidance uses Prestige preview math and ignores temporary boosts', async () => {
    const repo = await repository();
    const {
        activateTemporaryProductionBoost,
        calculateCurrentPrestigeEligibleProductionPerSecond,
        calculateOnlineProductionPerSecond,
        resolveNextGoal,
    } = await progressionModule();
    const state = await freshState();

    state.run.currentEraId = 'robotics_complex';
    state.run.purchasedBreakthroughIds = [
        'auto_feeder',
        'worker_bot',
        'robotic_logistics',
        'factory_control_system',
        'automated_cell_architecture',
        'advanced_robotics',
    ];
    setProducerLevel(state, 'fabricator', 50);
    setProducerLevel(state, 'assembly_station', 25);
    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);
    setProducerLevel(state, 'advanced_robotics_complex', 25);
    state.run.prestigePowerPeak = repo.getPrestigeConfig().p0PrestigePower;

    const boost = activateTemporaryProductionBoost(state.boosts, {
        boostId: 'fixture_surge',
        multiplier: 10,
        durationSeconds: 60,
        source: 'test',
    });
    assert.equal(boost.status, 'activated');
    state.boosts = boost.boosts;

    const goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'reboot_ai_core');
    assert.equal(goal.prestigePreview.currentAiCoreReward, 5);
    assert.equal(goal.prestigePreview.currentPrestigePower, repo.getPrestigeConfig().p0PrestigePower);
    assert.equal(goal.prestigePreview.currentEligibleProductionPerSecond, calculateCurrentPrestigeEligibleProductionPerSecond(repo, state));
    assert.equal(calculateOnlineProductionPerSecond(repo, state), goal.prestigePreview.currentEligibleProductionPerSecond * 10);
    assert.deepEqual(goal.focusTarget, {
        kind: 'progression_target',
        targetKind: 'reboot_ai_core',
    });
});

test('fresh Civilization #2 can surface permanent-upgrade-adjusted Auto Feeder without first-run onboarding assumptions', async () => {
    const repo = await repository();
    const { isFreeOverclockUnlocked, resolveNextGoal } = await progressionModule();
    const state = await freshState();

    state.meta.civilizationNumber = 2;
    state.meta.permanentUpgradeRanks.cached_procedures = 2;
    state.run.industrialOutput = 300;

    assert.equal(isFreeOverclockUnlocked(state), true);
    const goal = resolveNextGoal(repo, state);
    assert.equal(goal.category, 'breakthrough');
    assert.equal(goal.id, 'breakthrough:auto_feeder');
    assert.equal(goal.eligibilityStatus, 'eligible');
    assert.equal(goal.affordability.state, 'affordable');
    assert.equal(goal.affordability.cost, 300);
    assert.equal(goal.blocking.state, 'unblocked');
});
