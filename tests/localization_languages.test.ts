const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

test('listAvailableLanguages is [en] and equals the settings AVAILABLE_LANGUAGES', async () => {
    const localization = await imp('assets/scripts/localization/index.ts');
    const settings = await imp('assets/scripts/settings/UserSettings.ts');
    assert.deepEqual(localization.listAvailableLanguages(), ['en']);
    assert.deepEqual(localization.listAvailableLanguages(), [...settings.AVAILABLE_LANGUAGES]);
    assert.equal(localization.DEFAULT_LANGUAGE, settings.DEFAULT_LANGUAGE_SETTING);
});

test('getTextCatalogue(en) is the shared English catalogue and getDefaultTextCatalogue still works', async () => {
    const localization = await imp('assets/scripts/localization/index.ts');
    const english = localization.getTextCatalogue('en');
    assert.equal(english.locale, 'en');
    assert.equal(localization.getDefaultTextCatalogue(), english, 'one shared instance');
    assert.equal(localization.getTextCatalogue(), english);
    assert.equal(english.resolveText('settings.title'), 'Settings');
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, 'localization/en.json'), 'utf8'));
    assert.deepEqual(english.keys().sort(), Object.keys(parsed.entries).sort());
});

test('an unknown language falls back to English and reports unknown_language to the sink', async () => {
    const localization = await imp('assets/scripts/localization/index.ts');
    const reports = [];
    const catalogue = localization.getTextCatalogue('xx', (report) => reports.push(report));
    assert.equal(catalogue, localization.getTextCatalogue('en'));
    assert.deepEqual(reports, [{ kind: 'unknown_language', locale: 'en', language: 'xx' }]);
    // A known language reports nothing; a faulty sink never breaks the lookup; no sink is fine.
    localization.getTextCatalogue('en', (report) => reports.push(report));
    assert.equal(reports.length, 1);
    assert.doesNotThrow(() => localization.getTextCatalogue('fr', () => { throw new Error('boom'); }));
    assert.doesNotThrow(() => localization.getTextCatalogue('de'));
    for (const bad of ['', 'EN', 'en-US', '../en', 'constructor']) assert.equal(localization.getTextCatalogue(bad), localization.getTextCatalogue('en'), String(bad));
});

test('there is no parallel catalogue system: localization/ holds one en.json and the toast / settings wording lives in it', () => {
    assert.deepEqual(fs.readdirSync(path.join(repoRoot, 'localization')).sort(), ['en.json']);
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, 'localization/en.json'), 'utf8'));
    for (const key of ['toast.producer_milestone', 'toast.reboot_civilization', 'era.automated_factory.title_card', 'era.robotics_complex.title_card', 'settings.title', 'settings.language.en']) {
        assert.equal(typeof parsed.entries[key], 'string', key);
    }
    assert.equal(parsed.entries['era.automated_factory.title_card'], 'AUTOMATED FACTORY');
    assert.equal(parsed.entries['era.robotics_complex.title_card'], 'ROBOTICS COMPLEX ONLINE');
    assert.equal(Object.keys(parsed.entries).filter((key) => key.startsWith('toast.')).length, 12);
});

test('the new keys resolve with no missing-text report and missing-key detection still works', async () => {
    const localization = await imp('assets/scripts/localization/index.ts');
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, 'localization/en.json'), 'utf8'));
    const reports = [];
    const catalogue = localization.createTextCatalogue(JSON.stringify(parsed), (report) => reports.push(report));
    for (const key of Object.keys(parsed.entries).filter((k) => /^(toast|settings)\./.test(k) || k.endsWith('.title_card'))) {
        const params = Object.fromEntries(localization.extractPlaceholders(parsed.entries[key]).map((name) => [name, 1]));
        catalogue.resolveText(key, params);
    }
    assert.deepEqual(reports, []);
    // Missing-key detection still works.
    catalogue.resolveText('settings.nope');
    assert.deepEqual(reports, [{ kind: 'missing_key', locale: 'en', key: 'settings.nope' }]);
});
