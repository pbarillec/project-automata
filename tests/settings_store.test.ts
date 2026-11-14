const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

/** In-memory synchronous file port with optional fault injection and an operation log. */
function createPort({ files = {}, failOn = null } = {}) {
    const store = new Map(Object.entries(files));
    const log = [];
    const maybeFail = (op) => { if (failOn === op) throw new Error(`${op} failed`); };
    return {
        store,
        log,
        readText(name) { log.push(['read', name]); maybeFail('read'); return store.get(name); },
        writeText(name, text) { log.push(['write', name]); maybeFail('write'); store.set(name, text); },
        move(from, to) { log.push(['move', from, to]); maybeFail('move'); if (!store.has(from)) throw new Error('missing source'); store.set(to, store.get(from)); store.delete(from); },
        remove(name) { log.push(['remove', name]); store.delete(name); },
    };
}

test('load: a missing file gives the defaults and reports source default', async () => {
    const { SettingsStore } = await imp('assets/scripts/settings/SettingsStore.ts');
    const { DEFAULT_USER_SETTINGS } = await imp('assets/scripts/settings/UserSettings.ts');
    const events = [];
    const store = new SettingsStore(createPort(), (event) => events.push(event));
    assert.deepEqual({ ...store.load() }, { ...DEFAULT_USER_SETTINGS });
    assert.equal(store.getSource(), 'default');
    assert.deepEqual(events, [{ kind: 'loaded', source: 'default' }]);
});

test('round trip: update persists through settings.json and a new store reads it back (source file)', async () => {
    const { SettingsStore, SETTINGS_FILE } = await imp('assets/scripts/settings/SettingsStore.ts');
    const port = createPort();
    const first = new SettingsStore(port);
    first.load();
    assert.equal(first.update({ musicEnabled: false, vibrationEnabled: false }), true);
    assert.ok(port.store.has(SETTINGS_FILE));
    const second = new SettingsStore(port);
    const loaded = second.load();
    assert.equal(second.getSource(), 'file');
    assert.equal(loaded.musicEnabled, false);
    assert.equal(loaded.vibrationEnabled, false);
    assert.equal(loaded.sfxEnabled, true);
});

test('atomic write: the temp file is written first and moved onto settings.json; no temp file is left behind', async () => {
    const { SettingsStore, SETTINGS_FILE, SETTINGS_TEMP_FILE } = await imp('assets/scripts/settings/SettingsStore.ts');
    assert.equal(SETTINGS_TEMP_FILE, 'settings_temp.json');
    assert.equal(SETTINGS_FILE, 'settings.json');
    const port = createPort();
    const store = new SettingsStore(port);
    store.load();
    port.log.length = 0;
    store.update({ sfxEnabled: false });
    assert.deepEqual(port.log, [['write', SETTINGS_TEMP_FILE], ['move', SETTINGS_TEMP_FILE, SETTINGS_FILE]]);
    assert.equal(port.store.has(SETTINGS_TEMP_FILE), false);
});

test('write failure is contained: update returns false, the in-memory change and listeners still apply, the failure is reported, the temp file is cleaned', async () => {
    const { SettingsStore, SETTINGS_TEMP_FILE } = await imp('assets/scripts/settings/SettingsStore.ts');
    for (const failOn of ['write', 'move']) {
        const events = [];
        const port = createPort({ failOn });
        const store = new SettingsStore(port, (event) => events.push(event));
        store.load();
        const seen = [];
        store.subscribe((settings) => seen.push(settings.musicEnabled));
        assert.doesNotThrow(() => assert.equal(store.update({ musicEnabled: false }), false));
        assert.equal(store.get().musicEnabled, false, 'toggle still works for the session');
        assert.deepEqual(seen, [false]);
        assert.ok(events.some((event) => event.kind === 'save_failed' && /failed/.test(event.message)), failOn);
        assert.equal(port.store.has(SETTINGS_TEMP_FILE), false);
    }
});

test('read failure is contained and gives the defaults', async () => {
    const { SettingsStore } = await imp('assets/scripts/settings/SettingsStore.ts');
    const events = [];
    const store = new SettingsStore(createPort({ failOn: 'read' }), (event) => events.push(event));
    assert.doesNotThrow(() => store.load());
    assert.equal(store.get().musicEnabled, true);
    assert.equal(events[0].kind, 'load_failed');
    assert.equal(events[1].kind, 'loaded');
});

test('a corrupt file gives the defaults (source corrupt) and is overwritten by the next update', async () => {
    const { SettingsStore, SETTINGS_FILE } = await imp('assets/scripts/settings/SettingsStore.ts');
    const port = createPort({ files: { 'settings.json': '{broken' } });
    const store = new SettingsStore(port);
    store.load();
    assert.equal(store.getSource(), 'corrupt');
    store.update({ musicEnabled: false });
    assert.equal(JSON.parse(port.store.get(SETTINGS_FILE)).musicEnabled, false);
});

test('subscribe: listeners fire only on a real change, unsubscribe stops them, a throwing listener or sink never breaks update', async () => {
    const { SettingsStore } = await imp('assets/scripts/settings/SettingsStore.ts');
    const store = new SettingsStore(createPort(), () => { throw new Error('sink boom'); });
    store.load();
    const calls = [];
    const unsubscribe = store.subscribe((settings, previous) => calls.push([previous.sfxEnabled, settings.sfxEnabled]));
    store.subscribe(() => { throw new Error('listener boom'); });
    store.update({ sfxEnabled: true });
    assert.deepEqual(calls, [], 'no change, no notification');
    store.update({ sfxEnabled: false });
    assert.deepEqual(calls, [[true, false]]);
    unsubscribe();
    store.update({ sfxEnabled: true });
    assert.equal(calls.length, 1);
});

test('the store never touches the game save files', async () => {
    const { SettingsStore } = await imp('assets/scripts/settings/SettingsStore.ts');
    const port = createPort({ files: { 'save_main.json': 'SAVE', 'save_backup.json': 'BACKUP' } });
    const store = new SettingsStore(port);
    store.load();
    store.update({ musicEnabled: false });
    assert.equal(port.store.get('save_main.json'), 'SAVE');
    assert.equal(port.store.get('save_backup.json'), 'BACKUP');
    assert.deepEqual(port.log.filter((entry) => /save_/.test(String(entry[1]))), []);
});

test('CocosFileSystemPort is structurally the synchronous port the store needs', async () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(path.join(repoRoot, 'assets/scripts/app/CocosFileSystemPort.ts'), 'utf8');
    for (const method of ['readText(path: string): string | undefined', 'writeText(path: string, text: string): void', 'move(fromPath: string, toPath: string): void', 'remove(path: string): void']) {
        assert.ok(source.includes(`public ${method}`), method);
    }
});
