import { ZONE_LAYOUT } from './FactoryZoneLayout.ts';
import type { WorldVec3 } from './AssemblySliceLayout.ts';

/**
 * AUT-042 engine-free Robot Line (Producer #3) layout (presentation only).
 *
 * Art Director intent (2026-11-12, world x/z): zone RobotLine x 0.5..6.5, z -2.95..0.55; the spine takes
 * z -0.65..0.05 so the build area is z -2.9..-0.85; line axis z -1.9, input from the spine at the west end,
 * everything at most 1.35 high (below the Fabricator press 1.505), existing AUT-032 Kenney assets only.
 * The exact transforms are an implementer composition inside that intent (Scene Presentation polishes it).
 *
 * Deviation from the first proposal, forced by the default portrait camera (the camera is not touched): the
 * default view cuts off everything beyond world x ~5.5 on this side (the screen x of the slab corner at x 6.5
 * is -0.98), so the line is the shortened variant: slab x 0.6..5.4, six 0.6 conveyors x 1.2..4.8 and a lip
 * plate x 4.8..5.2.
 *
 * Measured AUT-032 GLB facts (POSITION bounds, unit scale, bottom-centre pivots):
 * - conveyor.glb 1.0 x 0.4 x 1.0; conveyor-corner.glb 1.0 x 0.45 x 1.0;
 * - machine.glb x -0.6..0.6, y 0..1.3, z -0.75..0.75 (one solid mesh: the belt runs under its roof);
 * - robot-arm-a.glb 1.0 x 3.2 x 1.0; robot-arm-b.glb 1.0 x 3.0 x 1.0 (vertical stacks);
 * - structure-high.glb x -0.15..0.15, y 0..1.5, z -0.55..0.55 (frame, opening along local X);
 * - screen-panel-wide.glb 1.2 x 0.991 x 0.658; box-large.glb 1.1 x 0.55 x 1.0; Robot.glb bind height 4.513.
 *
 * All coordinates are WORLD (x, y, z). FactoryWorld zones are unrotated and unscaled, so a node under the
 * RobotLine composition anchor uses `robotLineLocal(world)`.
 */

export const ROBOT_LINE_PRODUCER_ID = 'robot_line';

export type RobotLineModuleId =
    | 'foundation_slab'
    | 'entry_gate'
    | 'feed_corner'
    | 'belt'
    | 'machine_a'
    | 'arm_a'
    | 'machine_b'
    | 'arm_b'
    | 'status_panel'
    | 'output_lip';

/** Canonical order, also the AUT-040 construction order (slab -> gate -> feed corner -> conveyors -> machine -> arm -> lip). */
export const ROBOT_LINE_MODULE_IDS: readonly RobotLineModuleId[] = Object.freeze([
    'foundation_slab',
    'entry_gate',
    'feed_corner',
    'belt',
    'machine_a',
    'arm_a',
    'machine_b',
    'arm_b',
    'status_panel',
    'output_lip',
]);

/** Prefab slots serialized on FactoryWorldBootstrap (`robotLinePrefabs`, index-aligned). */
export const ROBOT_LINE_PREFAB_SLOTS = Object.freeze([
    'conveyor',
    'feed_corner',
    'machine',
    'arm_a',
    'arm_b',
    'gate_frame',
    'status_panel',
    'chassis',
] as const);

export type RobotLinePrefabSlot = typeof ROBOT_LINE_PREFAB_SLOTS[number];

/** Imported AUT-032 prefab sub-assets (nothing new; no pipe-large / hopper-square / conveyor-junction-t). */
export const ROBOT_LINE_ASSET_REFERENCES: Readonly<Record<RobotLinePrefabSlot, string>> = Object.freeze({
    conveyor: 'a0320000-0000-4000-8000-000000000007@a040b', // conveyor.glb
    feed_corner: 'a0320000-0000-4000-8000-000000000005@f3576', // conveyor-corner.glb
    machine: 'a0320000-0000-4000-8000-00000000000a@ce0e9', // machine.glb
    arm_a: 'a0320000-0000-4000-8000-00000000000c@ace94', // robot-arm-a.glb
    arm_b: 'a0320000-0000-4000-8000-00000000000d@cb36c', // robot-arm-b.glb
    gate_frame: 'a0320000-0000-4000-8000-00000000000f@5fe1c', // structure-high.glb
    status_panel: 'a0320000-0000-4000-8000-00000000000e@35a07', // screen-panel-wide.glb
    chassis: 'a0320000-0000-4000-8000-000000000004@2d450', // box-large.glb
});

/** Which prefab slot builds a prefab-backed module (`belt` instantiates `conveyor` per tile; slab and lip are primitives). */
export const ROBOT_LINE_MODULE_PREFAB: Readonly<Partial<Record<RobotLineModuleId, RobotLinePrefabSlot>>> = Object.freeze({
    entry_gate: 'gate_frame',
    feed_corner: 'feed_corner',
    belt: 'conveyor',
    machine_a: 'machine',
    arm_a: 'arm_a',
    machine_b: 'machine',
    arm_b: 'arm_b',
    status_panel: 'status_panel',
});

export interface RobotLineModuleTransform {
    readonly position: WorldVec3;
    readonly rotationY: number;
    readonly scale: number;
}

/** Floor heights of the Robot Line area (the shell zone foundation and the grey slab). */
export const ROBOT_LINE_FLOOR = Object.freeze({
    foundationTop: 0.12,
    slabTop: 0.16,
});

/** Line axis (world z) and the belt surface height. */
export const ROBOT_LINE_AXIS_Z = -1.9;
export const ROBOT_LINE_BELT_TILE_SCALE = 0.6;
/** Conveyor.glb is 0.4 high: belt top = slab top + 0.4 x 0.6. */
export const ROBOT_LINE_BELT_TOP = ROBOT_LINE_FLOOR.slabTop + (0.4 * ROBOT_LINE_BELT_TILE_SCALE);
export const ROBOT_LINE_BELT_START_X = 1.2;
export const ROBOT_LINE_BELT_TILES = 6;
export const ROBOT_LINE_BELT_END_X = ROBOT_LINE_BELT_START_X + (ROBOT_LINE_BELT_TILES * ROBOT_LINE_BELT_TILE_SCALE);

/** Grey foundation slab (primitive box built by the bootstrap): x 0.6..5.4, z -2.9..-0.9, y 0.12..0.16. */
export const ROBOT_LINE_FOUNDATION_SLAB = Object.freeze({
    center: Object.freeze({ x: 3.0, y: 0.14, z: -1.9 }),
    size: Object.freeze({ x: 4.8, y: 0.04, z: 2.0 }),
});

/** Output lip plate (primitive box): the belt end, x 4.8..5.2, flush with the belt top. */
export const ROBOT_LINE_OUTPUT_LIP = Object.freeze({
    center: Object.freeze({ x: 5.0, y: 0.28, z: ROBOT_LINE_AXIS_Z }),
    size: Object.freeze({ x: 0.4, y: 0.24, z: 0.5 }),
});

export const ROBOT_LINE_MODULE_TRANSFORMS: Readonly<Record<Exclude<RobotLineModuleId, 'foundation_slab' | 'output_lip'>, RobotLineModuleTransform>> = Object.freeze({
    // Entry gate frame on the slab, opening along the belt (local X): x 0.633..0.867, z -2.33..-1.47, top 1.33.
    entry_gate: { position: { x: 0.75, y: ROBOT_LINE_FLOOR.slabTop, z: ROBOT_LINE_AXIS_Z }, rotationY: 0, scale: 0.78 },
    // Feed stub from the spine side: x 0.65..1.15, z -1.45..-0.95.
    feed_corner: { position: { x: 0.9, y: ROBOT_LINE_FLOOR.slabTop, z: -1.2 }, rotationY: 0, scale: 0.5 },
    // Belt group origin = belt centre; tiles are children (see `robotLineBeltTileOffsets`).
    belt: { position: { x: (ROBOT_LINE_BELT_START_X + ROBOT_LINE_BELT_END_X) / 2, y: ROBOT_LINE_FLOOR.slabTop, z: ROBOT_LINE_AXIS_Z }, rotationY: 0, scale: 1 },
    // Machine 1 straddles the belt (solid block, hides the chassis -> robot swap): x 2.1..2.7, top 0.81.
    machine_a: { position: { x: 2.4, y: ROBOT_LINE_FLOOR.slabTop, z: ROBOT_LINE_AXIS_Z }, rotationY: 0, scale: 0.5 },
    // Arm 1 beside the belt (nod / rotate cycle): x 3.02..3.38, z -2.63..-2.27, top 1.312.
    arm_a: { position: { x: 3.2, y: ROBOT_LINE_FLOOR.slabTop, z: -2.45 }, rotationY: 0, scale: 0.36 },
    // Lv10 machine 2 (x 3.6..4.2) and arm 2 (x 4.42..4.78, top 1.24).
    machine_b: { position: { x: 3.9, y: ROBOT_LINE_FLOOR.slabTop, z: ROBOT_LINE_AXIS_Z }, rotationY: 0, scale: 0.5 },
    arm_b: { position: { x: 4.6, y: ROBOT_LINE_FLOOR.slabTop, z: -2.45 }, rotationY: 0, scale: 0.36 },
    // Lv10 status panel on the machine 1 roof (0.16 + 0.65), facing +X; top 1.107.
    status_panel: { position: { x: 2.4, y: 0.81, z: ROBOT_LINE_AXIS_Z }, rotationY: -90, scale: 0.3 },
});

/** Local (belt group) x offsets of the conveyor tiles. */
export function robotLineBeltTileOffsets(): readonly number[] {
    const offsets: number[] = [];
    for (let i = 0; i < ROBOT_LINE_BELT_TILES; i += 1) {
        offsets.push(((i + 0.5) * ROBOT_LINE_BELT_TILE_SCALE) - ((ROBOT_LINE_BELT_TILES * ROBOT_LINE_BELT_TILE_SCALE) / 2));
    }
    return offsets;
}

export type RobotLineLampId = 'machine_a' | 'arm_a' | 'machine_b' | 'arm_b';

export const ROBOT_LINE_LAMP_IDS: readonly RobotLineLampId[] = Object.freeze(['machine_a', 'arm_a', 'machine_b', 'arm_b']);

/** Tiny unlit status lamps (like ROBOT_BAY_LAMP): machine lamps on the camera-side face, arm lamps on the slab beside the base. */
export const ROBOT_LINE_LAMPS: Readonly<Record<RobotLineLampId, { readonly center: WorldVec3; readonly size: WorldVec3 }>> = Object.freeze({
    machine_a: { center: { x: 2.4, y: 0.58, z: -2.3 }, size: { x: 0.1, y: 0.07, z: 0.05 } },
    arm_a: { center: { x: 3.5, y: 0.19, z: -2.45 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
    machine_b: { center: { x: 3.9, y: 0.58, z: -2.3 }, size: { x: 0.1, y: 0.07, z: 0.05 } },
    arm_b: { center: { x: 4.9, y: 0.19, z: -2.45 }, size: { x: 0.06, y: 0.06, z: 0.06 } },
});

/** Lamp ids that exist at Lv1 / Lv10. */
export const ROBOT_LINE_LV1_LAMPS: readonly RobotLineLampId[] = Object.freeze(['machine_a', 'arm_a']);

/** Fake belt items (scale of the AUT-032 prefabs). */
export const ROBOT_LINE_CHASSIS_SCALE = 0.25;
export const ROBOT_LINE_FINISHED_ROBOT_SCALE = 0.15;
/** Robot.glb bind-pose height 4.513 at 0.15 = 0.68 tall: on the belt (0.40) its top is 1.08. */
export const ROBOT_LINE_FINISHED_ROBOT_HEIGHT = 4.513 * ROBOT_LINE_FINISHED_ROBOT_SCALE;

/** Reveal camera target (world): the middle of the line. */
export const ROBOT_LINE_REVEAL_TARGET: WorldVec3 = Object.freeze({ x: 3.0, y: 0.3, z: -1.7 });

/** Spark anchor of the AUT-040 construction sequence (world). */
export const ROBOT_LINE_SPARK_ANCHOR: WorldVec3 = Object.freeze({ x: 3.0, y: 0.16, z: ROBOT_LINE_AXIS_Z });

/** Robot Line placeholder boxes of the unbuilt zone (AUT-033 siblings of the composition anchor). */
export const ROBOT_LINE_PLACEHOLDER_NODE_NAMES = Object.freeze(['RobotLine_InactiveShell', 'RobotLine_DisconnectedLogistics']);

/** The RobotLine zone origin (composition anchor world position). */
export const ROBOT_LINE_ZONE_ORIGIN: WorldVec3 = Object.freeze({ x: ZONE_LAYOUT.RobotLine.x, y: 0, z: ZONE_LAYOUT.RobotLine.z });

/** World -> RobotLine composition-anchor local coordinates (the zone is unrotated and unscaled). */
export function robotLineLocal(world: WorldVec3): WorldVec3 {
    return { x: world.x - ROBOT_LINE_ZONE_ORIGIN.x, y: world.y - ROBOT_LINE_ZONE_ORIGIN.y, z: world.z - ROBOT_LINE_ZONE_ORIGIN.z };
}
