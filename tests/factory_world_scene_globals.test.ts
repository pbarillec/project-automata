const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const readScene = async (rel) => JSON.parse(await readFile(path.join(repoRoot, rel), 'utf8'));

const INFO_TYPES = {
    ambient: 'cc.AmbientInfo',
    shadows: 'cc.ShadowsInfo',
    _skybox: 'cc.SkyboxInfo',
    fog: 'cc.FogInfo',
    octree: 'cc.OctreeInfo',
    skin: 'cc.SkinInfo',
};

function globalsOf(scene) {
    const sceneNode = scene.find((o) => o.__type__ === 'cc.Scene');
    assert.ok(sceneNode, 'cc.Scene present');
    assert.ok(sceneNode._globals && typeof sceneNode._globals.__id__ === 'number', '_globals must reference a SceneGlobals object (AUT-R-033)');
    const globals = scene[sceneNode._globals.__id__];
    assert.equal(globals.__type__, 'cc.SceneGlobals');
    return globals;
}

test('AUT-R-033: FactoryWorld has scene globals with every info block resolved to its type', async () => {
    const scene = await readScene('assets/scenes/factory/FactoryWorld.scene');
    const globals = globalsOf(scene);
    for (const [key, type] of Object.entries(INFO_TYPES)) {
        assert.ok(globals[key] && typeof globals[key].__id__ === 'number', `${key} reference`);
        assert.equal(scene[globals[key].__id__].__type__, type, key);
    }
});

test('AUT-R-033: FactoryWorld globals are the project-standard values (same as CameraSpike, no new tuning)', async () => {
    const factory = await readScene('assets/scenes/factory/FactoryWorld.scene');
    const camera = await readScene('assets/scenes/camera/CameraSpike.scene');
    const fg = globalsOf(factory);
    const cg = globalsOf(camera);
    for (const key of Object.keys(INFO_TYPES)) {
        assert.deepEqual(factory[fg[key].__id__], camera[cg[key].__id__], `${key} values must match CameraSpike`);
    }
    const shadows = factory[fg.shadows.__id__];
    const skybox = factory[fg._skybox.__id__];
    const fog = factory[fg.fog.__id__];
    assert.equal(shadows._enabled, false);
    assert.equal(skybox._enabled, false);
    assert.equal(fog._enabled, false);
});
