const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const persistenceModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/persistence/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;
const fixturesRoot = path.join(repoRoot, 'tests/fixtures/save_migrations');

async function persistenceModule() {
    return import(persistenceModuleUrl);
}

async function stateModule() {
    return import(stateModuleUrl);
}

function readFixture(name) {
    return fs.readFileSync(path.join(fixturesRoot, name), 'utf8');
}

function parseFixture(name) {
    return JSON.parse(readFixture(name));
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

test('synthetic v0 fixture migrates through one explicit step and receives deterministic defaults', async () => {
    const { deserializeGameStateFromSaveJson } = await persistenceModule();
    const migrations = await syntheticV0Registry();
    const parsedBefore = parseFixture('synthetic_v0_missing_reduced_motion.json');

    const result = deserializeGameStateFromSaveJson(JSON.stringify(parsedBefore), { migrations });

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.envelope.saveVersion, 1);
    assert.equal(result.state.settings.reducedMotion, false);
    assert.equal(result.migration.migrated, true);
    assert.deepEqual(result.migration.appliedMigrations.map((migration) => migration.id), ['synthetic-test-v0-to-v1']);

    assert.equal(parsedBefore.saveVersion, 0);
    assert.equal('integrity' in parsedBefore, false);
    assert.equal('reducedMotion' in parsedBefore.payload.settings, false);
});

test('synthetic v0 migration preserves durable non-default progress', async () => {
    const { deserializeGameStateFromSaveJson } = await persistenceModule();
    const migrations = await syntheticV0Registry();
    const result = deserializeGameStateFromSaveJson(readFixture('synthetic_v0_progress.json'), { migrations });

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.state.run.industrialOutput, 12345.5);
    assert.equal(result.state.run.producers.fabricator.level, 25);
    assert.deepEqual(result.state.run.purchasedBreakthroughIds, ['auto_feeder']);
    assert.equal(result.state.meta.civilizationNumber, 2);
    assert.equal(result.state.meta.aiCores, 7);
    assert.equal(result.state.meta.permanentUpgradeRanks.industrial_scaling, 2);
    assert.equal(result.state.lifetime.highestCivilizationReached, 2);
});

test('repeated migration of identical legacy input produces equivalent current output', async () => {
    const { deserializeGameStateFromSaveJson } = await persistenceModule();
    const migrations = await syntheticV0Registry();
    const text = readFixture('synthetic_v0_progress.json');

    const first = deserializeGameStateFromSaveJson(text, { migrations });
    const second = deserializeGameStateFromSaveJson(text, { migrations });

    assert.deepEqual(first.envelope, second.envelope);
    assert.deepEqual(first.state, second.state);
    assert.deepEqual(first.migration.appliedMigrations, second.migration.appliedMigrations);
});

test('current-version saves bypass migration transformation and validate normally', async () => {
    const {
        createSaveMigrationRegistry,
        migrateParsedSaveEnvelopeToCurrent,
        serializeGameStateToSaveJson,
    } = await persistenceModule();
    const { createFreshGameState } = await stateModule();
    const text = serializeGameStateToSaveJson(createFreshGameState(), {
        saveVersion: 1,
        gameVersion: '0.1.0-test',
        contentVersion: 'current-test',
        savedAtUtc: '2026-08-22T08:30:45.123Z',
    });
    const parsed = JSON.parse(text);
    let called = false;
    const migrations = createSaveMigrationRegistry(1, [{
        id: 'should-not-run-v0-to-v1',
        sourceVersion: 0,
        targetVersion: 1,
        migrate: () => {
            called = true;
            throw new Error('current saves must bypass migration');
        },
    }]);

    const result = migrateParsedSaveEnvelopeToCurrent(parsed, migrations);

    assert.equal(result.value, parsed);
    assert.equal(result.migrated, false);
    assert.equal(called, false);
});

test('future and unsupported legacy versions are rejected deterministically', async () => {
    const {
        createSaveMigrationRegistry,
        deserializeGameStateFromSaveJson,
        serializeGameStateToSaveJson,
    } = await persistenceModule();
    const { createFreshGameState } = await stateModule();
    const currentText = serializeGameStateToSaveJson(createFreshGameState(), {
        saveVersion: 1,
        gameVersion: '0.1.0-test',
        contentVersion: 'current-test',
        savedAtUtc: '2026-08-22T08:30:45.123Z',
    });

    const future = JSON.parse(currentText);
    future.saveVersion = 2;
    const futureResult = deserializeGameStateFromSaveJson(JSON.stringify(future));
    assert.deepEqual(futureResult.diagnostics.map((diagnostic) => diagnostic.code), ['SAVE_UNSUPPORTED_VERSION']);

    const unsupportedLegacy = parseFixture('synthetic_v0_progress.json');
    const unsupportedResult = deserializeGameStateFromSaveJson(JSON.stringify(unsupportedLegacy), {
        migrations: createSaveMigrationRegistry(1, []),
    });
    assert.deepEqual(unsupportedResult.diagnostics.map((diagnostic) => diagnostic.code), ['SAVE_UNSUPPORTED_LEGACY_VERSION']);
});

test('migration steps must update saveVersion to their immediate target', async () => {
    const {
        createSaveMigrationRegistry,
        migrateParsedSaveEnvelopeToCurrent,
    } = await persistenceModule();
    const migrations = createSaveMigrationRegistry(1, [{
        id: 'bad-target-v0-to-v1',
        sourceVersion: 0,
        targetVersion: 1,
        migrate: (legacyEnvelope) => ({
            ...legacyEnvelope,
            saveVersion: 0,
        }),
    }]);

    const result = migrateParsedSaveEnvelopeToCurrent(parseFixture('synthetic_v0_progress.json'), migrations);

    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ['SAVE_MIGRATION_INVALID_TARGET_VERSION']);
});

test('test-only chained fixture executes strictly sequential migrations in order', async () => {
    const {
        createSaveMigrationRegistry,
        migrateParsedSaveEnvelopeToCurrent,
    } = await persistenceModule();
    const migrations = createSaveMigrationRegistry(2, [
        {
            id: 'synthetic-chain-v0-to-v1',
            sourceVersion: 0,
            targetVersion: 1,
            migrate: (legacyEnvelope) => {
                const payload = clonePlain(requireRecord(legacyEnvelope.payload, '$.payload'));
                payload.history = [...payload.history, 'v0-to-v1'];
                return {
                    ...legacyEnvelope,
                    saveVersion: 1,
                    payload,
                };
            },
        },
        {
            id: 'synthetic-chain-v1-to-v2',
            sourceVersion: 1,
            targetVersion: 2,
            migrate: (legacyEnvelope) => {
                const payload = clonePlain(requireRecord(legacyEnvelope.payload, '$.payload'));
                payload.history = [...payload.history, 'v1-to-v2'];
                return {
                    ...legacyEnvelope,
                    saveVersion: 2,
                    payload,
                };
            },
        },
    ]);

    const result = migrateParsedSaveEnvelopeToCurrent(parseFixture('synthetic_chain_v0.json'), migrations);

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.value.saveVersion, 2);
    assert.deepEqual(result.value.payload.history, ['v0-to-v1', 'v1-to-v2']);
    assert.deepEqual(result.appliedMigrations.map((migration) => migration.id), [
        'synthetic-chain-v0-to-v1',
        'synthetic-chain-v1-to-v2',
    ]);
});

test('atomic load consumes a migratable legacy main without writing migration output by itself', async () => {
    const {
        AtomicSaveRepository,
        InMemorySaveStorage,
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const legacyMain = readFixture('synthetic_v0_progress.json');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: legacyMain });
    const repository = new AtomicSaveRepository(storage, { migrations: await syntheticV0Registry() });

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'loaded_main');
    assert.equal(loaded.state.run.industrialOutput, 12345.5);
    assert.equal(storage.getFile(SAVE_MAIN_NAME), legacyMain);
});

test('failed legacy main migration still allows fallback to a migratable backup', async () => {
    const {
        AtomicSaveRepository,
        InMemorySaveStorage,
        SAVE_BACKUP_NAME,
        SAVE_MAIN_NAME,
    } = await persistenceModule();
    const invalidMain = clonePlain(parseFixture('synthetic_v0_progress.json'));
    delete invalidMain.gameVersion;
    const legacyBackup = readFixture('synthetic_v0_missing_reduced_motion.json');
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: JSON.stringify(invalidMain),
        [SAVE_BACKUP_NAME]: legacyBackup,
    });
    const repository = new AtomicSaveRepository(storage, { migrations: await syntheticV0Registry() });

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.settings.reducedMotion, false);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), legacyBackup);
});
