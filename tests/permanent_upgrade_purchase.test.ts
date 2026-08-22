const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const lifecycleModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/lifecycle/index.ts')).href;
const persistenceModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/persistence/index.ts')).href;
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
const runtimeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/runtime/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;
const timeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/time/index.ts')).href;

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

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

async function eligibleRebootState() {
    const repo = await repository();
    const state = await freshState();

    state.run.industrialOutput = 123456789;
    setProducerLevel(state, 'fabricator', 100);
    setProducerLevel(state, 'assembly_station', 50);
    setProducerLevel(state, 'robot_line', 50);
    setProducerLevel(state, 'automated_cell', 25);
    setProducerLevel(state, 'advanced_robotics_complex', 25);
    state.run.automation.fabricator = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: 'auto_feeder',
    };
    state.run.purchasedBreakthroughIds = [
        'auto_feeder',
        'worker_bot',
        'robotic_logistics',
        'factory_control_system',
        'automated_cell_architecture',
        'advanced_robotics',
    ];
    state.run.currentEraId = 'robotics_complex';
    state.run.robotsBuilt = 1234.5;
    state.run.statistics.robotsBuiltPeak = 1234.5;
    state.run.prestigePowerPeak = repo.getPrestigeConfig().p0PrestigePower;
    state.run.progressionFlags.first_robot = true;
    state.meta.aiCores = 3;
    state.meta.lifetimeAiCoresEarned = 3;

    return state;
}

function metadata(savedAtUtc, label = 'aut-030') {
    return Object.freeze({
        saveVersion: 1,
        gameVersion: '0.1.0-test',
        contentVersion: label,
        savedAtUtc,
    });
}

async function saveTextForState(state, savedAtUtc = '2026-08-22T00:00:00.000Z') {
    const { serializeGameStateToSaveJson } = await import(persistenceModuleUrl);
    return serializeGameStateToSaveJson(state, metadata(savedAtUtc));
}

async function envelopeFromSaveText(text) {
    const { assertDeserializeGameStateFromSaveJson } = await import(persistenceModuleUrl);
    return assertDeserializeGameStateFromSaveJson(text).envelope;
}

async function createHarness(state, options = {}) {
    const {
        AtomicSaveRepository,
        InMemorySaveStorage,
        PersistenceCoordinator,
        SAVE_MAIN_NAME,
    } = await import(persistenceModuleUrl);
    const { ManualTimeService } = await import(timeModuleUrl);
    const main = await saveTextForState(state, options.savedAtUtc ?? '2026-08-22T00:00:00.000Z');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main });
    const clock = new ManualTimeService({
        utcIso: options.utcIso ?? '2026-08-22T00:00:00.000Z',
        monotonicSeconds: 0,
    });
    const atomicRepository = new AtomicSaveRepository(storage);
    const persistence = new PersistenceCoordinator({
        repository: atomicRepository,
        timeService: clock,
        gameVersion: '0.1.0-test',
        contentVersion: 'aut-030-test',
        dirtySavePolicy: { debounceSeconds: 5, periodicSeconds: 25 },
    });

    return {
        storage,
        clock,
        persistence,
        configRepository: await repository(),
    };
}

async function startup(harness) {
    const { LifecycleSessionCoordinator } = await import(lifecycleModuleUrl);
    return LifecycleSessionCoordinator.startup({
        configRepository: harness.configRepository,
        persistence: harness.persistence,
        timeService: harness.clock,
    });
}

test('permanent upgrade purchase rejects deterministically without mutating state', async () => {
    const repo = await repository();
    const { purchasePermanentUpgrade } = await import(progressionModuleUrl);
    const state = await freshState();
    state.meta.aiCores = 1;
    const before = JSON.stringify(state);

    assert.equal(purchasePermanentUpgrade(repo, state, 'missing_upgrade').status, 'unknown_upgrade');
    assert.equal(purchasePermanentUpgrade(repo, state, 'industrial_scaling').status, 'prerequisite_locked');
    assert.equal(purchasePermanentUpgrade(repo, state, 'cached_procedures').status, 'insufficient_ai_cores');

    const invalid = clonePlain(state);
    invalid.meta.permanentUpgradeRanks.optimized_fabrication = 4;
    assert.equal(purchasePermanentUpgrade(repo, invalid, 'optimized_fabrication').status, 'invalid_state');
    assert.equal(JSON.stringify(state), before);
});

test('runtime permanent upgrade purchase spends next-rank AI Core cost atomically', async () => {
    const repo = await repository();
    const { GameRuntime } = await import(runtimeModuleUrl);
    const state = await freshState();
    state.meta.aiCores = 8;
    setProducerLevel(state, 'fabricator', 1);
    const runBefore = clonePlain(state.run);
    const runtime = new GameRuntime(repo, state);

    const first = runtime.purchasePermanentUpgrade('optimized_fabrication');
    const afterFirst = runtime.getStateSnapshot();
    const productionAfterFirst = runtime.getProductionPerSecond();
    const second = runtime.purchasePermanentUpgrade('optimized_fabrication');
    const afterSecond = runtime.getStateSnapshot();

    assert.equal(first.ok, true);
    assert.deepEqual(first.events.map((event) => event.type), [
        'aiCoreBalanceChanged',
        'permanentUpgradePurchased',
    ]);
    assert.equal(first.events[0].delta, -1);
    assert.equal(first.events[1].cost, 1);
    assert.equal(afterFirst.meta.aiCores, 7);
    assert.equal(afterFirst.meta.permanentUpgradeRanks.optimized_fabrication, 1);
    assert.deepEqual(afterFirst.run, runBefore);
    assert.equal(productionAfterFirst, 1.25);

    assert.equal(second.ok, true);
    assert.equal(second.events[1].cost, 2);
    assert.equal(afterSecond.meta.aiCores, 5);
    assert.equal(afterSecond.meta.permanentUpgradeRanks.optimized_fabrication, 2);
    assert.deepEqual(afterSecond.run, runBefore);

    runtime.purchasePermanentUpgrade('optimized_fabrication');
    const maxedBefore = JSON.stringify(runtime.getStateSnapshot());
    const maxed = runtime.purchasePermanentUpgrade('optimized_fabrication');
    assert.equal(maxed.ok, false);
    assert.equal(maxed.reason, 'permanent_upgrade_max_rank');
    assert.equal(JSON.stringify(runtime.getStateSnapshot()), maxedBefore);
});

test('branch prerequisite purchases unlock downstream derived permanent effects', async () => {
    const repo = await repository();
    const { GameRuntime } = await import(runtimeModuleUrl);
    const {
        applyNewProducerConstructionCostMultiplier,
        resolveEffectiveBreakthroughDefinition,
        resolveEffectiveMajorRequirement,
    } = await import(progressionModuleUrl);

    const automationState = await freshState();
    automationState.meta.aiCores = 7;
    const automationRuntime = new GameRuntime(repo, automationState);
    assert.equal(automationRuntime.purchasePermanentUpgrade('cached_procedures').ok, true);
    assert.equal(automationRuntime.purchasePermanentUpgrade('cached_procedures').ok, true);
    const afterAutomation = automationRuntime.getStateSnapshot();
    assert.deepEqual(resolveEffectiveBreakthroughDefinition(repo, afterAutomation, 'auto_feeder').requirements, []);
    assert.equal(resolveEffectiveBreakthroughDefinition(repo, afterAutomation, 'auto_feeder').cost, 300);
    assert.deepEqual(afterAutomation.run.purchasedBreakthroughIds, []);

    const expansionState = await freshState();
    expansionState.meta.aiCores = 10;
    const expansionRuntime = new GameRuntime(repo, expansionState);
    assert.equal(expansionRuntime.purchasePermanentUpgrade('era_compression').ok, false);
    assert.equal(expansionRuntime.purchasePermanentUpgrade('compact_blueprints').ok, true);
    assert.equal(expansionRuntime.purchasePermanentUpgrade('compact_blueprints').ok, true);
    assert.equal(expansionRuntime.purchasePermanentUpgrade('era_compression').ok, true);
    const afterExpansion = expansionRuntime.getStateSnapshot();
    assert.ok(Math.abs(applyNewProducerConstructionCostMultiplier(repo, afterExpansion.meta, 1500) - 1083.75) < 1e-9);
    assert.equal(resolveEffectiveMajorRequirement(repo, afterExpansion.meta, 50), 45);
});

test('lifecycle permanent upgrade purchase requests critical persistence and saves committed state', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await import(persistenceModuleUrl);
    const state = await freshState();
    state.meta.aiCores = 2;
    const harness = await createHarness(state);
    const started = await startup(harness);
    assert.equal(started.ok, true);

    const result = await started.session.purchasePermanentUpgrade('optimized_fabrication');
    const savedEnvelope = await envelopeFromSaveText(harness.storage.getFile(SAVE_MAIN_NAME));

    assert.equal(result.status, 'permanent_upgrade_saved');
    assert.equal(result.save.intent, 'critical');
    assert.equal(result.save.reason, 'permanent_upgrade_purchase');
    assert.deepEqual(result.execution.events.map((event) => event.type), [
        'aiCoreBalanceChanged',
        'permanentUpgradePurchased',
    ]);
    assert.equal(started.session.getStateSnapshot().meta.aiCores, 1);
    assert.equal(savedEnvelope.payload.meta.aiCores, 1);
    assert.equal(savedEnvelope.payload.meta.permanentUpgradeRanks.optimized_fabrication, 1);
});

test('post-purchase persistence failure is explicit and does not roll back memory state', async () => {
    const {
        SAVE_MAIN_NAME,
        SAVE_TEMP_NAME,
    } = await import(persistenceModuleUrl);
    const state = await freshState();
    state.meta.aiCores = 2;
    const harness = await createHarness(state);
    const started = await startup(harness);
    assert.equal(started.ok, true);
    harness.storage.failNext({
        operation: 'replace',
        fromName: SAVE_TEMP_NAME,
        toName: SAVE_MAIN_NAME,
        mode: 'after_delete_destination',
        message: 'durability failure',
    });

    const result = await started.session.purchasePermanentUpgrade('optimized_fabrication');

    assert.equal(result.status, 'permanent_upgrade_persistence_failed');
    assert.equal(result.save.ok, false);
    assert.equal(result.save.intent, 'critical');
    assert.equal(result.save.reason, 'permanent_upgrade_purchase');
    assert.equal(started.session.getStateSnapshot().meta.aiCores, 1);
    assert.equal(started.session.getStateSnapshot().meta.permanentUpgradeRanks.optimized_fabrication, 1);
});

test('purchased permanent rank survives Reboot and affects the next Civilization', async () => {
    const state = await eligibleRebootState();
    const harness = await createHarness(state);
    const started = await startup(harness);
    assert.equal(started.ok, true);

    const purchase = await started.session.purchasePermanentUpgrade('optimized_fabrication');
    const reboot = await started.session.rebootCivilizationConfirmed();
    const afterReboot = started.session.getStateSnapshot();
    setProducerLevel(afterReboot, 'fabricator', 1);
    const { calculateOnlineProductionPerSecond } = await import(progressionModuleUrl);

    assert.equal(purchase.status, 'permanent_upgrade_saved');
    assert.equal(reboot.status, 'reboot_saved');
    assert.equal(afterReboot.meta.civilizationNumber, 2);
    assert.equal(afterReboot.meta.permanentUpgradeRanks.optimized_fabrication, 1);
    assert.equal(calculateOnlineProductionPerSecond(await repository(), afterReboot), 1.25);
});
