const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('FactoryWorld connects every deterministic selectable target to its focus anchor', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    for (const id of ['Fabricator', 'AssemblyStation', 'RobotLine', 'AutomatedCell', 'AdvancedRoboticsComplex']) {
        assert.match(source, new RegExp(`'${id}'`));
    }
    assert.match(source, /Zone_\$\{zoneId\}/);
    assert.match(source, /\$\{zoneId\}_FocusAnchor/);
    assert.match(source, /\$\{zoneId\}_SelectableTarget/);
    assert.match(source, /createProducerSelection/);
    assert.match(source, /cameraController = rig\?\.getComponent\(MobileCameraController\)/);
});
