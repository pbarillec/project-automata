const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function collectJsonSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) return collectJsonSources(entryPath);
        if (!entry.isFile() || !entry.name.endsWith('.json')) return [];
        return [{ filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'), text: await readFile(entryPath, 'utf8') }];
    }));
    return nested.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

let repositoryPromise;
async function repository() {
    repositoryPromise ??= (async () => {
        const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
        return loadGameConfigFromSources(await collectJsonSources(path.join(repoRoot, 'data')));
    })();
    return repositoryPromise;
}

async function freshState() {
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    return createFreshGameState();
}

function build(state, producerId, level) {
    state.run.producers[producerId] = { level, isUnlocked: level > 0, isBuilt: level > 0 };
}

async function modules() {
    const bounds = await imp('assets/scripts/presentation/CameraPanBounds.ts');
    const layout = await imp('assets/scripts/presentation/FactoryZoneLayout.ts');
    const math = await imp('assets/scripts/camera/CameraMath.ts');
    return { ...bounds, ...layout, DEFAULT_CAMERA_TUNING: math.DEFAULT_CAMERA_TUNING };
}

function zoneRect(zone, margin) {
    return { minX: zone.x - zone.width / 2 - margin, maxX: zone.x + zone.width / 2 + margin, minZ: zone.z - zone.depth / 2 - margin, maxZ: zone.z + zone.depth / 2 + margin };
}

function clampInto(rect, global) {
    return { minX: Math.max(rect.minX, global.minX), maxX: Math.min(rect.maxX, global.maxX), minZ: Math.max(rect.minZ, global.minZ), maxZ: Math.min(rect.maxZ, global.maxZ) };
}

test('AUT-R-031-02: fresh state → only the Fabricator zone (+ margin, inside the global bounds)', async () => {
    const M = await modules();
    const repo = await repository();
    const state = await freshState();
    assert.deepEqual(M.resolveUnlockedCameraZones(repo, state, M.ZONE_LAYOUT), ['Fabricator']);
    const bounds = M.resolveCameraPanBounds(repo, state, M.ZONE_LAYOUT, M.CAMERA_PAN_BOUNDS_MARGIN);
    assert.deepEqual(bounds, clampInto(zoneRect(M.ZONE_LAYOUT.Fabricator, M.CAMERA_PAN_BOUNDS_MARGIN), M.DEFAULT_CAMERA_TUNING.focusBounds));
    assert.deepEqual(bounds, { minX: -9, maxX: -2.5, minZ: -6, maxZ: 0 });
    // The FactoryWorld default focus (-3.8, -1.8) is inside the opening bounds, so the first sync does not move the camera.
    assert.ok(-3.8 >= bounds.minX && -3.8 <= bounds.maxX && -1.8 >= bounds.minZ && -1.8 <= bounds.maxZ);
});

test('AUT-R-031-02: a buildable Assembly Station joins the bounds; built producers stay included', async () => {
    const M = await modules();
    const repo = await repository();
    const state = await freshState();
    build(state, 'fabricator', 1);
    assert.deepEqual(M.resolveUnlockedCameraZones(repo, state, M.ZONE_LAYOUT), ['Fabricator', 'AssemblyStation']);
    const withAssembly = M.resolveCameraPanBounds(repo, state, M.ZONE_LAYOUT, 1);
    const a = zoneRect(M.ZONE_LAYOUT.Fabricator, 1);
    const b = zoneRect(M.ZONE_LAYOUT.AssemblyStation, 1);
    assert.deepEqual(withAssembly, clampInto({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }, M.DEFAULT_CAMERA_TUNING.focusBounds));

    build(state, 'assembly_station', 3);
    build(state, 'robot_line', 1);
    const zones = M.resolveUnlockedCameraZones(repo, state, M.ZONE_LAYOUT);
    for (const id of ['Fabricator', 'AssemblyStation', 'RobotLine']) assert.ok(zones.includes(id), id + ' is built');
    const { evaluateProducerBuildProgression } = await imp('assets/scripts/progression/index.ts');
    assert.equal(zones.includes('AutomatedCell'), evaluateProducerBuildProgression(repo, state, 'automated_cell').status === 'available', 'Automated Cell follows the authoritative progression');
    assert.equal(zones.includes('AdvancedRoboticsComplex'), false, 'its prerequisite (Automated Cell) is not built');
    const wider = M.resolveCameraPanBounds(repo, state, M.ZONE_LAYOUT, 1);
    assert.ok(wider.maxX > withAssembly.maxX && wider.maxZ > withAssembly.maxZ, 'bounds expand as the factory expands');
});

test('AUT-R-031-02: pan bounds never exceed the global focus bounds and are deterministic', async () => {
    const M = await modules();
    const repo = await repository();
    const state = await freshState();
    for (const [id, level] of [['fabricator', 60], ['assembly_station', 30], ['robot_line', 5], ['automated_cell', 2], ['advanced_robotics_complex', 1]]) build(state, id, level);
    const before = JSON.stringify(state);
    const global = M.DEFAULT_CAMERA_TUNING.focusBounds;
    const all = M.resolveCameraPanBounds(repo, state, M.ZONE_LAYOUT, 5);
    assert.deepEqual(all, { ...global }, 'a huge margin is clipped to the global bounds');
    assert.deepEqual(M.resolveCameraPanBounds(repo, state, M.ZONE_LAYOUT, 5), all);
    assert.equal(JSON.stringify(state), before, 'state is never mutated');

    const narrow = { minX: -7, maxX: 0, minZ: -4, maxZ: 1 };
    const clipped = M.resolveCameraPanBounds(repo, state, M.ZONE_LAYOUT, 1, narrow);
    assert.deepEqual(clipped, narrow);
    for (const margin of [0, 1, -3, Number.NaN]) {
        const b = M.resolveCameraPanBounds(repo, await freshState(), M.ZONE_LAYOUT, margin);
        assert.ok(b.minX >= global.minX && b.maxX <= global.maxX && b.minZ >= global.minZ && b.maxZ <= global.maxZ);
        assert.ok(b.minX <= b.maxX && b.minZ <= b.maxZ);
    }
});

test('AUT-R-031-02: zone layout is engine-free, moved unchanged, and maps zones through the selection mapping', async () => {
    const M = await modules();
    const { FACTORY_WORLD_SELECTION_PRODUCER_IDS } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    assert.deepEqual(JSON.parse(JSON.stringify(M.ZONE_LAYOUT)), {
        Fabricator: { x: -6, z: -3, width: 5, depth: 4 },
        AssemblyStation: { x: -2, z: -1.8, width: 4, depth: 3.5 },
        RobotLine: { x: 3.5, z: -1.2, width: 6, depth: 3.5 },
        AutomatedCell: { x: 6.2, z: 3.2, width: 4.5, depth: 4 },
        AdvancedRoboticsComplex: { x: 2, z: 6, width: 6, depth: 5.5 },
    });
    for (const id of M.factoryZoneIds(M.ZONE_LAYOUT)) assert.equal(M.producerIdForZone(id), FACTORY_WORLD_SELECTION_PRODUCER_IDS[id]);
    for (const rel of ['assets/scripts/presentation/FactoryZoneLayout.ts', 'assets/scripts/presentation/CameraPanBounds.ts']) {
        const source = await readFile(path.join(repoRoot, rel), 'utf8');
        assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/, rel);
    }
    const panBounds = await readFile(path.join(repoRoot, 'assets/scripts/presentation/CameraPanBounds.ts'), 'utf8');
    assert.match(panBounds, /evaluateProducerBuildProgression\(repository, state, producerIdForZone\(zoneId\)\)/);
    assert.match(panBounds, /status === 'available' \|\| status === 'already_built'/);
    const layoutSource = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryZoneLayout.ts'), 'utf8');
    assert.doesNotMatch(layoutSource, /'fabricator'|'assembly_station'/, 'no duplicated producer id mapping');
});
