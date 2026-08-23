const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('Fabricator controller exposes reusable additive modules and debug forcing', async () => {
    const source = await readFile(path.join(__dirname, '..', 'assets', 'scripts', 'presentation', 'FabricatorVisualController.ts'), 'utf8');
    for (const moduleName of ['base_compact_press', 'secondary_module', 'auto_feeder_hopper', 'input_conveyor', 'output_conveyor', 'storage_buffer', 'dual_fabrication_module', 'small_robotic_arm', 'advanced_indicators']) {
        assert.match(source, new RegExp(moduleName));
    }
    assert.match(source, /forceDebugState/);
    assert.match(source, /syncFromGameState/);
});

test('Fabricator composition remains attached to the AUT-033 anchor', async () => {
    const source = await readFile(path.join(__dirname, '..', 'assets', 'scripts', 'presentation', 'FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(source, /Fabricator_CompositionAnchor/);
    assert.match(source, /FabricatorVisualController/);
});

