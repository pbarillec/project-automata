const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/*
 * AUT-039 scene / wiring / geometry smoke for the Assembly + first Worker Bot slice. Bounds come from the
 * approved AUT-032 GLBs (no new asset); transforms come from the engine-free AssemblySliceLayout.
 */
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const scenePath = path.join(repoRoot, 'assets/scenes/factory/FactoryWorld.scene');
const bootstrapPath = path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts');
const artRoot = path.join(repoRoot, 'assets/art');
const factoryDir = path.join(artRoot, 'aut032/factory');
const PRESS_TOP = 1.505;
const EPS = 1e-6;

/** Approved Art Director mapping for the slice (all already imported by AUT-032). */
const EXPECTED_ASSET_FILES = {
    workstation_bed: 'machine-bed.glb',
    input_corner: 'conveyor-corner.glb',
    assembly_arm: 'robot-arm-b.glb',
    status_panel: 'screen-panel-wide.glb',
    robot_bay: 'structure-high.glb',
    storage_crate: 'box-large.glb',
};

function gltfScenePrefabs(dir, out = new Map()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) gltfScenePrefabs(full, out);
        else if (entry.name.endsWith('.glb.meta')) {
            const meta = JSON.parse(readFileSync(full, 'utf8'));
            for (const sub of Object.values(meta.subMetas ?? {})) {
                if (sub.importer === 'gltf-scene') out.set(sub.uuid, { file: entry.name.replace(/\.meta$/, ''), name: sub.name });
            }
        }
    }
    return out;
}

function trs(node) {
    const t = node.translation ?? [0, 0, 0];
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    const m = [1 - (2 * ((y * y) + (z * z))), 2 * ((x * y) + (z * w)), 2 * ((x * z) - (y * w)), 0,
        2 * ((x * y) - (z * w)), 1 - (2 * ((x * x) + (z * z))), 2 * ((y * z) + (x * w)), 0,
        2 * ((x * z) + (y * w)), 2 * ((y * z) - (x * w)), 1 - (2 * ((x * x) + (y * y))), 0, t[0], t[1], t[2], 1];
    for (let i = 0; i < 3; i += 1) { m[i] *= s[0]; m[4 + i] *= s[1]; m[8 + i] *= s[2]; }
    return m;
}

function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[(c * 4) + r] += a[(k * 4) + r] * b[(c * 4) + k];
    return o;
}

/** POSITION bounds of a static (non-skinned) GLB through its node hierarchy. */
function glbBounds(file) {
    const buffer = readFileSync(path.join(factoryDir, file));
    const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const visit = (index, parent) => {
        const node = gltf.nodes[index];
        const m = mul(parent, trs(node));
        if (node.mesh !== undefined) {
            for (const primitive of gltf.meshes[node.mesh].primitives) {
                const a = gltf.accessors[primitive.attributes.POSITION];
                for (const px of [a.min[0], a.max[0]]) for (const py of [a.min[1], a.max[1]]) for (const pz of [a.min[2], a.max[2]]) {
                    const p = [0, 1, 2].map((i) => (m[i] * px) + (m[4 + i] * py) + (m[8 + i] * pz) + m[12 + i]);
                    for (let i = 0; i < 3; i += 1) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
                }
            }
        }
        for (const child of node.children ?? []) visit(child, m);
    };
    for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return { min, max };
}

/** World AABB of a module: Cocos Y rotation maps local (x, z) to (x cos + z sin, -x sin + z cos). */
function worldBox(transform, bounds) {
    const rad = (transform.rotationY * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const xs = [];
    const zs = [];
    for (const lx of [bounds.min[0], bounds.max[0]]) for (const lz of [bounds.min[2], bounds.max[2]]) {
        xs.push(transform.position.x + (((lx * c) + (lz * s)) * transform.scale));
        zs.push(transform.position.z + (((-lx * s) + (lz * c)) * transform.scale));
    }
    return {
        min: { x: Math.min(...xs), y: transform.position.y + (bounds.min[1] * transform.scale), z: Math.min(...zs) },
        max: { x: Math.max(...xs), y: transform.position.y + (bounds.max[1] * transform.scale), z: Math.max(...zs) },
    };
}

function overlap(a, b, eps = 1e-3) {
    return a.min.x < b.max.x - eps && a.max.x > b.min.x + eps
        && a.min.y < b.max.y - eps && a.max.y > b.min.y + eps
        && a.min.z < b.max.z - eps && a.max.z > b.min.z + eps;
}

async function composition() {
    const L = await imp('assets/scripts/presentation/AssemblySliceLayout.ts');
    const boxes = new Map();
    for (const id of L.ASSEMBLY_SERIALIZED_PREFAB_MODULES) {
        boxes.set(id, worldBox(L.ASSEMBLY_MODULE_TRANSFORMS[id], glbBounds(EXPECTED_ASSET_FILES[id])));
    }
    const slab = L.ASSEMBLY_FOUNDATION_SLAB;
    boxes.set('foundation_slab', {
        min: { x: slab.center.x - (slab.size.x / 2), y: slab.center.y - (slab.size.y / 2), z: slab.center.z - (slab.size.z / 2) },
        max: { x: slab.center.x + (slab.size.x / 2), y: slab.center.y + (slab.size.y / 2), z: slab.center.z + (slab.size.z / 2) },
    });
    return { L, boxes };
}

test('AUT-039 FactoryWorld serializes the Assembly prefabs index-aligned with the layout and the Robot.glb prefab', async () => {
    const L = await imp('assets/scripts/presentation/AssemblySliceLayout.ts');
    const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
    const holders = scene.filter((entry) => Array.isArray(entry?.assemblyPrefabs));
    assert.equal(holders.length, 1, 'exactly one serialized assemblyPrefabs list');
    assert.equal(holders[0].__type__, scene.find((entry) => Array.isArray(entry?.factoryPrefabs)).__type__, 'held by FactoryWorldBootstrap');
    const prefabs = gltfScenePrefabs(artRoot);
    const uuids = holders[0].assemblyPrefabs.map((ref) => ref.__uuid__);
    assert.equal(uuids.length, L.ASSEMBLY_SERIALIZED_PREFAB_MODULES.length);
    L.ASSEMBLY_SERIALIZED_PREFAB_MODULES.forEach((id, i) => {
        assert.equal(uuids[i], L.ASSEMBLY_ASSET_REFERENCES[id], `${id} at index ${i}`);
        assert.equal(prefabs.get(uuids[i])?.file, EXPECTED_ASSET_FILES[id], `${id} resolves to ${prefabs.get(uuids[i])?.file}`);
    });
    assert.equal(holders[0].robotPrefab?.__uuid__, L.WORKER_BOT_PREFAB_REFERENCE);
    assert.deepEqual(prefabs.get(L.WORKER_BOT_PREFAB_REFERENCE), { file: 'Robot.glb', name: 'Robot.prefab' });
});

test('AUT-039 uses only already-imported AUT-032 assets (no new asset files)', () => {
    const doc = readFileSync(path.join(repoRoot, 'docs/AUT-032_3D_ASSET_ROBOT_SPIKE.md'), 'utf8');
    for (const file of [...Object.values(EXPECTED_ASSET_FILES), 'Robot.glb']) assert.ok(doc.includes(file), `${file} is in the AUT-032 inventory`);
    const factoryFiles = readdirSync(factoryDir).filter((name) => name.endsWith('.glb')).sort();
    assert.equal(factoryFiles.length, 12, 'the AUT-032 Kenney selection is unchanged');
    assert.deepEqual(readdirSync(path.join(artRoot)).filter((name) => !name.endsWith('.meta')), ['aut032']);
});

test('AUT-039 bootstrap wires the Assembly visual and first-robot controllers through the presentation registry', () => {
    const bootstrap = readFileSync(bootstrapPath, 'utf8');
    assert.match(bootstrap, /this\.createAssemblySlice\(site\);/);
    assert.match(bootstrap, /this\.connectFirstRobotPresentation\(site\);/);
    assert.match(bootstrap, /addComponent\(AssemblyVisualController\)/);
    assert.match(bootstrap, /addComponent\(FirstRobotPresentationController\)/);
    assert.match(bootstrap, /visual\.assemblyPrefabs = this\.assemblyPrefabs;/);
    assert.match(bootstrap, /robot\.robotPrefab = this\.robotPrefab;/);
    assert.match(bootstrap, /presentation\.focusAnchor = zone\?\.getChildByName\('FirstRobot_RevealAnchor'\)/);
    assert.match(bootstrap, /controller\.firstRobotPresentation = /);
    const registry = readFileSync(path.join(repoRoot, 'assets/scripts/presentation/PresentationController.ts'), 'utf8');
    assert.match(registry, /this\.firstRobotPresentation\?\.sync\(/);
    assert.match(registry, /this\.firstRobotPresentation\?\.consumeDomainEvents\(state, events\)/);
    const controller = readFileSync(path.join(repoRoot, 'assets/scripts/presentation/FirstRobotPresentationController.ts'), 'utf8');
    assert.match(controller, /this\.cameraController\.focusOnRevealTarget\(target\)/, 'reuses the AUT-038 reveal focus API');
    assert.doesNotMatch(controller, /focusOnWorldTarget|snapToWorldTarget|setFocusBounds/, 'no other camera API');
    // Visibility by scale (AUT-038 Android rule): the controllers never deactivate imported nodes.
    for (const file of ['AssemblyVisualController.ts', 'FirstRobotPresentationController.ts']) {
        const source = readFileSync(path.join(repoRoot, 'assets/scripts/presentation', file), 'utf8');
        assert.doesNotMatch(source, /\.active = false/, file);
    }
    for (const file of ['AssemblySliceLayout', 'AssemblyVisualStateResolver', 'FirstRobotPresentationViewModel', 'WorkerBotRoute', 'AssemblyVisualController', 'FirstRobotPresentationController']) {
        const meta = JSON.parse(readFileSync(path.join(repoRoot, `assets/scripts/presentation/${file}.ts.meta`), 'utf8'));
        assert.equal(meta.importer, 'typescript', `${file}.ts.meta`);
    }
});

test('AUT-039 diagnostics: robot_state is a declared DEBUG event type', async () => {
    const { DEVICE_EVENT_TYPES } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.ok(DEVICE_EVENT_TYPES.includes('robot_state'));
});

test('AUT-039 Assembly modules rest on their floor, stay below the Fabricator press and do not interpenetrate', async () => {
    const { L, boxes } = await composition();
    for (const id of ['workstation_bed', 'input_corner', 'assembly_arm', 'robot_bay', 'storage_crate']) {
        const t = L.ASSEMBLY_MODULE_TRANSFORMS[id];
        assert.ok(Math.abs(glbBounds(EXPECTED_ASSET_FILES[id]).min[1]) < 1e-3, `${id} pivot is bottom-centre`);
        assert.ok(Math.abs(t.position.y - L.floorHeightAt(t.position.x, t.position.z)) < EPS, `${id} rests on the floor`);
    }
    // Slab modules sit fully on the slab.
    const slab = boxes.get('foundation_slab');
    for (const id of ['workstation_bed', 'input_corner', 'assembly_arm']) {
        const b = boxes.get(id);
        assert.ok(b.min.x >= slab.min.x - EPS && b.max.x <= slab.max.x + EPS && b.min.z >= slab.min.z - EPS && b.max.z <= slab.max.z + EPS, `${id} on the slab`);
    }
    assert.ok(Math.abs(slab.max.y - L.SHELL_FLOOR.slabTop) < EPS);
    // Status panel seated on the bed inlet roof (1.25 at unit scale).
    const bed = L.ASSEMBLY_MODULE_TRANSFORMS.workstation_bed;
    assert.ok(Math.abs(L.ASSEMBLY_MODULE_TRANSFORMS.status_panel.position.y - (bed.position.y + (1.25 * bed.scale))) < EPS);
    // Lv10 composition stays shorter than the Fabricator press (Art Director).
    for (const id of ['workstation_bed', 'input_corner', 'assembly_arm', 'status_panel', 'robot_bay', 'storage_crate']) {
        assert.ok(boxes.get(id).max.y < PRESS_TOP, `${id} top ${boxes.get(id).max.y.toFixed(3)} < ${PRESS_TOP}`);
    }
    const ids = [...boxes.keys()].filter((id) => id !== 'foundation_slab');
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
        if (new Set([ids[i], ids[j]]).has('status_panel') && new Set([ids[i], ids[j]]).has('workstation_bed')) continue; // declared contact: panel on the roof
        assert.ok(!overlap(boxes.get(ids[i]), boxes.get(ids[j])), `${ids[i]} vs ${ids[j]}`);
    }
});

test('AUT-039 slice stays clear of the Fabricator zone, the spine, Robot Line, and keeps the Art Director anchors', async () => {
    const { L, boxes } = await composition();
    const { ZONE_LAYOUT } = await imp('assets/scripts/presentation/FactoryZoneLayout.ts');
    const footprint = (zone) => ({ min: { x: zone.x - (zone.width / 2), y: -1, z: zone.z - (zone.depth / 2) }, max: { x: zone.x + (zone.width / 2), y: 10, z: zone.z + (zone.depth / 2) } });
    for (const [id, box] of boxes) {
        assert.ok(!overlap(box, footprint(ZONE_LAYOUT.Fabricator)), `${id} clear of the Fabricator zone`);
        assert.ok(!overlap(box, footprint(ZONE_LAYOUT.RobotLine)), `${id} clear of the Robot Line zone`);
        assert.ok(box.max.x < 0.5, `${id} clear of RobotLine (x >= 0.5)`);
    }
    const spine = { min: { x: -6.3, y: 0.12, z: -0.65 }, max: { x: 6.7, y: 0.24, z: 0.05 } };
    for (const [id, box] of boxes) assert.ok(!overlap(box, spine), `${id} clear of the spine`);
    assert.match(readFileSync(bootstrapPath, 'utf8'), /'MainLogisticsSpine', new Vec3\(13, 0\.12, 0\.7\), new Vec3\(0\.2, 0\.18, -0\.3\)/);
    assert.ok(Math.abs(boxes.get('input_corner').max.z - spine.min.z) < EPS, 'input corner meets the spine edge');
    const bay = L.ASSEMBLY_MODULE_TRANSFORMS.robot_bay.position;
    assert.deepEqual([bay.x, bay.z], [-3.4, 0.7]);
    const storage = L.ASSEMBLY_MODULE_TRANSFORMS.storage_crate;
    assert.deepEqual([storage.position.x, storage.position.z, storage.scale], [-0.8, 0.95, 0.8]);
});

test('AUT-039 Worker Bot route never passes through a module and stays on the walkable floor', async () => {
    const { L, boxes } = await composition();
    const R = await imp('assets/scripts/presentation/WorkerBotRoute.ts');
    const CLEARANCE = 0.09;
    const poses = [];
    for (let t = 0; t <= R.WORKER_BOT_ENTRY_SECONDS; t += 0.02) poses.push(['entry', t, R.sampleEntryPose(t)]);
    for (let t = 0; t <= R.WORKER_BOT_LOOP_SECONDS; t += 0.02) poses.push(['loop', t, R.sampleLoopPose(t)]);
    for (const [phase, t, pose] of poses) {
        assert.equal(pose.y, L.floorHeightAt(pose.x, pose.z));
        for (const [id, b] of boxes) {
            if (id === 'foundation_slab') continue;
            const inside = pose.x > b.min.x - CLEARANCE && pose.x < b.max.x + CLEARANCE && pose.z > b.min.z - CLEARANCE && pose.z < b.max.z + CLEARANCE;
            if (id === 'robot_bay' && phase === 'entry' && pose.phase === 'activation') continue; // the robot activates inside its bay frame
            if (id === 'robot_bay' && phase === 'entry' && Math.hypot(pose.x - (-3.4), pose.z - 0.7) <= 0.6) continue; // walking out through the frame opening
            assert.ok(!inside, `${phase} t=${t.toFixed(2)} (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}) inside ${id}`);
        }
    }
    assert.equal(L.WORKER_BOT_SCALE * 4.513 < 1.5, true, 'robot fits under the bay frame');
});

function defaultCamera(overrides = {}) {
    const bootstrap = readFileSync(bootstrapPath, 'utf8');
    const num = (pattern) => { const match = bootstrap.match(pattern); assert.ok(match, `${pattern}`); return Number(match[1]); };
    const yaw = num(/defaultYawDeg = (-?[\d.]+)/) * Math.PI / 180;
    const pitch = num(/defaultPitchDeg = (-?[\d.]+)/) * Math.PI / 180;
    const distance = overrides.distance ?? num(/defaultDistance = ([\d.]+)/);
    const focus = overrides.focus ?? { x: num(/defaultFocusX = (-?[\d.]+)/), y: 0, z: num(/defaultFocusZ = (-?[\d.]+)/) };
    const fov = num(/camera\.fov = ([\d.]+)/) * Math.PI / 180;
    const h = distance * Math.cos(pitch);
    const eye = [focus.x + (Math.sin(yaw) * h), focus.y + (distance * Math.sin(pitch)), focus.z + (Math.cos(yaw) * h)];
    const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
    const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    const forward = norm([focus.x - eye[0], focus.y - eye[1], focus.z - eye[2]]);
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const tanH = Math.tan(fov / 2);
    const tanV = tanH * (2412 / 1080);
    return (x, y, z) => {
        const d = [x - eye[0], y - eye[1], z - eye[2]];
        const depth = dot(d, forward);
        return { x: dot(d, right) / depth / tanH, y: dot(d, up) / depth / tanV };
    };
}

test('AUT-039 slice modules and the whole robot route are on screen at the default portrait view and in the reveal focus', async () => {
    const { L, boxes } = await composition();
    const R = await imp('assets/scripts/presentation/WorkerBotRoute.ts');
    const bootstrap = readFileSync(bootstrapPath, 'utf8');
    const focusDistance = Number(bootstrap.match(/controller\.focusDistance = ([\d.]+);/)[1]);
    const views = {
        default: defaultCamera(),
        reveal: defaultCamera({ distance: focusDistance, focus: L.FIRST_ROBOT_REVEAL_TARGET }),
    };
    const robotTop = L.WORKER_BOT_SCALE * 4.513;
    for (const [name, project] of Object.entries(views)) {
        for (const [id, b] of boxes) {
            for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
                const p = project(x, y, z);
                assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: ${id} corner on screen (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
            }
        }
        const points = [R.sampleEntryPose(0), ...R.WORKER_BOT_LOOP_ROUTE.map((s) => ({ x: s.x, y: L.floorHeightAt(s.x, s.z), z: s.z })), ...R.WORKER_BOT_ENTRY_ROUTE.map((s) => ({ x: s.x, y: 0, z: s.z }))];
        for (const point of points) for (const y of [point.y, point.y + robotTop]) {
            const p = project(point.x, y, point.z);
            assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: robot at (${point.x}, ${point.z}) on screen (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        }
    }
});
