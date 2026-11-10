const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

/** Map-backed FileSystemPort fake with optional injected failures. */
function createFakePort(initial = {}) {
    const files = new Map(Object.entries(initial));
    const failures = [];
    const log = [];
    const fail = (op, p) => {
        const index = failures.findIndex((rule) => rule.op === op && (rule.path === undefined || rule.path === p));
        if (index >= 0) {
            failures.splice(index, 1);
            throw new Error(`fake ${op} failure`);
        }
    };
    return {
        files,
        log,
        failNext(op, p) { failures.push({ op, path: p }); },
        exists(p) { log.push(['exists', p]); fail('exists', p); return files.has(p); },
        readText(p) { log.push(['read', p]); fail('read', p); return files.get(p); },
        writeText(p, text) { log.push(['write', p]); fail('write', p); files.set(p, text); },
        async move(from, to) { log.push(['move', from, to]); fail('move', from); files.set(to, files.get(from)); files.delete(from); },
        remove(p) { log.push(['remove', p]); fail('remove', p); files.delete(p); },
    };
}

async function outcome(fn) {
    try {
        return { ok: true, value: await fn() };
    }
    catch (error) {
        return { ok: false, name: error.name, operation: error.operation, message: error.message };
    }
}

function snapshotOf(port) {
    return Object.fromEntries([...port.files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function snapshotOfMemory(storage) {
    return Object.fromEntries(Object.entries(storage.snapshot()).sort(([a], [b]) => a.localeCompare(b)));
}

test('FileSaveStorage matches InMemorySaveStorage for read/write/copy/replace including missing sources', async () => {
    const { FileSaveStorage, InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_TEMP_NAME, SAVE_BACKUP_NAME } = await imp('assets/scripts/persistence/index.ts');
    const port = createFakePort();
    const file = new FileSaveStorage(port);
    const memory = new InMemorySaveStorage();

    const script = [
        (s) => s.readText(SAVE_MAIN_NAME),
        (s) => s.copyText(SAVE_MAIN_NAME, SAVE_BACKUP_NAME),
        (s) => s.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME),
        (s) => s.writeText(SAVE_TEMP_NAME, 'one'),
        (s) => s.readText(SAVE_TEMP_NAME),
        (s) => s.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME),
        (s) => s.readText(SAVE_TEMP_NAME),
        (s) => s.readText(SAVE_MAIN_NAME),
        (s) => s.copyText(SAVE_MAIN_NAME, SAVE_BACKUP_NAME),
        (s) => s.writeText(SAVE_TEMP_NAME, 'two'),
        (s) => s.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME),
        (s) => s.readText(SAVE_MAIN_NAME),
        (s) => s.readText(SAVE_BACKUP_NAME),
    ];

    for (const [index, step] of script.entries()) {
        const fromFile = await outcome(() => step(file));
        const fromMemory = await outcome(() => step(memory));
        assert.deepEqual(fromFile, fromMemory, `step ${index}`);
        assert.deepEqual(snapshotOf(port), snapshotOfMemory(memory), `files after step ${index}`);
    }
    assert.deepEqual(snapshotOf(port), { [SAVE_BACKUP_NAME]: 'one', [SAVE_MAIN_NAME]: 'two' });
});

test('FileSaveStorage replace moves source to destination, deletes the source, and wraps port failures', async () => {
    const { FileSaveStorage, SaveStorageError, SAVE_MAIN_NAME, SAVE_TEMP_NAME } = await imp('assets/scripts/persistence/index.ts');
    const port = createFakePort({ [SAVE_TEMP_NAME]: 'new', [SAVE_MAIN_NAME]: 'old' });
    const storage = new FileSaveStorage(port);

    await storage.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME);
    assert.deepEqual(snapshotOf(port), { [SAVE_MAIN_NAME]: 'new' });
    assert.ok(port.log.some(([op, from, to]) => op === 'move' && from === SAVE_TEMP_NAME && to === SAVE_MAIN_NAME));

    port.failNext('write', SAVE_TEMP_NAME);
    await assert.rejects(storage.writeText(SAVE_TEMP_NAME, 'x'), (error) => error instanceof SaveStorageError && error.operation === 'write');
    port.failNext('read', SAVE_MAIN_NAME);
    await assert.rejects(storage.readText(SAVE_MAIN_NAME), (error) => error instanceof SaveStorageError && error.operation === 'read');
    port.files.set(SAVE_TEMP_NAME, 'x');
    port.failNext('move', SAVE_TEMP_NAME);
    await assert.rejects(storage.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME), (error) => error instanceof SaveStorageError && error.operation === 'replace');
});

test('AtomicSaveRepository over FileSaveStorage saves atomically with backup rotation and recovers from backup', async () => {
    const {
        AtomicSaveRepository, FileSaveStorage, SAVE_BACKUP_NAME, SAVE_MAIN_NAME, SAVE_TEMP_NAME,
    } = await imp('assets/scripts/persistence/index.ts');
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const port = createFakePort();
    const repository = new AtomicSaveRepository(new FileSaveStorage(port));
    const metadata = (savedAtUtc) => ({ saveVersion: 1, gameVersion: '0.0.0-test', contentVersion: 'test', savedAtUtc });

    const first = createFreshGameState();
    first.run.industrialOutput = 10;
    const second = createFreshGameState();
    second.run.industrialOutput = 20;

    assert.equal((await repository.save(first, metadata('2026-11-10T00:00:00.000Z'))).ok, true);
    const secondSave = await repository.save(second, metadata('2026-11-10T00:01:00.000Z'));
    assert.equal(secondSave.ok, true);
    assert.equal(secondSave.wroteBackup, true);
    assert.equal(port.files.has(SAVE_TEMP_NAME), false);
    assert.ok(port.files.has(SAVE_MAIN_NAME));
    assert.ok(port.files.has(SAVE_BACKUP_NAME));

    const loaded = await repository.load();
    assert.equal(loaded.status, 'loaded_main');
    assert.equal(loaded.state.run.industrialOutput, 20);

    port.files.set(SAVE_MAIN_NAME, '{ corrupt');
    const recovered = await repository.load();
    assert.equal(recovered.status, 'recovered_backup');
    assert.equal(recovered.state.run.industrialOutput, 10);
    assert.equal(recovered.recovery.status, 'succeeded');
    assert.equal(port.files.get(SAVE_MAIN_NAME), port.files.get(SAVE_BACKUP_NAME));
    assert.equal(port.files.has(SAVE_TEMP_NAME), false);
});

test('FileSaveStorage stays engine-free', async () => {
    const { readFile } = require('node:fs/promises');
    const source = await readFile(path.join(repoRoot, 'assets/scripts/persistence/FileSaveStorage.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc['"]|cc\/env|native\.fileUtils|localStorage/);
});
