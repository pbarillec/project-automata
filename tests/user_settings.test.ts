const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

test('defaults: everything on, English, schema 1', async () => {
    const S = await imp('assets/scripts/settings/UserSettings.ts');
    assert.deepEqual({ ...S.DEFAULT_USER_SETTINGS }, { schemaVersion: 1, musicEnabled: true, sfxEnabled: true, vibrationEnabled: true, language: 'en' });
    assert.deepEqual([...S.AVAILABLE_LANGUAGES], ['en']);
    assert.ok(Object.isFrozen(S.DEFAULT_USER_SETTINGS));
});

test('parse: missing text gives the defaults (source default)', async () => {
    const S = await imp('assets/scripts/settings/UserSettings.ts');
    for (const input of [undefined, null]) {
        const result = S.parseUserSettings(input);
        assert.equal(result.source, 'default');
        assert.deepEqual({ ...result.settings }, { ...S.DEFAULT_USER_SETTINGS });
    }
});

test('parse: corrupt JSON, non-objects and unknown schemas never throw and give the defaults (source corrupt)', async () => {
    const S = await imp('assets/scripts/settings/UserSettings.ts');
    for (const input of ['', '{', 'not json', 'null', '[]', '42', '"x"', '{"schemaVersion":2,"musicEnabled":false}', '{"musicEnabled":false}', '{"schemaVersion":"1"}']) {
        const result = S.parseUserSettings(input);
        assert.equal(result.source, 'corrupt', input);
        assert.deepEqual({ ...result.settings }, { ...S.DEFAULT_USER_SETTINGS }, input);
    }
});

test('parse: a valid document wins; a non-boolean flag falls back to its default; an unknown language becomes en', async () => {
    const S = await imp('assets/scripts/settings/UserSettings.ts');
    const ok = S.parseUserSettings('{"schemaVersion":1,"musicEnabled":false,"sfxEnabled":false,"vibrationEnabled":false,"language":"en"}');
    assert.equal(ok.source, 'file');
    assert.deepEqual({ ...ok.settings }, { schemaVersion: 1, musicEnabled: false, sfxEnabled: false, vibrationEnabled: false, language: 'en' });
    const bad = S.parseUserSettings('{"schemaVersion":1,"musicEnabled":"no","sfxEnabled":0,"vibrationEnabled":null,"language":"xx"}');
    assert.equal(bad.source, 'file');
    assert.deepEqual({ ...bad.settings }, { ...S.DEFAULT_USER_SETTINGS });
    assert.equal(S.parseUserSettings('{"schemaVersion":1,"language":42}').settings.language, 'en');
    // Partial documents keep the defaults for the missing fields.
    assert.deepEqual({ ...S.parseUserSettings('{"schemaVersion":1,"sfxEnabled":false}').settings }, { ...S.DEFAULT_USER_SETTINGS, sfxEnabled: false });
});

test('serialize: stable key order, 2-space indent, LF only, trailing newline; round trip is lossless', async () => {
    const S = await imp('assets/scripts/settings/UserSettings.ts');
    const settings = { schemaVersion: 1, musicEnabled: false, sfxEnabled: true, vibrationEnabled: false, language: 'en' };
    const text = S.serializeUserSettings(settings);
    assert.equal(text, '{\n  "schemaVersion": 1,\n  "musicEnabled": false,\n  "sfxEnabled": true,\n  "vibrationEnabled": false,\n  "language": "en"\n}\n');
    assert.equal(text.includes('\r'), false);
    assert.deepEqual({ ...S.parseUserSettings(text).settings }, settings);
    // Property order of the input never changes the output.
    assert.equal(S.serializeUserSettings({ language: 'en', vibrationEnabled: false, sfxEnabled: true, musicEnabled: false, schemaVersion: 1 }), text);
});

test('merge: a patch validates like parsing and never mutates the base', async () => {
    const S = await imp('assets/scripts/settings/UserSettings.ts');
    const base = S.DEFAULT_USER_SETTINGS;
    const next = S.mergeUserSettings(base, { musicEnabled: false });
    assert.equal(next.musicEnabled, false);
    assert.equal(base.musicEnabled, true);
    assert.equal(S.mergeUserSettings(base, { sfxEnabled: 'x' }).sfxEnabled, true, 'non-boolean ignored');
    assert.equal(S.mergeUserSettings(base, { language: 'zz' }).language, 'en');
});

test('settings stay out of the save: no schema, GameState or command change; the dormant GameState.settings is untouched', async () => {
    const fs = require('node:fs');
    for (const rel of ['assets/scripts/settings/UserSettings.ts', 'assets/scripts/settings/SettingsStore.ts', 'assets/scripts/settings/index.ts']) {
        const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
        assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), /from\s+['"](cc|\.\.\/(state|domain|persistence|runtime|economy|progression)\/)/, rel);
    }
    const { CURRENT_SAVE_VERSION } = await imp('assets/scripts/persistence/index.ts');
    assert.equal(CURRENT_SAVE_VERSION, 2, 'AUT-052 changes no save schema');
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    assert.equal(createFreshGameState().settings.vibrationEnabled, false, 'the dormant save-level default is unchanged (the user settings default differs: vibration on)');
    const commands = fs.readFileSync(path.join(repoRoot, 'assets/scripts/domain/Commands.ts'), 'utf8');
    assert.doesNotMatch(commands, /ettings|udio|ibrat/);
});
