const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const scenePath = path.join(repoRoot, 'assets/scenes/camera/CameraSpike.scene');
const buildConfigPath = path.join(repoRoot, 'tools/ci/cocos_android_debug_build.json');
const bootstrapMetaPath = path.join(repoRoot, 'assets/scripts/presentation/CameraSpikeBootstrap.ts.meta');
const controllerSourcePath = path.join(repoRoot, 'assets/scripts/camera/MobileCameraController.ts');
const bootstrapSourcePath = path.join(repoRoot, 'assets/scripts/presentation/CameraSpikeBootstrap.ts');

test('camera spike scene has the expected bootstrap component and is included in Android build config', async () => {
    const scene = JSON.parse(await readFile(scenePath, 'utf8'));
    const buildConfig = JSON.parse(await readFile(buildConfigPath, 'utf8'));
    const bootstrapMeta = JSON.parse(await readFile(bootstrapMetaPath, 'utf8'));

    assert.equal(scene[0]._name, 'CameraSpike');
    assert.equal(scene[1]._name, 'CameraSpike');
    assert.ok(scene.some((entry) => entry.__type__ === '646128RWLZK1IGsmKLTMmzF'), `CameraSpikeBootstrap component missing for ${bootstrapMeta.uuid}`);
    assert.equal(buildConfig.startScene, scene[1]._id);
    assert.ok(buildConfig.scenes.some((entry) => entry.uuid === scene[1]._id && /CameraSpike\.scene$/.test(entry.url)));
});

test('camera spike sources stay presentation-only and do not import gameplay state or economy', async () => {
    const sources = [
        ['MobileCameraController.ts', await readFile(controllerSourcePath, 'utf8')],
        ['CameraSpikeBootstrap.ts', await readFile(bootstrapSourcePath, 'utf8')],
    ];

    for (const [name, source] of sources) {
        assert.equal(/GameState|assets[\\/]scripts[\\/]state|assets[\\/]scripts[\\/]economy|assets[\\/]scripts[\\/]runtime|assets[\\/]scripts[\\/]services/.test(source), false, `${name} imports or references gameplay state/economy`);
        assert.equal(/IndustrialOutputChanged|BuyProducer|Reboot|AI Cores/.test(source), false, `${name} contains gameplay command/event behavior`);
    }
});
