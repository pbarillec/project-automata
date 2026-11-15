// AUT-071 error handling and recovery matrix: SAVE cells (corrupt, truncated, future version, failed write, migration failure).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const persistence = () => imp('assets/scripts/persistence/index.ts');

function metadata(label = 'base', savedAtUtc = '2026-11-10T07:00:00.000Z', saveVersion = 3) {
    return Object.freeze({ saveVersion, gameVersion: '0.1.0-test', contentVersion: label, savedAtUtc });
}

async function stateWithOutput(industrialOutput) {
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const state = createFreshGameState();
    state.run.industrialOutput = industrialOutput;
    state.run.statistics.industrialOutputEarned = industrialOutput;
    state.lifetime.industrialOutputEarned = industrialOutput;
    return state;
}

async function saveText(industrialOutput, label = `io-${industrialOutput}`) {
    const { serializeGameStateToSaveJson } = await persistence();
    return serializeGameStateToSaveJson(await stateWithOutput(industrialOutput), metadata(label));
}

async function outputOf(text) {
    const { assertDeserializeGameStateFromSaveJson } = await persistence();
    return assertDeserializeGameStateFromSaveJson(text).state.run.industrialOutput;
}

function mutations(storage) {
    return storage.operationLog().filter((record) => record.operation !== 'read');
}

async function futureVersionText(version = 4) {
    const parsed = JSON.parse(await saveText(77, 'future'));
    parsed.saveVersion = version;
    parsed.futureOnlyField = { shinyNewFeature: true };
    return JSON.stringify(parsed);
}

test('AUT-071 SAVE corrupt main + valid backup: recovers the backup, never rewrites it, keeps the corrupt main for diagnosis', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME } = await persistence();
    const backup = await saveText(9, 'backup');
    const corruptMain = '{"saveVersion":3,"payload":';
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: corruptMain, [SAVE_BACKUP_NAME]: backup });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 9);
    assert.equal(loaded.recovery.status, 'succeeded');
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
    assert.equal(storage.getFile(SAVE_MAIN_NAME), backup);
    assert.deepEqual({ status: loaded.quarantine.status, source: loaded.quarantine.source }, { status: 'preserved', source: 'main' });
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), corruptMain);
    assert.equal(mutations(storage).some((record) => record.toName === SAVE_BACKUP_NAME || record.name === SAVE_BACKUP_NAME), false);
});

test('AUT-071 SAVE corrupt main AND corrupt backup: a safe fresh game, no crash, both corrupt files are never silently destroyed', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME } = await persistence();
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{"broken main', [SAVE_BACKUP_NAME]: 'not json at all' });
    const repository = new AtomicSaveRepository(storage);

    const loaded = await repository.load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'fresh_started');
    assert.equal(loaded.fresh, true);
    assert.equal(loaded.state.run.industrialOutput, 0);
    assert.equal(loaded.quarantine.status, 'preserved');
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), '{"broken main');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), '{"broken main', 'load alone never rewrites main');

    // The first fresh save replaces the corrupt main, but the diagnostic copy survives it (and later saves).
    const first = await repository.save(await stateWithOutput(5), metadata('fresh-1'));
    const second = await repository.save(await stateWithOutput(6), metadata('fresh-2'));
    assert.equal(first.ok && second.ok, true);
    assert.equal(await outputOf(storage.getFile(SAVE_MAIN_NAME)), 6);
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), '{"broken main');
});

test('AUT-071 SAVE missing main + corrupt backup keeps the corrupt backup for diagnosis too', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME } = await persistence();
    const storage = new InMemorySaveStorage({ [SAVE_BACKUP_NAME]: '{"half' });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.status, 'fresh_started');
    assert.deepEqual({ status: loaded.quarantine.status, source: loaded.quarantine.source }, { status: 'preserved', source: 'backup' });
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), '{"half');
});

test('AUT-071 SAVE a failed diagnostic copy never blocks or changes the recovery', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME } = await persistence();
    const backup = await saveText(4, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: backup });
    storage.failNext({ operation: 'write', name: SAVE_CORRUPT_NAME, message: 'disk full' });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 4);
    assert.equal(loaded.quarantine.status, 'failed');
    assert.equal(loaded.recovery.status, 'succeeded');
});

test('AUT-071 SAVE truncated main (partial write) with a valid backup recovers; the truncated bytes are preserved', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME } = await persistence();
    const full = await saveText(21, 'main');
    const truncated = full.slice(0, Math.floor(full.length / 2));
    const backup = await saveText(20, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: truncated, [SAVE_BACKUP_NAME]: backup });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 20);
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), truncated);
});

test('AUT-071 SAVE crash simulation: a partial temp (crash during the temp write) never reaches main and is ignored on load', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_TEMP_NAME } = await persistence();
    const main = await saveText(1, 'main');
    const backup = await saveText(2, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main, [SAVE_BACKUP_NAME]: backup });
    storage.transformNextWrite(SAVE_TEMP_NAME, (text) => text.slice(0, 40));
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithOutput(3), metadata('new'));
    const loaded = await repository.load();

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'temp_verification_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
    assert.equal(loaded.status, 'loaded_main');
    assert.equal(loaded.state.run.industrialOutput, 1);
});

test('AUT-071 SAVE crash simulation: dying after the temp is verified but before promotion keeps the old main loadable', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_TEMP_NAME } = await persistence();
    const main = await saveText(1, 'main');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: main });
    storage.failNext({ operation: 'replace', fromName: SAVE_TEMP_NAME, toName: SAVE_MAIN_NAME, message: 'process killed' });
    const repository = new AtomicSaveRepository(storage);

    const result = await repository.save(await stateWithOutput(3), metadata('new'));
    const loaded = await repository.load();

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'main_promotion_failed');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), main);
    assert.equal(loaded.status, 'loaded_main');
    assert.equal(loaded.state.run.industrialOutput, 1);
});

test('AUT-071 SAVE unknown future save version: load refuses, writes nothing, never downgrades or starts fresh (main future + valid older backup)', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistence();
    const futureMain = await futureVersionText(4);
    const backup = await saveText(5, 'older-backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: futureMain, [SAVE_BACKUP_NAME]: backup });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.ok, false);
    assert.equal(loaded.status, 'failed');
    assert.equal(loaded.reason, 'unsupported_future_version');
    assert.equal(mutations(storage).length, 0);
    assert.equal(storage.getFile(SAVE_MAIN_NAME), futureMain);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('AUT-071 SAVE unknown future save version in the backup only (main unreadable) also refuses instead of starting fresh', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await persistence();
    const futureBackup = await futureVersionText(9);
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{', [SAVE_BACKUP_NAME]: futureBackup });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, 'unsupported_future_version');
    assert.equal(mutations(storage).length, 0);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), futureBackup);
});

test('AUT-071 SAVE a version below the current one is NOT a future version (plain unreadable legacy save)', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME } = await persistence();
    const legacy = JSON.parse(await saveText(1));
    legacy.saveVersion = -1;
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: JSON.stringify(legacy) });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'fresh_started');
    assert.equal(loaded.main.status, 'invalid');
    assert.equal(loaded.main.futureSaveVersion, undefined);
});

test('AUT-071 SAVE future version through the session bootstrap: load_failed, zero writes, the session never exists', async () => {
    const { InMemorySaveStorage, SAVE_MAIN_NAME } = await persistence();
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const futureMain = await futureVersionText(4);
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: futureMain });

    const result = await bootstrapGameSession({ storage, timeService: new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z' }) });

    assert.equal(result.startup.ok, false);
    assert.equal(result.startup.status, 'load_failed');
    assert.equal(result.startup.load.reason, 'unsupported_future_version');
    assert.equal(mutations(storage).length, 0);
    assert.equal(storage.getFile(SAVE_MAIN_NAME), futureMain);
});

test('AUT-071 SAVE corrupt main AND corrupt backup through the session bootstrap: playable fresh session, corrupt file kept', async () => {
    const { InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME } = await persistence();
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: '{{{', [SAVE_BACKUP_NAME]: '[]' });

    const result = await bootstrapGameSession({ storage, timeService: new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z' }) });

    assert.equal(result.startup.ok, true);
    assert.equal(result.startup.status, 'fresh_game');
    const command = await result.startup.session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(command.execution.ok, true);
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), '{{{');
});

test('AUT-071 SAVE failed write (storage full / IO error) keeps the in-memory session playing and the next save retries and lands everything', async () => {
    const { InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_TEMP_NAME } = await persistence();
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const clock = new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z', monotonicSeconds: 0 });
    const storage = new InMemorySaveStorage();
    const { startup } = await bootstrapGameSession({ storage, timeService: clock });
    const session = startup.session;

    storage.failNext({ operation: 'write', name: SAVE_TEMP_NAME, message: 'ENOSPC: no space left on device' });
    clock.advanceMonotonicSeconds(30); // past the ordinary-save cadence so the save is attempted
    const first = await session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(first.execution.ok, true, 'the command still applies in memory');
    assert.equal(first.save.ok, false);
    assert.equal(first.save.save.reason, 'temp_write_failed');
    assert.equal(storage.hasFile(SAVE_MAIN_NAME), false);
    const afterFirst = session.getStateSnapshot().run.industrialOutput;
    assert.ok(afterFirst > 0);

    // Play continues; still dirty, so the next cadence save retries and persists both taps.
    clock.advanceMonotonicSeconds(30);
    const second = await session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(second.execution.ok, true);
    assert.equal(second.save.ok, true);
    assert.equal(await outputOf(storage.getFile(SAVE_MAIN_NAME)), session.getStateSnapshot().run.industrialOutput);
    assert.ok(session.getStateSnapshot().run.industrialOutput > afterFirst);
});

test('AUT-071 SAVE failed critical suspend save is reported, the session survives and a later suspend persists', async () => {
    const { InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_TEMP_NAME } = await persistence();
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const clock = new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z', monotonicSeconds: 0 });
    const storage = new InMemorySaveStorage();
    const { startup } = await bootstrapGameSession({ storage, timeService: clock });
    await startup.session.execute({ type: 'manualProduce' });

    storage.failNext({ operation: 'write', name: SAVE_TEMP_NAME, message: 'EIO' });
    const failed = await startup.session.suspend();
    assert.equal(failed.status, 'suspend_save_failed');
    assert.equal(storage.hasFile(SAVE_MAIN_NAME), false);

    startup.session.resume();
    const retried = await startup.session.suspend();
    assert.equal(retried.status, 'suspended_saved');
    assert.equal(await outputOf(storage.getFile(SAVE_MAIN_NAME)), startup.session.getStateSnapshot().run.industrialOutput);
});

test('AUT-071 SAVE migration failure: a throwing step makes the main unreadable, the backup is used, the legacy bytes are preserved', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME, CURRENT_SAVE_VERSION, createSaveMigrationRegistry, PRODUCTION_SAVE_MIGRATION_STEPS } = await persistence();
    // A "v0" main whose migration step throws; the production chain continues from v1.
    const legacy = JSON.stringify({ ...JSON.parse(await saveText(1)), saveVersion: 0 });
    const registry = createSaveMigrationRegistry(CURRENT_SAVE_VERSION, [{
        id: 'broken-test-v0-to-v1',
        sourceVersion: 0,
        targetVersion: 1,
        migrate: () => { throw new Error('migration bug'); },
    }, ...PRODUCTION_SAVE_MIGRATION_STEPS]);
    const backup = await saveText(8, 'backup');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: legacy, [SAVE_BACKUP_NAME]: backup });
    const repository = new AtomicSaveRepository(storage, { migrations: registry });

    const loaded = await repository.load();

    assert.equal(loaded.status, 'recovered_backup');
    assert.equal(loaded.state.run.industrialOutput, 8);
    assert.equal(loaded.main.status, 'invalid');
    assert.equal(loaded.main.diagnostics.some((entry) => entry.code === 'SAVE_MIGRATION_FAILED'), true);
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), legacy);
    assert.equal(storage.getFile(SAVE_BACKUP_NAME), backup);
});

test('AUT-071 SAVE migration failure of main AND backup: fresh game, the migration-failed main is preserved', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_BACKUP_NAME, SAVE_CORRUPT_NAME, CURRENT_SAVE_VERSION, createSaveMigrationRegistry } = await persistence();
    const legacy = JSON.stringify({ ...JSON.parse(await saveText(1)), saveVersion: 0 });
    const registry = createSaveMigrationRegistry(CURRENT_SAVE_VERSION, [{
        id: 'broken-test-v0-to-v1',
        sourceVersion: 0,
        targetVersion: 1,
        migrate: () => { throw new Error('migration bug'); },
    }]);
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: legacy, [SAVE_BACKUP_NAME]: legacy });

    const loaded = await new AtomicSaveRepository(storage, { migrations: registry }).load();

    assert.equal(loaded.status, 'fresh_started');
    assert.equal(storage.getFile(SAVE_CORRUPT_NAME), legacy);
});

test('AUT-071 SAVE storage read error is never treated as a missing or corrupt save (no fresh start, no quarantine, no writes)', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_MAIN_NAME } = await persistence();
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: await saveText(3) });
    storage.failNext({ operation: 'read', name: SAVE_MAIN_NAME, message: 'EACCES' });
    storage.failNext({ operation: 'read', name: 'save_backup.json', message: 'EACCES' });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, 'main_read_failed');
    assert.equal(mutations(storage).length, 0);
});

test('AUT-071 SAVE the quarantine file is outside recovery precedence: it is never loaded', async () => {
    const { AtomicSaveRepository, InMemorySaveStorage, SAVE_CORRUPT_NAME } = await persistence();
    const storage = new InMemorySaveStorage({ [SAVE_CORRUPT_NAME]: await saveText(99, 'diagnostic') });

    const loaded = await new AtomicSaveRepository(storage).load();

    assert.equal(loaded.status, 'fresh_started');
    assert.equal(loaded.state.run.industrialOutput, 0);
});
