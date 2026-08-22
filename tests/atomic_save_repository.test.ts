const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const persistenceModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/persistence/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

async function persistenceModule() {
    return import(persistenceModuleUrl);
}

async function stateModule() {
    return import(stateModuleUrl);
}

function metadata(label = 'base') {
    return Object.freeze({
        saveVersion: 1,
        gameVersion: '0.1.0-test',
        contentVersion: `0.1.0-${label}`,
        savedAtUtc: '2026-08-22T08:30:45.123Z',
    });
}

async function stateWithIndustrialOutput(industrialOutput) {
    const { createFreshGameState } = await stateModule();
    const state = createFreshGameState();
    state.run.industrialOutput = industrialOutput;
    state.run.statistics.industrialOutputEarned = industrialOutput;
    state.lifetime.industrialOutputEarned = industrialOutput;
    return state;
}

async function saveTextForState(industrialOutput, label = `io-${industrialOutput}`) {
    const { serializeGameStateToSaveJson } = await persistenceModule();
    return serializeGameStateToSaveJson(await stateWithIndustrialOutput(industrialOutput), metadata(label));
}

async function industrialOutputFromText(text) {
    const { assertDeserializeGameStateFromSaveJson } = await persistenceModule();
    return assertDeserializeGameStateFromSaveJson(text).state.run.industrialOutput;
}

test('successful save writes validated temp and promotes it to main', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const storage = new InMemorySaveStorage();
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(10), metadata('new'));

    assert.equal(result.ok, true);
    assert.equal(result.wroteBackup, false);
    assert.equal(await industrialOutputFromText(storage.getFile(SAVE_MAIN_NAME)), 10);
    assert.equal(storage.hasFile(SAVE_BACKUP_NAME), false);
});

test('successful replacement preserves previous valid main as backup', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const oldMain = await saveTextForState(5, 'old');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: oldMain });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(20), metadata('new'));

    assert.equal(result.ok, true);
    assert.equal(result.wroteBackup, true);
    assert.equal(await industrialOutputFromText(storage.getFile(SAVE_MAIN_NAME)), 20);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), oldMain);
});

test('serialization failure leaves main and backup untouched', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const backup = await saveTextForState(2, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save({ run: {} }, metadata('invalid'));

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'serialization_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('temp write failure leaves main and backup untouched', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const backup = await saveTextForState(2, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    storage.failNext({ operation: 'write', name: SAVE_TEMP_NAME, message: 'no temp write' });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(3), metadata('new'));

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'temp_write_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('temp read verification failure leaves main and backup untouched', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const backup = await saveTextForState(2, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    storage.failNext({ operation: 'read', name: SAVE_TEMP_NAME, message: 'no temp read' });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(3), metadata('new'));

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'temp_verification_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('invalid temp verification failure never promotes temp to main', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const backup = await saveTextForState(2, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    storage.corruptNextWrite(SAVE_TEMP_NAME, '{');
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(3), metadata('new'));

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'temp_verification_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
    assert.equal(storage.getFile(SAVE_TEMP_NAME), '{');
});

test('backup rotation failure leaves current valid copies untouched', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const backup = await saveTextForState(2, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    storage.failNext({ operation: 'copy', fromName: SAVE_MAIN_NAME, toName: SAVE_BACKUP_NAME, message: 'backup full' });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(3), metadata('new'));

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'backup_rotation_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('destructive main promotion failure preserves previous valid main through backup', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main });
    storage.failNext({
        operation: 'replace',
        fromName: SAVE_TEMP_NAME,
        toName: SAVE_MAIN_NAME,
        mode: 'after_delete_destination',
        message: 'replace failed after destination delete',
    });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(3), metadata('new'));
    const loaded = await repository.load();

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'main_promotion_failed');
    assert.equal(storage.hasFile(SAVE_MAIN_NAME), true);
    assert.equal(await industrialOutputFromText(storage.getFile(SAVE_MAIN_NAME)), 1);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), main);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 1);
});

test('corrupted main plus valid backup loads backup and restores main without overwriting backup', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const backup = await saveTextForState(9, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: backup });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 9);
    assert.equal(loaded.recovery.status, 'succeeded');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), backup);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('backup recovery failure still returns the validated backup state', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const backup = await saveTextForState(9, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: backup });
    storage.failNext({
        operation: 'replace',
        fromName: SAVE_TEMP_NAME,
        toName: SAVE_MAIN_NAME,
        mode: 'after_delete_destination',
        message: 'cannot restore main',
    });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 9);
    assert.equal(loaded.recovery.status, 'failed');
    assert.equal(loaded.recovery.reason, 'main_promotion_failed');
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('valid main takes precedence over backup and stale temp', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const main = await saveTextForState(1, 'main');
    const backup = await saveTextForState(2, 'backup');
    const temp = await saveTextForState(3, 'temp');
    const storage = new InMemorySaveStorage({ [SAVE_TEMP_NAME]: temp, [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'loaded_main');
    assert.equal(loaded.state.run.industrialOutput, 1);
});

test('stale temp never takes precedence over valid backup', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_TEMP_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const backup = await saveTextForState(2, 'backup');
    const temp = await saveTextForState(3, 'temp');
    const storage = new InMemorySaveStorage({ [SAVE_TEMP_NAME]: temp, [SAVE_BACKUP_NAME]: backup });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 2);
});

test('fresh-game fallback is explicit when neither main nor backup is valid or present', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: '{' });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'fresh_started');
    assert.equal(loaded.fresh, true);
    assert.equal(loaded.state.run.industrialOutput, 0);
    assert.equal(loaded.main.status, 'invalid');
    assert.equal(loaded.backup.status, 'invalid');
});

test('backup preservation prefers valid backup over corrupted newer main during save', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistenceModule();
    const backup = await saveTextForState(7, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: backup });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithIndustrialOutput(11), metadata('new'));

    assert.equal(result.ok, true);
    assert.equal(result.wroteBackup, false);
    assert.equal(await industrialOutputFromText(storage.getFile(SAVE_MAIN_NAME)), 11);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('read errors fail deterministically instead of silently starting fresh', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_BACKUP_NAME } = await persistenceModule();
    const storage = new InMemorySaveStorage();
    storage.failNext({ operation: 'read', name: SAVE_BACKUP_NAME, message: 'backup unreadable' });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, false);
    assert.equal(loaded.status, 'failed');
    assert.equal(loaded.reason, 'backup_read_failed');
});

test('dirty scheduler marks dirty idempotently and clears only after successful save', async () => {
    const { DirtySaveTracker } = await persistenceModule();
    const tracker = new DirtySaveTracker(0);

    const first = tracker.markDirty(2);
    const second = tracker.markDirty(10);
    const failed = tracker.recordSaveFailed();
    const succeeded = tracker.recordSaveSucceeded(12);

    assert.equal(first.dirty, true);
    assert.equal(first.lastDirtyElapsedSeconds, 2);
    assert.equal(second.lastDirtyElapsedSeconds, 2);
    assert.equal(failed.dirty, true);
    assert.equal(succeeded.dirty, false);
    assert.equal(succeeded.lastDirtyElapsedSeconds, null);
    assert.equal(succeeded.lastSuccessfulSaveElapsedSeconds, 12);
});

test('dirty scheduler supports debounce, periodic and critical save decisions from caller elapsed time', async () => {
    const { DirtySaveTracker, shouldSaveDirtyState } = await persistenceModule();
    const policy = { debounceSeconds: 5, periodicSeconds: 25 };
    const tracker = new DirtySaveTracker(0);

    assert.deepEqual(tracker.shouldSave(1, policy), { shouldSave: false, reason: 'not_dirty' });
    tracker.markDirty(10);
    assert.deepEqual(tracker.shouldSave(12, policy), { shouldSave: false, reason: 'waiting' });
    assert.deepEqual(tracker.shouldSave(15, policy), { shouldSave: true, reason: 'debounce_elapsed' });

    const periodicTracker = new DirtySaveTracker(0);
    periodicTracker.markDirty(24);
    assert.deepEqual(periodicTracker.shouldSave(25, policy), { shouldSave: true, reason: 'periodic_elapsed' });

    assert.deepEqual(shouldSaveDirtyState({
        dirty: false,
        critical: true,
        elapsedSinceDirtySeconds: 0,
        elapsedSinceLastSuccessfulSaveSeconds: 0,
    }, policy), { shouldSave: true, reason: 'critical' });
});
