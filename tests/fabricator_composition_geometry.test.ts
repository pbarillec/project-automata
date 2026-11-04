const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

/*
 * AUT-038 visual correction: geometry sanity for the first-automation
 * production line (press + output tray + feeder hopper + input conveyor).
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

function glbBounds(file: string): Bounds {
    const buffer = readFileSync(path.join(factoryAssetDir, file));
    const jsonLength = buffer.readUInt32LE(12);
    const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const node of gltf.nodes) {
        // These single-node assets must not carry a node transform.
        assert.equal(node.translation, undefined, `${file} node translation`);
        assert.equal(node.rotation, undefined, `${file} node rotation`);
        assert.equal(node.scale, undefined, `${file} node scale`);
    }
    for (const mesh of gltf.meshes) {
        for (const primitive of mesh.primitives) {
            const accessor = gltf.accessors[primitive.attributes.POSITION];
            for (let axis = 0; axis < 3; axis += 1) {
                min[axis] = Math.min(min[axis], accessor.min[axis]);
                max[axis] = Math.max(max[axis], accessor.max[axis]);
            }
        }
    }
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

function loadComposition(): Map<string, Transform> {
    const source = readFileSync(controllerPath, 'utf8');
    const positions = vecTable(source, 'positionFor');
    const scales = vecTable(source, 'scaleFor');
    const rotations = vecTable(source, 'rotationFor');
    const uuidToFile = assetFileByUuid();
    const references = new Map<string, string>();
    for (const match of source.matchAll(/(\w+):\s*'([0-9a-f-]+)@\w+'/g)) {
        references.set(match[1], match[2]);
    }
    const modules: Record<string, string> = {
        base_compact_press: 'machine.glb',
        simple_output_tray: 'conveyor.glb',
        secondary_module: 'box-large.glb',
        auto_feeder_hopper: 'hopper-square.glb',
        input_conveyor: 'conveyor.glb',
    };
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
