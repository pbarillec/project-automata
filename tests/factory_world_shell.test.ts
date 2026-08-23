const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const scenePath = path.join(repoRoot, 'assets/scenes/factory/FactoryWorld.scene');
const bootstrapPath = path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts');
const controllerPath = path.join(repoRoot, 'assets/scripts/presentation/PresentationController.ts');

test('FactoryWorld scene has one persistent site and all five deterministic zones', async () => {
    const scene = JSON.parse(await readFile(scenePath, 'utf8'));
    const names = scene.filter((entry: { __type__?: string }) => entry.__type__ === 'cc.Node').map((entry: { _name: string }) => entry._name);
    assert.equal(scene[0]._name, 'FactoryWorld');
    assert.ok(names.includes('FactoryWorldRoot'));
    assert.ok(names.includes('FactorySite'));
    for (const zone of ['Fabricator', 'AssemblyStation', 'RobotLine', 'AutomatedCell', 'AdvancedRoboticsComplex']) {
        assert.ok(names.includes(`Zone_${zone}`), `missing zone ${zone}`);
    }
    assert.ok(names.includes('OpeningWorkshopFoundation'));
    assert.ok(names.includes('CameraRig'));
    assert.ok(names.includes('PresentationAnchors'));
});

test('FactoryWorld presentation sources stay outside gameplay and expose stable attachment points', async () => {
    const [bootstrap, controller] = await Promise.all([readFile(bootstrapPath, 'utf8'), readFile(controllerPath, 'utf8')]);
    assert.match(bootstrap, /FACTORY_ZONE_IDS/);
    assert.match(bootstrap, /MobileCameraController/);
    assert.match(bootstrap, /Zone_\$\{zoneId\}/);
    assert.match(controller, /getFocusAnchor/);
    assert.match(controller, /getCompositionAnchor/);
    assert.doesNotMatch(`${bootstrap}\n${controller}`, /GameState|scripts[\\/]economy|scripts[\\/]gameplay|scripts[\\/]persistence|scripts[\\/]progression|RobotPopulationController/);
});
