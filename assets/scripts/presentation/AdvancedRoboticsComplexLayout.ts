import { ZONE_LAYOUT } from './FactoryZoneLayout.ts';
import type { WorldVec3 } from './AssemblySliceLayout.ts';

/**
 * AUT-044 engine-free Advanced Robotics Complex (Producer #5, Era III frontier) layout (presentation only).
 *
 * Art Director intent (2026-11-12): a building-scale, vertical complex (a stepped tower with an overhead gantry
 * bridge and a spire) that dwarfs the Automated Cell and the Robot Line, L-shaped tall frames on the far (-x / +z)
 * sides, the camera side (+x, -z) open. Owner-approved presentation-only zone shift (same reason as AUT-043): the
 * zone rect moved from (2, 6) 6 x 5.5 (mostly off-screen at the default portrait view) to (-1.0, 5.125) 3.5 x 3.75
 * (x -2.75..0.75, z 3.25..7.0; clear of the Automated Cell zone z <= 2.75 and the Robot Line). The camera is not touched.
 * Existing AUT-032 Kenney assets and primitives only (Modular Space is NOT imported, no new asset file).
 *
 * The Art Director transforms are proposals; the values below differ where the interpenetration / clearance / screen
 * tests required it (see docs/AUT-044_ADVANCED_ROBOTICS_COMPLEX_VISUAL.md for each deviation).
 *
 * Measured AUT-032 GLB facts (POSITION bounds, unit scale, bottom-centre pivots): machine x -0.6..0.6, y 0..1.29975,
 * z -0.75..0.75 (solid block); robot-arm-a 1.0 x 3.2 x 1.0; robot-arm-b 1.0 x 3.0 x 1.0; structure-high x -0.15..0.15,
 * y 0..1.5, z -0.55..0.55 (frame, plane along local Z); conveyor 1.0 x 0.4 x 1.0 (flow along local X); hopper-square
 * x/z +-0.5586, y 0..1.0; box-large 1.1 x 0.55 x 1.0.
 *
 * All coordinates are WORLD (x, y, z). FactoryWorld zones are unrotated and unscaled, so a node under the
 * AdvancedRoboticsComplex composition anchor uses `arcLocal(world)`.
 */

export const ARC_PRODUCER_ID = 'advanced_robotics_complex';

export type ArcModuleId =
    | 'foundation_slab'
    | 'frame_west_1'
    | 'frame_west_2'
    | 'frame_back_1'
    | 'frame_back_2'
    | 'conveyor_in'
    | 'conveyor_out'
    | 'core'
    | 'head'
    | 'arm_1'
    | 'arm_2'
    | 'bay'
    | 'arm_b'
    | 'beam_1'
    | 'beam_2'
    | 'overhead_belt'
    | 'spire';

/** Canonical order, also the AUT-040 construction order (slab -> west + back frames -> conveyors -> core -> head + arms; Lv10 extras last; lamps at activation). */
export const ARC_MODULE_IDS: readonly ArcModuleId[] = Object.freeze([
    'foundation_slab',
    'frame_west_1',
    'frame_west_2',
    'frame_back_1',
    'frame_back_2',
    'conveyor_in',
    'conveyor_out',
    'core',
    'head',
    'arm_1',
    'arm_2',
    'bay',
    'arm_b',
    'beam_1',
    'beam_2',
    'overhead_belt',
    'spire',
]);

/** Modules present at Lv1 (the Lv10 set adds the rest). */
export const ARC_LV1_MODULE_IDS: readonly ArcModuleId[] = Object.freeze([
    'foundation_slab',
    'frame_west_1',
    'frame_west_2',
    'frame_back_1',
    'frame_back_2',
    'conveyor_in',
    'conveyor_out',
    'core',
    'head',
    'arm_1',
    'arm_2',
]);

/** Primitive modules built by the bootstrap (grey slab, graphite gantry beams). */
export const ARC_PRIMITIVE_MODULE_IDS: readonly ArcModuleId[] = Object.freeze(['foundation_slab', 'beam_1', 'beam_2']);

/** Prefab slots serialized on FactoryWorldBootstrap (`advancedRoboticsComplexPrefabs`, index-aligned). */
export const ARC_PREFAB_SLOTS = Object.freeze([
    'conveyor',
    'machine',
    'arm_a',
    'arm_b',
    'frame',
    'hopper',
    'box',
] as const);

export type ArcPrefabSlot = typeof ARC_PREFAB_SLOTS[number];

/** Imported AUT-032 prefab sub-assets (nothing new). */
export const ARC_ASSET_REFERENCES: Readonly<Record<ArcPrefabSlot, string>> = Object.freeze({
    conveyor: 'a0320000-0000-4000-8000-000000000007@a040b', // conveyor.glb
    machine: 'a0320000-0000-4000-8000-00000000000a@ce0e9', // machine.glb
    arm_a: 'a0320000-0000-4000-8000-00000000000c@ace94', // robot-arm-a.glb
    arm_b: 'a0320000-0000-4000-8000-00000000000d@cb36c', // robot-arm-b.glb
    frame: 'a0320000-0000-4000-8000-00000000000f@5fe1c', // structure-high.glb
    hopper: 'a0320000-0000-4000-8000-000000000008@92950', // hopper-square.glb
    box: 'a0320000-0000-4000-8000-000000000004@2d450', // box-large.glb
});

/** Which prefab slot builds a prefab-backed module (the slab and the beams are primitives). */
export const ARC_MODULE_PREFAB: Readonly<Partial<Record<ArcModuleId, ArcPrefabSlot>>> = Object.freeze({
    frame_west_1: 'frame',
    frame_west_2: 'frame',
    frame_back_1: 'frame',
    frame_back_2: 'frame',
    conveyor_in: 'conveyor',
    conveyor_out: 'conveyor',
    overhead_belt: 'conveyor',
    core: 'machine',
    bay: 'machine',
    spire: 'machine',
    head: 'hopper',
    arm_1: 'arm_a',
    arm_2: 'arm_a',
    arm_b: 'arm_b',
});

export interface ArcModuleTransform {
    readonly position: WorldVec3;
    readonly rotationY: number;
    readonly scale: number;
}

/** Floor heights of the Advanced Robotics Complex area (the shell zone foundation and the grey slab). */
export const ARC_FLOOR = Object.freeze({
    foundationTop: 0.12,
    slabTop: 0.16,
});

/** Frame scale: 1.5 x 1.25 = 1.875 tall (top 2.035), 1.375 long, 0.375 thick. */
export const ARC_FRAME_SCALE = 1.25;
/** Conveyor.glb is 0.4 high: input / output belt top = slab top + 0.4 x 0.6. */
export const ARC_BELT_SCALE = 0.6;
export const ARC_BELT_TOP = ARC_FLOOR.slabTop + (0.4 * ARC_BELT_SCALE);
/** Overhead belt: conveyor scale 0.5 resting on the gantry beams (top = beam top 2.155 + 0.4 x 0.5). */
export const ARC_OVERHEAD_BELT_SCALE = 0.5;
export const ARC_FRAME_TOP = ARC_FLOOR.slabTop + (1.5 * ARC_FRAME_SCALE);
export const ARC_BEAM_TOP = ARC_FRAME_TOP + 0.12;
export const ARC_OVERHEAD_BELT_TOP = ARC_BEAM_TOP + (0.4 * ARC_OVERHEAD_BELT_SCALE);
/** Height limits of the composition: Lv1 stepped tower, Lv10 with the spire. */
export const ARC_LV1_MAX_HEIGHT = 2.35;
export const ARC_LV10_MAX_HEIGHT = 3.1;

/** Grey foundation slab (primitive box built by the bootstrap): x -2.5..0.5, z 3.55..6.75, y 0..0.16. */
export const ARC_FOUNDATION_SLAB = Object.freeze({
    center: Object.freeze({ x: -1.0, y: 0.08, z: 5.15 }),
    size: Object.freeze({ x: 3.0, y: 0.16, z: 3.2 }),
});

/** Graphite gantry beams (primitive boxes) from the west frame tops to the core head, resting on the frames (y 2.035..2.155). */
export const ARC_BEAMS: Readonly<Record<'beam_1' | 'beam_2', { readonly center: WorldVec3; readonly size: WorldVec3 }>> = Object.freeze({
    beam_1: { center: { x: -1.83125, y: 2.095, z: 4.75 }, size: { x: 1.3125, y: 0.12, z: 0.15 } },
    beam_2: { center: { x: -1.83125, y: 2.095, z: 5.25 }, size: { x: 1.3125, y: 0.12, z: 0.15 } },
});
export const ARC_BEAM_GRAPHITE_COLOR = Object.freeze({ r: 43, g: 49, b: 52 });

export const ARC_MODULE_TRANSFORMS: Readonly<Record<Exclude<ArcModuleId, 'foundation_slab' | 'beam_1' | 'beam_2'>, ArcModuleTransform>> = Object.freeze({
    // West run (along z at x -2.3, end to end): x -2.4875..-2.1125, z 3.6..4.975 / 4.975..6.35, top 2.035.
    frame_west_1: { position: { x: -2.3, y: ARC_FLOOR.slabTop, z: 4.2875 }, rotationY: 0, scale: ARC_FRAME_SCALE },
    frame_west_2: { position: { x: -2.3, y: ARC_FLOOR.slabTop, z: 5.6625 }, rotationY: 0, scale: ARC_FRAME_SCALE },
    // Back run (along x at z 6.5375, turned 90, end to end): x -2.4875..-1.1125 / -1.1125..0.2625, z 6.35..6.725.
    frame_back_1: { position: { x: -1.8, y: ARC_FLOOR.slabTop, z: 6.5375 }, rotationY: 90, scale: ARC_FRAME_SCALE },
    frame_back_2: { position: { x: -0.425, y: ARC_FLOOR.slabTop, z: 6.5375 }, rotationY: 90, scale: ARC_FRAME_SCALE },
    // Robot entry / exit conveyors (turned 90, flow along z) butt into the core front face: x -1.3..-0.7 / -0.7..-0.1, z 3.65..4.25, belt top 0.40.
    conveyor_in: { position: { x: -1.0, y: ARC_FLOOR.slabTop, z: 3.95 }, rotationY: 90, scale: ARC_BELT_SCALE },
    conveyor_out: { position: { x: -0.4, y: ARC_FLOOR.slabTop, z: 3.95 }, rotationY: 90, scale: ARC_BELT_SCALE },
    // Core: solid machine block, x -1.3..-0.1, z 4.25..5.75, top 1.46.
    core: { position: { x: -0.7, y: ARC_FLOOR.slabTop, z: 5.0 }, rotationY: 0, scale: 1.0 },
    // Head (hopper-square) on the core roof: x -1.175..-0.225, z 4.525..5.475, top 2.31.
    head: { position: { x: -0.7, y: 1.46, z: 5.0 }, rotationY: 0, scale: 0.85 },
    // East strip (open camera side) x -0.1..0.5: arm 1 / arm 2 (robot-arm-a, top 1.6) flank the core, arm B (robot-arm-b, top 1.51), second bay machine (top 0.81).
    arm_1: { position: { x: 0.2, y: ARC_FLOOR.slabTop, z: 3.98 }, rotationY: 0, scale: 0.45 },
    arm_2: { position: { x: 0.2, y: ARC_FLOOR.slabTop, z: 4.6 }, rotationY: 180, scale: 0.45 },
    arm_b: { position: { x: 0.2, y: ARC_FLOOR.slabTop, z: 5.22 }, rotationY: 0, scale: 0.45 },
    bay: { position: { x: 0.2, y: ARC_FLOOR.slabTop, z: 5.95 }, rotationY: 0, scale: 0.5 },
    // Overhead belt on the gantry beams, flow along x into the head: x -1.675..-1.175, z 4.75..5.25, y 2.155..2.355.
    overhead_belt: { position: { x: -1.425, y: ARC_BEAM_TOP, z: 5.0 }, rotationY: 0, scale: ARC_OVERHEAD_BELT_SCALE },
    // Spire (machine) on the head: top 2.31 + 1.29975 x 0.5 = 2.96.
    spire: { position: { x: -0.7, y: 2.31, z: 5.0 }, rotationY: 0, scale: 0.5 },
});

export type ArcLampId =
    | 'input'
    | 'output'
    | 'core'
    | 'head'
    | 'arm_1'
    | 'arm_2'
    | 'frame_west'
    | 'frame_back'
    | 'bay'
    | 'arm_b'
    | 'gantry_1'
    | 'gantry_2'
    | 'overhead'
    | 'spire';

export const ARC_LAMP_IDS: readonly ArcLampId[] = Object.freeze([
    'input', 'output', 'core', 'head', 'arm_1', 'arm_2', 'frame_west', 'frame_back',
    'bay', 'arm_b', 'gantry_1', 'gantry_2', 'overhead', 'spire',
]);

/** Lamp ids that exist at Lv1 (8); Lv10 has all 14. */
export const ARC_LV1_LAMPS: readonly ArcLampId[] = Object.freeze(ARC_LAMP_IDS.slice(0, 8));

/** Tiny unlit status lamps (graphite off / cyan 82,206,224 on; no dynamic light). */
export const ARC_LAMPS: Readonly<Record<ArcLampId, { readonly center: WorldVec3; readonly size: WorldVec3 }>> = Object.freeze({
    // Robot entry / exit belt mouths on the slab.
    input: { center: { x: -1.37, y: 0.19, z: 3.7 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    output: { center: { x: -0.03, y: 0.19, z: 3.62 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    // Core camera face (-z), above the conveyors.
    core: { center: { x: -0.7, y: 0.62, z: 4.225 }, size: { x: 0.1, y: 0.07, z: 0.05 } },
    // Head camera face (-z).
    head: { center: { x: -0.7, y: 1.95, z: 4.5 }, size: { x: 0.1, y: 0.07, z: 0.05 } },
    // Arm bases in the gaps between the arm swings on the slab.
    arm_1: { center: { x: 0.2, y: 0.185, z: 4.29 }, size: { x: 0.05, y: 0.05, z: 0.05 } },
    arm_2: { center: { x: 0.2, y: 0.185, z: 4.91 }, size: { x: 0.05, y: 0.05, z: 0.05 } },
    // Frame tops (sitting on the first west / back frame).
    frame_west: { center: { x: -2.3, y: 2.065, z: 4.2875 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    frame_back: { center: { x: -1.8, y: 2.065, z: 6.5375 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    // Lv10: second bay face, arm B base, the two gantry beam strips, the overhead belt, the spire top (up to y 3.1).
    bay: { center: { x: 0.2, y: 0.62, z: 5.55 }, size: { x: 0.1, y: 0.07, z: 0.05 } },
    arm_b: { center: { x: 0.2, y: 0.185, z: 5.535 }, size: { x: 0.05, y: 0.05, z: 0.05 } },
    gantry_1: { center: { x: -2.05, y: 2.17, z: 4.75 }, size: { x: 0.7, y: 0.03, z: 0.05 } },
    gantry_2: { center: { x: -2.05, y: 2.17, z: 5.25 }, size: { x: 0.7, y: 0.03, z: 0.05 } },
    overhead: { center: { x: -1.45, y: 2.23, z: 4.725 }, size: { x: 0.1, y: 0.06, z: 0.05 } },
    spire: { center: { x: -0.7, y: 3.03, z: 5.0 }, size: { x: 0.1, y: 0.14, z: 0.1 } },
});

/**
 * Light connector (the only factory-wide change of AUT-044): a flat graphite guide from the storage crate north face
 * (z 1.35) at x -1.0 to the robot entry conveyor (z 3.55 = the slab edge). The strip lies on the ground (z 1.35..3.25,
 * y 0..0.04); past z 3.25 the zone foundation (top 0.12) covers the ground, so a short stub rests on it (y 0.12..0.16,
 * z 3.25..3.55). Graphite until the complex is built, then cyan at ~40% intensity. It is not the Cell output.
 */
export type ArcGuidePart = 'strip' | 'stub';
export const ARC_GUIDE_PARTS: readonly ArcGuidePart[] = Object.freeze(['strip', 'stub']);
export const ARC_GUIDE: Readonly<Record<ArcGuidePart, { readonly center: WorldVec3; readonly size: WorldVec3 }>> = Object.freeze({
    strip: { center: { x: -1.0, y: 0.02, z: 2.3 }, size: { x: 0.12, y: 0.04, z: 1.9 } },
    stub: { center: { x: -1.0, y: 0.14, z: 3.4 }, size: { x: 0.12, y: 0.04, z: 0.3 } },
});
/** Graphite (off) and ~40% cyan (on) of the guide: graphite + 0.4 x (cyan - graphite). */
export const ARC_GUIDE_OFF_COLOR = Object.freeze({ r: 43, g: 49, b: 52 });
export const ARC_GUIDE_ON_COLOR = Object.freeze({ r: 59, g: 112, b: 121 });

/** Fake production items (scale of the AUT-032 prefabs). */
export const ARC_BOX_SCALE = 0.2;
export const ARC_ROBOT_SCALE = 0.12;
/** Robot.glb bind-pose height 4.513 at 0.12 = 0.54 tall: on the exit belt (0.40) its top is 0.94. */
export const ARC_ROBOT_HEIGHT = 4.513 * ARC_ROBOT_SCALE;

/** Reveal camera target (world): the complex. */
export const ARC_REVEAL_TARGET: WorldVec3 = Object.freeze({ x: -1.0, y: 1.0, z: 5.0 });

/** Spark anchor of the AUT-040 construction sequence (world). */
export const ARC_SPARK_ANCHOR: WorldVec3 = Object.freeze({ x: -1.0, y: 0.16, z: 5.0 });

/** Advanced Robotics Complex placeholder boxes of the unbuilt zone (AUT-033 siblings of the composition anchor). */
export const ARC_PLACEHOLDER_NODE_NAMES = Object.freeze(['AdvancedRoboticsComplex_InactiveShell', 'AdvancedRoboticsComplex_DisconnectedLogistics']);

/** The AdvancedRoboticsComplex zone origin (composition anchor world position). */
export const ARC_ZONE_ORIGIN: WorldVec3 = Object.freeze({ x: ZONE_LAYOUT.AdvancedRoboticsComplex.x, y: 0, z: ZONE_LAYOUT.AdvancedRoboticsComplex.z });

/** World -> AdvancedRoboticsComplex composition-anchor local coordinates (the zone is unrotated and unscaled). */
export function arcLocal(world: WorldVec3): WorldVec3 {
    return { x: world.x - ARC_ZONE_ORIGIN.x, y: world.y - ARC_ZONE_ORIGIN.y, z: world.z - ARC_ZONE_ORIGIN.z };
}
