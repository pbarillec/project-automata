const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-R-036-02: strict portrait lock on every device (owner decision 2026-11-10).
const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const MANIFESTS = {
    'native/engine/android/app/AndroidManifest.xml': 'com.cocos.game.AppActivity',
    'native/engine/android/instantapp/AndroidManifest.xml': 'com.cocos.game.InstantActivity',
};

test('AUT-R-036-02: the tracked Android manifests (app and instant app) lock the game activity to portrait', async () => {
    for (const [rel, activity] of Object.entries(MANIFESTS)) {
        const manifest = await read(rel);
        const tag = manifest.match(new RegExp(`<activity android:name="${activity.replace(/\./g, '\\.')}"[^>]*>`));
        assert.ok(tag, `${rel}: ${activity}`);
        assert.match(tag[0], /android:screenOrientation="portrait"/, rel);
        // Every screenOrientation is either the portrait lock or the edit box's "behind" (follows the game activity).
        const values = [...manifest.matchAll(/android:screenOrientation="(\w+)"/g)].map((m) => m[1]);
        assert.deepEqual(values.sort(), ['behind', 'portrait'], rel);
        assert.doesNotMatch(manifest, /[Ll]andscape|android:screenOrientation="(sensor|user|fullSensor|unspecified)"/, rel);
    }
});

test('AUT-R-036-02: the tracked build config enables portrait only and still starts CameraSpike', async () => {
    const config = JSON.parse(await read('tools/ci/cocos_android_debug_build.json'));
    assert.deepEqual(config.packages.android.orientation, { portrait: true, upsideDown: false, landscapeRight: false, landscapeLeft: false });
    assert.equal(config.startScene, 'f8adf834-2374-4aef-a9d6-3f5ac4569a28');
    assert.deepEqual(config.scenes.map((scene) => scene.url), ['db://assets/scenes/camera/CameraSpike.scene']);
});

test('AUT-R-036-02: the FactoryWorld gate build switches only the scenes and keeps the portrait lock', async () => {
    const { switchConfigToFactoryWorld } = await import(pathToFileURL(path.join(repoRoot, 'tools/device/gate_build.ts')).href);
    const original = JSON.parse(await read('tools/ci/cocos_android_debug_build.json'));
    const switched = JSON.parse(switchConfigToFactoryWorld(JSON.stringify(original)));
    assert.deepEqual(switched.packages.android.orientation, original.packages.android.orientation);
    assert.equal(switched.startScene, 'b0330000-0000-4000-8000-000000000010');
});

test('AUT-R-036-02: the design resolution is portrait 720×1280 with a fixed width', async () => {
    const settings = JSON.parse(await read('settings/v2/packages/project.json'));
    assert.deepEqual(settings.general.designResolution, { width: 720, height: 1280, fitWidth: true, fitHeight: false });
    const { UI_DESIGN_RESOLUTION } = await import(pathToFileURL(path.join(repoRoot, 'assets/scripts/presentation/UiLayout.ts')).href);
    assert.deepEqual(UI_DESIGN_RESOLUTION, { width: settings.general.designResolution.width, height: settings.general.designResolution.height });
});
