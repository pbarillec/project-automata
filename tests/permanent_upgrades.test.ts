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

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
}

async function freshState() {
    const { createFreshGameState } = await import(stateModuleUrl);
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

test('permanent upgrade rank state exposes next cost, locked prerequisites and maxed state', async () => {
    const repo = await repository();
    const { evaluatePermanentUpgradeRankState, getNextPermanentUpgradeRankCost } = await import(progressionModuleUrl);
    const state = await freshState();

    assert.deepEqual(evaluatePermanentUpgradeRankState(repo, state.meta, 'optimized_fabrication'), {
        status: 'available',
        upgradeId: 'optimized_fabrication',
        currentRank: 0,
        maxRank: 3,
        nextRank: 1,
        nextRankCost: 1,
        missingPrerequisites: [],
    });

    assert.deepEqual(evaluatePermanentUpgradeRankState(repo, state.meta, 'industrial_scaling'), {
        status: 'prerequisite_locked',
        upgradeId: 'industrial_scaling',
        currentRank: 0,
        maxRank: 3,
        nextRank: 1,
        nextRankCost: 2,
        missingPrerequisites: [
            { upgradeId: 'optimized_fabrication', requiredRank: 1, currentRank: 0 },
        ],
    });

    state.meta.permanentUpgradeRanks.optimized_fabrication = 1;
    assert.equal(evaluatePermanentUpgradeRankState(repo, state.meta, 'industrial_scaling').status, 'available');
    assert.equal(getNextPermanentUpgradeRankCost(repo, state.meta, 'industrial_scaling'), 2);

    state.meta.permanentUpgradeRanks.industrial_scaling = 3;
    assert.deepEqual(evaluatePermanentUpgradeRankState(repo, state.meta, 'industrial_scaling'), {
        status: 'max_rank',
        upgradeId: 'industrial_scaling',
        currentRank: 3,
        maxRank: 3,
        nextRank: null,
        nextRankCost: null,
        missingPrerequisites: [],
    });
});

test('invalid permanent rank values fail deterministic validation', async () => {
    const repo = await repository();
    const { PermanentUpgradeInputError, validatePermanentUpgradeRanks } = await import(progressionModuleUrl);
    const state = await freshState();

    for (const rank of [-1, 1.5, 4]) {
        state.meta.permanentUpgradeRanks = { optimized_fabrication: rank };
        assert.throws(() => validatePermanentUpgradeRanks(repo, state.meta), PermanentUpgradeInputError);
    }

    state.meta.permanentUpgradeRanks = { missing_upgrade: 1 };
    assert.throws(() => validatePermanentUpgradeRanks(repo, state.meta), /unknown permanent upgrade id/);
});

test('Production permanent upgrades resolve through ModifierSet and milestone power bonus', async () => {
    const repo = await repository();
    const { resolveEffectiveProducerProductionMultiplier } = await import(economyModuleUrl);
    const {
        createPermanentUpgradeModifierSet,
        resolvePermanentMilestonePowerBonus,
    } = await import(progressionModuleUrl);
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 1);
    setProducerLevel(state, 'assembly_station', 1);
    state.run.automation.assembly_station = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'test',
    };

    for (const [rank, expected] of [[0, 1], [1, 1.25], [2, 1.5625], [3, 1.953125]]) {
        state.meta.permanentUpgradeRanks = { optimized_fabrication: rank };
        const modifierSet = createPermanentUpgradeModifierSet(repo, state);
        assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'fabricator'), expected);
    }

    state.meta.permanentUpgradeRanks = {
        optimized_fabrication: 0,
        autonomous_optimization: 2,
        industrial_scaling: 3,
    };
    const modifierSet = createPermanentUpgradeModifierSet(repo, state);
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'fabricator'), 1);
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'assembly_station'), 2.25);
    assert.equal(resolvePermanentMilestonePowerBonus(repo, state.meta), 0.6000000000000001);

    for (const [rank, expectedBonus] of [[1, 0.2], [2, 0.4], [3, 0.6000000000000001]]) {
        state.meta.permanentUpgradeRanks = { industrial_scaling: rank };
        assert.equal(resolvePermanentMilestonePowerBonus(repo, state.meta), expectedBonus);
    }
});

test('A1 and A2 produce effective Breakthrough requirements and costs without mutating base config', async () => {
    const repo = await repository();
    const { resolveEffectiveBreakthroughDefinition } = await import(progressionModuleUrl);
    const state = await freshState();
    const baseAutoFeeder = repo.getBreakthrough('auto_feeder');
    const baseWorkerBot = repo.getBreakthrough('worker_bot');

    state.meta.permanentUpgradeRanks.cached_procedures = 1;
    assert.deepEqual(resolveEffectiveBreakthroughDefinition(repo, state, 'auto_feeder'), {
        breakthroughId: 'auto_feeder',
        baseCost: 1500,
        cost: 750,
        requirements: [
            { type: 'producerLevel', producerId: 'fabricator', level: 10 },
        ],
    });

    state.meta.permanentUpgradeRanks.cached_procedures = 2;
    assert.deepEqual(resolveEffectiveBreakthroughDefinition(repo, state, 'auto_feeder'), {
        breakthroughId: 'auto_feeder',
        baseCost: 1500,
        cost: 300,
        requirements: [],
    });

    state.meta.permanentUpgradeRanks.worker_templates = 1;
    assert.deepEqual(resolveEffectiveBreakthroughDefinition(repo, state, 'worker_bot').requirements, [
        { type: 'producerLevel', producerId: 'assembly_station', level: 7 },
    ]);
    assert.equal(resolveEffectiveBreakthroughDefinition(repo, state, 'worker_bot').cost, 37500);

    state.meta.permanentUpgradeRanks.worker_templates = 2;
    assert.deepEqual(resolveEffectiveBreakthroughDefinition(repo, state, 'worker_bot').requirements, [
        { type: 'producerLevel', producerId: 'assembly_station', level: 5 },
    ]);
    assert.equal(resolveEffectiveBreakthroughDefinition(repo, state, 'worker_bot').cost, 18750);
    assert.deepEqual(baseAutoFeeder.requirements, [
        { type: 'producerLevel', producerId: 'fabricator', level: 15 },
    ]);
    assert.deepEqual(baseWorkerBot.requirements, [
        { type: 'producerLevel', producerId: 'assembly_station', level: 10 },
    ]);
});

test('A1/A2 do not automatically purchase Breakthroughs and A3 does not construct Assembly', async () => {
    const repo = await repository();
    const {
        GameRuntime,
    } = await import(runtimeModuleUrl);
    const {
        evaluateBreakthroughEligibility,
        resolveEffectiveProducerAutomationState,
    } = await import(progressionModuleUrl);
    const state = await freshState();
    state.meta.permanentUpgradeRanks.cached_procedures = 2;
    state.meta.permanentUpgradeRanks.worker_templates = 2;
    state.meta.permanentUpgradeRanks.inherited_automation = 1;

    const autoFeeder = evaluateBreakthroughEligibility(repo, state, 'auto_feeder');
    assert.equal(autoFeeder.status, 'eligible');
    assert.deepEqual(state.run.purchasedBreakthroughIds, []);
    assert.equal(state.run.producers.assembly_station, undefined);

    assert.deepEqual(resolveEffectiveProducerAutomationState(repo, state, 'assembly_station'), {
        isAutomated: false,
        isOfflineEligible: false,
        unlockedByBreakthroughId: null,
    });

    setProducerLevel(state, 'assembly_station', 1);
    assert.deepEqual(resolveEffectiveProducerAutomationState(repo, state, 'assembly_station'), {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: null,
    });

    const runtimeState = await freshState();
    runtimeState.meta.permanentUpgradeRanks.inherited_automation = 1;
    runtimeState.run.industrialOutput = 1500;
    setProducerLevel(runtimeState, 'fabricator', 1);
    const runtime = new GameRuntime(repo, runtimeState);
    const construction = runtime.execute({ type: 'buyProducerLevels', producerId: 'assembly_station', quantity: 1 });
    assert.equal(construction.ok, true);
    assert.deepEqual(runtime.getStateSnapshot().run.automation.assembly_station, {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: null,
    });
});

test('E1 construction multiplier is multiplicative and does not modify regular level costs', async () => {
    const repo = await repository();
    const {
        calculateProducerPurchaseCost,
    } = await import(economyModuleUrl);
    const {
        applyNewProducerConstructionCostMultiplier,
        resolveNewProducerConstructionCostMultiplier,
    } = await import(progressionModuleUrl);
    const state = await freshState();
    const assembly = repo.getProducer('assembly_station');

    for (const [rank, expected] of [[0, 1], [1, 0.85], [2, 0.7224999999999999], [3, 0.6141249999999999]]) {
        state.meta.permanentUpgradeRanks = rank === 0 ? {} : { compact_blueprints: rank };
        assert.equal(resolveNewProducerConstructionCostMultiplier(repo, state.meta), expected);
    }

    state.meta.permanentUpgradeRanks = { compact_blueprints: 3 };
    assert.equal(applyNewProducerConstructionCostMultiplier(repo, state.meta, 1500), 921.1874999999999);
    assert.ok(Math.abs(calculateProducerPurchaseCost(assembly, 1, 1).cost - 1725) < 1e-9);
});

test('E2 major requirement reduction uses floor rounding and leaves base data unchanged', async () => {
    const repo = await repository();
    const {
        resolveEffectiveBreakthroughDefinition,
        resolveEffectiveMajorRequirement,
        resolvePermanentMajorRequirementReduction,
    } = await import(progressionModuleUrl);
    const state = await freshState();

    for (const [rank, expectedReduction, expected50, expected1000] of [
        [0, 0, 50, 1000],
        [1, 0.1, 45, 900],
        [2, 0.2, 40, 800],
        [3, 0.30000000000000004, 35, 700],
    ]) {
        state.meta.permanentUpgradeRanks = rank === 0 ? {} : { era_compression: rank };
        assert.equal(resolvePermanentMajorRequirementReduction(repo, state.meta), expectedReduction);
        assert.equal(resolveEffectiveMajorRequirement(repo, state.meta, 50), expected50);
        assert.equal(resolveEffectiveMajorRequirement(repo, state.meta, 1000), expected1000);
    }

    state.meta.permanentUpgradeRanks = { era_compression: 3 };
    const effectiveAdvanced = resolveEffectiveBreakthroughDefinition(repo, state, 'advanced_robotics');
    assert.deepEqual(effectiveAdvanced.requirements, [
        { type: 'producerLevel', producerId: 'robot_line', level: 35 },
        { type: 'producerLevel', producerId: 'automated_cell', level: 17 },
        { type: 'robotsBuilt', count: 700 },
    ]);
    assert.deepEqual(repo.getBreakthrough('advanced_robotics').requirements, [
        { type: 'producerLevel', producerId: 'robot_line', level: 50 },
        { type: 'producerLevel', producerId: 'automated_cell', level: 25 },
        { type: 'robotsBuilt', count: 1000 },
    ]);
});

test('fresh-run runtime calculations consume permanent ranks headlessly without spending AI Cores', async () => {
    const repo = await repository();
    const { GameRuntime } = await import(runtimeModuleUrl);
    const state = await freshState();
    state.meta.aiCores = 99;
    state.meta.permanentUpgradeRanks.optimized_fabrication = 1;
    state.meta.permanentUpgradeRanks.cached_procedures = 2;
    state.run.industrialOutput = 300;
    setProducerLevel(state, 'fabricator', 1);

    const runtime = new GameRuntime(repo, state);
    assert.equal(runtime.getProductionPerSecond(), 1.25);

    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
    assert.equal(result.ok, true);
    const after = runtime.getStateSnapshot();
    assert.equal(after.meta.aiCores, 99);
    assert.deepEqual(after.meta.permanentUpgradeRanks, {
        optimized_fabrication: 1,
        cached_procedures: 2,
    });
});

test('permanent upgrade config rejects duplicate ids, bad ranks, invalid prerequisites and cycles', async () => {
    const { validateConfigSources } = await import(configModuleUrl);
    const validSources = await collectJsonSources(dataRoot);

    function withPermanentItems(items) {
        return validSources
            .filter((source) => source.filePath !== 'data/economy/permanent_upgrades.json')
            .concat({
                filePath: 'data/economy/permanent_upgrades.json',
                text: JSON.stringify({
                    kind: 'permanent_upgrades',
                    schemaVersion: 1,
                    contentVersion: '0.1.0-aut-010',
                    items,
                }),
            })
            .sort((left, right) => left.filePath.localeCompare(right.filePath));
    }

    const base = {
        id: 'one',
        branch: 'production',
        displayNameKey: 'one',
        maxRank: 1,
        rankCosts: [1],
        prerequisites: [],
        effects: [{ type: 'globalProductionMultiplierPerRank', multiplier: 1.1 }],
    };

    assert.equal(validateConfigSources(withPermanentItems([base, { ...base }])).diagnostics[0].code, 'CONFIG_DUPLICATE_ID');
    assert.equal(validateConfigSources(withPermanentItems([{ ...base, branch: 'mystery' }])).diagnostics[0].code, 'CONFIG_INVALID_BRANCH');
    assert.equal(validateConfigSources(withPermanentItems([{ ...base, rankCosts: [1, 2] }])).diagnostics[0].code, 'CONFIG_RANK_COST_LENGTH_MISMATCH');
    assert.equal(validateConfigSources(withPermanentItems([{ ...base, prerequisites: [{ upgradeId: 'missing', rank: 1 }] }])).diagnostics[0].code, 'CONFIG_UNKNOWN_REFERENCE');
    assert.equal(validateConfigSources(withPermanentItems([
        { ...base, id: 'one', prerequisites: [{ upgradeId: 'two', rank: 1 }] },
        { ...base, id: 'two', prerequisites: [{ upgradeId: 'one', rank: 1 }] },
    ])).diagnostics[0].code, 'CONFIG_REFERENCE_CYCLE');
});
