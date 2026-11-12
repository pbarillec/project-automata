import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import type { DomainEvent } from '../assets/scripts/domain/Events.ts';
import { ZONE_LAYOUT } from '../assets/scripts/presentation/FactoryZoneLayout.ts';
import { floorHeightAt, SHELL_FLOOR, ASSEMBLY_MODULE_TRANSFORMS } from '../assets/scripts/presentation/AssemblySliceLayout.ts';
import * as L from '../assets/scripts/presentation/RobotLineLayout.ts';
import { resolveRobotLineVisualState } from '../assets/scripts/presentation/RobotLineVisualStateResolver.ts';
import * as P from '../assets/scripts/presentation/RobotLineProduction.ts';
import * as R from '../assets/scripts/presentation/RobotLineExitRoute.ts';
import { RobotLineRevealViewModel, ROBOT_LINE_STATE_PHASES } from '../assets/scripts/presentation/RobotLineRevealViewModel.ts';
import { ConstructionViewModel } from '../assets/scripts/presentation/ConstructionViewModel.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { WORKER_BOT_LOOP_SECONDS } from '../assets/scripts/presentation/WorkerBotRoute.ts';
import {
    resolvePoolRobotRoute,
    robotSlotVariation,
    sampleRobotPoolPose,
    ROBOT_POPULATION_POOL_LIMIT,
} from '../assets/scripts/presentation/RobotPopulation.ts';
import { RobotPopulationViewModel } from '../assets/scripts/presentation/RobotPopulationViewModel.ts';

/*
 * AUT-042 Robot Line visual + Era II reveal hook: pure resolver / production / route tests, GLB-bounds geometry,
 * scene prefab alignment and runtime wiring. Bounds come from the approved AUT-032 GLBs (no new asset).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const scenePath = path.join(repoRoot, 'assets/scenes/factory/FactoryWorld.scene');
const artRoot = path.join(repoRoot, 'assets/art');
const factoryDir = path.join(artRoot, 'aut032/factory');
const PRESS_TOP = 1.505;
const LINE_MAX_HEIGHT = 1.35;
const EPS = 1e-6;

const EXPECTED_ASSET_FILES: Record<string, string> = {
    conveyor: 'conveyor.glb',
    feed_corner: 'conveyor-corner.glb',
    machine: 'machine.glb',
    arm_a: 'robot-arm-a.glb',
    arm_b: 'robot-arm-b.glb',
    gate_frame: 'structure-high.glb',
    status_panel: 'screen-panel-wide.glb',
    chassis: 'box-large.glb',
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
function worldBox(transform: { position: Vec3; rotationY: number; scale: number }, bounds: { min: number[]; max: number[] }): Box {
    const rad = (transform.rotationY * Math.PI) / 180;
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

function composition(): Map<string, Box> {
    const boxes = new Map<string, Box>();
    const t = L.ROBOT_LINE_MODULE_TRANSFORMS;
    boxes.set('foundation_slab', boxOf(L.ROBOT_LINE_FOUNDATION_SLAB.center, L.ROBOT_LINE_FOUNDATION_SLAB.size));
    boxes.set('output_lip', boxOf(L.ROBOT_LINE_OUTPUT_LIP.center, L.ROBOT_LINE_OUTPUT_LIP.size));
    for (const [id, slot] of Object.entries(L.ROBOT_LINE_MODULE_PREFAB) as [Exclude<L.RobotLineModuleId, 'foundation_slab' | 'output_lip'>, L.RobotLinePrefabSlot][]) {
        if (id === 'belt') continue;
        boxes.set(id, worldBox(t[id], glbBounds(EXPECTED_ASSET_FILES[slot])));
    }
    L.robotLineBeltTileOffsets().forEach((offset, index) => {
        boxes.set(`belt_tile_${index}`, worldBox({ position: { x: t.belt.position.x + offset, y: t.belt.position.y, z: t.belt.position.z }, rotationY: 0, scale: L.ROBOT_LINE_BELT_TILE_SCALE }, glbBounds('conveyor.glb')));
    });
    return boxes;
}

function lampBoxes(): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const id of L.ROBOT_LINE_LAMP_IDS) out.set(`lamp_${id}`, boxOf(L.ROBOT_LINE_LAMPS[id].center, L.ROBOT_LINE_LAMPS[id].size));
    return out;
}

/** Default portrait projection (same camera maths as the Assembly slice test; the camera is untouched). */
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

function stateWithLine(level: number | null, extra: Partial<{ era: string }> = {}): GameState {
    const state = createFreshGameState();
    if (level !== null) {
        state.run.producers['robot_line'] = { level, isUnlocked: true, isBuilt: level > 0 };
        if (level > 0) state.run.currentEraId = extra.era ?? 'automated_factory';
    } else {
        state.run.producers['robot_line'] = { level: 0, isUnlocked: true, isBuilt: false };
    }
    return state;
}

// ---------------------------------------------------------------------------------------------------------------
// Scene / assets

test('AUT-042 FactoryWorld serializes robotLinePrefabs index-aligned with the layout, AUT-032 assets only', () => {
    const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
    const holders = scene.filter((entry: any) => Array.isArray(entry?.robotLinePrefabs));
    assert.equal(holders.length, 1, 'exactly one serialized robotLinePrefabs list');
    assert.equal(holders[0].__type__, scene.find((entry: any) => Array.isArray(entry?.factoryPrefabs)).__type__, 'held by FactoryWorldBootstrap');
    assert.ok(Array.isArray(holders[0].assemblyPrefabs), 'the AUT-039 list is untouched');
    const prefabs = gltfScenePrefabs(artRoot);
    const uuids = holders[0].robotLinePrefabs.map((ref: any) => ref.__uuid__);
    assert.equal(uuids.length, L.ROBOT_LINE_PREFAB_SLOTS.length);
    L.ROBOT_LINE_PREFAB_SLOTS.forEach((slot, index) => {
        assert.equal(uuids[index], L.ROBOT_LINE_ASSET_REFERENCES[slot], `${slot} at index ${index}`);
        assert.equal(prefabs.get(uuids[index])?.file, EXPECTED_ASSET_FILES[slot], `${slot} resolves to ${prefabs.get(uuids[index])?.file}`);
    });
    const forbidden = ['pipe-large.glb', 'hopper-square.glb', 'conveyor-junction-t.glb'];
    for (const uuid of uuids) assert.ok(!forbidden.includes(prefabs.get(uuid)?.file ?? ''), `forbidden asset ${prefabs.get(uuid)?.file}`);
    const doc = read('docs/AUT-032_3D_ASSET_ROBOT_SPIKE.md');
    for (const file of Object.values(EXPECTED_ASSET_FILES)) assert.ok(doc.includes(file), `${file} is in the AUT-032 inventory`);
    assert.equal(readdirSync(factoryDir).filter((name) => name.endsWith('.glb')).length, 12, 'no new asset files');
    assert.equal(holders[0].robotPrefab?.__uuid__, 'a0320000-0000-4000-8000-000000000003@68751');
});

// ---------------------------------------------------------------------------------------------------------------
// Layout geometry (measured GLB bounds)

test('AUT-042 measured GLB facts the layout relies on', () => {
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-2;
    const conveyor = glbBounds('conveyor.glb');
    assert.ok(near(conveyor.max[0] - conveyor.min[0], 1) && near(conveyor.max[1], 0.4) && near(conveyor.max[2] - conveyor.min[2], 1));
    const machine = glbBounds('machine.glb');
    assert.ok(near(machine.max[0] - machine.min[0], 1.2) && near(machine.max[1], 1.3) && near(machine.max[2] - machine.min[2], 1.5));
    assert.ok(near(glbBounds('robot-arm-a.glb').max[1], 3.2));
    assert.ok(near(glbBounds('robot-arm-b.glb').max[1], 3.0));
    const gate = glbBounds('structure-high.glb');
    assert.ok(near(gate.max[0] - gate.min[0], 0.3) && near(gate.max[1], 1.5) && near(gate.max[2] - gate.min[2], 1.1));
    for (const file of Object.values(EXPECTED_ASSET_FILES)) assert.ok(Math.abs(glbBounds(file).min[1]) < 1e-3, `${file} pivot is bottom-centre`);
});

test('AUT-042 modules rest on the slab, stay below 1.35 (and the press), and do not interpenetrate', () => {
    const boxes = composition();
    const slab = boxes.get('foundation_slab')!;
    assert.ok(Math.abs(slab.max.y - SHELL_FLOOR.slabTop) < EPS && Math.abs(L.ROBOT_LINE_FLOOR.slabTop - SHELL_FLOOR.slabTop) < EPS);
    assert.ok(Math.abs((slab.max.x - slab.min.x) - 4.8) < EPS && Math.abs((slab.max.z - slab.min.z) - 2.0) < EPS);
    assert.ok(Math.abs(L.ROBOT_LINE_FOUNDATION_SLAB.center.z - L.ROBOT_LINE_AXIS_Z) < EPS, 'slab centred on the line axis');
    for (const [id, box] of boxes) {
        if (id === 'foundation_slab') continue;
        assert.ok(box.min.x >= slab.min.x - EPS && box.max.x <= slab.max.x + EPS && box.min.z >= slab.min.z - EPS && box.max.z <= slab.max.z + EPS, `${id} on the slab`);
        assert.ok(box.max.y <= LINE_MAX_HEIGHT + EPS, `${id} top ${box.max.y.toFixed(3)} <= ${LINE_MAX_HEIGHT}`);
        assert.ok(box.max.y < PRESS_TOP, `${id} below the Fabricator press`);
        if (id !== 'status_panel') assert.ok(Math.abs(box.min.y - L.ROBOT_LINE_FLOOR.slabTop) < EPS, `${id} rests on the slab (min y ${box.min.y})`);
    }
    // Status panel seated on the machine 1 roof (1.3 x 0.5 at unit scale).
    const machineA = L.ROBOT_LINE_MODULE_TRANSFORMS.machine_a;
    assert.ok(Math.abs(L.ROBOT_LINE_MODULE_TRANSFORMS.status_panel.position.y - (machineA.position.y + (1.3 * machineA.scale))) < EPS);
    // Declared contacts: belt tiles run under / through the solid machines; the panel sits on machine 1.
    const declared = (a: string, b: string): boolean => {
        const pair = new Set([a, b]);
        if (pair.has('status_panel') && pair.has('machine_a')) return true;
        return [...pair].some((id) => id.startsWith('belt_tile_')) && [...pair].some((id) => id === 'machine_a' || id === 'machine_b');
    };
    const ids = [...boxes.keys()].filter((id) => id !== 'foundation_slab');
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
        if (declared(ids[i], ids[j])) continue;
        assert.ok(!overlap(boxes.get(ids[i])!, boxes.get(ids[j])!), `${ids[i]} vs ${ids[j]}`);
    }
    // Belt tiles are contiguous from the entry to the lip plate.
    const tiles = ids.filter((id) => id.startsWith('belt_tile_')).map((id) => boxes.get(id)!).sort((a, b) => a.min.x - b.min.x);
    assert.equal(tiles.length, L.ROBOT_LINE_BELT_TILES);
    assert.ok(Math.abs(tiles[0].min.x - L.ROBOT_LINE_BELT_START_X) < EPS);
    tiles.slice(1).forEach((tile, i) => assert.ok(Math.abs(tile.min.x - tiles[i].max.x) < 1e-6, 'tiles are contiguous'));
    assert.ok(Math.abs(boxes.get('output_lip')!.min.x - tiles[tiles.length - 1].max.x) < 1e-6, 'lip plate starts at the belt end');
    assert.ok(Math.abs(boxes.get('output_lip')!.max.y - L.ROBOT_LINE_BELT_TOP) < EPS, 'lip flush with the belt top');
    assert.ok(Math.abs(tiles[0].max.y - L.ROBOT_LINE_BELT_TOP) < 1e-6, 'belt top matches the measured conveyor height');
});

test('AUT-042 lamps, arm swing and belt items fit inside the composition', () => {
    const boxes = composition();
    for (const [id, lamp] of lampBoxes()) {
        assert.ok(lamp.max.y <= LINE_MAX_HEIGHT);
        for (const [other, box] of boxes) {
            if (other === 'foundation_slab') continue;
            const contact = (id === 'lamp_machine_a' && other === 'machine_a') || (id === 'lamp_machine_b' && other === 'machine_b');
            if (!contact) assert.ok(!overlap(lamp, box), `${id} vs ${other}`);
        }
    }
    // Arms at the maximum yaw swing stay clear of the belt tiles.
    const swing = (L.ROBOT_LINE_MODULE_TRANSFORMS.arm_a.scale * 0.5) * (Math.cos((P.ROBOT_LINE_ARM_YAW_DEG * Math.PI) / 180) + Math.sin((P.ROBOT_LINE_ARM_YAW_DEG * Math.PI) / 180));
    for (const id of ['arm_a', 'arm_b'] as const) {
        const t = L.ROBOT_LINE_MODULE_TRANSFORMS[id];
        assert.ok(t.position.z + swing < L.ROBOT_LINE_AXIS_Z - (L.ROBOT_LINE_BELT_TILE_SCALE / 2) + 0.005, `${id} swing clears the belt`);
    }
    // Items ride on the belt top; the finished robot is shorter than 1.35 and the press.
    assert.ok(P.ROBOT_LINE_ITEM_MAX_TOP <= LINE_MAX_HEIGHT && P.ROBOT_LINE_ITEM_MAX_TOP < PRESS_TOP, `robot on belt top ${P.ROBOT_LINE_ITEM_MAX_TOP}`);
    const chassis = glbBounds('box-large.glb');
    assert.ok((chassis.max[0] - chassis.min[0]) * L.ROBOT_LINE_CHASSIS_SCALE < L.ROBOT_LINE_BELT_TILE_SCALE, 'chassis narrower than the belt');
    assert.ok(L.ROBOT_LINE_FINISHED_ROBOT_SCALE >= 0.14 && L.ROBOT_LINE_FINISHED_ROBOT_SCALE <= 0.2);
    assert.ok(L.ROBOT_LINE_CHASSIS_SCALE >= 0.2 && L.ROBOT_LINE_CHASSIS_SCALE <= 0.3);
});

test('AUT-042 footprint: inside the RobotLine build area and clear of Assembly, storage crate, Fabricator and the spine', () => {
    const zone = ZONE_LAYOUT.RobotLine;
    const zoneBox: Box = { min: { x: zone.x - (zone.width / 2), y: -1, z: zone.z - (zone.depth / 2) }, max: { x: zone.x + (zone.width / 2), y: 10, z: zone.z + (zone.depth / 2) } };
    assert.deepEqual([zoneBox.min.x, zoneBox.max.x, zoneBox.min.z, zoneBox.max.z], [0.5, 6.5, -2.95, 0.55]);
    const all = new Map<string, Box>([...composition(), ...lampBoxes()]);
    const spine: Box = { min: { x: -6.3, y: 0.12, z: -0.65 }, max: { x: 6.7, y: 0.24, z: 0.05 } };
    const fabricator = ZONE_LAYOUT.Fabricator;
    const crate = L.ROBOT_LINE_ASSET_REFERENCES.chassis && ASSEMBLY_MODULE_TRANSFORMS.storage_crate;
    const crateBox = worldBox(crate, glbBounds('box-large.glb'));
    for (const [id, box] of all) {
        assert.ok(box.min.x >= zoneBox.min.x && box.max.x <= zoneBox.max.x && box.min.z >= zoneBox.min.z && box.max.z <= zoneBox.max.z, `${id} inside the zone`);
        assert.ok(box.max.z <= -0.85 + EPS && box.min.z >= -2.9 - EPS, `${id} inside the build area z -2.9..-0.85`);
        assert.ok(box.min.x >= 0.5, `${id} east of the Assembly slice (x >= 0.5, Assembly max x -1.0)`);
        assert.ok(!overlap(box, spine), `${id} clear of the spine`);
        assert.ok(!overlap(box, crateBox), `${id} clear of the storage crate`);
        assert.ok(box.min.x > fabricator.x + (fabricator.width / 2), `${id} clear of the Fabricator zone`);
    }
    const spineMatch = read('assets/scripts/presentation/FactoryWorldBootstrap.ts').match(/'MainLogisticsSpine', new Vec3\(13, 0\.12, 0\.7\), new Vec3\(0\.2, 0\.18, -0\.3\)/);
    assert.ok(spineMatch, 'spine geometry matches the shell');
    // floorHeightAt knows the slab (0.16) and the zone foundation (0.12).
    assert.equal(floorHeightAt(3.0, -1.9), 0.16);
    assert.equal(floorHeightAt(5.9, -1.9), 0.12);
    assert.equal(floorHeightAt(5.0, -0.3), 0.24);
    assert.equal(floorHeightAt(3.0, 0.3), 0.12);
    assert.equal(floorHeightAt(3.0, 1.5), 0);
});

test('AUT-042 the whole composition is on screen at the default portrait view and in the reveal focus', () => {
    const boxes = new Map<string, Box>([...composition(), ...lampBoxes()]);
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const focusDistance = Number(bootstrap.match(/controller\.focusDistance = ([\d.]+);/)![1]);
    const views = { default: defaultView(), reveal: camera(focusDistance, L.ROBOT_LINE_REVEAL_TARGET) };
    for (const [name, project] of Object.entries(views)) {
        for (const [id, b] of boxes) {
            for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
                const p = project(x, y, z);
                assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: ${id} corner on screen (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
            }
        }
    }
    assert.deepEqual(L.ROBOT_LINE_REVEAL_TARGET, { x: 3.0, y: 0.3, z: -1.7 });
});

// ---------------------------------------------------------------------------------------------------------------
// Resolver

test('AUT-042 resolver: unbuilt, Lv1, Lv10, Lv25+, Reboot', () => {
    const unbuilt = resolveRobotLineVisualState(stateWithLine(null));
    assert.equal(unbuilt.phase, 'unbuilt');
    assert.equal(unbuilt.constructed, false);
    assert.equal(unbuilt.placeholderVisible, true);
    assert.deepEqual([unbuilt.modules, unbuilt.litLamps, unbuilt.itemCount], [[], [], 0]);
    assert.deepEqual(resolveRobotLineVisualState(createFreshGameState()), { ...unbuilt, eraAutomatedFactory: false }, 'no robot_line entry at all = unbuilt');

    const lv1 = resolveRobotLineVisualState(stateWithLine(1));
    assert.equal(lv1.phase, 'line_lv1');
    assert.deepEqual(lv1.modules, ['foundation_slab', 'entry_gate', 'feed_corner', 'belt', 'machine_a', 'arm_a', 'output_lip']);
    assert.deepEqual(lv1.litLamps, ['machine_a', 'arm_a']);
    assert.deepEqual([lv1.itemCount, lv1.beltCadence, lv1.placeholderVisible, lv1.eraAutomatedFactory], [2, 1, false, true]);

    for (const level of [10, 25, 100]) {
        const lv10 = resolveRobotLineVisualState(stateWithLine(level));
        assert.equal(lv10.phase, 'line_lv10', `Lv${level}`);
        assert.deepEqual(lv10.modules, ['foundation_slab', 'entry_gate', 'feed_corner', 'belt', 'machine_a', 'arm_a', 'machine_b', 'arm_b', 'status_panel', 'output_lip']);
        assert.deepEqual(lv10.litLamps, ['machine_a', 'arm_a', 'machine_b', 'arm_b']);
        assert.deepEqual([lv10.itemCount, lv10.beltCadence], [4, 1.2]);
    }
    assert.equal(resolveRobotLineVisualState(stateWithLine(9)).phase, 'line_lv1');
    // Lv25+ keep the Lv10 composition exactly.
    assert.deepEqual(resolveRobotLineVisualState(stateWithLine(25)), { ...resolveRobotLineVisualState(stateWithLine(10)), level: 25 });
    // Reboot: the producer is gone again.
    const reboot = createFreshGameState();
    assert.equal(resolveRobotLineVisualState(reboot).phase, 'unbuilt');
    // Every module of every phase is a known id in canonical (construction) order.
    for (const level of [1, 10]) {
        const modules = resolveRobotLineVisualState(stateWithLine(level)).modules;
        assert.deepEqual([...modules], L.ROBOT_LINE_MODULE_IDS.filter((id) => modules.includes(id)));
    }
});

test('AUT-042 resolver is deterministic and leaves the state untouched', () => {
    const state = stateWithLine(10);
    const before = JSON.stringify(state);
    assert.deepEqual(resolveRobotLineVisualState(state), resolveRobotLineVisualState(state));
    assert.equal(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------------------------------------------
// Production model

test('AUT-042 production: positions are periodic, staggered and recycled; kind swaps under machine 1', () => {
    const period = P.beltCycleSeconds(1);
    assert.ok(Math.abs(period - 8) < 1e-9, '4.0 units at 0.5 u/s');
    assert.ok(Math.abs(P.beltCycleSeconds(1.2) - (8 / 1.2)) < 1e-9);
    let clock = 0;
    const sampled = new Map<number, number>();
    for (let t = 0; t < period * 3; t += 0.05) {
        clock = P.advanceBeltClock(clock, 0.05, 1);
        for (const item of P.sampleBeltItems(clock, 4, true)) {
            assert.ok(item.x >= P.ROBOT_LINE_ITEM_ENTRY_X - EPS && item.x <= P.ROBOT_LINE_ITEM_LIP_X + EPS, `x ${item.x}`);
            assert.ok(item.visibility >= 0 && item.visibility <= 1);
            assert.equal(item.y, L.ROBOT_LINE_BELT_TOP);
            assert.equal(item.z, L.ROBOT_LINE_AXIS_Z);
            assert.equal(item.headingDeg, 90, 'finished robots face +X');
            assert.equal(item.kind, item.x < L.ROBOT_LINE_MODULE_TRANSFORMS.machine_a.position.x ? 'chassis' : 'robot');
            sampled.set(item.slot, Math.max(sampled.get(item.slot) ?? 0, item.cycle));
        }
    }
    // Each item recycles about once per cycle: three periods = three cycles (+/- one for the phase).
    for (const cycles of sampled.values()) assert.ok(cycles >= 2 && cycles <= 4, `cycles ${cycles}`);
    // Periodic: one full cycle later the sample is identical (up to the cycle counter).
    const a = P.sampleBeltItems(0.3, 4, true);
    const b = P.sampleBeltItems(1.3, 4, true);
    a.forEach((item, i) => {
        assert.ok(Math.abs(item.x - b[i].x) < 1e-9 && Math.abs(item.visibility - b[i].visibility) < 1e-9);
        assert.equal(item.kind, b[i].kind);
    });
    // Visibility ramps to 0 at the entry and at the lip (scale hide), and to 0 inside machine 1 for the finished robot.
    const at = (x: number, machineB = false) => P.sampleBeltItem(((x - P.ROBOT_LINE_ITEM_ENTRY_X) / P.ROBOT_LINE_ITEM_TRAVEL) - P.beltItemPhase(0), 0, machineB);
    assert.equal(at(P.ROBOT_LINE_ITEM_ENTRY_X + 1e-9).visibility < 1e-6, true);
    assert.equal(at(P.ROBOT_LINE_ITEM_LIP_X - 1e-9).visibility < 1e-6, true);
    assert.equal(at(2.0).kind, 'chassis');
    assert.equal(at(2.0).visibility, 1);
    assert.equal(at(2.45).kind, 'robot');
    assert.equal(at(2.45).visibility, 0, 'the swap happens hidden under the machine roof');
    assert.equal(at(3.4).visibility, 1);
    assert.equal(at(3.9, true).visibility, 0, 'Lv10: the second machine is a tunnel');
    assert.equal(at(3.9, false).visibility, 1);
});

test('AUT-042 production: golden-ratio stagger keeps items apart and the Lv10 cadence is 1.2x', () => {
    const phases = [0, 1, 2, 3].map((slot) => P.beltItemPhase(slot));
    assert.equal(new Set(phases.map((p) => Math.round(p * 1000))).size, 4);
    const sorted = [...phases].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i += 1) assert.ok((sorted[i] - sorted[i - 1]) * P.ROBOT_LINE_ITEM_TRAVEL >= 0.5, 'items stay at least 0.5 units apart');
    assert.equal(P.sampleBeltItems(1, 9, true).length, P.ROBOT_LINE_ITEM_POOL_SIZE, 'the pool never exceeds 4');
    assert.equal(P.sampleBeltItems(1, 0, true).length, 0);
    assert.ok(Math.abs((P.advanceBeltClock(0, 1, 1.2) / P.advanceBeltClock(0, 1, 1)) - 1.2) < 1e-9);
    assert.equal(P.advanceBeltClock(2, -5, 1), 2);
    assert.equal(P.advanceBeltClock(2, Number.NaN, 1), 2);
});

test('AUT-042 arms run a deterministic timer cycle, bounded and out of phase', () => {
    const period = P.ROBOT_LINE_ARM_PERIOD_SECONDS;
    for (let t = 0; t < period * 2; t += 0.1) {
        const pose = P.sampleArmPose(t, 0);
        assert.deepEqual(pose, P.sampleArmPose(t, 0));
        assert.ok(Math.abs(pose.yawDeg) <= P.ROBOT_LINE_ARM_YAW_DEG + EPS && pose.pitchDeg >= 0 && pose.pitchDeg <= P.ROBOT_LINE_ARM_PITCH_DEG + EPS);
        const later = P.sampleArmPose(t + period, 0);
        assert.ok(Math.abs(later.yawDeg - pose.yawDeg) < 1e-6 && Math.abs(later.pitchDeg - pose.pitchDeg) < 1e-6, 'periodic');
    }
    assert.notEqual(P.sampleArmPose(1, 0).yawDeg, P.sampleArmPose(1, 1).yawDeg);
});

// ---------------------------------------------------------------------------------------------------------------
// Exit route + population

test('AUT-042 exit route: periodic, Walking/Idle only, on the walkable floor, clear of the line and the crate, on screen', () => {
    const boxes = new Map<string, Box>([...composition(), ...lampBoxes()]);
    const crate = worldBox(ASSEMBLY_MODULE_TRANSFORMS.storage_crate, glbBounds('box-large.glb'));
    const project = defaultView();
    const CLEARANCE = 0.07;
    const robotTop = 4.513 * 0.24;
    assert.ok(R.ROBOT_LINE_LOOP_SECONDS > 10 && R.ROBOT_LINE_LOOP_SECONDS < 40, `lap ${R.ROBOT_LINE_LOOP_SECONDS.toFixed(1)} s`);
    assert.deepEqual(R.sampleLineLoopPose(1.234), R.sampleLineLoopPose(1.234 + R.ROBOT_LINE_LOOP_SECONDS));
    const ids = R.ROBOT_LINE_LOOP_ROUTE.map((s) => s.id);
    assert.deepEqual(ids.slice(0, 6), ['line_lip', 'lip_exit', 'exit_slab', 'exit_cross', 'exit_south', 'storage_pick']);
    const lip = R.ROBOT_LINE_LOOP_ROUTE[0];
    assert.ok(lip.x > boxes.get('output_lip')!.max.x, 'the pickup stop is east of the lip plate');
    assert.ok(Math.abs(lip.z - L.ROBOT_LINE_AXIS_Z) < EPS);
    for (let t = 0; t <= R.ROBOT_LINE_LOOP_SECONDS; t += 0.02) {
        const pose = R.sampleLineLoopPose(t);
        assert.ok(['Robot_Walking', 'Robot_Idle'].includes(pose.clip), pose.clip);
        assert.equal(pose.y, floorHeightAt(pose.x, pose.z));
        for (const [id, b] of [...boxes, ['storage_crate', crate] as [string, Box]]) {
            if (id === 'foundation_slab') continue;
            const inside = pose.x > b.min.x - CLEARANCE && pose.x < b.max.x + CLEARANCE && pose.z > b.min.z - CLEARANCE && pose.z < b.max.z + CLEARANCE;
            assert.ok(!inside, `t=${t.toFixed(2)} (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}) inside ${id}`);
        }
        for (const y of [pose.y, pose.y + robotTop]) {
            const p = project(pose.x, y, pose.z);
            // Walkers at the lip pickup stop sit about 2% inside the screen edge (the structures keep the 0.98 margin).
            assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, `on screen at t=${t.toFixed(2)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        }
    }
    // The route crosses the spine on its south side and reaches the storage crate from the east.
    const crossing = R.ROBOT_LINE_LOOP_ROUTE.find((s) => s.id === 'exit_cross')!;
    assert.ok(crossing.z > -0.65 && crossing.z < 0.05, 'crosses the spine');
    const south = R.ROBOT_LINE_LOOP_ROUTE.find((s) => s.id === 'exit_south')!;
    assert.ok(south.z > 0.05, 'continues on the south side of the spine');
    const pick = R.ROBOT_LINE_LOOP_ROUTE.find((s) => s.id === 'storage_pick')!;
    assert.ok(pick.x > crate.max.x && pick.x - crate.max.x < 0.2 && pick.z > crate.min.z && pick.z < crate.max.z, 'pick stop beside the crate face');
});

test('AUT-042 population: about a third of the pooled robots take the Line loop once the line is built; the rest keep Assembly <-> Storage', () => {
    for (let slot = 0; slot < ROBOT_POPULATION_POOL_LIMIT; slot += 1) assert.equal(resolvePoolRobotRoute(slot, false), 'assembly_storage');
    assert.equal(resolvePoolRobotRoute(0, true), 'assembly_storage', 'rank 1 stays on the Assembly loop');
    const line = [...Array(13).keys()].filter((slot) => resolvePoolRobotRoute(slot, true) === 'line_storage');
    assert.deepEqual(line, [1, 4, 7, 10], 'slots 1, 4, 7, 10 = ranks 2, 5, 8, 11 (never rank 0 / 1)');
    const share = line.length / 13;
    assert.ok(share > 0.25 && share < 0.4, `share ${share}`);
    // The Worker Bot (rank 0) is not part of the pool, so the Assembly <-> Storage loop remains for the rest.
    const poses = (slot: number, route: 'assembly_storage' | 'line_storage') => Array.from({ length: 80 }, (_, i) => sampleRobotPoolPose(robotSlotVariation(slot), i * 0.7, route));
    for (const pose of poses(1, 'line_storage')) {
        assert.ok(pose.x > -0.5 && pose.x < 5.6, `line route x ${pose.x}`);
        assert.ok(['Robot_Walking', 'Robot_Idle'].includes(pose.clip));
    }
    for (const pose of poses(1, 'assembly_storage')) assert.ok(pose.x < -0.5, 'the Assembly loop stays west of the spine crossing');
    assert.deepEqual(sampleRobotPoolPose(robotSlotVariation(3), 5), sampleRobotPoolPose(robotSlotVariation(3), 5, 'assembly_storage'), 'default route unchanged');
    assert.ok(robotSlotVariation(2).phaseFraction >= 0 && robotSlotVariation(2).phaseFraction < 1);
    assert.ok(Math.abs((robotSlotVariation(2).phaseFraction * WORKER_BOT_LOOP_SECONDS) - robotSlotVariation(2).phaseSeconds) < 1e-9);
});

test('AUT-042 population view model: the Robot Line flag follows the state; Robots Built mapping and pool size are unchanged', () => {
    const withBot = (line: number | null, built = 100): GameState => {
        const state = stateWithLine(line);
        state.run.robotsBuilt = built;
        state.run.progressionFlags['first_robot'] = true;
        return state;
    };
    const vm = new RobotPopulationViewModel();
    const unbuilt = vm.sync(withBot(null));
    assert.equal(unbuilt.robotLineBuilt, false);
    const built = vm.sync(withBot(1));
    assert.equal(built.robotLineBuilt, true);
    assert.equal(built.changed, true, 'the allocation change is reported');
    assert.equal(built.pooled, unbuilt.pooled, 'no new robots: the Robots Built mapping is unchanged');
    assert.equal(built.visible, unbuilt.visible);
    assert.equal(vm.sync(withBot(1)).changed, false);
    const fresh = new RobotPopulationViewModel();
    assert.equal(fresh.sync(withBot(10, 1e12)).robotLineBuilt, true);
    assert.ok(fresh.sync(withBot(10, 1e12)).visible <= 14);
    const controller = read('assets/scripts/presentation/RobotPopulationController.ts');
    assert.match(controller, /resolvePoolRobotRoute\(robot\.variation\.slot, this\.robotLineBuilt\)/);
    assert.match(controller, /sampleRobotPoolPose\(robot\.variation, this\.clock, route\)/);
    assert.match(controller, /route: resolvePoolRobotRoute\(slot, this\.robotLineBuilt\)/, 'a loaded save starts on the right route (no re-scale)');
    assert.doesNotMatch(controller, /instantiate\(this\.robotPrefab\);[\s\S]*instantiate\(this\.robotPrefab\)/, 'still one lazy instantiate site, no extra instances');
});

// ---------------------------------------------------------------------------------------------------------------
// Construction target, reveal hook, no replay

const constructed: DomainEvent = { type: 'producerConstructed', producerId: 'robot_line', level: 1, source: 'producer_purchase' };
const eraChanged: DomainEvent = { type: 'eraChanged', oldEraId: 'manual_workshop', newEraId: 'automated_factory', breakthroughId: undefined } as DomainEvent;

test('AUT-042 construction: plan order slab -> gate -> feed corner -> conveyors -> machine -> arm -> lip; no replay on load', () => {
    const resolve = (producerId: string, state: GameState): readonly string[] => (producerId === 'robot_line' ? resolveRobotLineVisualState(state).modules : []);
    assert.deepEqual(resolve('robot_line', stateWithLine(1)), ['foundation_slab', 'entry_gate', 'feed_corner', 'belt', 'machine_a', 'arm_a', 'output_lip']);

    const loaded = new ConstructionViewModel(resolve);
    assert.deepEqual(loaded.syncFromState(stateWithLine(10)), [], 'a save load never plays the sequence');
    assert.deepEqual(loaded.consumeEvents(stateWithLine(10), [constructed]), []);
    assert.equal(loaded.isActive('robot_line'), false);

    const live = new ConstructionViewModel(resolve);
    live.syncFromState(stateWithLine(null));
    const started = live.syncFromState(stateWithLine(1));
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].plan.moduleIds, ['foundation_slab', 'entry_gate', 'feed_corner', 'belt', 'machine_a', 'arm_a', 'output_lip']);
    assert.deepEqual(live.consumeEvents(stateWithLine(1), [constructed]), [], 'snapshot-before-event ordering plays one sequence');
    let completed = 0;
    for (let i = 0; i < 200; i += 1) completed += live.tick(0.05).completed.filter((id) => id === 'robot_line').length;
    assert.equal(completed, 1, 'the activation hook fires once');
    // Reboot allows a new sequence.
    live.syncFromState(stateWithLine(null));
    assert.equal(live.consumeEvents(stateWithLine(1), [constructed]).length, 1);
});

test('AUT-042 Era II reveal hook: only a live era change counts; one focus beat per construction; load never reveals', () => {
    const era2 = stateWithLine(1);
    const loaded = new RobotLineRevealViewModel();
    assert.equal(loaded.syncFromState(era2).eraRevealPending, false, 'loading an Automated Factory save is not a reveal');
    assert.equal(loaded.consumeEvents(era2, []).eraRevealPending, false);

    const vm = new RobotLineRevealViewModel();
    vm.syncFromState(stateWithLine(null));
    assert.equal(vm.syncFromState(era2).eraRevealPending, true, 'live transition seen by a snapshot');
    const beat = vm.beginConstructionBeat();
    assert.deepEqual(beat, { focusRequested: true, eraReveal: true });
    assert.deepEqual(vm.beginConstructionBeat(), { focusRequested: true, eraReveal: false }, 'the reveal is consumed once');

    const viaEvent = new RobotLineRevealViewModel();
    viaEvent.syncFromState(stateWithLine(null));
    assert.equal(viaEvent.consumeEvents(era2, [eraChanged]).eraRevealPending, true);
    assert.equal(viaEvent.consumeEvents(era2, [eraChanged]).eraRevealPending, true, 'deduplicated, still pending until consumed');
    viaEvent.beginConstructionBeat();
    assert.equal(viaEvent.consumeEvents(era2, [eraChanged]).eraRevealPending, false, 'the same event is not replayed');
    // Reboot clears it.
    const reboot = new RobotLineRevealViewModel();
    reboot.syncFromState(stateWithLine(null));
    reboot.syncFromState(era2);
    reboot.syncFromState(stateWithLine(null));
    assert.equal(reboot.beginConstructionBeat().eraReveal, false);
    // Read-only.
    const state = stateWithLine(10);
    const before = JSON.stringify(state);
    new RobotLineRevealViewModel().syncFromState(state);
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual([...ROBOT_LINE_STATE_PHASES], ['synced', 'construction_started', 'activated', 'focus_requested', 'item_cycle']);
});

// ---------------------------------------------------------------------------------------------------------------
// Wiring

test('AUT-042 pure modules are engine-free and command-free', () => {
    for (const file of ['RobotLineLayout', 'RobotLineVisualStateResolver', 'RobotLineProduction', 'RobotLineExitRoute', 'RobotLineRevealViewModel']) {
        const source = read(`assets/scripts/presentation/${file}.ts`);
        assert.doesNotMatch(source, /from 'cc/, `${file} imports cc`);
        assert.doesNotMatch(source, /import[^;]*Commands|\.submit\(|execute\(/, `${file} issues commands`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|readonly|protected)/, `${file}: no constructor parameter properties`);
        assert.match(source, /from '\.{1,2}\/[^']*\.ts';$/m,`${file} uses explicit .ts imports`);
    }
    const state = stateWithLine(10);
    state.run.industrialOutput = 123;
    const before = JSON.stringify(state);
    resolveRobotLineVisualState(state);
    P.sampleBeltItems(3, 4, true);
    R.sampleLineLoopPose(3);
    assert.equal(JSON.stringify(state), before);
});

test('AUT-042 bootstrap, registry and construction wiring; scale visibility; reveal API reuse; metas', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /@property\(\[Prefab\]\)\s+public robotLinePrefabs: Prefab\[\] = \[\];/);
    assert.match(bootstrap, /this\.createRobotLineSlice\(site\);/);
    assert.match(bootstrap, /this\.connectRobotLinePresentation\(site\);/);
    assert.match(bootstrap, /addComponent\(RobotLineVisualController\)/);
    assert.match(bootstrap, /visual\.robotLinePrefabs = this\.robotLinePrefabs;/);
    assert.match(bootstrap, /visual\.robotPrefab = this\.robotPrefab;/);
    assert.match(bootstrap, /visual\.focusAnchor = zone\.getChildByName\('RobotLine_RevealAnchor'\)/);
    assert.match(bootstrap, /controller\.robotLineVisual = /);
    assert.match(bootstrap, /construction\.registerTarget\('robot_line', lineVisual\)/);
    assert.match(bootstrap, /construction\.sparkAnchors\.set\('robot_line', /);
    assert.match(bootstrap, /registerTarget\('assembly_station', visual\)/, 'the Assembly target stays registered');
    const registry = read('assets/scripts/presentation/PresentationController.ts');
    assert.match(registry, /this\.robotLineVisual\?\.sync\(/);
    assert.match(registry, /this\.robotLineVisual\?\.consumeDomainEvents\(state, events\)/);
    assert.ok(registry.indexOf('constructionPresentation?.sync(') < registry.indexOf('robotLineVisual?.sync('), 'construction frame 0 is applied before the line applies its descriptor');
    assert.ok(registry.indexOf('constructionPresentation?.consumeDomainEvents') < registry.indexOf('robotLineVisual?.consumeDomainEvents'));
    const controller = read('assets/scripts/presentation/RobotLineVisualController.ts');
    assert.match(controller, /implements ConstructionTarget/);
    assert.match(controller, /this\.cameraController\.focusOnRevealTarget\(target\)/, 'reuses the AUT-038 reveal focus API');
    assert.doesNotMatch(controller, /focusOnWorldTarget|snapToWorldTarget|setFocusBounds/, 'no other camera API');
    for (const file of ['RobotLineVisualController.ts', 'RobotPopulationController.ts', 'FactoryWorldBootstrap.ts']) {
        const source = read(`assets/scripts/presentation/${file}`);
        assert.doesNotMatch(source, /\.active = false/, `${file}: visibility by scale, not node.active`);
    }
    assert.doesNotMatch(controller, /DirectionalLight|SphereLight|SpotLight|addComponent\((\w*Light)/, 'no dynamic lights');
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('robot_line_state'));
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /'synced' \| 'construction_started' \| 'activated' \| 'focus_requested' \| 'item_cycle'/);
    for (const phase of ROBOT_LINE_STATE_PHASES) assert.match(controller, new RegExp(`phase: '${phase}'`), `controller emits ${phase}`);
    const uuids = new Set<string>();
    for (const file of ['RobotLineLayout', 'RobotLineVisualStateResolver', 'RobotLineProduction', 'RobotLineExitRoute', 'RobotLineRevealViewModel', 'RobotLineVisualController']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript', `${file}.ts.meta`);
        assert.match(meta.uuid, /^a0420000-0000-4000-8000-\d{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 6, 'unique meta uuids');
    // Presentation never touches the camera API surface beyond the reveal beat, nor the economy / runtime / save.
    assert.doesNotMatch(controller, /GameRuntime|persistence|economy\/|\.submit\(|HudViewModel|PresentationText/);
});

test('AUT-042 the unbuilt placeholder shell is the AUT-033 shell and the controller swaps it by scale', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    for (const name of L.ROBOT_LINE_PLACEHOLDER_NODE_NAMES) {
        assert.ok(bootstrap.includes('`${zoneId}_InactiveShell`') || bootstrap.includes('_InactiveShell'), 'shell created by createZones');
        assert.ok(name === 'RobotLine_InactiveShell' || name === 'RobotLine_DisconnectedLogistics');
    }
    assert.match(read('assets/scripts/presentation/RobotLineVisualController.ts'), /placeholder\.setScale\(applied, applied, applied\)/);
});
