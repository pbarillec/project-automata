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

async function eligibleRebootState() {
    const repo = await repository();
    const { activateTemporaryProductionBoost } = await import(progressionModuleUrl);
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
    state.run.statistics = {
        industrialOutputEarned: 5000000000,
        industrialOutputSpent: 4000000000,
        manualProductionActions: 321,
        producerLevelsPurchased: 250,
        breakthroughsPurchased: 6,
        robotsBuiltPeak: 1234.5,
    };
    state.run.prestigePowerPeak = repo.getPrestigeConfig().p0PrestigePower;
    state.run.progressionFlags.first_robot = true;

    const boost = activateTemporaryProductionBoost(state.boosts, {
        boostId: 'fixture_factory_surge',
        multiplier: 3,
        durationSeconds: 600,
        cooldownSeconds: 120,
        source: 'test',
    });
    assert.equal(boost.status, 'activated');
    state.boosts = boost.boosts;
    state.boosts.cooldowns.spent_fixture = { remainingSeconds: 99 };
    state.boosts.consumedCharges.fixture_factory_surge = 1;

    state.meta.civilizationNumber = 1;
    state.meta.aiCores = 2;
    state.meta.lifetimeAiCoresEarned = 10;
    state.meta.permanentUpgradeRanks = {
        optimized_fabrication: 1,
        cached_procedures: 2,
        inherited_automation: 1,
    };
    state.meta.accountFeatureUnlocks.known_free_overclock = true;
    state.meta.durableEntitlements.founder = {
        owned: true,
        source: 'test',
        lastKnownValidUtcMs: 123,
    };
    state.meta.cosmeticOwnership.founder_robot = true;

    state.settings.musicVolume = 0.25;
    state.settings.sfxVolume = 0.75;
    state.settings.vibrationEnabled = true;
    state.settings.languageCode = 'en';
    state.settings.reducedMotion = true;

    state.monetization.rewardedClaims['rewarded.offline_double'] = {
        placementId: 'rewarded.offline_double',
        claimCount: 1,
        lastClaimUtcMs: 456,
    };
    state.monetization.productMetadataCache.founder = {
        productId: 'founder',
        localizedPrice: '$2.99',
        updatedUtcMs: 789,
    };

    state.lifetime = {
        industrialOutputEarned: 9000000000,
        manualProductionActions: 321,
        producerLevelsPurchased: 250,
        breakthroughsPurchased: 6,
        robotsBuilt: 1234.5,
        rebootsCompleted: 0,
        highestCivilizationReached: 1,
    };

    return state;
}

function metadata(savedAtUtc, label = 'aut-029') {
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
        contentVersion: 'aut-029-test',
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

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('Reboot preview is pure and exposes Civilization, Prestige Power and AI Core reward', async () => {
    const repo = await repository();
    const { createRebootPreview } = await import(progressionModuleUrl);
    const state = await eligibleRebootState();
    const before = JSON.stringify(state);

    const preview = createRebootPreview(repo, state);

    assert.equal(preview.eligibility, 'eligible');
    assert.equal(preview.currentCivilization, 1);
    assert.equal(preview.resultingCivilization, 2);
    assert.equal(preview.prestigePower, repo.getPrestigeConfig().p0PrestigePower);
    assert.equal(preview.aiCoresToGain, 5);
    assert.equal(preview.currentAiCores, 2);
    assert.equal(preview.resultingAiCores, 7);
    assert.equal(JSON.stringify(state), before);
});

test('confirmed Reboot grants previewed AI Cores once and resets only run-scoped state', async () => {
    const repo = await repository();
    const {
        createRebootPreview,
        executeRebootCivilization,
        isFreeOverclockUnlocked,
        calculateOnlineProductionPerSecond,
    } = await import(progressionModuleUrl);
    const state = await eligibleRebootState();
    const preview = createRebootPreview(repo, state);
    const before = JSON.stringify(state);

    const result = executeRebootCivilization(repo, state, { confirmed: true });

    assert.equal(result.status, 'success');
    assert.equal(result.preview.aiCoresToGain, preview.aiCoresToGain);
    assert.deepEqual(result.events.map((event) => event.type), [
        'aiCoresGranted',
        'civilizationChanged',
    ]);
    assert.equal(JSON.stringify(state), before);

    const after = result.state;
    assert.equal(after.meta.civilizationNumber, 2);
    assert.equal(after.meta.aiCores, 7);
    assert.equal(after.meta.lifetimeAiCoresEarned, 15);
    assert.deepEqual(after.meta.permanentUpgradeRanks, state.meta.permanentUpgradeRanks);
    assert.deepEqual(after.meta.accountFeatureUnlocks, state.meta.accountFeatureUnlocks);
    assert.deepEqual(after.meta.durableEntitlements, state.meta.durableEntitlements);
    assert.deepEqual(after.meta.cosmeticOwnership, state.meta.cosmeticOwnership);
    assert.deepEqual(after.settings, state.settings);
    assert.deepEqual(after.monetization, state.monetization);
    assert.equal(after.lifetime.industrialOutputEarned, state.lifetime.industrialOutputEarned);
    assert.equal(after.lifetime.rebootsCompleted, 1);
    assert.equal(after.lifetime.highestCivilizationReached, 2);

    assert.equal(after.run.industrialOutput, 0);
    assert.deepEqual(after.run.producers, {});
    assert.deepEqual(after.run.automation, {});
    assert.deepEqual(after.run.purchasedBreakthroughIds, []);
    assert.equal(after.run.currentEraId, 'manual_workshop');
    assert.equal(after.run.robotsBuilt, 0);
    assert.equal(after.run.prestigePowerPeak, 0);
    assert.deepEqual(after.boosts, {
        activeBoosts: {},
        cooldowns: {},
        consumedCharges: {},
    });
    assert.equal(isFreeOverclockUnlocked(after), true);

    const permanentEffectState = clonePlain(after);
    setProducerLevel(permanentEffectState, 'fabricator', 1);
    assert.equal(calculateOnlineProductionPerSecond(repo, permanentEffectState), 1.25);

    const duplicate = executeRebootCivilization(repo, after, { confirmed: true });
    assert.equal(duplicate.status, 'not_eligible');
    assert.equal(duplicate.preview.aiCoresToGain, 0);
});

test('unconfirmed or ineligible Reboot leaves authoritative state unchanged', async () => {
    const repo = await repository();
    const { executeRebootCivilization } = await import(progressionModuleUrl);
    const eligible = await eligibleRebootState();
    const eligibleBefore = JSON.stringify(eligible);
    const fresh = await freshState();
    const freshBefore = JSON.stringify(fresh);

    const unconfirmed = executeRebootCivilization(repo, eligible, {});
    const ineligible = executeRebootCivilization(repo, fresh, { confirmed: true });

    assert.equal(unconfirmed.status, 'not_confirmed');
    assert.equal(ineligible.status, 'not_eligible');
    assert.equal(JSON.stringify(eligible), eligibleBefore);
    assert.equal(JSON.stringify(fresh), freshBefore);
});

test('runtime confirmed Reboot rejects duplicate execution without granting stale reward', async () => {
    const repo = await repository();
    const { GameRuntime } = await import(runtimeModuleUrl);
    const runtime = new GameRuntime(repo, await eligibleRebootState());

    const first = runtime.rebootCivilizationConfirmed();
    const afterFirst = runtime.getStateSnapshot();
    const second = runtime.rebootCivilizationConfirmed();

    assert.equal(first.ok, true);
    assert.equal(afterFirst.meta.aiCores, 7);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'reboot_not_eligible');
    assert.equal(runtime.getStateSnapshot().meta.aiCores, 7);
    assert.equal(runtime.getStateSnapshot().meta.civilizationNumber, 2);
});

test('lifecycle Reboot requests critical persistence and saves the committed state', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await import(persistenceModuleUrl);
    const harness = await createHarness(await eligibleRebootState());
    const started = await startup(harness);
    assert.equal(started.ok, true);

    const result = await started.session.rebootCivilizationConfirmed();
    const savedEnvelope = await envelopeFromSaveText(harness.storage.getFile(SAVE_MAIN_NAME));

    assert.equal(result.status, 'reboot_saved');
    assert.equal(result.save.intent, 'critical');
    assert.equal(result.save.reason, 'reboot');
    assert.deepEqual(result.execution.events.map((event) => event.type), [
        'aiCoresGranted',
        'civilizationChanged',
        'rebootCompleted',
    ]);
    assert.equal(started.session.getStateSnapshot().meta.civilizationNumber, 2);
    assert.equal(savedEnvelope.payload.meta.civilizationNumber, 2);
    assert.equal(savedEnvelope.payload.meta.aiCores, 7);
});

test('post-Reboot persistence failure is explicit and does not roll back memory state', async () => {
    const {
        SAVE_MAIN_NAME,
        SAVE_TEMP_NAME,
    } = await import(persistenceModuleUrl);
    const harness = await createHarness(await eligibleRebootState());
    const started = await startup(harness);
    assert.equal(started.ok, true);
    harness.storage.failNext({
        operation: 'replace',
        fromName: SAVE_TEMP_NAME,
        toName: SAVE_MAIN_NAME,
        mode: 'after_delete_destination',
        message: 'durability failure',
    });

    const result = await started.session.rebootCivilizationConfirmed();

    assert.equal(result.status, 'reboot_persistence_failed');
    assert.equal(result.save.ok, false);
    assert.equal(result.save.intent, 'critical');
    assert.equal(result.save.reason, 'reboot');
    assert.deepEqual(result.execution.events.map((event) => event.type), [
        'aiCoresGranted',
        'civilizationChanged',
    ]);
    assert.equal(started.session.getStateSnapshot().meta.civilizationNumber, 2);
    assert.equal(started.session.getStateSnapshot().meta.aiCores, 7);
});
