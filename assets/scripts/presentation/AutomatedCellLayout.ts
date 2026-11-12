import { ZONE_LAYOUT } from './FactoryZoneLayout.ts';
import type { WorldVec3 } from './AssemblySliceLayout.ts';

/**
 * AUT-043 engine-free Automated Cell (Producer #4) layout (presentation only).
 *
 * Art Director intent (2026-11-12): a compact, walled, vertical, dense multi-arm cell that contrasts with the long,
 * low, open Robot Line. Owner decision (2026-11-12): the zone rect moved west from (6.2, 3.2) 4.5 x 4 to the
 * on-screen free ground south of the spine, centre (2.3, 1.9), 2.0 x 1.7 (x 1.3..3.3, z 1.05..2.75; clear of the
 * Robot Line zone z <= 0.55 and the Advanced Robotics Complex z >= 3.25). The camera is not touched.
 * Everything is at most 1.35 high (above the Robot Line, below the Fabricator press 1.505); existing AUT-032 Kenney
 * assets only (no panel, pipe-large, junction-t, machine-bed, no static Robot.glb, no extra arms / walls).
 *
 * The Art Director transforms are proposals; the implementer values below differ by at most 0.1 where the
 * interpenetration / clearance tests required it (see docs/AUT-043_AUTOMATED_CELL_VISUAL.md for each change).
 *
 * Measured AUT-032 GLB facts (POSITION bounds, unit scale, bottom-centre pivots):
 * - machine.glb x -0.6..0.6, y 0..1.3, z -0.75..0.75 (one solid block: the core);
 * - robot-arm-a.glb 1.0 x 3.2 x 1.0, robot-arm-b.glb 1.0 x 3.0 x 1.0 (vertical stacks);
 * - structure-high.glb x -0.15..0.15, y 0..1.5, z -0.55..0.55 (frame, plane along local Z);
 * - conveyor.glb 1.0 x 0.4 x 1.0; hopper-square.glb x/z +-0.5586, y 0..1; box-large.glb 1.1 x 0.55 x 1.0.
 *
 * All coordinates are WORLD (x, y, z). FactoryWorld zones are unrotated and unscaled, so a node under the
 * AutomatedCell composition anchor uses `automatedCellLocal(world)`. The camera sits on the +x / -z side, so the
 * walls stand on the -x and +z sides and the front stays open.
 */

export const AUTOMATED_CELL_PRODUCER_ID = 'automated_cell';

export type AutomatedCellModuleId =
    | 'foundation_slab'
    | 'wall_west'
    | 'wall_back'
    | 'conveyor_in'
    | 'conveyor_out'
    | 'core'
    | 'arm_1'
    | 'arm_2'
    | 'arm_3'
    | 'hopper';

/** Canonical order, also the AUT-040 construction order (slab -> walls -> conveyors -> core -> arms; lamps flicker at activation). */
export const AUTOMATED_CELL_MODULE_IDS: readonly AutomatedCellModuleId[] = Object.freeze([
    'foundation_slab',
    'wall_west',
    'wall_back',
    'conveyor_in',
    'conveyor_out',
    'core',
    'arm_1',
    'arm_2',
    'arm_3',
    'hopper',
]);

/** Prefab slots serialized on FactoryWorldBootstrap (`automatedCellPrefabs`, index-aligned). */
export const AUTOMATED_CELL_PREFAB_SLOTS = Object.freeze([
    'conveyor',
    'machine',
    'arm_a',
    'arm_b',
    'wall_frame',
    'hopper',
    'box',
] as const);

export type AutomatedCellPrefabSlot = typeof AUTOMATED_CELL_PREFAB_SLOTS[number];

/** Imported AUT-032 prefab sub-assets (nothing new). */
export const AUTOMATED_CELL_ASSET_REFERENCES: Readonly<Record<AutomatedCellPrefabSlot, string>> = Object.freeze({
    conveyor: 'a0320000-0000-4000-8000-000000000007@a040b', // conveyor.glb
    machine: 'a0320000-0000-4000-8000-00000000000a@ce0e9', // machine.glb
    arm_a: 'a0320000-0000-4000-8000-00000000000c@ace94', // robot-arm-a.glb
    arm_b: 'a0320000-0000-4000-8000-00000000000d@cb36c', // robot-arm-b.glb
    wall_frame: 'a0320000-0000-4000-8000-00000000000f@5fe1c', // structure-high.glb
    hopper: 'a0320000-0000-4000-8000-000000000008@92950', // hopper-square.glb
    box: 'a0320000-0000-4000-8000-000000000004@2d450', // box-large.glb
});

/** Which prefab slot builds a prefab-backed module (the slab is a primitive). */
export const AUTOMATED_CELL_MODULE_PREFAB: Readonly<Partial<Record<AutomatedCellModuleId, AutomatedCellPrefabSlot>>> = Object.freeze({
    wall_west: 'wall_frame',
    wall_back: 'wall_frame',
    conveyor_in: 'conveyor',
    conveyor_out: 'conveyor',
    core: 'machine',
    arm_1: 'arm_a',
    arm_2: 'arm_a',
    arm_3: 'arm_b',
    hopper: 'hopper',
});

export interface AutomatedCellModuleTransform {
    readonly position: WorldVec3;
    readonly rotationY: number;
    readonly scale: number;
}

/** Floor heights of the Automated Cell area (the shell zone foundation and the grey slab). */
export const AUTOMATED_CELL_FLOOR = Object.freeze({
    foundationTop: 0.12,
    slabTop: 0.16,
});

/** Conveyor.glb is 0.4 high: belt top = slab top + 0.4 x 0.45. */
export const AUTOMATED_CELL_BELT_SCALE = 0.45;
export const AUTOMATED_CELL_BELT_TOP = AUTOMATED_CELL_FLOOR.slabTop + (0.4 * AUTOMATED_CELL_BELT_SCALE);

/** Grey foundation slab (primitive box built by the bootstrap): x 1.45..3.15, z 1.1..2.6, y 0..0.16. */
export const AUTOMATED_CELL_FOUNDATION_SLAB = Object.freeze({
    center: Object.freeze({ x: 2.3, y: 0.08, z: 1.85 }),
    size: Object.freeze({ x: 1.7, y: 0.16, z: 1.5 }),
});

export const AUTOMATED_CELL_MODULE_TRANSFORMS: Readonly<Record<Exclude<AutomatedCellModuleId, 'foundation_slab'>, AutomatedCellModuleTransform>> = Object.freeze({
    // West wall frame (-x side, plane along z): x 1.463..1.697, z 1.121..1.979, top 1.33.
    wall_west: { position: { x: 1.58, y: AUTOMATED_CELL_FLOOR.slabTop, z: 1.55 }, rotationY: 0, scale: 0.78 },
    // Back wall frame (+z side, turned 90): x 1.571..2.429, z 2.363..2.597, top 1.33.
    wall_back: { position: { x: 2.0, y: AUTOMATED_CELL_FLOOR.slabTop, z: 2.48 }, rotationY: 90, scale: 0.78 },
    // Input / output conveyors (turned 90, flow along z) butt into the core front face: x 1.975..2.425 / 2.475..2.925, z 1.105..1.555.
    conveyor_in: { position: { x: 2.2, y: AUTOMATED_CELL_FLOOR.slabTop, z: 1.33 }, rotationY: 90, scale: AUTOMATED_CELL_BELT_SCALE },
    conveyor_out: { position: { x: 2.7, y: AUTOMATED_CELL_FLOOR.slabTop, z: 1.33 }, rotationY: 90, scale: AUTOMATED_CELL_BELT_SCALE },
    // Core: solid machine block, x 2.0..2.6, z 1.555..2.305, top 0.81.
    core: { position: { x: 2.3, y: AUTOMATED_CELL_FLOOR.slabTop, z: 1.93 }, rotationY: 0, scale: 0.5 },
    // Arm 1 on the open camera side of the core: x 2.8..3.1, z 1.61..1.91, top 1.12.
    arm_1: { position: { x: 2.95, y: AUTOMATED_CELL_FLOOR.slabTop, z: 1.76 }, rotationY: 0, scale: 0.3 },
    // Arm 2 in the north-west corner between the walls and the core, turned 180: x 1.65..1.95, z 2.025..2.325, top 1.12.
    arm_2: { position: { x: 1.8, y: AUTOMATED_CELL_FLOOR.slabTop, z: 2.175 }, rotationY: 180, scale: 0.3 },
    // Lv10 arm 3 (robot-arm-b) north-east of the core: x 2.78..3.08, z 2.05..2.35, top 1.06.
    arm_3: { position: { x: 2.93, y: AUTOMATED_CELL_FLOOR.slabTop, z: 2.2 }, rotationY: 0, scale: 0.3 },
    // Lv10 hopper on the core roof (0.16 + 1.3 x 0.5 = 0.81): x 2.077..2.523, z 1.707..2.153, top 1.21.
    hopper: { position: { x: 2.3, y: 0.81, z: 1.93 }, rotationY: 0, scale: 0.4 },
});

export type AutomatedCellLampId = 'input' | 'output' | 'core' | 'arm_1' | 'arm_3' | 'hopper';

export const AUTOMATED_CELL_LAMP_IDS: readonly AutomatedCellLampId[] = Object.freeze(['input', 'output', 'core', 'arm_1', 'arm_3', 'hopper']);

/** Lamp ids that exist at Lv1 (4); Lv10 has all 6. */
export const AUTOMATED_CELL_LV1_LAMPS: readonly AutomatedCellLampId[] = Object.freeze(['input', 'output', 'core', 'arm_1']);

/** Tiny unlit status lamps (graphite off / cyan 82,206,224 on; no dynamic light). */
export const AUTOMATED_CELL_LAMPS: Readonly<Record<AutomatedCellLampId, { readonly center: WorldVec3; readonly size: WorldVec3 }>> = Object.freeze({
    // Input end and output end on the slab beside the conveyor mouths.
    input: { center: { x: 1.9, y: 0.19, z: 1.2 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    output: { center: { x: 2.97, y: 0.19, z: 1.2 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    // Core camera face (-z), above the conveyors, between the two mouths.
    core: { center: { x: 2.3, y: 0.58, z: 1.53 }, size: { x: 0.1, y: 0.07, z: 0.05 } },
    // Arm bases on the slab.
    arm_1: { center: { x: 3.1, y: 0.19, z: 1.45 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    arm_3: { center: { x: 3.05, y: 0.19, z: 2.48 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    // Hopper camera face (+x).
    hopper: { center: { x: 2.55, y: 1.0, z: 1.93 }, size: { x: 0.05, y: 0.07, z: 0.1 } },
});

/**
 * Flat floor guide strip (the light one-flow connector): from x 3.6 to x -0.1 at z 0.95 (south of the Line -> Storage
 * lane, ending short of the crate face) with a stub joining the cell output. Graphite until the cell is built, then
 * cyan at ~40% intensity. Primitive boxes built by the bootstrap; both lie on the ground (the stub is a short 0.15
 * stub from z 0.95 to the slab edge z 1.1; past z 1.05 it is covered by the zone foundation).
 */
export type AutomatedCellGuidePart = 'strip' | 'stub';
export const AUTOMATED_CELL_GUIDE_PARTS: readonly AutomatedCellGuidePart[] = Object.freeze(['strip', 'stub']);
export const AUTOMATED_CELL_GUIDE: Readonly<Record<AutomatedCellGuidePart, { readonly center: WorldVec3; readonly size: WorldVec3 }>> = Object.freeze({
    strip: { center: { x: 1.75, y: 0.02, z: 0.95 }, size: { x: 3.7, y: 0.04, z: 0.12 } },
    stub: { center: { x: 2.7, y: 0.02, z: 1.025 }, size: { x: 0.12, y: 0.04, z: 0.15 } },
});
/** Graphite (off) and ~40% cyan (on) of the guide: graphite + 0.4 x (cyan - graphite). */
export const AUTOMATED_CELL_GUIDE_OFF_COLOR = Object.freeze({ r: 43, g: 49, b: 52 });
export const AUTOMATED_CELL_GUIDE_ON_COLOR = Object.freeze({ r: 59, g: 112, b: 121 });

/** Fake production items (scale of the AUT-032 prefabs). */
export const AUTOMATED_CELL_BOX_SCALE = 0.2;
export const AUTOMATED_CELL_ROBOT_SCALE = 0.12;
/** Robot.glb bind-pose height 4.513 at 0.12 = 0.54 tall: on the output belt (0.34) its top is 0.88. */
export const AUTOMATED_CELL_ROBOT_HEIGHT = 4.513 * AUTOMATED_CELL_ROBOT_SCALE;

/** Reveal camera target (world): the cell. */
export const AUTOMATED_CELL_REVEAL_TARGET: WorldVec3 = Object.freeze({ x: 2.3, y: 0.5, z: 1.9 });

/** Spark anchor of the AUT-040 construction sequence (world). */
export const AUTOMATED_CELL_SPARK_ANCHOR: WorldVec3 = Object.freeze({ x: 2.3, y: 0.16, z: 1.85 });

/** Automated Cell placeholder boxes of the unbuilt zone (AUT-033 siblings of the composition anchor). */
export const AUTOMATED_CELL_PLACEHOLDER_NODE_NAMES = Object.freeze(['AutomatedCell_InactiveShell', 'AutomatedCell_DisconnectedLogistics']);

/** The AutomatedCell zone origin (composition anchor world position). */
export const AUTOMATED_CELL_ZONE_ORIGIN: WorldVec3 = Object.freeze({ x: ZONE_LAYOUT.AutomatedCell.x, y: 0, z: ZONE_LAYOUT.AutomatedCell.z });

/** World -> AutomatedCell composition-anchor local coordinates (the zone is unrotated and unscaled). */
export function automatedCellLocal(world: WorldVec3): WorldVec3 {
    return { x: world.x - AUTOMATED_CELL_ZONE_ORIGIN.x, y: world.y - AUTOMATED_CELL_ZONE_ORIGIN.y, z: world.z - AUTOMATED_CELL_ZONE_ORIGIN.z };
}
