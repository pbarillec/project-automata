const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('FactoryWorld attaches first automation presentation to the existing Fabricator composition and focus anchor', async () => {
    const source = await readFile(path.join(__dirname, '..', 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(source, /FirstAutomationPresentationController/);
    assert.match(source, /Fabricator_CompositionAnchor/);
    assert.match(source, /Fabricator_FocusAnchor/);
    assert.match(source, /connectFirstAutomationPresentation/);
    assert.match(source, /cameraController = parent\.getChildByName\('CameraRig'\)/);
    const registrySource = await readFile(path.join(__dirname, '..', 'assets/scripts/presentation/PresentationController.ts'), 'utf8');
    assert.match(registrySource, /consumeDomainEvents/);
    assert.match(registrySource, /syncAutomationState/);
});

const repoRoot = path.join(__dirname, '..');

/** The two status panels have no FABRICATOR_ASSET_REFERENCES entry; they use the AUT-032 screen panel. */
const INDICATOR_PREFAB = 'screen-panel-wide.prefab';

function readGltfScenePrefabs(dir, out = new Map()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) readGltfScenePrefabs(full, out);
        else if (entry.name.endsWith('.meta')) {
            const meta = JSON.parse(readFileSync(full, 'utf8'));
            for (const sub of Object.values(meta.subMetas ?? {})) {
                if (sub.importer === 'gltf-scene') out.set(sub.uuid, sub.name);
            }
        }
    }
    return out;
}

test('AUT-038 G1: FactoryWorld factoryPrefabs are index-aligned with SERIALIZED_PREFAB_MODULES and resolve to imported prefabs', async () => {
    const controller = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FabricatorVisualController.ts'), 'utf8');
    const modulesBlock = controller.match(/const SERIALIZED_PREFAB_MODULES = \[([\s\S]*?)\] as const;/);
    assert.ok(modulesBlock, 'SERIALIZED_PREFAB_MODULES not found');
    const modules = [...modulesBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const refsBlock = controller.match(/FABRICATOR_ASSET_REFERENCES[^=]*= \{([\s\S]*?)\};/);
    assert.ok(refsBlock, 'FABRICATOR_ASSET_REFERENCES not found');
    const references = Object.fromEntries([...refsBlock[1].matchAll(/([a-z_]+): '([^']+)'/g)].map((m) => [m[1], m[2]]));

    const scene = JSON.parse(await readFile(path.join(repoRoot, 'assets/scenes/factory/FactoryWorld.scene'), 'utf8'));
    const holders = scene.filter((entry) => Array.isArray(entry?.factoryPrefabs));
    assert.equal(holders.length, 1, 'exactly one serialized factoryPrefabs list');
    const uuids = holders[0].factoryPrefabs.map((ref) => ref.__uuid__);
    assert.equal(uuids.length, modules.length);

    const prefabs = readGltfScenePrefabs(path.join(repoRoot, 'assets/art'));
    const byName = new Map([...prefabs].map(([uuid, name]) => [name, uuid]));
    modules.forEach((moduleName, i) => {
        assert.ok(prefabs.has(uuids[i]), `${moduleName}: ${uuids[i]} does not resolve under assets/art`);
        const expected = references[moduleName] ?? byName.get(INDICATOR_PREFAB);
        assert.ok(expected, `${moduleName}: no expected prefab`);
        assert.equal(uuids[i], expected, `${moduleName} at index ${i} resolves to ${prefabs.get(uuids[i])}`);
    });
});

// AUT-R-036-02: the approved framing is now the portrait one (Scene Presentation, owner Option A 2026-11-11).
test('AUT-038 G2 / AUT-R-036-02: FactoryWorld camera defaults stay at the approved portrait framing', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    const expected = {
        defaultYawDeg: '135', defaultPitchDeg: '48', defaultDistance: '14',
        defaultFocusX: '-2.5', defaultFocusZ: '0', focusDistance: '9.5',
        focusMinX: '-9', focusMaxX: '9', focusMinZ: '-6', focusMaxZ: '8',
        panUnitsPerPixelAtDistance: '0.001',
    };
    assert.deepEqual([...source.matchAll(/camera\.fov = ([0-9.]+);/g)].map((m) => m[1]), ['55']);
    assert.match(source, /camera\.fovAxis = Camera\.FOVAxis\.HORIZONTAL;/);
    for (const [field, value] of Object.entries(expected)) {
        const matches = [...source.matchAll(new RegExp(`controller\\.${field} = (-?[0-9.]+);`, 'g'))].map((m) => m[1]);
        assert.deepEqual(matches, [value], field);
    }
});
