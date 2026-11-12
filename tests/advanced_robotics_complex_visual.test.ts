import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import type { DomainEvent } from '../assets/scripts/domain/Events.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { DEFAULT_CAMERA_TUNING } from '../assets/scripts/camera/CameraMath.ts';
import { ZONE_LAYOUT, factoryZoneIds } from '../assets/scripts/presentation/FactoryZoneLayout.ts';
import { resolveCameraPanBounds, resolveUnlockedCameraZones } from '../assets/scripts/presentation/CameraPanBounds.ts';
import { pickSelectionTarget } from '../assets/scripts/presentation/SelectionRaycast.ts';
import { floorHeightAt, SHELL_FLOOR, ASSEMBLY_MODULE_TRANSFORMS } from '../assets/scripts/presentation/AssemblySliceLayout.ts';
import * as AC from '../assets/scripts/presentation/AutomatedCellLayout.ts';
import * as C from '../assets/scripts/presentation/AdvancedRoboticsComplexLayout.ts';
import { resolveArcVisualState } from '../assets/scripts/presentation/AdvancedRoboticsComplexVisualStateResolver.ts';
import * as P from '../assets/scripts/presentation/AdvancedRoboticsComplexProduction.ts';
import * as R from '../assets/scripts/presentation/AdvancedRoboticsComplexExitRoute.ts';
import { AdvancedRoboticsComplexRevealViewModel, ARC_STATE_PHASES } from '../assets/scripts/presentation/AdvancedRoboticsComplexRevealViewModel.ts';
import { ConstructionViewModel } from '../assets/scripts/presentation/ConstructionViewModel.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { evaluateProducerBuildProgression } from '../assets/scripts/progression/index.ts';

/*
 * AUT-044 Advanced Robotics Complex visual: pure layout / resolver / production / exit-route tests, GLB-bounds geometry,
 * the owner-approved zone-rect shift consequences, scene prefab alignment and runtime wiring. Bounds come from the
 * approved AUT-032 GLBs (no new asset).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const scenePath = path.join(repoRoot, 'assets/scenes/factory/FactoryWorld.scene');
const artRoot = path.join(repoRoot, 'assets/art');
const factoryDir = path.join(artRoot, 'aut032/factory');
const EPS = 1e-6;
/** Tall elements keep this much margin inside the left screen edge (the Art Director brief: screen x >= -0.93). */
const TALL_SCREEN_MIN_X = -0.93;
/** Reveal view: every corner stays within this screen half-width. */
const REVEAL_SCREEN_LIMIT = 0.77;

const EXPECTED_ASSET_FILES: Record<string, string> = {
    conveyor: 'conveyor.glb',
    machine: 'machine.glb',
    arm_a: 'robot-arm-a.glb',
    arm_b: 'robot-arm-b.glb',
    frame: 'structure-high.glb',
    hopper: 'hopper-square.glb',
    box: 'box-large.glb',
};

type Vec3 = { x: number; y: number; z: number };
type Box = { min: Vec3; max: Vec3 };

function gltfScenePrefabs(dir: string, out = new Map<string, { file: string; name: string }>()): Map<string, { file: string; name: string }> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) gltfScenePrefabs(full, out);
        else if (entry.name.endsWith('.glb.meta')) {
            const meta = JSON.parse(readFileSync(full, 'utf8'));
            for (const sub of Object.values<any>(meta.subMetas ?? {})) {
                if (sub.importer === 'gltf-scene') out.set(sub.uuid, { file: entry.name.replace(/\.meta$/, ''), name: sub.name });
            }
        }
    }
    return out;
}

function trs(node: any): number[] {
    const t = node.translation ?? [0, 0, 0];
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    const m = [1 - (2 * ((y * y) + (z * z))), 2 * ((x * y) + (z * w)), 2 * ((x * z) - (y * w)), 0,
        2 * ((x * y) - (z * w)), 1 - (2 * ((x * x) + (z * z))), 2 * ((y * z) + (x * w)), 0,
        2 * ((x * z) + (y * w)), 2 * ((y * z) - (x * w)), 1 - (2 * ((x * x) + (y * y))), 0, t[0], t[1], t[2], 1];
    for (let i = 0; i < 3; i += 1) { m[i] *= s[0]; m[4 + i] *= s[1]; m[8 + i] *= s[2]; }
    return m;
}

function mul(a: number[], b: number[]): number[] {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[(c * 4) + r] += a[(k * 4) + r] * b[(c * 4) + k];
    return o;
}

/** POSITION bounds of a static (non-skinned) GLB through its node hierarchy. */
function glbBounds(file: string): { min: number[]; max: number[] } {
    const buffer = readFileSync(path.join(factoryDir, file));
    const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const visit = (index: number, parent: number[]): void => {
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
function worldBox(transform: { position: Vec3; rotationY: number; scale: number }, bounds: { min: number[]; max: number[] }, yawExtraDeg = 0): Box {
    const rad = ((transform.rotationY + yawExtraDeg) * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const xs: number[] = [];
    const zs: number[] = [];
    for (const lx of [bounds.min[0], bounds.max[0]]) for (const lz of [bounds.min[2], bounds.max[2]]) {
        xs.push(transform.position.x + (((lx * c) + (lz * s)) * transform.scale));
        zs.push(transform.position.z + (((-lx * s) + (lz * c)) * transform.scale));
    }
    return {
        min: { x: Math.min(...xs), y: transform.position.y + (bounds.min[1] * transform.scale), z: Math.min(...zs) },
        max: { x: Math.max(...xs), y: transform.position.y + (bounds.max[1] * transform.scale), z: Math.max(...zs) },
    };
}

function boxOf(center: Vec3, size: Vec3): Box {
    return {
        min: { x: center.x - (size.x / 2), y: center.y - (size.y / 2), z: center.z - (size.z / 2) },
        max: { x: center.x + (size.x / 2), y: center.y + (size.y / 2), z: center.z + (size.z / 2) },
    };
}

function overlap(a: Box, b: Box, eps = 1e-3): boolean {
    return a.min.x < b.max.x - eps && a.max.x > b.min.x + eps
        && a.min.y < b.max.y - eps && a.max.y > b.min.y + eps
        && a.min.z < b.max.z - eps && a.max.z > b.min.z + eps;
}

const MODULE_FILE: Record<string, string> = {
    frame_west_1: 'structure-high.glb',
    frame_west_2: 'structure-high.glb',
    frame_back_1: 'structure-high.glb',
    frame_back_2: 'structure-high.glb',
    conveyor_in: 'conveyor.glb',
    conveyor_out: 'conveyor.glb',
    overhead_belt: 'conveyor.glb',
    core: 'machine.glb',
    bay: 'machine.glb',
    spire: 'machine.glb',
    head: 'hopper-square.glb',
    arm_1: 'robot-arm-a.glb',
    arm_2: 'robot-arm-a.glb',
    arm_b: 'robot-arm-b.glb',
};

function composition(): Map<string, Box> {
    const boxes = new Map<string, Box>();
    boxes.set('foundation_slab', boxOf(C.ARC_FOUNDATION_SLAB.center, C.ARC_FOUNDATION_SLAB.size));
    for (const [id, beam] of Object.entries(C.ARC_BEAMS)) boxes.set(id, boxOf(beam.center, beam.size));
    for (const [id, transform] of Object.entries(C.ARC_MODULE_TRANSFORMS)) boxes.set(id, worldBox(transform, glbBounds(MODULE_FILE[id])));
    return boxes;
}

const ARMS = ['arm_1', 'arm_2', 'arm_b'] as const;

/** Worst-case AABB of an arm over its yaw swing (+-15 deg); the 3 deg nod is ignored. */
function swingBox(id: typeof ARMS[number]): Box {
    const transform = C.ARC_MODULE_TRANSFORMS[id];
    const bounds = glbBounds(MODULE_FILE[id]);
    const a = worldBox(transform, bounds, P.ARC_ARM_YAW_DEG);
    const b = worldBox(transform, bounds, -P.ARC_ARM_YAW_DEG);
    return {
        min: { x: Math.min(a.min.x, b.min.x), y: a.min.y, z: Math.min(a.min.z, b.min.z) },
        max: { x: Math.max(a.max.x, b.max.x), y: a.max.y, z: Math.max(a.max.z, b.max.z) },
    };
}

function lampBoxes(): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const id of C.ARC_LAMP_IDS) out.set(`lamp_${id}`, boxOf(C.ARC_LAMPS[id].center, C.ARC_LAMPS[id].size));
    return out;
}

function guideBoxes(): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const part of C.ARC_GUIDE_PARTS) out.set(`guide_${part}`, boxOf(C.ARC_GUIDE[part].center, C.ARC_GUIDE[part].size));
    return out;
}

/** Default portrait projection (same camera maths as the Cell test; the camera is untouched). */
function camera(distance: number, focus: Vec3): (x: number, y: number, z: number) => { x: number; y: number } {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const num = (pattern: RegExp): number => { const match = bootstrap.match(pattern); assert.ok(match, `${pattern}`); return Number(match[1]); };
    const yaw = num(/defaultYawDeg = (-?[\d.]+)/) * Math.PI / 180;
    const pitch = num(/defaultPitchDeg = (-?[\d.]+)/) * Math.PI / 180;
    const fov = num(/camera\.fov = ([\d.]+)/) * Math.PI / 180;
    const h = distance * Math.cos(pitch);
    const eye = [focus.x + (Math.sin(yaw) * h), focus.y + (distance * Math.sin(pitch)), focus.z + (Math.cos(yaw) * h)];
    const norm = (v: number[]): number[] => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const cross = (a: number[], b: number[]): number[] => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
    const dot = (a: number[], b: number[]): number => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
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

function defaultView(): (x: number, y: number, z: number) => { x: number; y: number } {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const num = (pattern: RegExp): number => Number(bootstrap.match(pattern)![1]);
    return camera(num(/defaultDistance = ([\d.]+)/), { x: num(/defaultFocusX = (-?[\d.]+)/), y: 0, z: num(/defaultFocusZ = (-?[\d.]+)/) });
}

function stateWithArc(level: number | null): GameState {
    const state = createFreshGameState();
    state.run.producers['advanced_robotics_complex'] = level === null ? { level: 0, isUnlocked: true, isBuilt: false } : { level, isUnlocked: true, isBuilt: level > 0 };
    return state;
}

const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const LV1_IDS = [...C.ARC_LV1_MODULE_IDS] as string[];
const OLD_ZONE = { x: 2, z: 6, width: 6, depth: 5.5 };

// ---------------------------------------------------------------------------------------------------------------
// Scene / assets

test('AUT-044 FactoryWorld serializes advancedRoboticsComplexPrefabs index-aligned with the layout, AUT-032 assets only', () => {
    const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
    const holders = scene.filter((entry: any) => Array.isArray(entry?.advancedRoboticsComplexPrefabs));
    assert.equal(holders.length, 1, 'exactly one serialized advancedRoboticsComplexPrefabs list');
    assert.equal(holders[0].__type__, scene.find((entry: any) => Array.isArray(entry?.factoryPrefabs)).__type__, 'held by FactoryWorldBootstrap');
    assert.ok(Array.isArray(holders[0].assemblyPrefabs) && Array.isArray(holders[0].robotLinePrefabs) && Array.isArray(holders[0].automatedCellPrefabs), 'the earlier lists are untouched');
    assert.equal(holders[0].automatedCellPrefabs.length, 7);
    const prefabs = gltfScenePrefabs(artRoot);
    const uuids = holders[0].advancedRoboticsComplexPrefabs.map((ref: any) => ref.__uuid__);
    assert.equal(uuids.length, C.ARC_PREFAB_SLOTS.length);
    C.ARC_PREFAB_SLOTS.forEach((slot, index) => {
        assert.equal(uuids[index], C.ARC_ASSET_REFERENCES[slot], `${slot} at index ${index}`);
        assert.equal(prefabs.get(uuids[index])?.file, EXPECTED_ASSET_FILES[slot], `${slot} resolves to ${prefabs.get(uuids[index])?.file}`);
    });
    const forbidden = ['pipe-large.glb', 'conveyor-junction-t.glb', 'machine-bed.glb', 'screen-panel-wide.glb', 'conveyor-corner.glb'];
    for (const uuid of uuids) assert.ok(!forbidden.includes(prefabs.get(uuid)?.file ?? ''), `forbidden asset ${prefabs.get(uuid)?.file}`);
    const doc = read('docs/AUT-032_3D_ASSET_ROBOT_SPIKE.md');
    for (const file of Object.values(EXPECTED_ASSET_FILES)) assert.ok(doc.includes(file), `${file} is in the AUT-032 inventory`);
    assert.equal(readdirSync(factoryDir).filter((name) => name.endsWith('.glb')).length, 12, 'no new asset files (Modular Space is not imported)');
    assert.equal(readdirSync(artRoot).filter((name) => /modular/i.test(name)).length, 0, 'no Modular Space import');
    assert.equal(holders[0].robotPrefab?.__uuid__, 'a0320000-0000-4000-8000-000000000003@68751');
    for (const slot of Object.values(C.ARC_MODULE_PREFAB)) assert.ok(C.ARC_PREFAB_SLOTS.includes(slot as any));
    // Every module is either prefab-backed (with a transform) or a primitive; nothing else.
    assert.deepEqual([...Object.keys(C.ARC_MODULE_TRANSFORMS), ...C.ARC_PRIMITIVE_MODULE_IDS].sort(), [...C.ARC_MODULE_IDS].sort());
    assert.deepEqual(Object.keys(C.ARC_MODULE_PREFAB).sort(), Object.keys(C.ARC_MODULE_TRANSFORMS).sort());
});

// ---------------------------------------------------------------------------------------------------------------
// Owner-approved zone-rect shift

test('AUT-044 zone rect shift: AdvancedRoboticsComplex sits on the on-screen ground, clear of every other zone', () => {
    assert.deepEqual({ ...ZONE_LAYOUT.AdvancedRoboticsComplex }, { x: -1.0, z: 5.125, width: 3.5, depth: 3.75 });
    const rect = (id: keyof typeof ZONE_LAYOUT) => {
        const z = ZONE_LAYOUT[id];
        return { minX: z.x - (z.width / 2), maxX: z.x + (z.width / 2), minZ: z.z - (z.depth / 2), maxZ: z.z + (z.depth / 2) };
    };
    const arc = rect('AdvancedRoboticsComplex');
    assert.deepEqual([arc.minX, arc.maxX, arc.minZ, arc.maxZ].map((v) => Math.round(v * 1000) / 1000), [-2.75, 0.75, 3.25, 7.0]);
    for (const id of factoryZoneIds(ZONE_LAYOUT)) {
        if (id === 'AdvancedRoboticsComplex') continue;
        const other = rect(id);
        const separated = arc.maxX <= other.minX || arc.minX >= other.maxX || arc.maxZ <= other.minZ || arc.minZ >= other.maxZ;
        assert.ok(separated, `AdvancedRoboticsComplex zone does not overlap ${id}`);
    }
    assert.ok(arc.minZ >= rect('AutomatedCell').maxZ + 0.5, 'north of the Automated Cell zone (z <= 2.75)');
    // The scene node and the zone rect agree (createZones reads the same layout at runtime).
    const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
    const node = scene.find((entry: any) => entry?._name === 'Zone_AdvancedRoboticsComplex');
    assert.deepEqual([node._lpos.x, node._lpos.y, node._lpos.z], [ZONE_LAYOUT.AdvancedRoboticsComplex.x, 0, ZONE_LAYOUT.AdvancedRoboticsComplex.z]);
    // The selectable target picks the complex at its new centre and not at the old one.
    const targets = factoryZoneIds(ZONE_LAYOUT).map((id) => ({ id, position: { x: ZONE_LAYOUT[id]!.x, y: 0.2, z: ZONE_LAYOUT[id]!.z }, scale: { x: ZONE_LAYOUT[id]!.width, y: 1, z: ZONE_LAYOUT[id]!.depth } }));
    const down = (x: number, z: number) => pickSelectionTarget({ o: { x, y: 9, z }, d: { x: 0, y: -1, z: 0 } }, targets).hit;
    assert.equal(down(-1.0, 5.125), 'AdvancedRoboticsComplex');
    assert.equal(down(0.6, 3.4), 'AdvancedRoboticsComplex');
    assert.equal(down(4.5, 7.5), null, 'the old zone area is no longer a producer');
    assert.equal(down(2.3, 1.9), 'AutomatedCell', 'the Automated Cell zone is still picked');
    // The AUT-033 shell is a child of the zone, sized from the layout (relocated with the zone).
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /`\$\{zoneId\}_InactiveShell`, new Vec3\(layout\.width \* 0\.48, 0\.8, layout\.depth \* 0\.42\), new Vec3\(0, 0\.46, 0\)/);
    // Unbuilt shell (centre of the zone, 0.48 x 0.42 of the rect, 0.06..0.86 high) stays inside screen x >= -0.93.
    const project = defaultView();
    const zone = ZONE_LAYOUT.AdvancedRoboticsComplex;
    const shell = boxOf({ x: zone.x, y: 0.46, z: zone.z }, { x: zone.width * 0.48, y: 0.8, z: zone.depth * 0.42 });
    const logistics = boxOf({ x: zone.x, y: 0.18, z: zone.z + (zone.depth * 0.32) }, { x: zone.width * 0.72, y: 0.08, z: 0.3 });
    for (const [id, b] of [['shell', shell], ['logistics', logistics]] as const) {
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
            const p = project(x, y, z);
            assert.ok(p.x >= TALL_SCREEN_MIN_X && p.x <= 0.98 && Math.abs(p.y) <= 1, `unbuilt ${id} corner on screen (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
        }
    }
});

test('AUT-044 zone rect shift: pan bounds stay valid and the built-factory pan range is unchanged by the shift', () => {
    const build = (state: GameState, id: string, level: number): void => { state.run.producers[id] = { level, isUnlocked: level > 0, isBuilt: level > 0 }; };
    const state = createFreshGameState();
    build(state, 'fabricator', 60);
    build(state, 'assembly_station', 30);
    build(state, 'robot_line', 5);
    assert.equal(resolveUnlockedCameraZones(repository, state, ZONE_LAYOUT).includes('AdvancedRoboticsComplex'), false, 'locked until built');
    const global = DEFAULT_CAMERA_TUNING.focusBounds;
    const before = resolveCameraPanBounds(repository, state, ZONE_LAYOUT, 1);
    assert.ok(before.minX >= global.minX && before.maxX <= global.maxX && before.minZ >= global.minZ && before.maxZ <= global.maxZ);
    assert.ok(before.minX <= -2.5 && before.maxX >= -2.5 && before.minZ <= 0 && before.maxZ >= 0, 'the default focus (-2.5, 0) is inside the pan bounds');
    build(state, 'automated_cell', 25);
    build(state, 'advanced_robotics_complex', 1);
    const withArc = resolveCameraPanBounds(repository, state, ZONE_LAYOUT, 1);
    assert.equal(resolveUnlockedCameraZones(repository, state, ZONE_LAYOUT).includes('AdvancedRoboticsComplex'), true);
    assert.ok(withArc.minX <= -2.75 - 1 && withArc.maxX >= 0.75 + 1 && withArc.minZ <= 3.25 - 1 && withArc.maxZ >= 7.0 + 1 - EPS, 'the bounds cover the new zone plus the 1 unit margin');
    assert.ok(withArc.minX >= global.minX && withArc.maxX <= global.maxX && withArc.minZ >= global.minZ && withArc.maxZ <= global.maxZ);
    // Same state with the OLD (off-screen) zone rect: the pan range is identical (the global focus bounds and the other zones dominate).
    const oldLayout = { ...ZONE_LAYOUT, AdvancedRoboticsComplex: OLD_ZONE };
    assert.deepEqual(withArc, resolveCameraPanBounds(repository, state, oldLayout, 1), 'no pan-range change for the built factory');
    assert.equal(withArc.maxZ, global.maxZ);
});

// ---------------------------------------------------------------------------------------------------------------
// Layout geometry (measured GLB bounds)

test('AUT-044 measured GLB facts the layout relies on', () => {
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-2;
    const machine = glbBounds('machine.glb');
    assert.ok(near(machine.max[0] - machine.min[0], 1.2) && near(machine.max[1], 1.3) && near(machine.max[2] - machine.min[2], 1.5), 'machine = solid block 1.2 x 1.3 x 1.5');
    assert.ok(near(glbBounds('robot-arm-a.glb').max[1], 3.2) && near(glbBounds('robot-arm-b.glb').max[1], 3.0));
    const wall = glbBounds('structure-high.glb');
    assert.ok(near(wall.max[0] - wall.min[0], 0.3) && near(wall.max[1], 1.5) && near(wall.max[2] - wall.min[2], 1.1));
    const conveyor = glbBounds('conveyor.glb');
    assert.ok(near(conveyor.max[0] - conveyor.min[0], 1) && near(conveyor.max[1], 0.4) && near(conveyor.max[2] - conveyor.min[2], 1));
    const hopper = glbBounds('hopper-square.glb');
    assert.ok(near(hopper.max[0] - hopper.min[0], 1.117) && near(hopper.max[1], 1.0) && near(hopper.max[2] - hopper.min[2], 1.117), 'hopper 1.117 x 1.0 x 1.117');
    for (const file of Object.values(EXPECTED_ASSET_FILES)) assert.ok(Math.abs(glbBounds(file).min[1]) < 1e-3, `${file} pivot is bottom-centre`);
    // Derived constants.
    assert.ok(Math.abs(C.ARC_BELT_TOP - (0.16 + (conveyor.max[1] * C.ARC_BELT_SCALE))) < 1e-6);
    assert.ok(Math.abs(C.ARC_FRAME_TOP - (0.16 + (wall.max[1] * C.ARC_FRAME_SCALE))) < 1e-6);
    const core = C.ARC_MODULE_TRANSFORMS.core;
    assert.ok(Math.abs(C.ARC_MODULE_TRANSFORMS.head.position.y - (core.position.y + (machine.max[1] * core.scale))) < 2e-3, 'the head sits on the core roof (machine top measured 1.29975)');
    const head = C.ARC_MODULE_TRANSFORMS.head;
    assert.ok(Math.abs(C.ARC_MODULE_TRANSFORMS.spire.position.y - (head.position.y + (hopper.max[1] * head.scale))) < 2e-3, 'the spire sits on the head top (2.31)');
    assert.ok(Math.abs(C.ARC_OVERHEAD_BELT_TOP - (C.ARC_BEAM_TOP + (conveyor.max[1] * C.ARC_OVERHEAD_BELT_SCALE))) < 1e-6);
    assert.ok(Math.abs(C.ARC_MODULE_TRANSFORMS.overhead_belt.position.y - C.ARC_BEAM_TOP) < 1e-6, 'the overhead belt rests on the beams');
});

test('AUT-044 modules rest on the slab / frames, never interpenetrate; Lv1 top <= 2.35 and Lv10 top <= 3.1', () => {
    const boxes = composition();
    const slab = boxes.get('foundation_slab')!;
    assert.ok(Math.abs(slab.max.y - SHELL_FLOOR.slabTop) < EPS && Math.abs(C.ARC_FLOOR.slabTop - SHELL_FLOOR.slabTop) < EPS);
    assert.deepEqual([slab.min.x, slab.max.x, slab.min.z, slab.max.z].map((v) => Math.round(v * 1000) / 1000), [-2.5, 0.5, 3.55, 6.75]);
    let tallLv1 = 0;
    let tallLv10 = 0;
    for (const [id, box] of boxes) {
        if (id === 'foundation_slab') continue;
        assert.ok(box.min.x >= slab.min.x - EPS && box.max.x <= slab.max.x + EPS && box.min.z >= slab.min.z - EPS && box.max.z <= slab.max.z + EPS, `${id} on the slab`);
        tallLv10 = Math.max(tallLv10, box.max.y);
        if (LV1_IDS.includes(id)) tallLv1 = Math.max(tallLv1, box.max.y);
        const seat = id === 'head' ? 1.46 : id === 'spire' ? 2.31 : id === 'overhead_belt' ? C.ARC_BEAM_TOP : id.startsWith('beam') ? C.ARC_FRAME_TOP : C.ARC_FLOOR.slabTop;
        assert.ok(Math.abs(box.min.y - seat) < 2e-3, `${id} rests on its seat ${seat} (min y ${box.min.y})`);
    }
    for (const [id, lamp] of lampBoxes()) {
        tallLv10 = Math.max(tallLv10, lamp.max.y);
        if (C.ARC_LV1_LAMPS.includes(id.replace('lamp_', '') as any)) tallLv1 = Math.max(tallLv1, lamp.max.y);
    }
    assert.ok(tallLv1 <= C.ARC_LV1_MAX_HEIGHT + EPS && C.ARC_LV1_MAX_HEIGHT === 2.35, `Lv1 top ${tallLv1.toFixed(3)} <= 2.35`);
    assert.ok(tallLv1 > 2.2, 'the Lv1 head tower is the stepped top');
    assert.ok(tallLv10 <= C.ARC_LV10_MAX_HEIGHT + EPS && C.ARC_LV10_MAX_HEIGHT === 3.1, `Lv10 top ${tallLv10.toFixed(3)} <= 3.1`);
    assert.ok(tallLv10 > tallLv1 + 0.6, 'Lv10 is clearly taller (spire)');
    // Taller than every earlier producer (Robot Line 1.33, Cell 1.33, press 1.505): building-scale.
    assert.ok(tallLv1 > 1.505 + 0.5);
    // Everything that is not a declared contact stays apart (face contacts are allowed at eps 1e-3).
    const ids = [...boxes.keys()].filter((id) => id !== 'foundation_slab');
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
        assert.ok(!overlap(boxes.get(ids[i])!, boxes.get(ids[j])!), `${ids[i]} vs ${ids[j]}`);
    }
    // The conveyors butt into the core front face; the L-shaped frames meet at the corner; the gantry beams end on the head face.
    const core = boxes.get('core')!;
    for (const id of ['conveyor_in', 'conveyor_out']) {
        assert.ok(Math.abs(boxes.get(id)!.max.z - core.min.z) < 1e-6, `${id} butts into the core`);
        assert.ok(Math.abs(boxes.get(id)!.min.y - 0.16) < EPS && Math.abs(boxes.get(id)!.max.y - C.ARC_BELT_TOP) < 1e-6);
        assert.ok(boxes.get(id)!.min.z >= slab.min.z + 0.05, `${id} on the slab`);
    }
    const w1 = boxes.get('frame_west_1')!; const w2 = boxes.get('frame_west_2')!;
    const b1 = boxes.get('frame_back_1')!; const b2 = boxes.get('frame_back_2')!;
    assert.ok(Math.abs(w1.max.z - w2.min.z) < 1e-6 && Math.abs(b1.max.x - b2.min.x) < 1e-6, 'two frames end to end on each run');
    assert.ok(Math.abs(w2.max.z - b1.min.z) < 1e-6 && Math.abs(w1.min.x - b1.min.x) < 1e-6, 'the west run ends at the back run (L-shaped corner)');
    assert.ok(w1.max.x < core.min.x - 0.5 && b1.min.z > core.max.z + 0.5, 'frames stand behind the core on the far (-x / +z) sides; the camera side stays open');
    for (const id of ARMS) assert.ok(boxes.get(id)!.min.x >= core.max.x, `${id} on the open +x side`);
    const head = boxes.get('head')!;
    for (const id of ['beam_1', 'beam_2']) {
        const beam = boxes.get(id)!;
        assert.ok(Math.abs(beam.max.x - head.min.x) < 5e-3 && Math.abs(beam.min.x - w1.min.x) < 1e-6, `${id} runs from the west frame outer face to the head`);
        assert.ok(Math.abs(beam.min.y - C.ARC_FRAME_TOP) < 1e-6, `${id} rests on the frame tops`);
        assert.ok(beam.min.z >= head.min.z && beam.max.z <= head.max.z, `${id} meets the head face`);
    }
    // Building-scale contrast: the complex out-masses the Cell (footprint area and height).
    const cellSlab = AC.AUTOMATED_CELL_FOUNDATION_SLAB.size;
    assert.ok(C.ARC_FOUNDATION_SLAB.size.x * C.ARC_FOUNDATION_SLAB.size.z > 3.5 * cellSlab.x * cellSlab.z, 'a much larger footprint than the Automated Cell');
});

test('AUT-044 arm swing (+-15 deg), lamps and items fit inside the composition', () => {
    const boxes = composition();
    for (const arm of ARMS) {
        const swing = swingBox(arm);
        for (const [id, box] of boxes) {
            if (id === 'foundation_slab' || id === arm) continue;
            assert.ok(!overlap(swing, box), `${arm} swing vs ${id}`);
        }
        for (const other of ARMS) if (other !== arm) assert.ok(!overlap(swing, swingBox(other)), `${arm} swing vs ${other} swing`);
        const slab = boxes.get('foundation_slab')!;
        assert.ok(swing.min.x >= slab.min.x && swing.max.x <= slab.max.x && swing.min.z >= slab.min.z && swing.max.z <= slab.max.z, `${arm} swing stays on the slab`);
    }
    assert.equal(C.ARC_LV1_LAMPS.length, 8);
    assert.equal(C.ARC_LAMP_IDS.length, 14);
    assert.equal(new Set(C.ARC_LAMP_IDS).size, 14);
    for (const [id, lamp] of lampBoxes()) {
        assert.ok(lamp.max.y <= C.ARC_LV10_MAX_HEIGHT + EPS);
        for (const [other, box] of boxes) {
            if (other === 'foundation_slab') continue;
            assert.ok(!overlap(lamp, box), `${id} vs ${other}`);
        }
        for (const arm of ARMS) assert.ok(!overlap(lamp, swingBox(arm)), `${id} vs ${arm} swing`);
        for (const [other, otherLamp] of lampBoxes()) if (other !== id) assert.ok(!overlap(lamp, otherLamp), `${id} vs ${other}`);
        const slab = boxes.get('foundation_slab')!;
        if (lamp.max.y < 0.4) assert.ok(Math.abs(lamp.min.y - slab.max.y) < 0.05, `${id} stands on the slab`);
        assert.ok(lamp.min.x >= slab.min.x - EPS && lamp.max.x <= slab.max.x + EPS && lamp.min.z >= slab.min.z - EPS && lamp.max.z <= slab.max.z + EPS, `${id} over the slab`);
    }
    // The spire lamp reaches y 3.1 exactly (the Lv10 cap) and sits on the spire top.
    assert.ok(Math.abs(lampBoxes().get('lamp_spire')!.max.y - 3.1) < 1e-6);
    assert.ok(Math.abs(lampBoxes().get('lamp_spire')!.min.y - boxes.get('spire')!.max.y) < 2e-3);
    // Items.
    assert.ok(P.ARC_ITEM_MAX_TOP < 1.0, `robot on belt top ${P.ARC_ITEM_MAX_TOP}`);
    const boxBounds = glbBounds('box-large.glb');
    const beltWidth = C.ARC_BELT_SCALE;
    const boxW = (boxBounds.max[0] - boxBounds.min[0]) * C.ARC_BOX_SCALE;
    const boxD = (boxBounds.max[2] - boxBounds.min[2]) * C.ARC_BOX_SCALE;
    assert.ok(boxW < beltWidth && boxD < beltWidth && boxW < C.ARC_OVERHEAD_BELT_SCALE && boxD < C.ARC_OVERHEAD_BELT_SCALE);
    const conveyorIn = boxes.get('conveyor_in')!;
    const conveyorOut = boxes.get('conveyor_out')!;
    const overhead = boxes.get('overhead_belt')!;
    for (let t = 0; t < 9.6; t += 0.02) {
        for (const job of P.sampleArcJobs(t, 4, 2.4)) {
            if (job.box.visibility >= 0.95) {
                if (job.route === 'overhead_belt') {
                    assert.ok(job.box.x - (boxW / 2) >= overhead.min.x - EPS && job.box.x + (boxW / 2) <= overhead.max.x + EPS && Math.abs(job.box.y - overhead.max.y) < EPS, 'box on the overhead belt');
                    assert.ok(job.box.z >= overhead.min.z && job.box.z <= overhead.max.z);
                } else {
                    assert.ok(job.box.x - (boxW / 2) >= conveyorIn.min.x && job.box.x + (boxW / 2) <= conveyorIn.max.x, 'box inside the input belt width');
                    assert.ok(job.box.z - (boxD / 2) >= conveyorIn.min.z - EPS && job.box.z + (boxD / 2) <= conveyorIn.max.z + EPS, 'box on the input belt');
                }
            }
            if (job.robot.visibility >= 0.95 && job.robot.z >= R.ARC_EXIT_BELT_END_Z) {
                assert.ok(job.robot.x >= conveyorOut.min.x && job.robot.x <= conveyorOut.max.x && job.robot.z <= conveyorOut.max.z, 'robot on the exit belt');
                assert.ok(job.robot.x + 0.04 < swingBox('arm_1').min.x, 'robot (about 0.06 wide) clear of the arm 1 swing');
            }
        }
    }
});

test('AUT-044 footprint: inside the zone, clear of the Cell zone, the Robot Line, the spine and the storage crate; robots keep the apron lane', () => {
    const zone = ZONE_LAYOUT.AdvancedRoboticsComplex;
    const zoneBox: Box = { min: { x: zone.x - (zone.width / 2), y: -1, z: zone.z - (zone.depth / 2) }, max: { x: zone.x + (zone.width / 2), y: 10, z: zone.z + (zone.depth / 2) } };
    const all = new Map<string, Box>([...composition(), ...lampBoxes(), ...guideBoxes()]);
    const cell = ZONE_LAYOUT.AutomatedCell;
    const cellBox: Box = { min: { x: cell.x - (cell.width / 2), y: -1, z: cell.z - (cell.depth / 2) }, max: { x: cell.x + (cell.width / 2), y: 10, z: cell.z + (cell.depth / 2) } };
    const crateBox = worldBox(ASSEMBLY_MODULE_TRANSFORMS.storage_crate, glbBounds('box-large.glb'));
    for (const [id, box] of all) {
        if (id.startsWith('guide_strip')) continue; // the connector strip is the only thing outside the zone
        assert.ok(box.min.x >= zoneBox.min.x - EPS && box.max.x <= zoneBox.max.x + EPS && box.min.z >= zoneBox.min.z - EPS && box.max.z <= zoneBox.max.z + EPS, `${id} inside the zone`);
        assert.ok(!overlap(box, cellBox), `${id} vs the Automated Cell zone`);
        assert.ok(box.max.x <= cellBox.min.x - 0.5, `${id} well west of the Cell zone (x <= 0.8)`);
    }
    // The connector strip: flat, from the storage crate north face along x = -1.0 to the zone foundation edge; the stub rests on the foundation up to the slab edge.
    const guides = guideBoxes();
    const strip = guides.get('guide_strip')!;
    const stub = guides.get('guide_stub')!;
    assert.ok(Math.abs(strip.min.z - (crateBox.max.z)) < 1e-6 && Math.abs(strip.min.z - 1.35) < 1e-6, 'starts at the crate north face (z 1.35)');
    assert.ok(Math.abs(((strip.min.x + strip.max.x) / 2) + 1.0) < EPS && (strip.max.x - strip.min.x) < 0.121, 'along x = -1.0, 0.12 wide');
    assert.ok(strip.min.x > crateBox.min.x && strip.max.x < crateBox.max.x, 'leaves the crate at its north face');
    assert.ok(Math.abs(strip.max.z - 3.25) < 1e-6 && Math.abs(stub.min.z - 3.25) < 1e-6, 'the strip ends where the zone foundation starts');
    assert.ok(Math.abs(stub.max.z - 3.55) < 1e-6, 'the stub reaches the slab edge z 3.55');
    assert.ok(strip.max.y <= 0.04 + EPS && strip.min.y >= 0 && Math.abs(stub.min.y - C.ARC_FLOOR.foundationTop) < EPS && Math.abs(stub.max.y - C.ARC_FLOOR.slabTop) < EPS, 'flat on the ground / the foundation');
    assert.ok(Math.abs(((stub.min.x + stub.max.x) / 2) - C.ARC_MODULE_TRANSFORMS.conveyor_in.position.x) < EPS, 'joins the robot entry conveyor axis (x -1.0)');
    assert.ok(strip.max.z <= 3.25 + EPS && strip.min.z >= 1.35 - EPS);
    // The strip does not cross any Cell route or other structure: Cell zone x >= 1.3, Robot Line / spine are south of z 1.0.
    assert.ok(strip.max.x < cellBox.min.x);
    assert.deepEqual(C.ARC_GUIDE_OFF_COLOR, { r: 43, g: 49, b: 52 }, 'graphite');
    const cyan = { r: 82, g: 206, b: 224 };
    for (const key of ['r', 'g', 'b'] as const) {
        const expected = C.ARC_GUIDE_OFF_COLOR[key] + (0.4 * (cyan[key] - C.ARC_GUIDE_OFF_COLOR[key]));
        assert.ok(Math.abs(C.ARC_GUIDE_ON_COLOR[key] - expected) <= 1, `guide on colour ${key}`);
    }
    assert.deepEqual(C.ARC_BEAM_GRAPHITE_COLOR, { r: 43, g: 49, b: 52 });
    // floorHeightAt knows the slab (0.16) and the zone foundation (0.12).
    assert.equal(floorHeightAt(-1.0, 5.0), 0.16);
    assert.equal(floorHeightAt(-2.6, 5.0), 0.12, 'zone foundation west of the slab');
    assert.equal(floorHeightAt(-1.0, 3.4), 0.12, 'zone foundation south of the slab');
    assert.equal(floorHeightAt(-1.0, 3.05), 0, 'ground on the apron lane');
    assert.equal(floorHeightAt(2.3, 1.9), 0.16, 'the Automated Cell slab is unchanged');
    assert.equal(floorHeightAt(-5, -2), SHELL_FLOOR.openingFoundationTop, 'the Fabricator foundation is unchanged');
    // Robot apron lane: z 3.05, x -2.3..0.9, at least 0.4 from the slab edge, the Cell zone and every composition box.
    assert.deepEqual({ ...R.ARC_APRON_LANE }, { z: 3.05, minX: -2.3, maxX: 0.9 });
    assert.ok(R.ARC_EXIT_PAD.x >= R.ARC_APRON_LANE.minX && R.ARC_EXIT_PAD.x <= R.ARC_APRON_LANE.maxX && R.ARC_EXIT_PAD.z === R.ARC_APRON_LANE.z, 'the pad (-0.4, 3.05) is on the lane');
    const dist = (a: Box, x: number, z: number): number => Math.hypot(Math.max(a.min.x - x, 0, x - a.max.x), Math.max(a.min.z - z, 0, z - a.max.z));
    const slab = composition().get('foundation_slab')!;
    for (let x = R.ARC_APRON_LANE.minX; x <= R.ARC_APRON_LANE.maxX + EPS; x += 0.05) {
        assert.ok(dist(slab, x, R.ARC_APRON_LANE.z) >= 0.4, `lane x ${x.toFixed(2)} >= 0.4 from the slab edge`);
        assert.ok(dist(cellBox, x, R.ARC_APRON_LANE.z) >= 0.4 - EPS, `lane x ${x.toFixed(2)} >= 0.4 from the Cell zone`);
        for (const [id, box] of composition()) if (id !== 'foundation_slab') assert.ok(dist(box, x, R.ARC_APRON_LANE.z) >= 0.4, `lane vs ${id}`);
    }
    assert.ok(Math.abs(dist(slab, 0, 3.05) - 0.5) < EPS, 'slab edge clearance 0.5');
    assert.ok(Math.abs(dist(cellBox, 0.9, 3.05) - Math.hypot(0.4, 0.3)) < EPS);
    // The finished robots walk x = -0.4 from the exit belt over the slab edge to the pad: on the floor, never inside a module, clear of arm 1.
    const boxes = composition();
    let previousY = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.01) {
        const point = R.sampleArcExitPoint(u);
        assert.equal(point.x, -0.4);
        assert.ok(point.y <= previousY + EPS, 'feet only step down along the exit');
        previousY = point.y;
        if (point.z < R.ARC_EXIT_BELT_END_Z) assert.equal(point.y, floorHeightAt(point.x, point.z), `feet on the floor at z ${point.z.toFixed(2)}`);
        else assert.equal(point.y, C.ARC_BELT_TOP);
        for (const [id, box] of boxes) {
            if (id === 'foundation_slab') continue;
            const inside = point.x > box.min.x && point.x < box.max.x && point.z > box.min.z && point.z < box.max.z;
            if (inside) assert.ok(point.y >= box.max.y - EPS, `robot at z ${point.z.toFixed(2)} stands on top of ${id}`);
        }
    }
    assert.deepEqual(R.sampleArcExitPoint(1), { x: -0.4, y: 0, z: 3.05 }, 'ends on the ground pad');
    assert.equal(R.sampleArcExitPoint(0).z, R.ARC_EXIT_START_Z);
    assert.ok(R.ARC_EXIT_START_Z < boxes.get('core')!.min.z, 'the robot appears in front of the core face');
});

test('AUT-044 the whole composition is on screen at the default portrait view and in the reveal focus; tall elements keep screen x >= -0.93', () => {
    const boxes = new Map<string, Box>([...composition(), ...lampBoxes(), ...guideBoxes(), ...ARMS.map((id) => [`swing_${id}`, swingBox(id)] as [string, Box])]);
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const focusDistance = Number(bootstrap.match(/controller\.focusDistance = ([\d.]+);/)![1]);
    const views = { default: defaultView(), reveal: camera(focusDistance, C.ARC_REVEAL_TARGET) };
    let minTallX = Infinity;
    for (const [name, project] of Object.entries(views)) {
        for (const [id, b] of boxes) {
            for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
                const p = project(x, y, z);
                assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: ${id} corner on screen (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
                if (name === 'reveal') assert.ok(Math.abs(p.x) <= REVEAL_SCREEN_LIMIT, `reveal: ${id} corner at screen x ${p.x.toFixed(3)} within +-${REVEAL_SCREEN_LIMIT}`);
                if (name === 'default' && b.max.y > 0.5) {
                    minTallX = Math.min(minTallX, p.x);
                    assert.ok(p.x >= TALL_SCREEN_MIN_X, `default: tall ${id} corner at screen x ${p.x.toFixed(3)} >= ${TALL_SCREEN_MIN_X}`);
                }
            }
        }
        // The zone footprint itself and the robot apron lane are on screen too.
        const z = ZONE_LAYOUT.AdvancedRoboticsComplex;
        for (const x of [z.x - (z.width / 2), z.x + (z.width / 2)]) for (const zz of [z.z - (z.depth / 2), z.z + (z.depth / 2)]) {
            const p = project(x, 0, zz);
            assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: zone corner (${x}, ${zz}) on screen`);
        }
        for (const x of [R.ARC_APRON_LANE.minX, R.ARC_APRON_LANE.maxX]) {
            const p = project(x, 0, R.ARC_APRON_LANE.z);
            assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: apron lane end ${x} on screen`);
        }
    }
    assert.ok(minTallX < -0.8, `the tight corner is really measured (${minTallX.toFixed(3)})`);
    assert.deepEqual(C.ARC_REVEAL_TARGET, { x: -1.0, y: 1.0, z: 5.0 });
    const slab = boxes.get('foundation_slab')!;
    assert.ok(C.ARC_REVEAL_TARGET.x > slab.min.x && C.ARC_REVEAL_TARGET.x < slab.max.x && C.ARC_REVEAL_TARGET.z > slab.min.z && C.ARC_REVEAL_TARGET.z < slab.max.z);
});

// ---------------------------------------------------------------------------------------------------------------
// Resolver

test('AUT-044 resolver: unbuilt, Lv1, Lv10, Lv25+, Reboot', () => {
    const unbuilt = resolveArcVisualState(stateWithArc(null));
    assert.equal(unbuilt.phase, 'unbuilt');
    assert.equal(unbuilt.constructed, false);
    assert.equal(unbuilt.placeholderVisible, true);
    assert.deepEqual([unbuilt.modules, unbuilt.litLamps, unbuilt.poolSize, unbuilt.cycleSeconds, unbuilt.guideLit], [[], [], 0, 0, false]);
    assert.deepEqual(resolveArcVisualState(createFreshGameState()), unbuilt, 'no advanced_robotics_complex entry at all = unbuilt');

    const lv1 = resolveArcVisualState(stateWithArc(1));
    assert.equal(lv1.phase, 'arc_lv1');
    assert.deepEqual(lv1.modules, ['foundation_slab', 'frame_west_1', 'frame_west_2', 'frame_back_1', 'frame_back_2', 'conveyor_in', 'conveyor_out', 'core', 'head', 'arm_1', 'arm_2']);
    assert.deepEqual(lv1.litLamps, ['input', 'output', 'core', 'head', 'arm_1', 'arm_2', 'frame_west', 'frame_back']);
    assert.deepEqual([lv1.poolSize, lv1.cycleSeconds, lv1.armPeriodSeconds, lv1.placeholderVisible, lv1.guideLit], [3, 3.0, 3.0, false, true]);

    for (const level of [10, 25, 100]) {
        const lv10 = resolveArcVisualState(stateWithArc(level));
        assert.equal(lv10.phase, 'arc_lv10', `Lv${level}`);
        assert.deepEqual(lv10.modules, [...C.ARC_MODULE_IDS]);
        assert.equal(lv10.modules.length, 17);
        assert.deepEqual(lv10.litLamps, [...C.ARC_LAMP_IDS]);
        assert.deepEqual([lv10.poolSize, lv10.cycleSeconds, lv10.armPeriodSeconds, lv10.guideLit], [4, 2.4, 2.4, true]);
    }
    assert.equal(resolveArcVisualState(stateWithArc(9)).phase, 'arc_lv1');
    assert.deepEqual(resolveArcVisualState(stateWithArc(25)), { ...resolveArcVisualState(stateWithArc(10)), level: 25 }, 'Lv25+ keep the Lv10 composition exactly');
    assert.equal(resolveArcVisualState({ ...createFreshGameState(), run: { ...createFreshGameState().run, producers: { advanced_robotics_complex: { level: 3, isUnlocked: true, isBuilt: false } } } } as GameState).phase, 'unbuilt', 'a level without the built flag is not built');
    // Reboot: the producer is gone again.
    assert.equal(resolveArcVisualState(createFreshGameState()).phase, 'unbuilt');
    // Every module of every phase is a known id in canonical (construction) order: slab -> frames -> conveyors -> core -> head + arms.
    for (const level of [1, 10]) {
        const modules = resolveArcVisualState(stateWithArc(level)).modules;
        assert.deepEqual([...modules], C.ARC_MODULE_IDS.filter((id) => modules.includes(id)));
    }
    assert.deepEqual([...C.ARC_MODULE_IDS].slice(0, 11), ['foundation_slab', 'frame_west_1', 'frame_west_2', 'frame_back_1', 'frame_back_2', 'conveyor_in', 'conveyor_out', 'core', 'head', 'arm_1', 'arm_2']);
    assert.deepEqual([...C.ARC_MODULE_IDS].slice(11), ['bay', 'arm_b', 'beam_1', 'beam_2', 'overhead_belt', 'spire']);
    assert.ok(resolveArcVisualState(stateWithArc(10)).cycleSeconds < lv1.cycleSeconds, 'Lv10 is faster');
    assert.equal(C.ARC_PRODUCER_ID, 'advanced_robotics_complex');
});

test('AUT-044 resolver is deterministic and leaves the state untouched', () => {
    const state = stateWithArc(10);
    const before = JSON.stringify(state);
    assert.deepEqual(resolveArcVisualState(state), resolveArcVisualState(state));
    assert.equal(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------------------------------------------
// Production model

test('AUT-044 production: periodic per slot loop, slots one cycle apart, box -> 1.5 s dwell -> robot, scale-hide at both ends', () => {
    assert.equal(P.ARC_DWELL_SECONDS, 1.5);
    for (const [pool, cycle] of [[3, 3.0], [4, 2.4]] as const) {
        const period = pool * cycle;
        assert.ok(P.ARC_JOB_SECONDS <= period, `a job (${P.ARC_JOB_SECONDS}s) fits inside the slot period ${period}`);
        assert.equal(P.arcSlotPeriodSeconds(pool, cycle), period);
        const seen = new Map<number, number>();
        for (let t = 0; t < period * 4; t += 0.02) {
            let boxesShown = 0;
            let robotsShown = 0;
            for (const job of P.sampleArcJobs(t, pool, cycle)) {
                assert.ok(job.box.visibility >= 0 && job.box.visibility <= 1 && job.robot.visibility >= 0 && job.robot.visibility <= 1);
                assert.ok(!(job.box.visibility > 0 && job.robot.visibility > 0), 'the box and the robot of one job are never visible together (the dwell hides inside the core)');
                if (job.box.visibility > 0) boxesShown += 1;
                if (job.robot.visibility > 0) robotsShown += 1;
                assert.equal(job.robot.x, -0.4);
                assert.equal(job.robotHeadingDeg, 180, 'leaves toward the camera side');
                assert.ok(job.robot.z >= R.ARC_EXIT_PAD.z - EPS && job.robot.z <= R.ARC_EXIT_START_Z + EPS);
                if (job.route === 'input_belt') {
                    assert.equal(job.box.x, C.ARC_MODULE_TRANSFORMS.conveyor_in.position.x);
                    assert.equal(job.box.y, C.ARC_BELT_TOP);
                    assert.ok(job.box.z >= P.ARC_BELT_START_Z - EPS && job.box.z <= P.ARC_BELT_END_Z + EPS);
                } else {
                    assert.equal(job.box.y, C.ARC_OVERHEAD_BELT_TOP);
                    assert.equal(job.box.z, C.ARC_MODULE_TRANSFORMS.overhead_belt.position.z);
                    assert.ok(job.box.x >= P.ARC_OVERHEAD_START_X - EPS && job.box.x <= P.ARC_OVERHEAD_END_X + EPS);
                }
                seen.set(job.slot, Math.max(seen.get(job.slot) ?? 0, job.cycle));
            }
            assert.ok(boxesShown <= 1 && robotsShown <= 1, `one product per cadence: at most one box and one robot visible (t=${t.toFixed(2)})`);
        }
        for (const cycles of seen.values()) assert.ok(cycles >= 3 && cycles <= 5, `pool ${pool}: loops ${cycles}`);
        // Periodic: one slot period later the sample is identical (up to the counter).
        const a = P.sampleArcJobs(0.37, pool, cycle);
        const b = P.sampleArcJobs(0.37 + period, pool, cycle);
        a.forEach((job, i) => {
            assert.ok(Math.abs(job.box.z - b[i].box.z) < 1e-9 && Math.abs(job.box.x - b[i].box.x) < 1e-9 && Math.abs(job.box.visibility - b[i].box.visibility) < 1e-9);
            assert.ok(Math.abs(job.robot.z - b[i].robot.z) < 1e-9 && Math.abs(job.robot.visibility - b[i].robot.visibility) < 1e-9);
            assert.equal(b[i].cycle, job.cycle + 1);
        });
        // Slots are one cycle apart (the cadence between finished robots).
        for (let slot = 0; slot < pool; slot += 1) assert.ok(Math.abs(P.arcSlotOffsetSeconds(slot, pool, cycle) - (slot * cycle)) < 1e-12);
    }
    // Lv1 timeline of slot 0 (clock 0): ride 0..1.0, dwell 1.0..2.5, robot 2.5..4.1.
    const at = (t: number) => P.sampleArcJob(t, 0, 3, 3.0);
    assert.equal(at(0).box.visibility, 0, 'the box scales in at the belt start');
    assert.equal(at(0.5).box.visibility, 1);
    assert.ok(at(0.99).box.visibility < 0.1, 'the box scale-hides into the core');
    assert.equal(at(1.0).box.visibility + at(1.0).robot.visibility, 0, 'the dwell shows nothing');
    assert.equal(at(2.49).box.visibility + at(2.49).robot.visibility, 0);
    assert.equal(at(2.5).robot.visibility, 0, 'the robot scales up at the exit belt after the 1.5 s dwell');
    assert.equal(at(3.2).robot.visibility, 1);
    assert.ok(at(3.2).robot.z < at(2.8).robot.z, 'the robot slides toward the apron pad');
    assert.ok(at(4.09).robot.visibility < 0.1 && Math.abs(at(4.09).robot.z - 3.05) < 0.05, 'and scale-hides at the apron pad');
    assert.equal(at(5.0).box.visibility + at(5.0).robot.visibility, 0, 'idle until the next loop');
    // The Lv10 fourth slot rides the overhead belt; every other slot, and every Lv1 slot, rides the entry belt.
    assert.deepEqual([0, 1, 2, 3].map((slot) => P.sampleArcJob(0.5, slot, 4, 2.4).route), ['input_belt', 'input_belt', 'input_belt', 'overhead_belt']);
    assert.deepEqual([0, 1, 2].map((slot) => P.sampleArcJob(0.5, slot, 3, 3.0).route), ['input_belt', 'input_belt', 'input_belt']);
    assert.equal(P.ARC_OVERHEAD_SLOT, 3);
    assert.equal(P.sampleArcJob(2.9, 3, 4, 2.4).box.visibility, 1, 'slot 3 starts 7.2 s into the loop (one cadence after slot 2)');
    assert.equal(P.sampleArcJobs(1, 9, 2.4).length, P.ARC_POOL_LIMIT, 'the pool never exceeds 4');
    assert.equal(P.ARC_POOL_LIMIT, 4);
    assert.equal(P.sampleArcJobs(1, 0, 3).length, 0);
    assert.equal(P.advanceArcClock(2, -5), 2);
    assert.equal(P.advanceArcClock(2, Number.NaN), 2);
    assert.equal(P.advanceArcClock(2, 0.5), 2.5);
    // The spire lamp pulses once per cycle between 0.6 and 1.
    for (let t = 0; t < 2.4; t += 0.01) { const p = P.sampleArcSpirePulse(t, 2.4); assert.ok(p >= 0.6 - EPS && p <= 1 + EPS); }
    assert.ok(Math.abs(P.sampleArcSpirePulse(0.3, 2.4) - P.sampleArcSpirePulse(0.3 + 2.4, 2.4)) < 1e-9);
});

test('AUT-044 arms run a deterministic timer cycle (period = cycle), bounded, with the intended phase offsets', () => {
    assert.deepEqual([...P.ARC_ARM_PHASE_OFFSETS], [0, 0.5, 1 / 3]);
    for (const period of [3.0, 2.4]) {
        for (let t = 0; t < period * 2; t += 0.05) {
            for (const arm of [0, 1, 2]) {
                const pose = P.sampleArcArmPose(t, arm, period);
                assert.deepEqual(pose, P.sampleArcArmPose(t, arm, period));
                assert.ok(Math.abs(pose.yawDeg) <= 15 + EPS && pose.pitchDeg >= 0 && pose.pitchDeg <= 3 + EPS);
                const later = P.sampleArcArmPose(t + period, arm, period);
                assert.ok(Math.abs(later.yawDeg - pose.yawDeg) < 1e-6 && Math.abs(later.pitchDeg - pose.pitchDeg) < 1e-6, 'periodic');
            }
        }
        for (let t = 0; t < period; t += 0.1) assert.ok(Math.abs(P.sampleArcArmPose(t, 0, period).yawDeg + P.sampleArcArmPose(t, 1, period).yawDeg) < 1e-9, 'arm 2 is half a period out of phase');
        assert.ok(Math.abs(P.sampleArcArmPose(0, 2, period).yawDeg - (Math.sin(Math.PI * 2 / 3) * 15)) < 1e-9, 'arm B is a third of a period out');
    }
    let maxYaw = 0;
    for (let t = 0; t < 3.0; t += 0.01) maxYaw = Math.max(maxYaw, Math.abs(P.sampleArcArmPose(t, 0, 3.0).yawDeg));
    assert.ok(maxYaw > 14.9, 'the full +-15 deg is reached');
});

test('AUT-044 lamps blink once per cycle, staggered, and are lit most of the time', () => {
    for (const [count, cycle] of [[8, 3.0], [14, 2.4]] as const) {
        for (let lamp = 0; lamp < count; lamp += 1) {
            let lit = 0;
            let steps = 0;
            for (let t = 0; t < cycle; t += 0.01) { steps += 1; if (P.sampleArcLampLit(t, lamp, count, cycle)) lit += 1; }
            const share = lit / steps;
            assert.ok(Math.abs(share - (1 - P.ARC_LAMP_BLINK_FRACTION)) < 0.02, `lamp ${lamp}/${count}: lit share ${share}`);
            assert.equal(P.sampleArcLampLit(0.3, lamp, count, cycle), P.sampleArcLampLit(0.3 + cycle, lamp, count, cycle), 'periodic');
        }
        for (let t = 0; t < cycle; t += 0.05) assert.ok([...Array(count).keys()].filter((lamp) => !P.sampleArcLampLit(t, lamp, count, cycle)).length <= Math.ceil(P.ARC_LAMP_BLINK_FRACTION * count), 'the blink windows are staggered (few lamps off at an instant)');
    }
});

// ---------------------------------------------------------------------------------------------------------------
// Construction target, reveal hook, no replay

const constructed: DomainEvent = { type: 'producerConstructed', producerId: 'advanced_robotics_complex', level: 1, source: 'breakthrough' } as DomainEvent;
const LV1_PLAN = ['foundation_slab', 'frame_west_1', 'frame_west_2', 'frame_back_1', 'frame_back_2', 'conveyor_in', 'conveyor_out', 'core', 'head', 'arm_1', 'arm_2'];

test('AUT-044 construction: plan order slab -> frames -> conveyors -> core -> head + arms; no replay on load; one activation; Reboot replays', () => {
    const resolve = (producerId: string, state: GameState): readonly string[] => (producerId === 'advanced_robotics_complex' ? resolveArcVisualState(state).modules : []);
    assert.deepEqual(resolve('advanced_robotics_complex', stateWithArc(1)), LV1_PLAN);

    const loaded = new ConstructionViewModel(resolve);
    assert.deepEqual(loaded.syncFromState(stateWithArc(10)), [], 'a save load never plays the sequence');
    assert.deepEqual(loaded.consumeEvents(stateWithArc(10), [constructed]), []);
    assert.equal(loaded.isActive('advanced_robotics_complex'), false);

    const live = new ConstructionViewModel(resolve);
    live.syncFromState(stateWithArc(null));
    const started = live.syncFromState(stateWithArc(1));
    assert.equal(started.length, 1);
    assert.equal(started[0].producerId, 'advanced_robotics_complex');
    assert.deepEqual(started[0].plan.moduleIds, LV1_PLAN);
    assert.deepEqual(live.consumeEvents(stateWithArc(1), [constructed]), [], 'snapshot-before-event ordering plays one sequence');
    let completed = 0;
    for (let i = 0; i < 400; i += 1) completed += live.tick(0.05).completed.filter((id) => id === 'advanced_robotics_complex').length;
    assert.equal(completed, 1, 'the activation hook fires once');
    // Reboot allows a new sequence.
    live.syncFromState(stateWithArc(null));
    assert.equal(live.consumeEvents(stateWithArc(1), [constructed]).length, 1);
});

test('AUT-044 reveal view model: one bounded focus beat, read-only, no era presentation of its own; load never counts', () => {
    const vm = new AdvancedRoboticsComplexRevealViewModel();
    const state = stateWithArc(10);
    const before = JSON.stringify(state);
    assert.equal(vm.syncFromState(state).descriptor.phase, 'arc_lv10');
    assert.equal(vm.consumeEvents(state, [constructed]).descriptor.phase, 'arc_lv10', 'events never start a beat by themselves');
    assert.deepEqual(vm.beginConstructionBeat(), { focusRequested: true });
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual([...ARC_STATE_PHASES], ['synced', 'construction_started', 'activated', 'focus_requested', 'item_cycle']);
    const controller = read('assets/scripts/presentation/AdvancedRoboticsComplexVisualController.ts');
    // The beat is only requested from setConstructionSample(non-null) (the live AUT-040 sequence), never from sync on load.
    assert.match(controller, /if \(sample !== null && this\.construction === null\) this\.beatPending = true;/);
    assert.equal((controller.match(/beatPending = true/g) ?? []).length, 1, 'beatPending is raised in exactly one place');
    assert.doesNotMatch(controller.slice(controller.indexOf('public sync('), controller.indexOf('public consumeDomainEvents(')), /beatPending = true|focusOnRevealTarget/, 'sync (load) never focuses');
    // No title / door / light sweep / era transition here (AUT-048).
    assert.doesNotMatch(controller, /eraChanged|enterEra|currentEraId|DirectionalLight|lightSweep/i);
    assert.doesNotMatch(read('assets/scripts/presentation/AdvancedRoboticsComplexRevealViewModel.ts').replace(/\/\*[\s\S]*?\*\//, ''), /eraChanged|currentEraId/);
});

test('AUT-044 the Advanced Robotics breakthrough is the construction path (and also enters era robotics_complex)', () => {
    const breakthrough = JSON.parse(read('data/economy/breakthroughs.json')).items.find((entry: any) => entry.id === 'advanced_robotics');
    assert.ok(breakthrough.effects.some((e: any) => e.type === 'constructProducer' && e.producerId === C.ARC_PRODUCER_ID));
    assert.ok(breakthrough.effects.some((e: any) => e.type === 'enterEra' && e.eraId === 'robotics_complex'));
    // Not buildable from the producer panel: the construction blocker is always listed until it is built.
    assert.notEqual(evaluateProducerBuildProgression(repository, stateWithArc(null), 'advanced_robotics_complex').status, 'available');
});

// ---------------------------------------------------------------------------------------------------------------
// Wiring

const PURE_MODULES = ['AdvancedRoboticsComplexLayout', 'AdvancedRoboticsComplexVisualStateResolver', 'AdvancedRoboticsComplexProduction', 'AdvancedRoboticsComplexExitRoute', 'AdvancedRoboticsComplexRevealViewModel'];

test('AUT-044 pure modules are engine-free and command-free', () => {
    for (const file of PURE_MODULES) {
        const source = read(`assets/scripts/presentation/${file}.ts`);
        assert.doesNotMatch(source, /from 'cc/, `${file} imports cc`);
        assert.doesNotMatch(source, /import[^;]*Commands|\.submit\(|execute\(/, `${file} issues commands`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|readonly|protected)/, `${file}: no constructor parameter properties`);
        assert.match(source, /from '\.{1,2}\/[^']*\.ts';\s*$/m, `${file} uses explicit .ts imports`);
    }
    const state = stateWithArc(10);
    state.run.industrialOutput = 123;
    const before = JSON.stringify(state);
    resolveArcVisualState(state);
    P.sampleArcJobs(3, 4, 2.4);
    R.sampleArcExitPoint(0.5);
    assert.equal(JSON.stringify(state), before);
});

test('AUT-044 bootstrap, registry and construction wiring; scale visibility; reveal API reuse; metas; diagnostics', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /@property\(\[Prefab\]\)\s+public advancedRoboticsComplexPrefabs: Prefab\[\] = \[\];/);
    assert.match(bootstrap, /this\.createAdvancedRoboticsComplexSlice\(site\);/);
    assert.match(bootstrap, /this\.connectAdvancedRoboticsComplexPresentation\(site\);/);
    assert.match(bootstrap, /addComponent\(AdvancedRoboticsComplexVisualController\)/);
    assert.match(bootstrap, /visual\.advancedRoboticsComplexPrefabs = this\.advancedRoboticsComplexPrefabs;/);
    assert.match(bootstrap, /visual\.robotPrefab = this\.robotPrefab;/);
    assert.match(bootstrap, /visual\.focusAnchor = zone\.getChildByName\('AdvancedRoboticsComplex_RevealAnchor'\)/);
    assert.match(bootstrap, /controller\.advancedRoboticsComplexVisual = /);
    assert.match(bootstrap, /construction\.registerTarget\('advanced_robotics_complex', arcVisual\)/);
    assert.match(bootstrap, /construction\.sparkAnchors\.set\('advanced_robotics_complex', /);
    assert.match(bootstrap, /registerTarget\('assembly_station', visual\)/, 'the Assembly target stays registered');
    assert.match(bootstrap, /construction\.registerTarget\('robot_line', lineVisual\)/, 'the Robot Line target stays registered');
    assert.match(bootstrap, /construction\.registerTarget\('automated_cell', cellVisual\)/, 'the Automated Cell target stays registered');
    const registry = read('assets/scripts/presentation/PresentationController.ts');
    assert.match(registry, /this\.advancedRoboticsComplexVisual\?\.sync\(/);
    assert.match(registry, /this\.advancedRoboticsComplexVisual\?\.consumeDomainEvents\(state, events\)/);
    assert.ok(registry.indexOf('constructionPresentation?.sync(') < registry.indexOf('advancedRoboticsComplexVisual?.sync('), 'construction frame 0 is applied before the complex applies its descriptor');
    assert.ok(registry.indexOf('constructionPresentation?.consumeDomainEvents') < registry.indexOf('advancedRoboticsComplexVisual?.consumeDomainEvents'));
    const controller = read('assets/scripts/presentation/AdvancedRoboticsComplexVisualController.ts');
    assert.match(controller, /implements ConstructionTarget/);
    assert.match(controller, /this\.cameraController\.focusOnRevealTarget\(target\)/, 'reuses the AUT-038 reveal focus API');
    assert.doesNotMatch(controller, /focusOnWorldTarget|snapToWorldTarget|setFocusBounds/, 'no other camera API');
    for (const file of ['AdvancedRoboticsComplexVisualController.ts', 'FactoryWorldBootstrap.ts']) {
        assert.doesNotMatch(read(`assets/scripts/presentation/${file}`), /\.active = false/, `${file}: visibility by scale, not node.active`);
    }
    assert.doesNotMatch(controller, /DirectionalLight|SphereLight|SpotLight|addComponent\((\w*Light)/, 'no dynamic lights');
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('advanced_robotics_complex_state'));
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /AUT-044: Advanced Robotics Complex:/);
    for (const phase of ARC_STATE_PHASES) assert.match(controller, new RegExp(`phase: '${phase}'`), `controller emits ${phase}`);
    assert.doesNotMatch(controller, /GameRuntime|persistence|economy\/|\.submit\(|HudViewModel|PresentationText/, 'presentation only');
    assert.match(bootstrap, /ARC_FOUNDATION_SLAB/);
    assert.match(bootstrap, /ARC_BEAMS\[beamId\]/);
    assert.match(bootstrap, /ARC_LAMPS\[lampId\]/);
    assert.match(bootstrap, /ARC_GUIDE\[part\]/);
    assert.match(bootstrap, /'AdvancedRoboticsComplex_RevealAnchor'/);
    // No other controller or economy code was touched: the population controller keeps its AUT-043 shape (no apron route).
    assert.doesNotMatch(read('assets/scripts/presentation/RobotPopulationController.ts'), /advancedRobotics|AdvancedRobotics|apron/);
    // Metas: unique a0440000 uuids.
    const uuids = new Set<string>();
    for (const file of [...PURE_MODULES, 'AdvancedRoboticsComplexVisualController']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript', `${file}.ts.meta`);
        assert.match(meta.uuid, /^a0440000-0000-4000-8000-\d{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 6, 'unique meta uuids');
});

test('AUT-044 the unbuilt placeholder shell is the AUT-033 shell and the controller swaps it by scale', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.ok(bootstrap.includes('`${zoneId}_InactiveShell`') && bootstrap.includes('`${zoneId}_DisconnectedLogistics`'), 'shell created by createZones');
    assert.deepEqual([...C.ARC_PLACEHOLDER_NODE_NAMES], ['AdvancedRoboticsComplex_InactiveShell', 'AdvancedRoboticsComplex_DisconnectedLogistics']);
    assert.match(read('assets/scripts/presentation/AdvancedRoboticsComplexVisualController.ts'), /placeholder\.setScale\(applied, applied, applied\)/);
    assert.deepEqual(C.arcLocal({ x: -1.0, y: 1.0, z: 5.0 }), { x: 0, y: 1.0, z: -0.125 });
    assert.deepEqual(C.ARC_ZONE_ORIGIN, { x: -1.0, y: 0, z: 5.125 });
});
