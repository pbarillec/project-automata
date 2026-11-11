const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function harness(files = {}) {
    const { InMemorySaveStorage } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    return {
        storage: new InMemorySaveStorage(files),
        clock: new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z', monotonicSeconds: 0 }),
    };
}

async function bootstrap(h) {
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    return bootstrapGameSession({ storage: h.storage, timeService: h.clock });
}

function writes(storage) {
    return storage.operationLog().filter((record) => record.operation !== 'read');
}

test('empty storage starts a fresh game with the embedded config', async () => {
    const h = await harness();
    const result = await bootstrap(h);
    assert.equal(result.startup.ok, true);
    assert.equal(result.startup.status, 'fresh_game');
    assert.equal(result.startup.offlinePreview, null);
    assert.ok(result.configRepository.getProducer('fabricator'));
});

test('execute + suspend writes save_main.json; re-bootstrap of the same storage loads it deep-equal', async () => {
    const { SAVE_MAIN_NAME, assertDeserializeGameStateFromSaveJson } = await imp('assets/scripts/persistence/index.ts');
    const { GAME_SESSION_DEV_GAME_VERSION } = await imp('assets/scripts/lifecycle/index.ts');
    const h = await harness();
    const first = await bootstrap(h);
    assert.equal(first.startup.ok, true);
    const session = first.startup.session;

    const command = await session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(command.execution.ok, true);
    const suspended = await session.suspend();
    assert.equal(suspended.status, 'suspended_saved');
    assert.equal(h.storage.hasFile(SAVE_MAIN_NAME), true);
    const envelope = assertDeserializeGameStateFromSaveJson(h.storage.getFile(SAVE_MAIN_NAME)).envelope;
    assert.equal(envelope.gameVersion, GAME_SESSION_DEV_GAME_VERSION);
    assert.equal(envelope.contentVersion, first.configRepository.contentVersion);

    const second = await bootstrap(h);
    assert.equal(second.startup.ok, true);
    assert.equal(second.startup.status, 'loaded_main');
    assert.deepEqual(second.startup.session.getStateSnapshot(), session.getStateSnapshot());
    assert.ok(second.startup.session.getStateSnapshot().run.industrialOutput > 0);
});

test('corrupt main with a valid backup recovers from the backup', async () => {
    const { SAVE_MAIN_NAME, SAVE_BACKUP_NAME, serializeGameStateToSaveJson } = await imp('assets/scripts/persistence/index.ts');
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const state = createFreshGameState();
    state.run.industrialOutput = 42;
    const backup = serializeGameStateToSaveJson(state, { saveVersion: 2, gameVersion: 'test', contentVersion: 'test', savedAtUtc: '2026-11-10T08:00:00.000Z' });
    const h = await harness({ [SAVE_MAIN_NAME]: '{ corrupt', [SAVE_BACKUP_NAME]: backup });

    const result = await bootstrap(h);
    assert.equal(result.startup.ok, true);
    assert.equal(result.startup.status, 'recovered_backup');
    assert.equal(result.startup.session.getStateSnapshot().run.industrialOutput, 42);
});

test('a storage read error reports load_failed and performs zero writes', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const h = await harness();
    h.storage.failNext({ operation: 'read', name: SAVE_MAIN_NAME, message: 'disk unavailable' });

    const result = await bootstrap(h);
    assert.equal(result.startup.ok, false);
    assert.equal(result.startup.status, 'load_failed');
    assert.equal(result.startup.session, undefined);
    assert.deepEqual(writes(h.storage), []);
    assert.deepEqual(h.storage.snapshot(), {});
});

test('GameSessionBootstrap.ts is engine-free and does not use real clocks', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/lifecycle/GameSessionBootstrap.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc['"]|cc\/env/);
    assert.doesNotMatch(source, /Date\.now|setTimeout|setInterval|DefaultTimeService/);
    assert.match(source, /AtomicSaveRepository/);
    assert.match(source, /PersistenceCoordinator/);
    assert.match(source, /LifecycleSessionCoordinator\.startup/);
    assert.match(source, /getEmbeddedEconomyConfigSources/);
});
