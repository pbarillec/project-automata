const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const fixturesRoot = path.join(repoRoot, 'tests/fixtures/save_migrations');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const lifecycleModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/lifecycle/index.ts')).href;
const persistenceModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/persistence/index.ts')).href;
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;
const timeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/time/index.ts')).href;

let repositoryPromise;
let lifecycleModulePromise;
let persistenceModulePromise;
let stateModulePromise;
let timeModulePromise;

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
}

async function lifecycleModule() {
    if (lifecycleModulePromise === undefined) {
        lifecycleModulePromise = import(lifecycleModuleUrl);
    }

    return lifecycleModulePromise;
}

async function persistenceModule() {
    if (persistenceModulePromise === undefined) {
        persistenceModulePromise = import(persistenceModuleUrl);
    }

    return persistenceModulePromise;
}

async function stateModule() {
    if (stateModulePromise === undefined) {
        stateModulePromise = import(stateModuleUrl);
    }

    return stateModulePromise;
}

async function timeModule() {
    if (timeModulePromise === undefined) {
        timeModulePromise = import(timeModuleUrl);
    }

    return timeModulePromise;
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

async function freshState() {
    const { createFreshGameState } = await stateModule();
    return createFreshGameState();
}

async function offlineEligibleState() {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 1500;
    const result = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(result.status, 'success');
    return result.state;
}

async function activeBoostState() {
    const { activateFreeOverclock } = await import(progressionModuleUrl);
    const state = await offlineEligibleState();
    state.run.progressionFlags.first_robot = true;
    const activation = activateFreeOverclock(state);
    assert.equal(activation.status, 'activated');
    state.boosts = activation.boosts;
    return state;
}

function metadata(savedAtUtc, label = 'aut-028') {
    return Object.freeze({
        saveVersion: 1,
        gameVersion: '0.1.0-test',
        contentVersion: label,
        savedAtUtc,
    });
}

async function saveTextForState(state, savedAtUtc = '2026-08-22T00:00:00.000Z') {
    const { serializeGameStateToSaveJson } = await persistenceModule();
    return serializeGameStateToSaveJson(state, metadata(savedAtUtc));
}

async function stateFromSaveText(text) {
    const { assertDeserializeGameStateFromSaveJson } = await persistenceModule();
    return assertDeserializeGameStateFromSaveJson(text).state;
}

async function envelopeFromSaveText(text) {
    const { assertDeserializeGameStateFromSaveJson } = await persistenceModule();
    return assertDeserializeGameStateFromSaveJson(text).envelope;
}

async function createHarness(options = {}) {
    const {
        AtomicSaveRepository,
        InMemorySaveStorage,
        PersistenceCoordinator,
    } = await persistenceModule();
    const { ManualTimeService } = await timeModule();
    const storage = new InMemorySaveStorage(options.files ?? {});
    const clock = new ManualTimeService({
        utcIso: options.utcIso ?? '2026-08-22T01:00:00.000Z',
        monotonicSeconds: options.monotonicSeconds ?? 0,
    });
    const atomicRepository = new AtomicSaveRepository(storage, options.atomicOptions ?? {});
    const persistence = new PersistenceCoordinator({
        repository: atomicRepository,
        timeService: clock,
        gameVersion: '0.1.0-test',
        contentVersion: 'aut-028-test',
        dirtySavePolicy: options.dirtySavePolicy ?? { debounceSeconds: 5, periodicSeconds: 25 },
    });

    return {
        storage,
        clock,
        persistence,
        configRepository: await repository(),
    };
}

async function startup(harness) {
    const { LifecycleSessionCoordinator } = await lifecycleModule();
    return LifecycleSessionCoordinator.startup({
        configRepository: harness.configRepository,
        persistence: harness.persistence,
        timeService: harness.clock,
    });
}

function readFixture(name) {
    return fs.readFileSync(path.join(fixturesRoot, name), 'utf8');
}

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

function requireRecord(value, pathLabel) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${pathLabel} must be an object`);
    }

    return value;
}

async function syntheticV0Registry() {
    const {
        createIntegrityMetadata,
        createSaveMigrationRegistry,
    } = await persistenceModule();

    return createSaveMigrationRegistry(1, [{
        id: 'synthetic-test-v0-to-v1',
        sourceVersion: 0,
        targetVersion: 1,
        migrate: (legacyEnvelope) => {
            const payload = clonePlain(requireRecord(legacyEnvelope.payload, '$.payload'));
            const settings = clonePlain(requireRecord(payload.settings, '$.payload.settings'));
            payload.settings = {
                ...settings,
                reducedMotion: false,
            };

            return {
                saveVersion: 1,
                gameVersion: legacyEnvelope.gameVersion,
                contentVersion: legacyEnvelope.contentVersion,
                savedAtUtc: legacyEnvelope.savedAtUtc,
                integrity: createIntegrityMetadata(payload),
                payload,
            };
        },
    }]);
}

test('startup distinguishes loaded main, exposes pending offline preview, and does not mutate state', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const state = await offlineEligibleState();
    const main = await saveTextForState(state, '2026-08-22T00:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T01:00:00.000Z',
    });

    const result = await startup(harness);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'loaded_main');
    assert.equal(result.offlinePreview.status, 'preview_ready');
    assert.equal(result.offlinePreview.rawAbsenceSeconds, 3600);
    assert.equal(result.session.getPendingOfflinePreview().status, 'preview_ready');
    assert.equal(result.session.getStateSnapshot().run.industrialOutput, 0);
    assert.equal(harness.storage.getFile(SAVE_MAIN_NAME), main);
});

test('startup routes backup recovery, fresh fallback and legacy migration through persistence load', async () => {
    const {
        SAVE_BACKUP_NAME,
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const backup = await saveTextForState(await offlineEligibleState(), '2026-08-22T00:00:00.000Z');
    const recoveredHarness = await createHarness({
        files: { [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: backup },
        utcIso: '2026-08-22T01:00:00.000Z',
    });
    const freshHarness = await createHarness();
    const legacyHarness = await createHarness({
        files: { [SAVE_MAIN_NAME]: readFixture('synthetic_v0_progress.json') },
        atomicOptions: { migrations: await syntheticV0Registry() },
    });

    const recovered = await startup(recoveredHarness);
    const fresh = await startup(freshHarness);
    const legacy = await startup(legacyHarness);

    assert.equal(recovered.ok, true);
    assert.equal(recovered.status, 'recovered_backup');
    assert.equal(recovered.load.recovery.status, 'succeeded');
    assert.equal(fresh.ok, true);
    assert.equal(fresh.status, 'fresh_game');
    assert.equal(fresh.offlinePreview, null);
    assert.equal(legacy.ok, true);
    assert.equal(legacy.status, 'loaded_main');
    assert.equal(legacy.session.getStateSnapshot().settings.reducedMotion, false);
    assert.equal(legacyHarness.storage.getFile(SAVE_MAIN_NAME), readFixture('synthetic_v0_progress.json'));
});

test('suspend captures injected UTC, performs critical save, and grants no offline reward', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const main = await saveTextForState(await activeBoostState(), '2026-08-22T08:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T08:00:00.000Z',
    });
    const started = await startup(harness);
    assert.equal(started.ok, true);
    assert.equal(started.offlinePreview.status, 'no_reward');

    harness.clock.setUtcIso('2026-08-22T09:30:00.000Z');
    const suspended = await started.session.suspend();
    const savedEnvelope = await envelopeFromSaveText(harness.storage.getFile(SAVE_MAIN_NAME));
    const savedState = savedEnvelope.payload;

    assert.equal(suspended.status, 'suspended_saved');
    assert.equal(suspended.boundary.persistedUtcTimestamp, '2026-08-22T09:30:00.000Z');
    assert.equal(savedEnvelope.savedAtUtc, '2026-08-22T09:30:00.000Z');
    assert.equal(savedState.run.industrialOutput, 0);
    assert.equal(savedState.boosts.activeBoosts.free_overclock.remainingSeconds, 60);
});

test('resume creates one offline preview from the suspend boundary without advancing boost wall time', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const main = await saveTextForState(await activeBoostState(), '2026-08-22T08:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T08:00:00.000Z',
        monotonicSeconds: 10,
    });
    const started = await startup(harness);
    assert.equal(started.ok, true);

    const suspend = await started.session.suspend();
    assert.equal(suspend.status, 'suspended_saved');
    harness.clock.setUtcIso('2026-08-22T16:00:00.000Z');
    const resume = started.session.resume();
    const repeatedResume = started.session.resume();

    assert.equal(resume.status, 'preview_created');
    assert.equal(resume.offlinePreview.status, 'preview_ready');
    assert.equal(resume.offlinePreview.rawAbsenceSeconds, 8 * 60 * 60);
    assert.equal(repeatedResume.status, 'existing_pending_preview');
    assert.equal(started.session.getStateSnapshot().run.industrialOutput, 0);
    assert.equal(started.session.getStateSnapshot().boosts.activeBoosts.free_overclock.remainingSeconds, 60);
});

test('offline collect applies pending preview once, saves critically, and rejects duplicate collection', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const main = await saveTextForState(await offlineEligibleState(), '2026-08-22T00:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T01:00:00.000Z',
    });
    const started = await startup(harness);
    assert.equal(started.ok, true);
    const reward = started.offlinePreview.totalIndustrialOutputReward;

    const collect = await started.session.collectPendingOffline();
    const duplicate = await started.session.collectPendingOffline();
    const savedEnvelope = await envelopeFromSaveText(harness.storage.getFile(SAVE_MAIN_NAME));

    assert.equal(collect.status, 'collected_saved');
    assert.equal(collect.save.intent, 'critical');
    assert.equal(collect.save.reason, 'offline_collect');
    assert.equal(started.session.getStateSnapshot().run.industrialOutput, reward);
    assert.equal(savedEnvelope.savedAtUtc, '2026-08-22T01:00:00.000Z');
    assert.equal(savedEnvelope.payload.run.industrialOutput, reward);
    assert.equal(started.session.getPendingOfflinePreview(), null);
    assert.equal(duplicate.status, 'no_pending_preview');
    assert.equal(started.session.getStateSnapshot().run.industrialOutput, reward);
});

test('post-collect persistence failure is explicit and does not roll back applied reward', async () => {
    const {
        SAVE_MAIN_NAME,
        SAVE_TEMP_NAME,
    } = await persistenceModule();
    const main = await saveTextForState(await offlineEligibleState(), '2026-08-22T00:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T01:00:00.000Z',
    });
    const started = await startup(harness);
    assert.equal(started.ok, true);
    const reward = started.offlinePreview.totalIndustrialOutputReward;
    harness.storage.failNext({
        operation: 'replace',
        fromName: SAVE_TEMP_NAME,
        toName: SAVE_MAIN_NAME,
        mode: 'after_delete_destination',
        message: 'durability failure',
    });

    const collect = await started.session.collectPendingOffline();

    assert.equal(collect.status, 'collected_persistence_failed');
    assert.equal(collect.save.ok, false);
    assert.equal(collect.save.save.reason, 'main_promotion_failed');
    assert.equal(started.session.getStateSnapshot().run.industrialOutput, reward);
    assert.equal(started.session.getPendingOfflinePreview(), null);
    assert.equal(started.session.getLastClosedAbsenceUtcIso(), '2026-08-22T01:00:00.000Z');
});

test('failed offline collection leaves authoritative session state unchanged', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const main = await saveTextForState(await offlineEligibleState(), '2026-08-22T00:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T01:00:00.000Z',
    });
    const started = await startup(harness);
    assert.equal(started.ok, true);
    const before = JSON.stringify(started.session.getStateSnapshot());
    started.session.pendingOfflinePreview = {
        ...started.offlinePreview,
        totalIndustrialOutputReward: Number.POSITIVE_INFINITY,
    };

    const collect = await started.session.collectPendingOffline();

    assert.equal(collect.status, 'collect_failed');
    assert.equal(collect.collect.status, 'failure');
    assert.equal(JSON.stringify(started.session.getStateSnapshot()), before);
    assert.equal(JSON.stringify(await stateFromSaveText(harness.storage.getFile(SAVE_MAIN_NAME))), before);
});

test('ordinary dirty save cadence uses monotonic policy while critical saves bypass debounce', async () => {
    const {
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const main = await saveTextForState(await offlineEligibleState(), '2026-08-22T00:00:00.000Z');
    const harness = await createHarness({
        files: { [SAVE_MAIN_NAME]: main },
        utcIso: '2026-08-22T00:00:00.000Z',
        monotonicSeconds: 0,
    });
    const started = await startup(harness);
    assert.equal(started.ok, true);

    const command = await started.session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(command.execution.ok, true);
    assert.equal(command.save.status, 'skipped');
    assert.equal(command.save.decision.reason, 'waiting');

    harness.clock.advanceMonotonicSeconds(5);
    const active = await started.session.advanceActiveSessionFromClock({ requestOrdinarySave: true });
    assert.equal(active.save.status, 'saved');
    assert.equal(active.save.intent, 'ordinary');

    harness.clock.setUtcIso('2026-08-22T00:10:00.000Z');
    const suspend = await started.session.suspend();
    assert.equal(suspend.status, 'suspended_saved');
    assert.equal(suspend.save.decision.reason, 'critical');
});

test('lifecycle orchestration stays headless and avoids real timers or direct clocks', async () => {
    const sourceFiles = [
        ...(await collectTypeScriptSources(path.join(repoRoot, 'assets', 'scripts', 'lifecycle'))),
        path.join(repoRoot, 'assets', 'scripts', 'persistence', 'PersistenceCoordinator.ts'),
    ];

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);

        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${relativePath} imports Cocos runtime`);
        assert.equal(/assets[\\/]scenes|assets[\\/]ui/.test(source), false, `${relativePath} imports scene or UI code`);
        assert.equal(/platform|services|native\.reflection|AutomataPlatformBridge|com\.google|BillingClient|MobileAds/.test(source), false, `${relativePath} imports platform/native code`);
        assert.equal(/Date\.now|setTimeout|setInterval/.test(source), false, `${relativePath} uses real clocks or timers`);
    }
});
