const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('producer panel emits existing producer purchase commands and does not mutate GameState', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerPanelViewModel.ts'), 'utf8');
    const controller = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerPanelController.ts'), 'utf8');
    assert.match(source, /type: 'buyProducerLevels'/);
    assert.match(source, /type: 'buyMaxProducerLevels'/);
    assert.match(controller, /commandEmitter\?\.\(action\.command\)/);
    assert.doesNotMatch(source, /state\.run\.industrialOutput\s*[-+]=/);
    assert.doesNotMatch(controller, /GameState|industrialOutput\s*=/);
});
