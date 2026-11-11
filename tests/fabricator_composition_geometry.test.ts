const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

/*
 * AUT-038 visual correction: geometry sanity for the first-automation
 * production line (press + output tray + feeder hopper + input conveyor).
 * AUT-VIS-002 extends it to the Lv25/Lv50/Lv100 milestone modules.
 * Bounds come from the approved AUT-032 GLBs; transforms come from the
 * FabricatorVisualController composition tables.
 */

const repoRoot = path.resolve(path.dirname(__filename), '..');
const controllerPath = path.join(repoRoot, 'assets/scripts/presentation/FabricatorVisualController.ts');
const bootstrapPath = path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts');
const factoryAssetDir = path.join(repoRoot, 'assets/art/aut032/factory');

// Measured on machine.glb by ray casting: open tunnel along local X,
// inner half-width 0.5 (walls start at |z| = 0.5) and ceiling at y ~1.0.
const MACHINE_TUNNEL_HALF_WIDTH = 0.5;
const MACHINE_TUNNEL_CEILING = 1.0;
// Measured on machine.glb: roof surface at y 1.20..1.27.
const MACHINE_ROOF_MIN = 1.2;
// Measured on hopper-square.glb: outlet ring half-width 0.25 at y = 0.
const HOPPER_OUTLET_HALF = 0.25;
const EPS = 0.011;

type Vec = { x: number; y: number; z: number };
type Bounds = { min: number[]; max: number[] };
type Transform = { pos: Vec; scale: Vec; rotY: number; bounds: Bounds };
type Axis = { x: number; z: number };

// Hierarchical assets (robot-arm-a.glb) stack child meshes by node
// translation only; every other asset is a single untransformed node.
const HIERARCHICAL_ASSETS = new Set(['robot-arm-a.glb']);

function glbBounds(file: string): Bounds {
    const buffer = readFileSync(path.join(factoryAssetDir, file));
    const jsonLength = buffer.readUInt32LE(12);
    const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const node of gltf.nodes) {
        assert.equal(node.rotation, undefined, `${file} node rotation`);
        assert.equal(node.scale, undefined, `${file} node scale`);
        // These single-node assets must not carry a node transform.
        if (!HIERARCHICAL_ASSETS.has(file)) assert.equal(node.translation, undefined, `${file} node translation`);
    }
    const visit = (index: number, offset: number[]) => {
        const node = gltf.nodes[index];
        const at = offset.map((value, axis) => value + (node.translation?.[axis] ?? 0));
        if (node.mesh !== undefined) {
            for (const primitive of gltf.meshes[node.mesh].primitives) {
                const accessor = gltf.accessors[primitive.attributes.POSITION];
                for (let axis = 0; axis < 3; axis += 1) {
                    min[axis] = Math.min(min[axis], accessor.min[axis] + at[axis]);
                    max[axis] = Math.max(max[axis], accessor.max[axis] + at[axis]);
                }
            }
        }
        for (const child of node.children ?? []) visit(child, at);
    };
    for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, [0, 0, 0]);
    return { min, max };
}

function assetFileByUuid(): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of readdirSync(factoryAssetDir)) {
        if (!file.endsWith('.glb.meta')) continue;
        const meta = JSON.parse(readFileSync(path.join(factoryAssetDir, file), 'utf8'));
        map.set(meta.uuid, file.replace(/\.meta$/, ''));
    }
    return map;
}

function vecTable(source: string, method: string): Map<string, Vec> {
    const start = source.indexOf(`private ${method}(`);
    assert.ok(start >= 0, `${method} exists`);
    const end = source.indexOf('return ', start);
    const body = source.slice(start, end);
    const table = new Map<string, Vec>();
    const entry = /(\w+):\s*new Vec3\(\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\)/g;
    for (const match of body.matchAll(entry)) {
        table.set(match[1], { x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) });
    }
    return table;
}

const FIRST_AUTOMATION_MODULES: Record<string, string> = {
    base_compact_press: 'machine.glb',
    simple_output_tray: 'conveyor.glb',
    secondary_module: 'box-large.glb',
    auto_feeder_hopper: 'hopper-square.glb',
    input_conveyor: 'conveyor.glb',
};

function loadComposition(modules: Record<string, string> = FIRST_AUTOMATION_MODULES): Map<string, Transform> {
    const source = readFileSync(controllerPath, 'utf8');
    const positions = vecTable(source, 'positionFor');
    const scales = vecTable(source, 'scaleFor');
    const rotations = vecTable(source, 'rotationFor');
    const uuidToFile = assetFileByUuid();
    const references = new Map<string, string>();
    for (const match of source.matchAll(/(\w+):\s*'([0-9a-f-]+)@\w+'/g)) {
        references.set(match[1], match[2]);
    }
    const result = new Map<string, Transform>();
    for (const [name, expectedFile] of Object.entries(modules)) {
        const file = uuidToFile.get(references.get(name) ?? '');
        assert.equal(file, expectedFile, `${name} asset mapping`);
        const pos = positions.get(name);
        assert.ok(pos, `${name} has an explicit position`);
        const rotation = rotations.get(name) ?? { x: 0, y: 0, z: 0 };
        assert.equal(rotation.x, 0, `${name} stays upright`);
        assert.equal(rotation.z, 0, `${name} stays upright`);
        result.set(name, {
            pos,
            scale: scales.get(name) ?? { x: 1, y: 1, z: 1 },
            rotY: rotation.y,
            bounds: glbBounds(file),
        });
    }
    return result;
}

function get(c: Map<string, Transform>, name: string): Transform {
    const t = c.get(name);
    assert.ok(t, `${name} is composed`);
    return t;
}

// Cocos Y rotation maps local +X to world (cos, 0, -sin).
function axisOf(rotY: number): Axis {
    const rad = (rotY * Math.PI) / 180;
    return { x: Math.cos(rad), z: -Math.sin(rad) };
}

// Extent of a grid-aligned module along a world horizontal axis.
function along(t: Transform, axis: Axis): { min: number; max: number } {
    const own = axisOf(t.rotY);
    const dot = (own.x * axis.x) + (own.z * axis.z);
    const parallel = Math.abs(dot) > 0.5;
    const localMin = parallel ? t.bounds.min[0] * t.scale.x : t.bounds.min[2] * t.scale.z;
    const localMax = parallel ? t.bounds.max[0] * t.scale.x : t.bounds.max[2] * t.scale.z;
    const centre = (t.pos.x * axis.x) + (t.pos.z * axis.z);
    const a = centre + (Math.sign(dot || 1) * localMin);
    const b = centre + (Math.sign(dot || 1) * localMax);
    return { min: Math.min(a, b), max: Math.max(a, b) };
}

function topOf(t: Transform): number {
    return t.pos.y + (t.bounds.max[1] * t.scale.y);
}

function floorTop(): number {
    const source = readFileSync(bootstrapPath, 'utf8');
    const match = source.match(/'OpeningWorkshopFoundation', new Vec3\([\d.]+, ([\d.]+), [\d.]+\), new Vec3\(-?[\d.]+, ([\d.]+), -?[\d.]+\)/);
    assert.ok(match, 'opening foundation box is declared');
    return Number(match[2]) + (Number(match[1]) / 2);
}

test('first-automation line modules rest on the workshop floor and share one axis', () => {
    const c = loadComposition();
    const floor = floorTop();
    for (const name of ['base_compact_press', 'simple_output_tray', 'input_conveyor']) {
        const t = get(c, name);
        assert.ok(Math.abs(t.bounds.min[1]) < 1e-3, `${name} pivot is bottom-centre`);
        assert.ok(Math.abs(t.pos.y - floor) <= EPS, `${name} rests on floor (${t.pos.y} vs ${floor})`);
    }
    const press = get(c, 'base_compact_press');
    for (const name of ['simple_output_tray', 'input_conveyor']) {
        const delta = (((get(c, name).rotY - press.rotY) % 180) + 180) % 180;
        assert.equal(delta, 0, `${name} travel axis is parallel to the press tunnel`);
    }
});

test('input belt and output tray enter opposite press mouths, centred and under the tunnel ceiling', () => {
    const c = loadComposition();
    const press = get(c, 'base_compact_press');
    const axis = axisOf(press.rotY);
    const lateral = { x: -axis.z, z: axis.x };
    const pressSpan = along(press, axis);
    const pressLateralCentre = (press.pos.x * lateral.x) + (press.pos.z * lateral.z);
    const tunnelHalf = MACHINE_TUNNEL_HALF_WIDTH * press.scale.z;
    const ceiling = press.pos.y + (MACHINE_TUNNEL_CEILING * press.scale.y);

    const spans: Record<string, { min: number; max: number }> = {};
    for (const name of ['input_conveyor', 'simple_output_tray']) {
        const belt = get(c, name);
        const span = along(belt, axis);
        spans[name] = span;
        const beltLateral = along(belt, lateral);
        const centre = (beltLateral.min + beltLateral.max) / 2;
        assert.ok(Math.abs(centre - pressLateralCentre) <= EPS, `${name} is centred on the tunnel`);
        assert.ok((beltLateral.max - beltLateral.min) / 2 <= tunnelHalf, `${name} fits the tunnel width`);
        assert.ok(topOf(belt) < ceiling, `${name} passes under the tunnel ceiling`);
        const inside = Math.min(span.max, pressSpan.max) - Math.max(span.min, pressSpan.min);
        assert.ok(inside >= 0.1 && inside <= 0.5, `${name} reaches ${inside.toFixed(3)} into a press mouth`);
    }
    const inputOnHigh = spans.input_conveyor.max > pressSpan.max;
    const outputOnHigh = spans.simple_output_tray.max > pressSpan.max;
    assert.notEqual(inputOnHigh, outputOnHigh, 'input and output use opposite mouths');
});

test('feeder hopper outlet sits on the upstream input belt and stays subordinate to the press', () => {
    const c = loadComposition();
    const press = get(c, 'base_compact_press');
    const hopper = get(c, 'auto_feeder_hopper');
    const belt = get(c, 'input_conveyor');
    const axis = axisOf(press.rotY);
    const lateral = { x: -axis.z, z: axis.x };
    assert.ok(Math.abs(hopper.pos.y - topOf(belt)) <= EPS, `hopper outlet (${hopper.pos.y}) meets belt top (${topOf(belt)})`);

    const beltSpan = along(belt, axis);
    const hopperCentre = (hopper.pos.x * axis.x) + (hopper.pos.z * axis.z);
    const outletHalf = HOPPER_OUTLET_HALF * hopper.scale.x;
    assert.ok(hopperCentre - outletHalf >= beltSpan.min && hopperCentre + outletHalf <= beltSpan.max, 'outlet lands on the belt');
    const beltLateral = along(belt, lateral);
    const hopperLateral = (hopper.pos.x * lateral.x) + (hopper.pos.z * lateral.z);
    assert.ok(Math.abs(hopperLateral - ((beltLateral.min + beltLateral.max) / 2)) <= EPS, 'outlet is centred on the belt');

    const pressSpan = along(press, axis);
    const hopperSpan = along(hopper, axis);
    const gap = hopperSpan.min > pressSpan.max ? hopperSpan.min - pressSpan.max : pressSpan.min - hopperSpan.max;
    assert.ok(gap >= 0.3, `visible carry segment between feeder and press (${gap.toFixed(3)})`);
    assert.ok(topOf(hopper) < topOf(press), 'press remains the tallest silhouette');
});

test('output product block rests on the output tray outside the press', () => {
    const c = loadComposition();
    const press = get(c, 'base_compact_press');
    const tray = get(c, 'simple_output_tray');
    const block = get(c, 'secondary_module');
    const axis = axisOf(press.rotY);
    assert.ok(Math.abs(block.pos.y - topOf(tray)) <= EPS, 'block rests on the tray top');
    const blockSpan = along(block, axis);
    const traySpan = along(tray, axis);
    const pressSpan = along(press, axis);
    assert.ok(blockSpan.min >= traySpan.min && blockSpan.max <= traySpan.max, 'block is supported by the tray');
    assert.ok(blockSpan.max <= pressSpan.min + EPS || blockSpan.min >= pressSpan.max - EPS, 'block is visible outside the press');
});

test('status indicators sit on the press roof instead of inside the body', () => {
    const source = readFileSync(controllerPath, 'utf8');
    const positions = vecTable(source, 'positionFor');
    const scales = vecTable(source, 'scaleFor');
    const press = positions.get('base_compact_press');
    const pressScale = scales.get('base_compact_press');
    assert.ok(press && pressScale);
    const roof = press.y + (MACHINE_ROOF_MIN * pressScale.y);
    for (const name of ['strong_status_indicator', 'autonomous_cycle_indicator']) {
        const p = positions.get(name);
        assert.ok(p, `${name} has a position`);
        assert.ok(Math.abs(p.y - roof) <= 0.03, `${name} base (${p.y}) on roof (${roof})`);
        const half = 0.6 * pressScale.x;
        assert.ok(Math.abs(p.x - press.x) <= half && Math.abs(p.z - press.z) <= half, `${name} within the roof footprint`);
    }
});

/*
 * AUT-VIS-002: Lv25 / Lv50 / Lv100 milestone modules on the composed line.
 * The default portrait view sees the Fabricator from world +X/-Z with the zone
 * near the right screen edge, so the expansion grows on the free +X side:
 * Lv25 output belt -> storage -> pipe toward Assembly; Lv50 twin press fed by
 * the machine-bed corner gantry; Lv100 transfer belt, gantry-roof feeder,
 * robotic arm and a panel on the twin roof.
 */
const HIGH_LEVEL_MODULES: Record<string, string> = {
    output_conveyor: 'conveyor.glb',
    storage_buffer: 'box-large.glb',
    logistics_connection: 'pipe-large.glb',
    dual_fabrication_module: 'machine.glb',
    shared_industrial_base: 'machine-bed.glb',
    integrated_feeder: 'hopper-square.glb',
    automated_input_output: 'conveyor.glb',
    small_robotic_arm: 'robot-arm-a.glb',
    advanced_indicators: 'screen-panel-wide.glb',
};
const ALL_MODULES: Record<string, string> = { ...FIRST_AUTOMATION_MODULES, ...HIGH_LEVEL_MODULES };
// Measured on machine-bed.glb: a 90-degree corner gantry. Inlet mouth centre
// (-0.6, 0) opening toward local -X; outlet mouth centre (1.0, 1.6) opening
// toward local +Z; tunnel 1.0 wide with its ceiling at y ~1.0; the roof over
// the inlet section (|x|, |z| <= 0.5) peaks at y 1.25.
const BED_INLET = { x: -0.6, z: 0 };
const BED_OUTLET = { x: 1.0, z: 1.6 };
const BED_ROOF_TOP = 1.25;
const BED_INLET_ROOF_HALF = 0.5;
// Measured on machine.glb: the tunnel mouths are its local +/-X faces.
const MACHINE_MOUTH_X = 0.6;

type Box = { min: Vec; max: Vec };

// Cocos Y rotation: local (x, z) -> world (x cos + z sin, -x sin + z cos).
function toWorld(t: Transform, local: { x: number; y?: number; z: number }): Vec {
    const rad = (t.rotY * Math.PI) / 180;
    const x = local.x * t.scale.x;
    const z = local.z * t.scale.z;
    return {
        x: t.pos.x + (x * Math.cos(rad)) + (z * Math.sin(rad)),
        y: t.pos.y + ((local.y ?? 0) * t.scale.y),
        z: t.pos.z - (x * Math.sin(rad)) + (z * Math.cos(rad)),
    };
}

function worldBox(t: Transform): Box {
    const corners = [];
    for (const x of [t.bounds.min[0], t.bounds.max[0]]) {
        for (const z of [t.bounds.min[2], t.bounds.max[2]]) corners.push(toWorld(t, { x, z }));
    }
    return {
        min: { x: Math.min(...corners.map((c) => c.x)), y: t.pos.y + (t.bounds.min[1] * t.scale.y), z: Math.min(...corners.map((c) => c.z)) },
        max: { x: Math.max(...corners.map((c) => c.x)), y: topOf(t), z: Math.max(...corners.map((c) => c.z)) },
    };
}

function overlap(a: Box, b: Box, axis: 'x' | 'y' | 'z'): number {
    return Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
}

function sceneBox(source: string, name: string): { size: number[]; centre: number[] } {
    const start = source.indexOf(`'${name}', new Vec3(`);
    assert.ok(start >= 0, `${name} box is declared`);
    const match = source.slice(start).match(/new Vec3\(([^)]*)\), new Vec3\(([^)]*)\)/);
    assert.ok(match, `${name} box size and centre`);
    return { size: match[1].split(',').map(Number), centre: match[2].split(',').map(Number) };
}

function zoneLayout(): Record<string, { x: number; z: number; width: number; depth: number }> {
    const source = readFileSync(path.join(repoRoot, 'assets/scripts/presentation/FactoryZoneLayout.ts'), 'utf8');
    const zones: Record<string, { x: number; z: number; width: number; depth: number }> = {};
    for (const m of source.matchAll(/(\w+): \{ x: (-?[\d.]+), z: (-?[\d.]+), width: ([\d.]+), depth: ([\d.]+) \}/g)) {
        zones[m[1]] = { x: Number(m[2]), z: Number(m[3]), width: Number(m[4]), depth: Number(m[5]) };
    }
    assert.ok(zones.Fabricator && zones.AssemblyStation, 'zone layout parsed');
    return zones;
}

/** Ground rectangles in Fabricator-local coordinates. */
function localRect(centreX: number, centreZ: number, width: number, depth: number, fabricator: { x: number; z: number }) {
    return { minX: centreX - (width / 2) - fabricator.x, maxX: centreX + (width / 2) - fabricator.x, minZ: centreZ - (depth / 2) - fabricator.z, maxZ: centreZ + (depth / 2) - fabricator.z };
}

const FLOOR_MODULES = ['output_conveyor', 'storage_buffer', 'logistics_connection', 'dual_fabrication_module', 'shared_industrial_base', 'automated_input_output', 'small_robotic_arm'];

test('AUT-VIS-002 Lv25+ modules keep the approved asset mapping and stay upright on the grid', () => {
    const c = loadComposition(HIGH_LEVEL_MODULES);
    for (const name of Object.keys(HIGH_LEVEL_MODULES)) {
        const t = get(c, name);
        assert.equal(((t.rotY % 90) + 90) % 90, 0, `${name} is grid aligned`);
        assert.ok(t.scale.x > 0 && t.scale.y > 0 && t.scale.z > 0, `${name} has a positive scale`);
    }
});

test('AUT-VIS-002 Lv25+ floor modules rest on the workshop floor, inside the foundation and clear of the neighbours', () => {
    const c = loadComposition(HIGH_LEVEL_MODULES);
    const floor = floorTop();
    const bootstrap = readFileSync(bootstrapPath, 'utf8');
    const zones = zoneLayout();
    const fab = zones.Fabricator;
    const foundation = sceneBox(bootstrap, 'OpeningWorkshopFoundation');
    const ground = localRect(foundation.centre[0], foundation.centre[2], foundation.size[0], foundation.size[2], fab);
    const spine = sceneBox(bootstrap, 'MainLogisticsSpine');
    const asm = zones.AssemblyStation;
    const keepOut = {
        MainLogisticsSpine: localRect(spine.centre[0], spine.centre[2], spine.size[0], spine.size[2], fab),
        // FactoryWorldBootstrap InactiveShell footprint (0.48 x 0.42 of the zone).
        AssemblyStation_InactiveShell: localRect(asm.x, asm.z, asm.width * 0.48, asm.depth * 0.42, fab),
    };
    for (const name of FLOOR_MODULES) {
        const t = get(c, name);
        assert.ok(Math.abs(t.bounds.min[1]) < 1e-3, `${name} pivot is bottom-centre`);
        assert.ok(Math.abs(t.pos.y - floor) <= EPS, `${name} rests on floor (${t.pos.y} vs ${floor})`);
        const box = worldBox(t);
        assert.ok(box.min.x >= ground.minX - EPS && box.max.x <= ground.maxX + EPS && box.min.z >= ground.minZ - EPS && box.max.z <= ground.maxZ + EPS, `${name} footprint stays on the foundation`);
        for (const [other, rect] of Object.entries(keepOut)) {
            const clear = box.max.x <= rect.minX + EPS || box.min.x >= rect.maxX - EPS || box.max.z <= rect.minZ + EPS || box.min.z >= rect.maxZ - EPS;
            assert.ok(clear, `${name} stays clear of ${other}`);
        }
    }
});

test('AUT-VIS-002 the full Lv100 automated composition has no interpenetrating modules', () => {
    const c = loadComposition(ALL_MODULES);
    // Designed contacts: belts entering a tunnel mouth, and add-ons seated on a roof.
    const allowed = new Set([
        'base_compact_press+input_conveyor',
        'base_compact_press+simple_output_tray',
        'dual_fabrication_module+automated_input_output',
        'dual_fabrication_module+advanced_indicators',
        'shared_industrial_base+integrated_feeder',
    ]);
    const names = [...c.keys()];
    for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
            const pair = [names[i], names[j]];
            if (allowed.has(pair.join('+')) || allowed.has([pair[1], pair[0]].join('+'))) continue;
            const a = worldBox(get(c, pair[0]));
            const b = worldBox(get(c, pair[1]));
            const intersects = overlap(a, b, 'x') > EPS && overlap(a, b, 'y') > EPS && overlap(a, b, 'z') > EPS;
            assert.ok(!intersects, `${pair[0]} and ${pair[1]} do not interpenetrate`);
        }
    }
});

test('AUT-VIS-002 Lv25 output belt carries the tray output sideways to the storage buffer and the logistics stub', () => {
    const c = loadComposition(ALL_MODULES);
    const tray = worldBox(get(c, 'simple_output_tray'));
    const beltT = get(c, 'output_conveyor');
    const belt = worldBox(beltT);
    const storage = worldBox(get(c, 'storage_buffer'));
    const pipeT = get(c, 'logistics_connection');
    const pipe = worldBox(pipeT);
    const travel = axisOf(beltT.rotY);
    const trayAxis = axisOf(get(c, 'simple_output_tray').rotY);
    assert.ok(Math.abs((travel.x * trayAxis.x) + (travel.z * trayAxis.z)) < 1e-6, 'output belt turns 90 degrees off the tray');
    assert.ok(Math.abs(topOf(beltT) - topOf(get(c, 'simple_output_tray'))) <= EPS, 'output belt shares the tray belt height');
    const pressBox = worldBox(get(c, 'base_compact_press'));
    assert.ok(Math.abs(belt.min.z - tray.min.z) <= EPS && Math.abs(belt.max.z - pressBox.min.z) <= EPS, 'output belt spans the tray outside the press mouth');
    assert.ok(Math.abs(belt.min.x - tray.max.x) <= EPS, 'output belt starts at the tray side');
    assert.ok(Math.abs(storage.min.x - belt.max.x) <= EPS, 'storage buffer sits at the belt end');
    assert.ok(Math.abs(((storage.min.z + storage.max.z) / 2) - ((belt.min.z + belt.max.z) / 2)) <= EPS, 'storage buffer is centred on the belt');
    const pipeAxis = axisOf(pipeT.rotY);
    assert.ok(Math.abs((pipeAxis.x * travel.x) + (pipeAxis.z * travel.z)) > 0.99, 'pipe continues the belt travel direction');
    assert.ok(Math.abs(pipe.min.x - storage.max.x) <= EPS, 'pipe stub leaves the storage far face');
    assert.ok(Math.abs(((pipe.min.z + pipe.max.z) / 2) - ((storage.min.z + storage.max.z) / 2)) <= EPS, 'pipe stub is centred on the storage');
});

test('AUT-VIS-002 Lv50 twin press runs parallel to the primary press and is fed by the corner gantry outlet', () => {
    const c = loadComposition(ALL_MODULES);
    const press = get(c, 'base_compact_press');
    const twin = get(c, 'dual_fabrication_module');
    const bed = get(c, 'shared_industrial_base');
    const flow = axisOf(press.rotY);
    const delta = (((twin.rotY - press.rotY) % 360) + 360) % 360;
    assert.equal(delta, 0, 'twin tunnel runs the same direction as the primary tunnel');
    assert.ok(twin.scale.x < press.scale.x, 'twin stays subordinate to the primary press');

    // The input mouth is local -X (upstream); flow travels local +X.
    const twinInput = toWorld(twin, { x: -MACHINE_MOUTH_X, z: 0 });
    const outlet = toWorld(bed, BED_OUTLET);
    assert.ok(Math.abs(outlet.x - twinInput.x) <= EPS && Math.abs(outlet.z - twinInput.z) <= EPS, `gantry outlet meets the twin input mouth (${outlet.x.toFixed(3)}, ${outlet.z.toFixed(3)})`);
    const outletDir = toWorld({ ...bed, pos: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, { x: 0, z: 1 });
    assert.ok(Math.abs(outletDir.x - flow.x) < 1e-6 && Math.abs(outletDir.z - flow.z) < 1e-6, 'gantry outlet discharges along the line flow');
    assert.ok(0.5 * bed.scale.x <= MACHINE_TUNNEL_HALF_WIDTH * twin.scale.z + EPS, 'gantry tunnel fits inside the twin mouth');
    assert.ok(bed.pos.y + (MACHINE_TUNNEL_CEILING * bed.scale.y) <= twin.pos.y + (MACHINE_TUNNEL_CEILING * twin.scale.y) + EPS, 'gantry tunnel is no taller than the twin tunnel');
    // The gantry inlet faces away from the primary line (toward open floor).
    const inlet = toWorld(bed, BED_INLET);
    const lateral = { x: -flow.z, z: flow.x };
    const side = (p: { x: number; z: number }) => (p.x * lateral.x) + (p.z * lateral.z);
    assert.ok(Math.abs(side(inlet) - side(press.pos)) > Math.abs(side(twin.pos) - side(press.pos)), 'gantry inlet sits on the far side of the twin from the primary press');
});

test('AUT-VIS-002 Lv100 transfer belt links the twin output mouth to the shared output belt', () => {
    const c = loadComposition(ALL_MODULES);
    const twin = get(c, 'dual_fabrication_module');
    const transferT = get(c, 'automated_input_output');
    const outputT = get(c, 'output_conveyor');
    const axis = axisOf(twin.rotY);
    const lateral = { x: -axis.z, z: axis.x };
    assert.equal((((transferT.rotY - twin.rotY) % 180) + 180) % 180, 0, 'transfer belt travels along the twin tunnel');
    const span = along(transferT, axis);
    const twinSpan = along(twin, axis);
    const transferLateral = along(transferT, lateral);
    const twinLateral = (twin.pos.x * lateral.x) + (twin.pos.z * lateral.z);
    assert.ok(Math.abs(((transferLateral.min + transferLateral.max) / 2) - twinLateral) <= EPS, 'transfer belt is centred on the twin tunnel');
    assert.ok((transferLateral.max - transferLateral.min) / 2 <= MACHINE_TUNNEL_HALF_WIDTH * twin.scale.z, 'transfer belt fits the twin tunnel width');
    assert.ok(topOf(transferT) < twin.pos.y + (MACHINE_TUNNEL_CEILING * twin.scale.y), 'transfer belt passes under the twin tunnel ceiling');
    const inside = Math.min(span.max, twinSpan.max) - Math.max(span.min, twinSpan.min);
    assert.ok(inside >= 0.1 && inside <= 0.5, `transfer belt reaches ${inside.toFixed(3)} into the twin mouth`);
    assert.ok(Math.abs(topOf(transferT) - topOf(outputT)) <= EPS, 'transfer belt shares the output belt height');
    const transfer = worldBox(transferT);
    const output = worldBox(outputT);
    assert.ok(Math.abs(transfer.min.z - output.max.z) <= EPS, 'transfer belt ends on the output belt edge');
    assert.ok(transfer.min.x >= output.min.x - EPS && transfer.min.x <= output.max.x, 'transfer belt lands over the output belt');
});

test('AUT-VIS-002 Lv100 add-ons sit on their hosts and the primary press stays the tallest silhouette', () => {
    const c = loadComposition(ALL_MODULES);
    const press = get(c, 'base_compact_press');
    const bed = get(c, 'shared_industrial_base');
    const twin = get(c, 'dual_fabrication_module');
    const feeder = get(c, 'integrated_feeder');
    const panel = get(c, 'advanced_indicators');
    assert.ok(Math.abs(feeder.pos.y - (bed.pos.y + (BED_ROOF_TOP * bed.scale.y))) <= 0.03, 'integrated feeder rests on the gantry roof');
    const feederLocal = { x: feeder.pos.x - bed.pos.x, z: feeder.pos.z - bed.pos.z };
    const roofHalf = BED_INLET_ROOF_HALF * bed.scale.x;
    assert.ok(Math.abs(feederLocal.x) <= roofHalf && Math.abs(feederLocal.z) <= roofHalf, 'integrated feeder is over the gantry inlet section');
    assert.ok(Math.abs(panel.pos.y - (twin.pos.y + (MACHINE_ROOF_MIN * twin.scale.y))) <= 0.03, 'advanced panel rests on the twin roof');
    const half = 0.6 * twin.scale.x;
    assert.ok(Math.abs(panel.pos.x - twin.pos.x) <= half && Math.abs(panel.pos.z - twin.pos.z) <= half, 'advanced panel is within the twin roof footprint');
    for (const name of Object.keys(HIGH_LEVEL_MODULES)) {
        assert.ok(topOf(get(c, name)) < topOf(press), `${name} stays below the primary press (${topOf(get(c, name)).toFixed(3)})`);
    }
});

test('AUT-VIS-002 keeps the Lv1-Lv10 and Auto Feeder transforms from AUT-038', () => {
    const source = readFileSync(controllerPath, 'utf8');
    const positions = vecTable(source, 'positionFor');
    const scales = vecTable(source, 'scaleFor');
    const rotations = vecTable(source, 'rotationFor');
    const expected: Record<string, [number[], number[], number[]]> = {
        base_compact_press: [[0, 0.14, -0.3], [1.05, 1.05, 1.05], [0, 90, 0]],
        simple_output_tray: [[0, 0.14, -1.15], [0.9, 0.9, 0.9], [0, 90, 0]],
        secondary_module: [[0, 0.5, -1.28], [0.5, 0.5, 0.5], [0, 90, 0]],
        strong_status_indicator: [[0.25, 1.4, -0.57], [0.28, 0.28, 0.28], [0, -90, 0]],
        auto_feeder_hopper: [[0, 0.5, 1.38], [0.9, 0.9, 0.9], [0, 90, 0]],
        input_conveyor: [[0, 0.14, 1.0], [1.8, 0.9, 0.9], [0, 90, 0]],
        autonomous_cycle_indicator: [[0.25, 1.4, -0.03], [0.2, 0.2, 0.2], [0, -90, 0]],
    };
    const flat = (v: Vec | undefined) => (v ? [v.x, v.y, v.z] : undefined);
    for (const [name, [pos, scale, rot]] of Object.entries(expected)) {
        assert.deepEqual(flat(positions.get(name)), pos, `${name} position`);
        assert.deepEqual(flat(scales.get(name)), scale, `${name} scale`);
        assert.deepEqual(flat(rotations.get(name)), rot, `${name} rotation`);
    }
});

test('AUT-VIS-002 the full Lv100 composition stays on screen at the default portrait view', () => {
    const bootstrap = readFileSync(bootstrapPath, 'utf8');
    const num = (pattern: RegExp) => {
        const match = bootstrap.match(pattern);
        assert.ok(match, `${pattern} configured`);
        return Number(match[1]);
    };
    const yaw = num(/defaultYawDeg = (-?[\d.]+)/) * Math.PI / 180;
    const pitch = num(/defaultPitchDeg = (-?[\d.]+)/) * Math.PI / 180;
    const distance = num(/defaultDistance = ([\d.]+)/);
    const focus = { x: num(/defaultFocusX = (-?[\d.]+)/), z: num(/defaultFocusZ = (-?[\d.]+)/) };
    const fov = num(/camera\.fov = ([\d.]+)/) * Math.PI / 180;
    assert.match(bootstrap, /camera\.fovAxis = Camera\.FOVAxis\.HORIZONTAL/);
    const fab = zoneLayout().Fabricator;
    // MobileCameraController.applyCameraPose with focusHeight 0.
    const h = distance * Math.cos(pitch);
    const eye = [focus.x + (Math.sin(yaw) * h), distance * Math.sin(pitch), focus.z + (Math.cos(yaw) * h)];
    const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const cross = (a: number[], b: number[]) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
    const dot = (a: number[], b: number[]) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    const forward = norm([focus.x - eye[0], -eye[1], focus.z - eye[2]]);
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const tanH = Math.tan(fov / 2);
    // Narrowest supported portrait: the NE2215 gate device (1080 x 2412).
    const tanV = tanH * (2412 / 1080);
    const c = loadComposition(ALL_MODULES);
    for (const [name, t] of c) {
        const box = worldBox(t);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
            const d = [x + fab.x - eye[0], y - eye[1], z + fab.z - eye[2]];
            const depth = dot(d, forward);
            const ndcX = dot(d, right) / depth / tanH;
            const ndcY = dot(d, up) / depth / tanV;
            assert.ok(Math.abs(ndcX) <= 0.98 && Math.abs(ndcY) <= 1, `${name} corner on screen (ndc ${ndcX.toFixed(2)}, ${ndcY.toFixed(2)})`);
        }
    }
});
