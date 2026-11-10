const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const modulePath = path.join(repoRoot, 'assets/scripts/localization/EmbeddedTextCatalogue.ts');

test('committed EmbeddedTextCatalogue.ts equals an in-memory regeneration from localization/ (drift guard)', async () => {
    const { collectTextCatalogueSources, renderEmbeddedTextCatalogueModule } = await imp('tools/config/embed_text_catalogue.ts');
    const committed = (await readFile(modulePath, 'utf8')).replace(/\r\n/g, '\n');
    assert.equal(
        committed,
        renderEmbeddedTextCatalogueModule(collectTextCatalogueSources()),
        'EmbeddedTextCatalogue.ts is stale: run node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_text_catalogue.ts',
    );
});

test('embedded sources cover every localization json file with identical text and are returned as copies', async () => {
    const { getEmbeddedTextCatalogueSources } = await imp('assets/scripts/localization/EmbeddedTextCatalogue.ts');
    const embedded = getEmbeddedTextCatalogueSources();
    const files = (await readdir(path.join(repoRoot, 'localization'))).filter((name) => name.endsWith('.json')).sort();
    assert.deepEqual(embedded.map((source) => source.filePath), files.map((name) => `localization/${name}`));
    for (const source of embedded) {
        const onDisk = (await readFile(path.join(repoRoot, source.filePath), 'utf8')).replace(/\r\n/g, '\n');
        assert.equal(source.text, onDisk, source.filePath);
    }
    embedded[0].text = 'mutated';
    assert.notEqual(getEmbeddedTextCatalogueSources()[0].text, 'mutated');
});

test('the default catalogue is built from the embedded en.json and matches localization/en.json', async () => {
    const { getDefaultTextCatalogue, createTextCatalogue } = await imp('assets/scripts/localization/index.ts');
    const fromDisk = createTextCatalogue(await readFile(path.join(repoRoot, 'localization/en.json'), 'utf8'));
    const embedded = getDefaultTextCatalogue();
    assert.equal(embedded, getDefaultTextCatalogue());
    assert.equal(embedded.locale, 'en');
    assert.deepEqual(embedded.keys(), fromDisk.keys());
    for (const key of fromDisk.keys()) assert.equal(embedded.template(key), fromDisk.template(key), key);
});

test('the catalogue lives outside data/ so economy config scanners never see it', async () => {
    const dataEntries = await readdir(path.join(repoRoot, 'data'));
    assert.ok(!dataEntries.includes('localization'));
});

test('EmbeddedTextCatalogue.ts is engine-free', async () => {
    assert.doesNotMatch(await readFile(modulePath, 'utf8'), /from\s+['"]cc['"]/);
});
