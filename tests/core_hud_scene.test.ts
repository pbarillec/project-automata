const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('FactoryWorld attaches the compact Core HUD exactly once through its bootstrap', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(source, /createCoreHud\(\)/);
    assert.match(source, /getChildByName\('CoreHudCanvas'\) \?\? new Node\('CoreHudCanvas'\)/);
    assert.match(source, /getChildByName\('CoreHUD'\) \?\? new Node\('CoreHUD'\)/);
    assert.match(source, /getComponent\(CoreHudController\) \?\? hud\.addComponent\(CoreHudController\)/);
});
