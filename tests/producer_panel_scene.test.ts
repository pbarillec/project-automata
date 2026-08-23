const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('FactoryWorld attaches one reusable Producer Panel and replaces its selection snapshot', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(source, /getChildByName\('ProducerPanel'\) \?\? new Node\('ProducerPanel'\)/);
    assert.match(source, /getComponent\(ProducerPanelController\) \?\? panel\.addComponent\(ProducerPanelController\)/);
    assert.match(source, /selection\.onSelectionChanged =/);
    assert.match(source, /panel\.replaceSelection/);
    assert.equal((source.match(/createProducerPanel\(/g) || []).length, 2);
});
