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
import * as RL from '../assets/scripts/presentation/RobotLineLayout.ts';
import * as C from '../assets/scripts/presentation/AutomatedCellLayout.ts';
import { resolveAutomatedCellVisualState } from '../assets/scripts/presentation/AutomatedCellVisualStateResolver.ts';
import * as P from '../assets/scripts/presentation/AutomatedCellProduction.ts';
import * as R from '../assets/scripts/presentation/AutomatedCellExitRoute.ts';
import { AutomatedCellRevealViewModel, AUTOMATED_CELL_STATE_PHASES } from '../assets/scripts/presentation/AutomatedCellRevealViewModel.ts';
import { ConstructionViewModel } from '../assets/scripts/presentation/ConstructionViewModel.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import {
    resolvePoolRobotRoute,
    robotSlotVariation,
    sampleRobotPoolPose,
} from '../assets/scripts/presentation/RobotPopulation.ts';
import { RobotPopulationViewModel } from '../assets/scripts/presentation/RobotPopulationViewModel.ts';
import { evaluateProducerBuildProgression } from '../assets/scripts/progression/index.ts';

/*
 * AUT-043 Automated Cell visual: pure layout / resolver / production / route tests, GLB-bounds geometry, the owner
 * zone-rect shift consequences, scene prefab alignment and runtime wiring. Bounds come from the approved AUT-032
 * GLBs (no new asset).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const scenePath = path.join(repoRoot, 'assets/scenes/factory/FactoryWorld.scene');
const artRoot = path.join(repoRoot, 'assets/art');
const factoryDir = path.join(artRoot, 'aut032/factory');
const PRESS_TOP = 1.505;
const ROBOT_LINE_TOP = 1.33;
const CELL_MAX_HEIGHT = 1.35;
const EPS = 1e-6;
/** Tall elements keep this much margin inside the left screen edge (the Art Director brief: screen x >= -0.93). */
const TALL_SCREEN_MIN_X = -0.93;

const EXPECTED_ASSET_FILES: Record<string, string> = {
    conveyor: 'conveyor.glb',
    machine: 'machine.glb',
    arm_a: 'robot-arm-a.glb',
    arm_b: 'robot-arm-b.glb',
    wall_frame: 'structure-high.glb',
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
    wall_west: 'structure-high.glb',
    wall_back: 'structure-high.glb',
    conveyor_in: 'conveyor.glb',
    conveyor_out: 'conveyor.glb',
    core: 'machine.glb',
    arm_1: 'robot-arm-a.glb',
    arm_2: 'robot-arm-a.glb',
    arm_3: 'robot-arm-b.glb',
    hopper: 'hopper-square.glb',
};

function composition(): Map<string, Box> {
    const boxes = new Map<string, Box>();
    boxes.set('foundation_slab', boxOf(C.AUTOMATED_CELL_FOUNDATION_SLAB.center, C.AUTOMATED_CELL_FOUNDATION_SLAB.size));
    for (const [id, transform] of Object.entries(C.AUTOMATED_CELL_MODULE_TRANSFORMS)) boxes.set(id, worldBox(transform, glbBounds(MODULE_FILE[id])));
    return boxes;
}

/** Worst-case AABB of an arm over its yaw swing (+-15 deg): the rotated footprint square plus the nod margin is ignored (3 deg). */
function swingBox(id: 'arm_1' | 'arm_2' | 'arm_3'): Box {
    const transform = C.AUTOMATED_CELL_MODULE_TRANSFORMS[id];
    const bounds = glbBounds(MODULE_FILE[id]);
    const a = worldBox(transform, bounds, P.AUTOMATED_CELL_ARM_YAW_DEG);
    const b = worldBox(transform, bounds, -P.AUTOMATED_CELL_ARM_YAW_DEG);
    return {
        min: { x: Math.min(a.min.x, b.min.x), y: a.min.y, z: Math.min(a.min.z, b.min.z) },
        max: { x: Math.max(a.max.x, b.max.x), y: a.max.y, z: Math.max(a.max.z, b.max.z) },
    };
}

function lampBoxes(): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const id of C.AUTOMATED_CELL_LAMP_IDS) out.set(`lamp_${id}`, boxOf(C.AUTOMATED_CELL_LAMPS[id].center, C.AUTOMATED_CELL_LAMPS[id].size));
    return out;
}

function guideBoxes(): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const part of C.AUTOMATED_CELL_GUIDE_PARTS) out.set(`guide_${part}`, boxOf(C.AUTOMATED_CELL_GUIDE[part].center, C.AUTOMATED_CELL_GUIDE[part].size));
    return out;
}

/** Default portrait projection (same camera maths as the Robot Line test; the camera is untouched). */
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

function stateWithCell(level: number | null): GameState {
    const state = createFreshGameState();
    state.run.producers['automated_cell'] = level === null ? { level: 0, isUnlocked: true, isBuilt: false } : { level, isUnlocked: true, isBuilt: level > 0 };
    return state;
}

const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

// ---------------------------------------------------------------------------------------------------------------
// Scene / assets

test('AUT-043 FactoryWorld serializes automatedCellPrefabs index-aligned with the layout, AUT-032 assets only', () => {
    const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
    const holders = scene.filter((entry: any) => Array.isArray(entry?.automatedCellPrefabs));
    assert.equal(holders.length, 1, 'exactly one serialized automatedCellPrefabs list');
    assert.equal(holders[0].__type__, scene.find((entry: any) => Array.isArray(entry?.factoryPrefabs)).__type__, 'held by FactoryWorldBootstrap');
    assert.ok(Array.isArray(holders[0].assemblyPrefabs) && Array.isArray(holders[0].robotLinePrefabs), 'the AUT-039 / AUT-042 lists are untouched');
    assert.equal(holders[0].robotLinePrefabs.length, 8);
    const prefabs = gltfScenePrefabs(artRoot);
    const uuids = holders[0].automatedCellPrefabs.map((ref: any) => ref.__uuid__);
    assert.equal(uuids.length, C.AUTOMATED_CELL_PREFAB_SLOTS.length);
    C.AUTOMATED_CELL_PREFAB_SLOTS.forEach((slot, index) => {
        assert.equal(uuids[index], C.AUTOMATED_CELL_ASSET_REFERENCES[slot], `${slot} at index ${index}`);
        assert.equal(prefabs.get(uuids[index])?.file, EXPECTED_ASSET_FILES[slot], `${slot} resolves to ${prefabs.get(uuids[index])?.file}`);
    });
    const forbidden = ['pipe-large.glb', 'conveyor-junction-t.glb', 'machine-bed.glb', 'screen-panel-wide.glb', 'conveyor-corner.glb'];
    for (const uuid of uuids) assert.ok(!forbidden.includes(prefabs.get(uuid)?.file ?? ''), `forbidden asset ${prefabs.get(uuid)?.file}`);
    const doc = read('docs/AUT-032_3D_ASSET_ROBOT_SPIKE.md');
    for (const file of Object.values(EXPECTED_ASSET_FILES)) assert.ok(doc.includes(file), `${file} is in the AUT-032 inventory`);
    assert.equal(readdirSync(factoryDir).filter((name) => name.endsWith('.glb')).length, 12, 'no new asset files');
    assert.equal(holders[0].robotPrefab?.__uuid__, 'a0320000-0000-4000-8000-000000000003@68751');
    // Module -> slot mapping: only existing slots; walls share the structure frame; Robot.glb is never a static module.
    for (const slot of Object.values(C.AUTOMATED_CELL_MODULE_PREFAB)) assert.ok(C.AUTOMATED_CELL_PREFAB_SLOTS.includes(slot as any));
    assert.deepEqual(Object.keys(C.AUTOMATED_CELL_MODULE_TRANSFORMS).sort(), [...C.AUTOMATED_CELL_MODULE_IDS].filter((id) => id !== 'foundation_slab').sort());
});

// ---------------------------------------------------------------------------------------------------------------
// Owner zone-rect shift

test('AUT-043 zone rect shift: AutomatedCell sits on the on-screen free ground south of the spine, clear of every other zone', () => {
    assert.deepEqual({ ...ZONE_LAYOUT.AutomatedCell }, { x: 2.3, z: 1.9, width: 2.0, depth: 1.7 });
    const rect = (id: keyof typeof ZONE_LAYOUT) => {
        const z = ZONE_LAYOUT[id];
        return { minX: z.x - (z.width / 2), maxX: z.x + (z.width / 2), minZ: z.z - (z.depth / 2), maxZ: z.z + (z.depth / 2) };
    };
    const cell = rect('AutomatedCell');
    assert.deepEqual([cell.minX, cell.maxX, cell.minZ, cell.maxZ].map((v) => Math.round(v * 1000) / 1000), [1.3, 3.3, 1.05, 2.75]);
    for (const id of factoryZoneIds(ZONE_LAYOUT)) {
        if (id === 'AutomatedCell') continue;
        const other = rect(id);
        const separated = cell.maxX <= other.minX || cell.minX >= other.maxX || cell.maxZ <= other.minZ || cell.minZ >= other.maxZ;
        assert.ok(separated, `AutomatedCell zone does not overlap ${id}`);
    }
    assert.ok(cell.minZ > rect('RobotLine').maxZ, 'south of the Robot Line zone (z <= 0.55) and the spine (z <= 0.05)');
    assert.ok(cell.maxZ < rect('AdvancedRoboticsComplex').minZ, 'north of the ARC zone (z >= 3.25)');
    // The scene node and the zone rect agree (createZones reads the same layout at runtime).
    const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
    const node = scene.find((entry: any) => entry?._name === 'Zone_AutomatedCell');
    assert.deepEqual([node._lpos.x, node._lpos.y, node._lpos.z], [ZONE_LAYOUT.AutomatedCell.x, 0, ZONE_LAYOUT.AutomatedCell.z]);
    // The selectable target (position = zone centre, scale = width x 1 x depth) picks the cell at its new centre and not at the old one.
    const targets = factoryZoneIds(ZONE_LAYOUT).map((id) => ({ id, position: { x: ZONE_LAYOUT[id]!.x, y: 0.2, z: ZONE_LAYOUT[id]!.z }, scale: { x: ZONE_LAYOUT[id]!.width, y: 1, z: ZONE_LAYOUT[id]!.depth } }));
    const down = (x: number, z: number) => pickSelectionTarget({ o: { x, y: 9, z }, d: { x: 0, y: -1, z: 0 } }, targets).hit;
    assert.equal(down(2.3, 1.9), 'AutomatedCell');
    assert.equal(down(3.2, 2.7), 'AutomatedCell');
    assert.equal(down(6.2, 3.2), null, 'the old centre is no longer a producer');
    assert.equal(down(2.3, 0.2), 'RobotLine', 'the Robot Line zone is still picked south of the spine');
    // The AUT-033 shell is a child of the zone, sized from the layout (relocated with the zone).
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /`\$\{zoneId\}_InactiveShell`, new Vec3\(layout\.width \* 0\.48, 0\.8, layout\.depth \* 0\.42\), new Vec3\(0, 0\.46, 0\)/);
    assert.match(bootstrap, /zone\.setPosition\(layout\.x, 0, layout\.z\)/);
});

test('AUT-043 zone rect shift: pan bounds stay valid (inside the global focus bounds, containing the default focus)', () => {
    const build = (state: GameState, id: string, level: number): void => { state.run.producers[id] = { level, isUnlocked: level > 0, isBuilt: level > 0 }; };
    const state = createFreshGameState();
    build(state, 'fabricator', 60);
    build(state, 'assembly_station', 30);
    build(state, 'robot_line', 5);
    const zones = resolveUnlockedCameraZones(repository, state, ZONE_LAYOUT);
    const available = evaluateProducerBuildProgression(repository, state, 'automated_cell').status === 'available';
    assert.equal(zones.includes('AutomatedCell'), available, 'the Automated Cell zone follows the authoritative progression');
    const global = DEFAULT_CAMERA_TUNING.focusBounds;
    const bounds = resolveCameraPanBounds(repository, state, ZONE_LAYOUT, 1);
    assert.ok(bounds.minX >= global.minX && bounds.maxX <= global.maxX && bounds.minZ >= global.minZ && bounds.maxZ <= global.maxZ);
    assert.ok(bounds.minX <= -2.5 && bounds.maxX >= -2.5 && bounds.minZ <= 0 && bounds.maxZ >= 0, 'the default focus (-2.5, 0) is inside the pan bounds');
    // With the cell built, the bounds cover the new zone plus the 1 unit margin and nothing beyond the Robot Line / cell union.
    build(state, 'automated_cell', 1);
    const withCell = resolveCameraPanBounds(repository, state, ZONE_LAYOUT, 1);
    assert.ok(withCell.minX <= 1.3 - 1 && withCell.maxX >= 3.3 + 1 && withCell.minZ <= 1.05 - 1 && withCell.maxZ >= 2.75 + 1);
    assert.equal(withCell.maxX, Math.max(RL_ZONE_MAX_X + 1, 3.3 + 1), 'the east extent is now the Robot Line zone, not the old off-screen cell');
    assert.equal(resolveCameraPanBounds(repository, state, ZONE_LAYOUT, 1).maxZ, 2.75 + 1);
});
const RL_ZONE_MAX_X = ZONE_LAYOUT.RobotLine.x + (ZONE_LAYOUT.RobotLine.width / 2);

// ---------------------------------------------------------------------------------------------------------------
// Layout geometry (measured GLB bounds)

test('AUT-043 measured GLB facts the layout relies on', () => {
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
    // Belt top and hopper seat are derived from those facts.
    assert.ok(Math.abs(C.AUTOMATED_CELL_BELT_TOP - (0.16 + (conveyor.max[1] * C.AUTOMATED_CELL_BELT_SCALE))) < 1e-6);
    const core = C.AUTOMATED_CELL_MODULE_TRANSFORMS.core;
    assert.ok(Math.abs(C.AUTOMATED_CELL_MODULE_TRANSFORMS.hopper.position.y - (core.position.y + (machine.max[1] * core.scale))) < 2e-3, 'the hopper sits on the core roof (machine top measured 1.29975)');
});

test('AUT-043 modules rest on the slab, stay at most 1.35 high (above the Robot Line, below the press), and do not interpenetrate', () => {
    const boxes = composition();
    const slab = boxes.get('foundation_slab')!;
    assert.ok(Math.abs(slab.max.y - SHELL_FLOOR.slabTop) < EPS && Math.abs(C.AUTOMATED_CELL_FLOOR.slabTop - SHELL_FLOOR.slabTop) < EPS);
    assert.deepEqual([slab.min.x, slab.max.x, slab.min.z, slab.max.z].map((v) => Math.round(v * 1000) / 1000), [1.45, 3.15, 1.1, 2.6]);
    let tallest = 0;
    for (const [id, box] of boxes) {
        if (id === 'foundation_slab') continue;
        assert.ok(box.min.x >= slab.min.x - EPS && box.max.x <= slab.max.x + EPS && box.min.z >= slab.min.z - EPS && box.max.z <= slab.max.z + EPS, `${id} on the slab`);
        assert.ok(box.max.y <= CELL_MAX_HEIGHT + EPS, `${id} top ${box.max.y.toFixed(3)} <= ${CELL_MAX_HEIGHT}`);
        assert.ok(box.max.y < PRESS_TOP, `${id} below the Fabricator press`);
        tallest = Math.max(tallest, box.max.y);
        const expectedBase = id === 'hopper' ? 0.81 : C.AUTOMATED_CELL_FLOOR.slabTop;
        assert.ok(Math.abs(box.min.y - expectedBase) < EPS, `${id} rests on its seat (min y ${box.min.y})`);
    }
    assert.ok(tallest >= ROBOT_LINE_TOP - 0.05 && tallest <= CELL_MAX_HEIGHT, `the walls (${tallest.toFixed(3)}) reach the Robot Line top (${ROBOT_LINE_TOP}) and stay under the cap`);
    // Declared contacts: the conveyors butt into the core and the hopper sits on its roof (all are face contacts at eps 1e-3).
    const ids = [...boxes.keys()].filter((id) => id !== 'foundation_slab');
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
        assert.ok(!overlap(boxes.get(ids[i])!, boxes.get(ids[j])!), `${ids[i]} vs ${ids[j]}`);
    }
    // The conveyors touch the core front face (z) and the slab front edge.
    const core = boxes.get('core')!;
    for (const id of ['conveyor_in', 'conveyor_out']) {
        assert.ok(Math.abs(boxes.get(id)!.max.z - core.min.z) < 1e-6, `${id} butts into the core`);
        assert.ok(Math.abs(boxes.get(id)!.min.y - 0.16) < EPS && Math.abs(boxes.get(id)!.max.y - C.AUTOMATED_CELL_BELT_TOP) < 1e-6);
    }
    // Walls stand on the -x and +z sides; the +x / -z (camera) side stays open.
    const wallWest = boxes.get('wall_west')!;
    const wallBack = boxes.get('wall_back')!;
    assert.ok(wallWest.max.x <= core.min.x - 0.2 && wallBack.min.z >= core.max.z + 0.05, 'walls behind the core');
    for (const id of ['arm_1', 'arm_3']) assert.ok(boxes.get(id)!.min.x >= core.max.x, `${id} on the open +x side`);
    // Silhouette contrast with the long, low Robot Line: compact, walled, vertical, dense.
    const footprintW = slab.max.x - slab.min.x;
    const footprintD = slab.max.z - slab.min.z;
    const lineW = RL.ROBOT_LINE_FOUNDATION_SLAB.size.x;
    assert.ok(Math.max(footprintW, footprintD) / Math.min(footprintW, footprintD) < 1.3, 'near-square footprint');
    assert.ok(RL.ROBOT_LINE_FOUNDATION_SLAB.size.x / RL.ROBOT_LINE_FOUNDATION_SLAB.size.z > 2, 'the Robot Line stays long and low');
    assert.ok(footprintW < lineW / 2, 'the cell is less than half the Robot Line length');
    assert.ok(tallest / Math.max(footprintW, footprintD) > 0.6, 'the cell is vertical relative to its footprint');
});

test('AUT-043 arm swing (+-15 deg), lamps, hopper and items fit inside the composition', () => {
    const boxes = composition();
    const arms = ['arm_1', 'arm_2', 'arm_3'] as const;
    for (const arm of arms) {
        const swing = swingBox(arm);
        for (const [id, box] of boxes) {
            if (id === 'foundation_slab' || id === arm) continue;
            assert.ok(!overlap(swing, box), `${arm} swing vs ${id}`);
        }
        const slab = boxes.get('foundation_slab')!;
        assert.ok(swing.min.x >= slab.min.x && swing.max.x <= slab.max.x && swing.min.z >= slab.min.z && swing.max.z <= slab.max.z, `${arm} swing stays on the slab`);
    }
    for (const [id, lamp] of lampBoxes()) {
        assert.ok(lamp.max.y <= CELL_MAX_HEIGHT);
        for (const [other, box] of boxes) {
            if (other === 'foundation_slab') continue;
            assert.ok(!overlap(lamp, box), `${id} vs ${other}`);
        }
        for (const arm of arms) assert.ok(!overlap(lamp, swingBox(arm)), `${id} vs ${arm} swing`);
        const slab = boxes.get('foundation_slab')!;
        if (lamp.max.y < 0.4) assert.ok(Math.abs(lamp.min.y - slab.max.y) < 0.05, `${id} stands on the slab`);
    }
    assert.equal(C.AUTOMATED_CELL_LV1_LAMPS.length, 4);
    assert.equal(C.AUTOMATED_CELL_LAMP_IDS.length, 6);
    // Items: the finished robot stays under 1.35 and below the walls; boxes are narrower than the belt.
    assert.ok(P.AUTOMATED_CELL_ITEM_MAX_TOP < CELL_MAX_HEIGHT && P.AUTOMATED_CELL_ITEM_MAX_TOP < PRESS_TOP, `robot on belt top ${P.AUTOMATED_CELL_ITEM_MAX_TOP}`);
    const boxBounds = glbBounds('box-large.glb');
    const beltWidth = C.AUTOMATED_CELL_BELT_SCALE;
    assert.ok((boxBounds.max[0] - boxBounds.min[0]) * C.AUTOMATED_CELL_BOX_SCALE < beltWidth && (boxBounds.max[2] - boxBounds.min[2]) * C.AUTOMATED_CELL_BOX_SCALE < beltWidth);
    // A fully visible job stays on the belts, clear of the arms.
    const conveyorIn = boxes.get('conveyor_in')!;
    const conveyorOut = boxes.get('conveyor_out')!;
    for (let t = 0; t < 4.8; t += 0.02) {
        const job = P.sampleCellJob(t, 0, 2, 4.8);
        if (job.box.visibility >= 0.95) {
            const half = (boxBounds.max[0] - boxBounds.min[0]) * C.AUTOMATED_CELL_BOX_SCALE / 2;
            assert.ok(job.box.x - half >= conveyorIn.min.x && job.box.x + half <= conveyorIn.max.x, 'box inside the input belt width');
            assert.ok(job.box.z - ((boxBounds.max[2] - boxBounds.min[2]) * C.AUTOMATED_CELL_BOX_SCALE / 2) >= 1.1 - 1e-6, 'box starts on the slab');
        }
        if (job.robot.visibility >= 0.95) {
            assert.ok(job.robot.x >= conveyorOut.min.x && job.robot.x <= conveyorOut.max.x && job.robot.z >= 1.1, 'robot on the output belt');
            assert.ok(job.robot.x + 0.04 < swingBox('arm_1').min.x, 'robot (about 0.5 x 0.12 = 0.06 wide, Robot.glb body +-0.25 at unit scale) clear of the arm 1 swing');
        }
    }
});

test('AUT-043 footprint: inside the cell zone, clear of the Robot Line, the ARC zone, the spine, the storage crate and the Line -> Storage lane', () => {
    const zone = ZONE_LAYOUT.AutomatedCell;
    const zoneBox: Box = { min: { x: zone.x - (zone.width / 2), y: -1, z: zone.z - (zone.depth / 2) }, max: { x: zone.x + (zone.width / 2), y: 10, z: zone.z + (zone.depth / 2) } };
    const all = new Map<string, Box>([...composition(), ...lampBoxes()]);
    const spine: Box = { min: { x: -6.3, y: 0.12, z: -0.65 }, max: { x: 6.7, y: 0.24, z: 0.05 } };
    const crateBox = worldBox(ASSEMBLY_MODULE_TRANSFORMS.storage_crate, glbBounds('box-large.glb'));
    const lineZone = ZONE_LAYOUT.RobotLine;
    const arc = ZONE_LAYOUT.AdvancedRoboticsComplex;
    for (const [id, box] of all) {
        assert.ok(box.min.x >= zoneBox.min.x - EPS && box.max.x <= zoneBox.max.x + EPS && box.min.z >= zoneBox.min.z - EPS && box.max.z <= zoneBox.max.z + EPS, `${id} inside the zone`);
        assert.ok(box.min.z >= (lineZone.z + (lineZone.depth / 2)) + 0.5, `${id} clear of the Robot Line zone (z <= 0.55) and the lane z 0.3..0.7`);
        assert.ok(box.max.z <= (arc.z - (arc.depth / 2)) - 0.4, `${id} clear of the ARC zone (z >= 3.25)`);
        assert.ok(!overlap(box, spine), `${id} clear of the spine`);
        assert.ok(!overlap(box, worldBox(ASSEMBLY_MODULE_TRANSFORMS.storage_crate, glbBounds('box-large.glb'))), `${id} clear of the storage crate`);
        assert.ok(box.min.x > crateBox.max.x + 1, `${id} east of the storage crate`);
    }
    // The Robot Line slab and the exit crossing do not touch the cell footprint.
    const lineSlab = boxOf(RL.ROBOT_LINE_FOUNDATION_SLAB.center, RL.ROBOT_LINE_FOUNDATION_SLAB.size);
    for (const [id, box] of all) assert.ok(!overlap(box, lineSlab), `${id} vs the Robot Line slab`);
    for (const stop of RL.ROBOT_LINE_FLOOR ? [{ x: 4.3, z: -0.3 }, { x: 4.1, z: 0.3 }, { x: 3.9, z: 0.55 }] : []) {
        const inside = [...all.values()].some((box) => stop.x > box.min.x && stop.x < box.max.x && stop.z > box.min.z && stop.z < box.max.z);
        assert.ok(!inside, `exit crossing stop (${stop.x}, ${stop.z}) is outside the cell`);
    }
    // floorHeightAt knows the cell slab (0.16) and the zone foundation (0.12).
    assert.equal(floorHeightAt(2.3, 1.9), 0.16);
    assert.equal(floorHeightAt(3.25, 1.9), 0.12, 'zone foundation east of the slab');
    assert.equal(floorHeightAt(2.3, 1.07), 0.12, 'zone foundation south of the slab');
    assert.equal(floorHeightAt(2.3, 0.9), 0);
    assert.equal(floorHeightAt(3.0, -1.9), 0.16, 'the Robot Line slab is unchanged');
    assert.equal(floorHeightAt(5.9, -1.9), 0.12);
    assert.equal(floorHeightAt(5.0, -0.3), 0.24);
});

test('AUT-043 guide strip: flat, between the Line -> Storage lane and the cell, joins the cell output, ends short of the crate', () => {
    const guides = guideBoxes();
    const strip = guides.get('guide_strip')!;
    const stub = guides.get('guide_stub')!;
    assert.ok(Math.abs(strip.max.x - 3.6) < 1e-6 && Math.abs(strip.min.x - -0.1) < 1e-6, 'x 3.6 .. -0.1');
    assert.ok(Math.abs(((strip.min.z + strip.max.z) / 2) - 0.95) < EPS && Math.abs((strip.max.x - strip.min.x) - 3.7) < 1e-6 && Math.abs((strip.max.z - strip.min.z) - 0.12) < 1e-6, '0.12 wide at z 0.95');
    for (const box of guides.values()) assert.ok(box.max.y <= 0.04 + EPS && box.min.y >= 0, 'flat on the ground');
    assert.ok(strip.min.z >= 0.7 + 0.1, 'south of the Line -> Storage lane (z 0.3..0.7)');
    assert.ok(strip.max.z < ZONE_LAYOUT.AutomatedCell.z - (ZONE_LAYOUT.AutomatedCell.depth / 2), 'the strip itself is outside the cell zone');
    const crateBox = worldBox(ASSEMBLY_MODULE_TRANSFORMS.storage_crate, glbBounds('box-large.glb'));
    assert.ok(strip.min.x > crateBox.max.x, 'ends short of the crate face');
    // The stub joins the output conveyor axis (x 2.7) to the strip and reaches the slab edge.
    assert.ok(Math.abs(((stub.min.x + stub.max.x) / 2) - C.AUTOMATED_CELL_MODULE_TRANSFORMS.conveyor_out.position.x) < EPS);
    assert.ok(stub.min.z <= strip.max.z + EPS && Math.abs(stub.max.z - 1.1) < 1e-6, 'stub from the strip to the slab edge');
    assert.deepEqual(C.AUTOMATED_CELL_GUIDE_OFF_COLOR, { r: 43, g: 49, b: 52 }, 'graphite');
    // ~40% of cyan 82,206,224 over graphite.
    const cyan = { r: 82, g: 206, b: 224 };
    for (const key of ['r', 'g', 'b'] as const) {
        const expected = C.AUTOMATED_CELL_GUIDE_OFF_COLOR[key] + (0.4 * (cyan[key] - C.AUTOMATED_CELL_GUIDE_OFF_COLOR[key]));
        assert.ok(Math.abs(C.AUTOMATED_CELL_GUIDE_ON_COLOR[key] - expected) <= 1, `guide on colour ${key}`);
    }
});

test('AUT-043 the whole composition is on screen at the default portrait view and in the reveal focus; tall elements keep screen x >= -0.93', () => {
    const boxes = new Map<string, Box>([...composition(), ...lampBoxes(), ...guideBoxes(), ['swing_arm_1', swingBox('arm_1')], ['swing_arm_2', swingBox('arm_2')], ['swing_arm_3', swingBox('arm_3')]]);
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const focusDistance = Number(bootstrap.match(/controller\.focusDistance = ([\d.]+);/)![1]);
    const views = { default: defaultView(), reveal: camera(focusDistance, C.AUTOMATED_CELL_REVEAL_TARGET) };
    for (const [name, project] of Object.entries(views)) {
        for (const [id, b] of boxes) {
            for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
                const p = project(x, y, z);
                assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: ${id} corner on screen (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
                if (b.max.y > 0.5) assert.ok(p.x >= TALL_SCREEN_MIN_X, `${name}: tall ${id} corner at screen x ${p.x.toFixed(3)} >= ${TALL_SCREEN_MIN_X}`);
            }
        }
        // The zone footprint itself (the selection target and the shell) is on screen too.
        const z = ZONE_LAYOUT.AutomatedCell;
        for (const x of [z.x - (z.width / 2), z.x + (z.width / 2)]) for (const zz of [z.z - (z.depth / 2), z.z + (z.depth / 2)]) {
            const p = project(x, 0, zz);
            assert.ok(Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 1, `${name}: zone corner (${x}, ${zz}) on screen`);
        }
    }
    assert.deepEqual(C.AUTOMATED_CELL_REVEAL_TARGET, { x: 2.3, y: 0.5, z: 1.9 });
    // The reveal target sits on the cell.
    const slab = boxes.get('foundation_slab')!;
    assert.ok(C.AUTOMATED_CELL_REVEAL_TARGET.x > slab.min.x && C.AUTOMATED_CELL_REVEAL_TARGET.x < slab.max.x && C.AUTOMATED_CELL_REVEAL_TARGET.z > slab.min.z && C.AUTOMATED_CELL_REVEAL_TARGET.z < slab.max.z);
});

// ---------------------------------------------------------------------------------------------------------------
// Resolver

test('AUT-043 resolver: unbuilt, Lv1, Lv10, Lv25+, Reboot', () => {
    const unbuilt = resolveAutomatedCellVisualState(stateWithCell(null));
    assert.equal(unbuilt.phase, 'unbuilt');
    assert.equal(unbuilt.constructed, false);
    assert.equal(unbuilt.placeholderVisible, true);
    assert.deepEqual([unbuilt.modules, unbuilt.litLamps, unbuilt.poolSize, unbuilt.cycleSeconds, unbuilt.guideLit], [[], [], 0, 0, false]);
    assert.deepEqual(resolveAutomatedCellVisualState(createFreshGameState()), unbuilt, 'no automated_cell entry at all = unbuilt');

    const lv1 = resolveAutomatedCellVisualState(stateWithCell(1));
    assert.equal(lv1.phase, 'cell_lv1');
    assert.deepEqual(lv1.modules, ['foundation_slab', 'wall_west', 'wall_back', 'conveyor_in', 'conveyor_out', 'core', 'arm_1', 'arm_2']);
    assert.deepEqual(lv1.litLamps, ['input', 'output', 'core', 'arm_1']);
    assert.deepEqual([lv1.poolSize, lv1.cycleSeconds, lv1.armPeriodSeconds, lv1.placeholderVisible, lv1.guideLit], [2, 4.8, 2.4, false, true]);

    for (const level of [10, 25, 100]) {
        const lv10 = resolveAutomatedCellVisualState(stateWithCell(level));
        assert.equal(lv10.phase, 'cell_lv10', `Lv${level}`);
        assert.deepEqual(lv10.modules, ['foundation_slab', 'wall_west', 'wall_back', 'conveyor_in', 'conveyor_out', 'core', 'arm_1', 'arm_2', 'arm_3', 'hopper']);
        assert.deepEqual(lv10.litLamps, ['input', 'output', 'core', 'arm_1', 'arm_3', 'hopper']);
        assert.deepEqual([lv10.poolSize, lv10.cycleSeconds, lv10.armPeriodSeconds, lv10.guideLit], [3, 3.6, 1.9, true]);
    }
    assert.equal(resolveAutomatedCellVisualState(stateWithCell(9)).phase, 'cell_lv1');
    // Lv25+ keep the Lv10 composition exactly.
    assert.deepEqual(resolveAutomatedCellVisualState(stateWithCell(25)), { ...resolveAutomatedCellVisualState(stateWithCell(10)), level: 25 });
    // Built flag without a level (or a level without the flag) is not a built cell.
    assert.equal(resolveAutomatedCellVisualState({ ...createFreshGameState(), run: { ...createFreshGameState().run, producers: { automated_cell: { level: 3, isUnlocked: true, isBuilt: false } } } } as GameState).phase, 'unbuilt');
    // Reboot: the producer is gone again.
    assert.equal(resolveAutomatedCellVisualState(createFreshGameState()).phase, 'unbuilt');
    // Every module of every phase is a known id in canonical (construction) order: slab -> walls -> conveyors -> core -> arms.
    for (const level of [1, 10]) {
        const modules = resolveAutomatedCellVisualState(stateWithCell(level)).modules;
        assert.deepEqual([...modules], C.AUTOMATED_CELL_MODULE_IDS.filter((id) => modules.includes(id)));
    }
    assert.deepEqual([...C.AUTOMATED_CELL_MODULE_IDS].slice(0, 6), ['foundation_slab', 'wall_west', 'wall_back', 'conveyor_in', 'conveyor_out', 'core']);
    // Lv10 is strictly richer than Lv1 and faster.
    assert.ok(resolveAutomatedCellVisualState(stateWithCell(10)).cycleSeconds < lv1.cycleSeconds && resolveAutomatedCellVisualState(stateWithCell(10)).armPeriodSeconds < lv1.armPeriodSeconds);
});

test('AUT-043 resolver is deterministic and leaves the state untouched', () => {
    const state = stateWithCell(10);
    const before = JSON.stringify(state);
    assert.deepEqual(resolveAutomatedCellVisualState(state), resolveAutomatedCellVisualState(state));
    assert.equal(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------------------------------------------
// Production model

test('AUT-043 production: periodic per cycle, staggered slots, box -> dwell -> robot, scale-hide at both ends', () => {
    assert.ok(P.AUTOMATED_CELL_JOB_SECONDS <= 3.6, 'a job fits inside the shortest cycle (Lv10)');
    assert.equal(P.AUTOMATED_CELL_DWELL_SECONDS, 1.2);
    for (const [pool, cycle] of [[2, 4.8], [3, 3.6]] as const) {
        const seen = new Map<number, number>();
        for (let t = 0; t < cycle * 4; t += 0.02) {
            for (const job of P.sampleCellJobs(t, pool, cycle)) {
                assert.ok(job.box.visibility >= 0 && job.box.visibility <= 1 && job.robot.visibility >= 0 && job.robot.visibility <= 1);
                assert.ok(!(job.box.visibility > 0 && job.robot.visibility > 0), 'the box and the robot of one job are never visible together (the dwell hides inside the core)');
                assert.equal(job.box.y, C.AUTOMATED_CELL_BELT_TOP);
                assert.equal(job.robot.y, C.AUTOMATED_CELL_BELT_TOP);
                assert.equal(job.box.x, C.AUTOMATED_CELL_MODULE_TRANSFORMS.conveyor_in.position.x);
                assert.equal(job.robot.x, C.AUTOMATED_CELL_MODULE_TRANSFORMS.conveyor_out.position.x);
                assert.ok(job.box.z >= P.AUTOMATED_CELL_BELT_START_Z - EPS && job.box.z <= P.AUTOMATED_CELL_BELT_END_Z + EPS);
                assert.ok(job.robot.z >= P.AUTOMATED_CELL_ROBOT_EXIT_Z - EPS && job.robot.z <= P.AUTOMATED_CELL_BELT_END_Z + EPS);
                assert.equal(job.robotHeadingDeg, 180, 'leaves toward the camera side');
                seen.set(job.slot, Math.max(seen.get(job.slot) ?? 0, job.cycle));
            }
        }
        for (const cycles of seen.values()) assert.ok(cycles >= 3 && cycles <= 5, `pool ${pool}: cycles ${cycles}`);
        // Periodic: one cycle later the sample is identical (up to the counter).
        const a = P.sampleCellJobs(0.37, pool, cycle);
        const b = P.sampleCellJobs(0.37 + cycle, pool, cycle);
        a.forEach((job, i) => {
            assert.ok(Math.abs(job.box.z - b[i].box.z) < 1e-9 && Math.abs(job.box.visibility - b[i].box.visibility) < 1e-9);
            assert.ok(Math.abs(job.robot.z - b[i].robot.z) < 1e-9 && Math.abs(job.robot.visibility - b[i].robot.visibility) < 1e-9);
            assert.equal(b[i].cycle, job.cycle + 1);
        });
        // Slots are evenly staggered across the cycle.
        for (let slot = 0; slot < pool; slot += 1) assert.ok(Math.abs(P.cellSlotOffsetSeconds(slot, pool, cycle) - ((slot * cycle) / pool)) < 1e-12);
    }
    // Timeline of one job (slot 0 starts at clock 0): ride 0..1.0, dwell 1.0..2.2, robot 2.2..3.4.
    const at = (t: number) => P.sampleCellJob(t, 0, 2, 4.8);
    assert.equal(at(0).box.visibility, 0, 'the box scales in at the belt start');
    assert.equal(at(0.5).box.visibility, 1);
    assert.ok(at(0.99).box.visibility < 0.1, 'the box scale-hides into the core');
    assert.equal(at(1.0).box.visibility + at(1.0).robot.visibility, 0, 'the dwell shows nothing');
    assert.equal(at(2.19).box.visibility + at(2.19).robot.visibility, 0);
    assert.equal(at(2.2).robot.visibility, 0, 'the robot scales up at the output belt after the 1.2 s dwell');
    assert.equal(at(2.8).robot.visibility, 1);
    assert.ok(at(2.8).robot.z < at(2.4).robot.z, 'the robot slides out toward z 1.05');
    assert.ok(at(3.39).robot.visibility < 0.1 && at(3.39).robot.z < 1.06, 'and scale-hides at the exit');
    assert.equal(at(4.0).box.visibility + at(4.0).robot.visibility, 0, 'idle until the next cycle');
    assert.equal(P.sampleCellJobs(1, 9, 4.8).length, P.AUTOMATED_CELL_POOL_LIMIT, 'the pool never exceeds 3');
    assert.equal(P.sampleCellJobs(1, 0, 4.8).length, 0);
    assert.equal(P.advanceCellClock(2, -5), 2);
    assert.equal(P.advanceCellClock(2, Number.NaN), 2);
    assert.equal(P.advanceCellClock(2, 0.5), 2.5);
});

test('AUT-043 arms run a deterministic timer cycle (Lv1 2.4 s, Lv10 1.9 s), bounded, with the intended phase offsets', () => {
    assert.deepEqual([...P.AUTOMATED_CELL_ARM_PHASE_OFFSETS], [0, 0.5, 1 / 3]);
    for (const period of [2.4, 1.9]) {
        for (let t = 0; t < period * 2; t += 0.05) {
            for (const arm of [0, 1, 2]) {
                const pose = P.sampleCellArmPose(t, arm, period);
                assert.deepEqual(pose, P.sampleCellArmPose(t, arm, period));
                assert.ok(Math.abs(pose.yawDeg) <= 15 + EPS && pose.pitchDeg >= 0 && pose.pitchDeg <= 3 + EPS);
                const later = P.sampleCellArmPose(t + period, arm, period);
                assert.ok(Math.abs(later.yawDeg - pose.yawDeg) < 1e-6 && Math.abs(later.pitchDeg - pose.pitchDeg) < 1e-6, 'periodic');
            }
        }
        // Arm 2 is half a period out of phase with arm 1: opposite yaw.
        for (let t = 0; t < period; t += 0.1) assert.ok(Math.abs(P.sampleCellArmPose(t, 0, period).yawDeg + P.sampleCellArmPose(t, 1, period).yawDeg) < 1e-9);
        // Arm 3 is offset by a third of a period.
        assert.ok(Math.abs(P.sampleCellArmPose(0, 2, period).yawDeg - (Math.sin(Math.PI * 2 / 3) * 15)) < 1e-9);
    }
    let maxYaw = 0;
    for (let t = 0; t < 2.4; t += 0.01) maxYaw = Math.max(maxYaw, Math.abs(P.sampleCellArmPose(t, 0, 2.4).yawDeg));
    assert.ok(maxYaw > 14.9, 'the full +-15 deg is reached');
});

test('AUT-043 lamps blink once per cycle, staggered, and are lit most of the time', () => {
    for (const [count, cycle] of [[4, 4.8], [6, 3.6]] as const) {
        for (let lamp = 0; lamp < count; lamp += 1) {
            let lit = 0;
            let steps = 0;
            for (let t = 0; t < cycle; t += 0.01) { steps += 1; if (P.sampleCellLampLit(t, lamp, count, cycle)) lit += 1; }
            const share = lit / steps;
            assert.ok(Math.abs(share - (1 - P.AUTOMATED_CELL_LAMP_BLINK_FRACTION)) < 0.02, `lamp ${lamp}/${count}: lit share ${share}`);
            assert.equal(P.sampleCellLampLit(0.3, lamp, count, cycle), P.sampleCellLampLit(0.3 + cycle, lamp, count, cycle), 'periodic');
        }
        // At any instant at most one lamp is off per blink window (they are staggered).
        for (let t = 0; t < cycle; t += 0.05) assert.ok([...Array(count).keys()].filter((lamp) => !P.sampleCellLampLit(t, lamp, count, cycle)).length <= 1);
    }
});

// ---------------------------------------------------------------------------------------------------------------
// Cell -> Storage route + population

test('AUT-043 cell route: periodic, Walking/Idle only, on the floor, clear of the cell and the crate, on screen, dwells 1 s at the output pad', () => {
    const boxes = new Map<string, Box>([...composition(), ...lampBoxes()]);
    const crate = worldBox(ASSEMBLY_MODULE_TRANSFORMS.storage_crate, glbBounds('box-large.glb'));
    const project = defaultView();
    const CLEARANCE = 0.07;
    const robotTop = 4.513 * 0.24;
    assert.ok(R.AUTOMATED_CELL_LOOP_SECONDS > 6 && R.AUTOMATED_CELL_LOOP_SECONDS < 40, `lap ${R.AUTOMATED_CELL_LOOP_SECONDS.toFixed(1)} s`);
    assert.deepEqual(R.sampleCellLoopPose(1.234), R.sampleCellLoopPose(1.234 + R.AUTOMATED_CELL_LOOP_SECONDS));
    const ids = R.AUTOMATED_CELL_LOOP_ROUTE.map((s) => s.id);
    assert.deepEqual(ids.slice(0, 4), ['cell_pad', 'pad_exit', 'cell_lane', 'storage_pick']);
    const pad = R.AUTOMATED_CELL_LOOP_ROUTE[0];
    assert.ok(Math.abs(pad.x - 2.7) < EPS && Math.abs(pad.z - 1.0) < EPS && pad.dwellSeconds === 1, 'the output pad (2.7, 1.0), 1 s dwell');
    // The robot idles at the pad for exactly its dwell at the start of the lap.
    for (let t = 0.05; t < 0.95; t += 0.05) { const pose = R.sampleCellLoopPose(t); assert.equal(pose.clip, 'Robot_Idle'); assert.ok(Math.abs(pose.x - 2.7) < EPS && Math.abs(pose.z - 1.0) < EPS); }
    assert.equal(R.sampleCellLoopPose(1.05).clip, 'Robot_Walking');
    const lineLane = { min: 0.3, max: 0.7 };
    for (let t = 0; t <= R.AUTOMATED_CELL_LOOP_SECONDS; t += 0.02) {
        const pose = R.sampleCellLoopPose(t);
        assert.ok(['Robot_Walking', 'Robot_Idle'].includes(pose.clip), pose.clip);
        assert.equal(pose.y, floorHeightAt(pose.x, pose.z));
        assert.ok(pose.z > lineLane.max + 0.1, `t=${t.toFixed(2)} stays south of the Line -> Storage lane`);
        for (const [id, b] of [...boxes, ['storage_crate', crate] as [string, Box]]) {
            if (id === 'foundation_slab') continue;
            const inside = pose.x > b.min.x - CLEARANCE && pose.x < b.max.x + CLEARANCE && pose.z > b.min.z - CLEARANCE && pose.z < b.max.z + CLEARANCE;
            assert.ok(!inside, `t=${t.toFixed(2)} (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}) inside ${id}`);
        }
        for (const y of [pose.y, pose.y + robotTop]) {
            const p = project(pose.x, y, pose.z);
            assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, `on screen at t=${t.toFixed(2)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        }
    }
    const pick = R.AUTOMATED_CELL_LOOP_ROUTE.find((s) => s.id === 'storage_pick')!;
    assert.ok(pick.x > crate.max.x && pick.x - crate.max.x < 0.2 && pick.z > crate.min.z && pick.z < crate.max.z, 'pick stop beside the crate face');
});

test('AUT-043 population: a second third (slots 2, 5, 8, ...) takes the Cell loop once the cell is built; Line and Assembly allocations are unchanged', () => {
    // No cell: identical to AUT-042.
    for (let slot = 0; slot < 16; slot += 1) {
        assert.equal(resolvePoolRobotRoute(slot, true), resolvePoolRobotRoute(slot, true, false));
        assert.equal(resolvePoolRobotRoute(slot, false), resolvePoolRobotRoute(slot, false, false));
        assert.equal(resolvePoolRobotRoute(slot, false, false), 'assembly_storage');
    }
    const cell = [...Array(13).keys()].filter((slot) => resolvePoolRobotRoute(slot, true, true) === 'cell_storage');
    assert.deepEqual(cell, [2, 5, 8, 11], 'slots 2, 5, 8, 11 = ranks 3, 6, 9, 12');
    const line = [...Array(13).keys()].filter((slot) => resolvePoolRobotRoute(slot, true, true) === 'line_storage');
    assert.deepEqual(line, [1, 4, 7, 10], 'the Line third is unchanged and disjoint');
    const rest = [...Array(13).keys()].filter((slot) => resolvePoolRobotRoute(slot, true, true) === 'assembly_storage');
    assert.deepEqual(rest, [0, 3, 6, 9, 12], 'the Assembly <-> Storage loop remains for the rest');
    // Cell built without the Line (not reachable by progression, but the allocation must stay consistent).
    assert.deepEqual([...Array(7).keys()].filter((slot) => resolvePoolRobotRoute(slot, false, true) === 'cell_storage'), [2, 5]);
    const poses = (slot: number) => Array.from({ length: 80 }, (_, i) => sampleRobotPoolPose(robotSlotVariation(slot), i * 0.7, 'cell_storage'));
    for (const pose of poses(2)) {
        assert.ok(pose.x > -0.6 && pose.x < 3.1, `cell route x ${pose.x}`);
        assert.ok(pose.z > 0.7 && pose.z < 1.2, `cell route z ${pose.z}`);
        assert.ok(['Robot_Walking', 'Robot_Idle'].includes(pose.clip));
    }
    assert.deepEqual(sampleRobotPoolPose(robotSlotVariation(3), 5), sampleRobotPoolPose(robotSlotVariation(3), 5, 'assembly_storage'), 'default route unchanged');
});

test('AUT-043 population view model: the Automated Cell flag follows the state; Robots Built mapping and pool size are unchanged', () => {
    const withBot = (line: boolean, cell: number | null, built = 100): GameState => {
        const state = stateWithCell(cell);
        state.run.producers['robot_line'] = { level: line ? 1 : 0, isUnlocked: true, isBuilt: line };
        state.run.robotsBuilt = built;
        state.run.progressionFlags['first_robot'] = true;
        return state;
    };
    const vm = new RobotPopulationViewModel();
    const unbuilt = vm.sync(withBot(true, null));
    assert.equal(unbuilt.automatedCellBuilt, false);
    const built = vm.sync(withBot(true, 1));
    assert.equal(built.automatedCellBuilt, true);
    assert.equal(built.robotLineBuilt, true);
    assert.equal(built.changed, true, 'the allocation change is reported');
    assert.equal(built.pooled, unbuilt.pooled, 'no new robots: the Robots Built mapping is unchanged');
    assert.equal(built.visible, unbuilt.visible);
    assert.equal(vm.sync(withBot(true, 1)).changed, false);
    assert.equal(new RobotPopulationViewModel().sync(withBot(true, 10, 1e12)).automatedCellBuilt, true);
    const controller = read('assets/scripts/presentation/RobotPopulationController.ts');
    assert.match(controller, /resolvePoolRobotRoute\(robot\.variation\.slot, this\.robotLineBuilt, this\.automatedCellBuilt\)/);
    assert.match(controller, /route: resolvePoolRobotRoute\(slot, this\.robotLineBuilt, this\.automatedCellBuilt\)/, 'a loaded save starts on the right route (no re-scale)');
    assert.match(controller, /this\.automatedCellBuilt = snapshot\.automatedCellBuilt/);
    assert.doesNotMatch(controller, /instantiate\(this\.robotPrefab\);[\s\S]*instantiate\(this\.robotPrefab\)/, 'still one lazy instantiate site, no extra instances');
});

// ---------------------------------------------------------------------------------------------------------------
// Construction target, reveal hook, no replay

const constructed: DomainEvent = { type: 'producerConstructed', producerId: 'automated_cell', level: 1, source: 'producer_purchase' };

test('AUT-043 construction: plan order slab -> walls -> conveyors -> core -> arms; no replay on load; one activation; Reboot replays', () => {
    const resolve = (producerId: string, state: GameState): readonly string[] => (producerId === 'automated_cell' ? resolveAutomatedCellVisualState(state).modules : []);
    assert.deepEqual(resolve('automated_cell', stateWithCell(1)), ['foundation_slab', 'wall_west', 'wall_back', 'conveyor_in', 'conveyor_out', 'core', 'arm_1', 'arm_2']);

    const loaded = new ConstructionViewModel(resolve);
    assert.deepEqual(loaded.syncFromState(stateWithCell(10)), [], 'a save load never plays the sequence');
    assert.deepEqual(loaded.consumeEvents(stateWithCell(10), [constructed]), []);
    assert.equal(loaded.isActive('automated_cell'), false);

    const live = new ConstructionViewModel(resolve);
    live.syncFromState(stateWithCell(null));
    const started = live.syncFromState(stateWithCell(1));
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].plan.moduleIds, ['foundation_slab', 'wall_west', 'wall_back', 'conveyor_in', 'conveyor_out', 'core', 'arm_1', 'arm_2']);
    assert.deepEqual(live.consumeEvents(stateWithCell(1), [constructed]), [], 'snapshot-before-event ordering plays one sequence');
    let completed = 0;
    for (let i = 0; i < 200; i += 1) completed += live.tick(0.05).completed.filter((id) => id === 'automated_cell').length;
    assert.equal(completed, 1, 'the activation hook fires once');
    // Reboot allows a new sequence.
    live.syncFromState(stateWithCell(null));
    assert.equal(live.consumeEvents(stateWithCell(1), [constructed]).length, 1);
});

test('AUT-043 reveal view model: one bounded focus beat, read-only, no Era change of its own; load never counts', () => {
    const vm = new AutomatedCellRevealViewModel();
    const state = stateWithCell(10);
    const before = JSON.stringify(state);
    assert.equal(vm.syncFromState(state).descriptor.phase, 'cell_lv10');
    assert.equal(vm.consumeEvents(state, [constructed]).descriptor.phase, 'cell_lv10', 'events never start a beat by themselves');
    assert.deepEqual(vm.beginConstructionBeat(), { focusRequested: true });
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual([...AUTOMATED_CELL_STATE_PHASES], ['synced', 'construction_started', 'activated', 'focus_requested', 'item_cycle']);
    const controller = read('assets/scripts/presentation/AutomatedCellVisualController.ts');
    // The beat is only requested from setConstructionSample(non-null) (the live AUT-040 sequence), never from sync on load.
    assert.match(controller, /if \(sample !== null && this\.construction === null\) this\.beatPending = true;/);
    assert.equal((controller.match(/beatPending = true/g) ?? []).length, 1, 'beatPending is raised in exactly one place');
    assert.doesNotMatch(controller.slice(controller.indexOf('public sync('), controller.indexOf('public consumeDomainEvents(')), /beatPending = true|focusOnRevealTarget/, 'sync (load) never focuses');
});

// ---------------------------------------------------------------------------------------------------------------
// Wiring

test('AUT-043 pure modules are engine-free and command-free', () => {
    for (const file of ['AutomatedCellLayout', 'AutomatedCellVisualStateResolver', 'AutomatedCellProduction', 'AutomatedCellExitRoute', 'AutomatedCellRevealViewModel']) {
        const source = read(`assets/scripts/presentation/${file}.ts`);
        assert.doesNotMatch(source, /from 'cc/, `${file} imports cc`);
        assert.doesNotMatch(source, /import[^;]*Commands|\.submit\(|execute\(/, `${file} issues commands`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|readonly|protected)/, `${file}: no constructor parameter properties`);
        assert.match(source, /from '\.{1,2}\/[^']*\.ts';\s*$/m, `${file} uses explicit .ts imports`);
    }
    const state = stateWithCell(10);
    state.run.industrialOutput = 123;
    const before = JSON.stringify(state);
    resolveAutomatedCellVisualState(state);
    P.sampleCellJobs(3, 3, 3.6);
    R.sampleCellLoopPose(3);
    assert.equal(JSON.stringify(state), before);
});

test('AUT-043 bootstrap, registry and construction wiring; scale visibility; reveal API reuse; metas; diagnostics', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /@property\(\[Prefab\]\)\s+public automatedCellPrefabs: Prefab\[\] = \[\];/);
    assert.match(bootstrap, /this\.createAutomatedCellSlice\(site\);/);
    assert.match(bootstrap, /this\.connectAutomatedCellPresentation\(site\);/);
    assert.match(bootstrap, /addComponent\(AutomatedCellVisualController\)/);
    assert.match(bootstrap, /visual\.automatedCellPrefabs = this\.automatedCellPrefabs;/);
    assert.match(bootstrap, /visual\.robotPrefab = this\.robotPrefab;/);
    assert.match(bootstrap, /visual\.focusAnchor = zone\.getChildByName\('AutomatedCell_RevealAnchor'\)/);
    assert.match(bootstrap, /controller\.automatedCellVisual = /);
    assert.match(bootstrap, /construction\.registerTarget\('automated_cell', cellVisual\)/);
    assert.match(bootstrap, /construction\.sparkAnchors\.set\('automated_cell', /);
    assert.match(bootstrap, /registerTarget\('assembly_station', visual\)/, 'the Assembly target stays registered');
    assert.match(bootstrap, /construction\.registerTarget\('robot_line', lineVisual\)/, 'the Robot Line target stays registered');
    const registry = read('assets/scripts/presentation/PresentationController.ts');
    assert.match(registry, /this\.automatedCellVisual\?\.sync\(/);
    assert.match(registry, /this\.automatedCellVisual\?\.consumeDomainEvents\(state, events\)/);
    assert.ok(registry.indexOf('constructionPresentation?.sync(') < registry.indexOf('automatedCellVisual?.sync('), 'construction frame 0 is applied before the cell applies its descriptor');
    assert.ok(registry.indexOf('constructionPresentation?.consumeDomainEvents') < registry.indexOf('automatedCellVisual?.consumeDomainEvents'));
    const controller = read('assets/scripts/presentation/AutomatedCellVisualController.ts');
    assert.match(controller, /implements ConstructionTarget/);
    assert.match(controller, /this\.cameraController\.focusOnRevealTarget\(target\)/, 'reuses the AUT-038 reveal focus API');
    assert.doesNotMatch(controller, /focusOnWorldTarget|snapToWorldTarget|setFocusBounds/, 'no other camera API');
    for (const file of ['AutomatedCellVisualController.ts', 'RobotPopulationController.ts', 'FactoryWorldBootstrap.ts']) {
        assert.doesNotMatch(read(`assets/scripts/presentation/${file}`), /\.active = false/, `${file}: visibility by scale, not node.active`);
    }
    assert.doesNotMatch(controller, /DirectionalLight|SphereLight|SpotLight|addComponent\((\w*Light)/, 'no dynamic lights');
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('automated_cell_state'));
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /AUT-043: Automated Cell:/);
    for (const phase of AUTOMATED_CELL_STATE_PHASES) assert.match(controller, new RegExp(`phase: '${phase}'`), `controller emits ${phase}`);
    // The controller is presentation only: no economy / runtime / save / HUD text.
    assert.doesNotMatch(controller, /GameRuntime|persistence|economy\/|\.submit\(|HudViewModel|PresentationText/);
    // Slab, lamps, guide parts and the reveal anchor are built by the bootstrap with the layout constants.
    assert.match(bootstrap, /AUTOMATED_CELL_FOUNDATION_SLAB/);
    assert.match(bootstrap, /AUTOMATED_CELL_LAMPS\[lampId\]/);
    assert.match(bootstrap, /AUTOMATED_CELL_GUIDE\[part\]/);
    assert.match(bootstrap, /new Color\(82, 206, 224, 255\)/);
    assert.match(bootstrap, /'AutomatedCell_RevealAnchor'/);
    // Metas: unique a0430000 uuids.
    const uuids = new Set<string>();
    for (const file of ['AutomatedCellLayout', 'AutomatedCellVisualStateResolver', 'AutomatedCellProduction', 'AutomatedCellRevealViewModel', 'AutomatedCellVisualController', 'AutomatedCellExitRoute']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript', `${file}.ts.meta`);
        assert.match(meta.uuid, /^a0430000-0000-4000-8000-\d{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 6, 'unique meta uuids');
});

test('AUT-043 the unbuilt placeholder shell is the AUT-033 shell and the controller swaps it by scale', () => {
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.ok(bootstrap.includes('`${zoneId}_InactiveShell`') && bootstrap.includes('`${zoneId}_DisconnectedLogistics`'), 'shell created by createZones');
    assert.deepEqual([...C.AUTOMATED_CELL_PLACEHOLDER_NODE_NAMES], ['AutomatedCell_InactiveShell', 'AutomatedCell_DisconnectedLogistics']);
    assert.match(read('assets/scripts/presentation/AutomatedCellVisualController.ts'), /placeholder\.setScale\(applied, applied, applied\)/);
    // The local conversion maps the new zone origin to the composition anchor.
    assert.deepEqual(C.automatedCellLocal({ x: 2.3, y: 0.5, z: 1.9 }), { x: 0, y: 0.5, z: 0 });
    assert.deepEqual(C.AUTOMATED_CELL_ZONE_ORIGIN, { x: 2.3, y: 0, z: 1.9 });
});
