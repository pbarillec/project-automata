const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const modulePath = path.join(repoRoot, 'assets/scripts/config/EmbeddedEconomyConfig.ts');

test('committed EmbeddedEconomyConfig.ts equals an in-memory regeneration from data/economy (drift guard)', async () => {
    const { collectEconomySources, renderEmbeddedEconomyConfigModule } = await imp('tools/config/embed_economy_config.ts');
    const committed = (await readFile(modulePath, 'utf8')).replace(/\r\n/g, '\n');
    const regenerated = renderEmbeddedEconomyConfigModule(collectEconomySources());
    assert.equal(
        committed,
        regenerated,
        'EmbeddedEconomyConfig.ts is stale: run node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_economy_config.ts',
    );
});

test('embedded sources cover every data/economy json file with identical text', async () => {
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const embedded = getEmbeddedEconomyConfigSources();
    const files = (await readdir(path.join(repoRoot, 'data/economy'))).filter((name) => name.endsWith('.json')).sort();
    assert.deepEqual(embedded.map((source) => source.filePath), files.map((name) => `data/economy/${name}`));
    for (const source of embedded) {
        const onDisk = (await readFile(path.join(repoRoot, source.filePath), 'utf8')).replace(/\r\n/g, '\n');
        assert.equal(source.text, onDisk, source.filePath);
    }
    // Callers receive copies, never the module's own records.
    embedded[0].text = 'mutated';
    assert.notEqual(getEmbeddedEconomyConfigSources()[0].text, 'mutated');
});

test('embedded sources load to a repository with the same contentVersion as data/', async () => {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const { collectEconomySources } = await imp('tools/config/embed_economy_config.ts');
    const fromEmbedded = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const fromData = loadGameConfigFromSources(collectEconomySources());
    assert.equal(fromEmbedded.contentVersion, fromData.contentVersion);
    assert.equal(fromEmbedded.listProducers().length, fromData.listProducers().length);
    assert.equal(fromEmbedded.listBreakthroughs().length, fromData.listBreakthroughs().length);
    assert.ok(fromEmbedded.listProducers().length > 0);
});

test('EmbeddedEconomyConfig.ts is engine-free', async () => {
    const source = await readFile(modulePath, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc['"]/);
});
