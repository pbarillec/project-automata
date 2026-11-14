const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function modules() {
    const [vm, settings, localization] = await Promise.all([
        imp('assets/scripts/presentation/SettingsViewModel.ts'),
        imp('assets/scripts/settings/UserSettings.ts'),
        imp('assets/scripts/localization/index.ts'),
    ]);
    return { vm, settings, localization };
}

test('default settings: title, chip, close and four rows (three ON toggles + informational English)', async () => {
    const { vm, settings } = await modules();
    const model = vm.createSettingsViewModel(settings.DEFAULT_USER_SETTINGS);
    assert.deepEqual({ ...model.texts }, { title: 'Settings', chip: 'SET', close: 'CLOSE' });
    assert.deepEqual(model.rows.map((row) => [row.id, row.label, row.valueText, row.on, row.tappable]), [
        ['music', 'Music', 'ON', true, true],
        ['sfx', 'SFX', 'ON', true, true],
        ['vibration', 'Vibration', 'ON', true, true],
        ['language', 'Language', 'English', null, false],
    ]);
});

test('a toggle row carries the opposite-value patch; the language row has none', async () => {
    const { vm, settings } = await modules();
    const off = { ...settings.DEFAULT_USER_SETTINGS, musicEnabled: false, vibrationEnabled: false };
    const model = vm.createSettingsViewModel(off);
    assert.deepEqual(model.rows.map((row) => row.valueText), ['OFF', 'ON', 'OFF', 'English']);
    assert.deepEqual({ ...model.rows[0].patch }, { musicEnabled: true });
    assert.deepEqual({ ...model.rows[1].patch }, { sfxEnabled: false });
    assert.deepEqual({ ...model.rows[2].patch }, { vibrationEnabled: true });
    assert.equal(model.rows[3].patch, null);
    assert.deepEqual(model.rows.map((row) => row.setting), ['musicEnabled', 'sfxEnabled', 'vibrationEnabled', 'language']);
});

test('the ON / OFF state is always text, never colour-only', async () => {
    const { vm, settings } = await modules();
    for (const on of [true, false]) {
        const model = vm.createSettingsViewModel({ ...settings.DEFAULT_USER_SETTINGS, musicEnabled: on, sfxEnabled: on, vibrationEnabled: on });
        for (const row of model.rows.slice(0, 3)) assert.equal(row.valueText, on ? 'ON' : 'OFF');
    }
});

test('rows resolve with no raw key and no missing text through the real catalogue', async () => {
    const { vm, settings, localization } = await modules();
    const reports = [];
    const catalogue = localization.createTextCatalogue(require('node:fs').readFileSync(path.join(repoRoot, 'localization/en.json'), 'utf8'), (report) => reports.push(report));
    const model = vm.createSettingsViewModel(settings.DEFAULT_USER_SETTINGS, catalogue);
    const all = [model.texts.title, model.texts.chip, model.texts.close, ...model.rows.flatMap((row) => [row.label, row.valueText])];
    for (const text of all) assert.doesNotMatch(text, /\b[a-z_]+(\.[a-z0-9_]+)+\b/, text);
    assert.deepEqual(reports, []);
});

test('the view model has no engine, command or store import (pure strings + patch)', () => {
    const source = require('node:fs').readFileSync(path.join(repoRoot, 'assets/scripts/presentation/SettingsViewModel.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /from\s+['"]cc['"]|Commands|SettingsStore|AudioService/);
});
