import { ZONE_LAYOUT } from './FactoryZoneLayout.ts';
import { AUTOMATED_CELL_FLOOR, AUTOMATED_CELL_FOUNDATION_SLAB } from './AutomatedCellLayout.ts';
import { ROBOT_LINE_FLOOR, ROBOT_LINE_FOUNDATION_SLAB } from './RobotLineLayout.ts';

/**
 * AUT-039 engine-free Assembly Station + first Worker Bot slice layout (presentation only).
 *
 * Art Director intent (2026-11-11, world x/z): bay stand-in `structure-high` at (-3.4, 0.7), storage
 * anchor `box-large` (~0.8) at (-0.8, 0.95), Assembly Lv1 = grey slab + `machine-bed` + `conveyor-corner`
 * input from the spine, Lv10 adds `robot-arm-b` + `screen-panel-wide` and stays shorter than the
 * Fabricator press (1.505). The exact module transforms below are an implementer composition inside that
 * intent; their polish belongs to Scene Presentation.
 *
 * Measured AUT-032 GLB facts (POSITION bounds, unit scale, bottom-centre pivots):
 * - machine-bed.glb: x -0.6..1.75, y 0..1.298, z -0.75..1.6 (90-degree corner gantry: inlet mouth at
 *   local -X, outlet mouth centred (1.0, 1.6) opening +Z, inlet-section roof at 1.25 over the origin);
 * - conveyor-corner.glb: 1.0 x 0.45 x 1.0; robot-arm-b.glb: 1.0 x 3.0 x 1.0 (vertical stack);
 * - screen-panel-wide.glb: 1.2 x 0.991 x 0.658; structure-high.glb: 0.3 x 1.5 x 1.1 (frame, opening
 *   along local X); box-large.glb: 1.1 x 0.55 x 1.0;
 * - Robot.glb (skinned): bind-pose height 4.513.
 *
 * All coordinates are WORLD (x, y, z); FactoryWorld zones are unrotated and unscaled, so a node under the
 * Assembly composition anchor uses `assemblyLocal(world)`.
 */

export interface WorldVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface WorldPoint {
    readonly x: number;
    readonly z: number;
}

export type AssemblyModuleId =
    | 'foundation_slab'
    | 'workstation_bed'
    | 'input_corner'
    | 'assembly_arm'
    | 'status_panel'
    | 'robot_bay'
    | 'storage_crate';

export const ASSEMBLY_MODULE_IDS: readonly AssemblyModuleId[] = Object.freeze([
    'foundation_slab',
    'workstation_bed',
    'input_corner',
    'assembly_arm',
    'status_panel',
    'robot_bay',
    'storage_crate',
]);

/** Modules instantiated from the prefabs serialized on FactoryWorldBootstrap (`assemblyPrefabs`, index-aligned). */
export const ASSEMBLY_SERIALIZED_PREFAB_MODULES = Object.freeze([
    'workstation_bed',
    'input_corner',
    'assembly_arm',
    'status_panel',
    'robot_bay',
    'storage_crate',
] as const);

export type AssemblyPrefabModuleId = typeof ASSEMBLY_SERIALIZED_PREFAB_MODULES[number];

/** Imported AUT-032 prefab sub-assets (already in ASSET_MANIFEST / AUT-032 inventory; nothing new). */
export const ASSEMBLY_ASSET_REFERENCES: Readonly<Record<AssemblyPrefabModuleId, string>> = Object.freeze({
    workstation_bed: 'a0320000-0000-4000-8000-000000000009@7c2af', // machine-bed.glb
    input_corner: 'a0320000-0000-4000-8000-000000000005@f3576', // conveyor-corner.glb
    assembly_arm: 'a0320000-0000-4000-8000-00000000000d@cb36c', // robot-arm-b.glb
    status_panel: 'a0320000-0000-4000-8000-00000000000e@35a07', // screen-panel-wide.glb
    robot_bay: 'a0320000-0000-4000-8000-00000000000f@5fe1c', // structure-high.glb
    storage_crate: 'a0320000-0000-4000-8000-000000000004@2d450', // box-large.glb
});

/** Quaternius Robot.glb prefab (AUT-032). */
export const WORKER_BOT_PREFAB_REFERENCE = 'a0320000-0000-4000-8000-000000000003@68751';

export interface AssemblyModuleTransform {
    readonly position: WorldVec3;
    readonly rotationY: number;
    readonly scale: number;
}

/** Floor heights of the FactoryWorld shell (FactoryWorldBootstrap boxes). */
export const SHELL_FLOOR = Object.freeze({
    ground: 0,
    assemblyFoundationTop: 0.12,
    openingFoundationTop: 0.14,
    spineTop: 0.24,
    slabTop: 0.16,
});

/** Grey foundation slab (a primitive box built by the bootstrap): x -3.3..-1.0, z -2.8..-0.65, y 0.12..0.16. */
export const ASSEMBLY_FOUNDATION_SLAB = Object.freeze({
    center: Object.freeze({ x: -2.15, y: 0.14, z: -1.725 }),
    size: Object.freeze({ x: 2.3, y: 0.04, z: 2.15 }),
});

export const ASSEMBLY_MODULE_TRANSFORMS: Readonly<Record<AssemblyPrefabModuleId, AssemblyModuleTransform>> = Object.freeze({
    // Corner gantry turned Y 90: inlet mouth faces +Z (the spine), outlet faces +X (the Worker Bot station).
    // Footprint x -3.275..-2.1, z -2.325..-1.15; top 0.809.
    workstation_bed: { position: { x: -2.9, y: SHELL_FLOOR.slabTop, z: -1.45 }, rotationY: 90, scale: 0.5 },
    // Input corner between the bed inlet and the spine edge: x -3.15..-2.65, z -1.15..-0.65.
    input_corner: { position: { x: -2.9, y: SHELL_FLOOR.slabTop, z: -0.9 }, rotationY: 0, scale: 0.5 },
    // Lv10 arm beside the bed outlet, clear of the station: x -2.05..-1.65, z -2.55..-2.15; top 1.36.
    assembly_arm: { position: { x: -1.85, y: SHELL_FLOOR.slabTop, z: -2.35 }, rotationY: 0, scale: 0.4 },
    // Lv10 / automated status panel on the bed inlet roof (0.16 + 1.25 x 0.5), facing +X (camera side); top 1.08.
    status_panel: { position: { x: -2.9, y: 0.785, z: -1.45 }, rotationY: -90, scale: 0.3 },
    // Bay stand-in, opening (local X) turned toward the first entry leg (-3.4, 0.7) -> (-2.6, 0.3).
    robot_bay: { position: { x: -3.4, y: SHELL_FLOOR.ground, z: 0.7 }, rotationY: 27, scale: 1 },
    // Storage anchor on the ground beyond the spine: x -1.24..-0.36, z 0.55..1.35 (clear of RobotLine x >= 0.5).
    storage_crate: { position: { x: -0.8, y: SHELL_FLOOR.ground, z: 0.95 }, rotationY: 0, scale: 0.8 },
});

/** Bay "light switching on" (ART_DIRECTION §26/§27: a lighting-state change, not a dynamic light): an unlit lamp on the frame top. */
export const ROBOT_BAY_LAMP = Object.freeze({
    center: Object.freeze({ x: -3.4, y: 1.54, z: 0.7 }),
    size: Object.freeze({ x: 0.18, y: 0.08, z: 0.18 }),
});

/** Worker Bot uniform scale: 4.513 x 0.24 = 1.08 tall (below the 1.5 bay frame and the 1.505 press). */
export const WORKER_BOT_SCALE = 0.24;

/** Reveal camera target: the middle of the bay -> station entry path (world). */
export const FIRST_ROBOT_REVEAL_TARGET: WorldVec3 = Object.freeze({ x: -2.6, y: 0.2, z: -0.3 });

interface FloorRect { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly top: number }

/** Highest surface first (spine over slab over foundations); outside every rect the floor is the ground (0). */
const FLOOR_RECTS: readonly FloorRect[] = Object.freeze([
    // MainLogisticsSpine: 13 x 0.12 x 0.7 at (0.2, 0.18, -0.3).
    { minX: -6.3, maxX: 6.7, minZ: -0.65, maxZ: 0.05, top: SHELL_FLOOR.spineTop },
    {
        minX: ASSEMBLY_FOUNDATION_SLAB.center.x - (ASSEMBLY_FOUNDATION_SLAB.size.x / 2),
        maxX: ASSEMBLY_FOUNDATION_SLAB.center.x + (ASSEMBLY_FOUNDATION_SLAB.size.x / 2),
        minZ: ASSEMBLY_FOUNDATION_SLAB.center.z - (ASSEMBLY_FOUNDATION_SLAB.size.z / 2),
        maxZ: ASSEMBLY_FOUNDATION_SLAB.center.z + (ASSEMBLY_FOUNDATION_SLAB.size.z / 2),
        top: SHELL_FLOOR.slabTop,
    },
    // AUT-042 Robot Line grey slab (primitive box built by the bootstrap).
    {
        minX: ROBOT_LINE_FOUNDATION_SLAB.center.x - (ROBOT_LINE_FOUNDATION_SLAB.size.x / 2),
        maxX: ROBOT_LINE_FOUNDATION_SLAB.center.x + (ROBOT_LINE_FOUNDATION_SLAB.size.x / 2),
        minZ: ROBOT_LINE_FOUNDATION_SLAB.center.z - (ROBOT_LINE_FOUNDATION_SLAB.size.z / 2),
        maxZ: ROBOT_LINE_FOUNDATION_SLAB.center.z + (ROBOT_LINE_FOUNDATION_SLAB.size.z / 2),
        top: ROBOT_LINE_FLOOR.slabTop,
    },
    // AUT-043 Automated Cell grey slab (primitive box built by the bootstrap).
    {
        minX: AUTOMATED_CELL_FOUNDATION_SLAB.center.x - (AUTOMATED_CELL_FOUNDATION_SLAB.size.x / 2),
        maxX: AUTOMATED_CELL_FOUNDATION_SLAB.center.x + (AUTOMATED_CELL_FOUNDATION_SLAB.size.x / 2),
        minZ: AUTOMATED_CELL_FOUNDATION_SLAB.center.z - (AUTOMATED_CELL_FOUNDATION_SLAB.size.z / 2),
        maxZ: AUTOMATED_CELL_FOUNDATION_SLAB.center.z + (AUTOMATED_CELL_FOUNDATION_SLAB.size.z / 2),
        top: AUTOMATED_CELL_FLOOR.slabTop,
    },
    // OpeningWorkshopFoundation: 6 x 0.18 x 4.8 at (-5.2, 0.05, -2.7).
    { minX: -8.2, maxX: -2.2, minZ: -5.1, maxZ: -0.3, top: SHELL_FLOOR.openingFoundationTop },
    // AssemblyStation_FutureFoundation: the zone footprint, 0.12 thick.
    {
        minX: ZONE_LAYOUT.AssemblyStation.x - (ZONE_LAYOUT.AssemblyStation.width / 2),
        maxX: ZONE_LAYOUT.AssemblyStation.x + (ZONE_LAYOUT.AssemblyStation.width / 2),
        minZ: ZONE_LAYOUT.AssemblyStation.z - (ZONE_LAYOUT.AssemblyStation.depth / 2),
        maxZ: ZONE_LAYOUT.AssemblyStation.z + (ZONE_LAYOUT.AssemblyStation.depth / 2),
        top: SHELL_FLOOR.assemblyFoundationTop,
    },
    // RobotLine_FutureFoundation: the zone footprint, 0.12 thick (AUT-042 exit route feet).
    {
        minX: ZONE_LAYOUT.RobotLine.x - (ZONE_LAYOUT.RobotLine.width / 2),
        maxX: ZONE_LAYOUT.RobotLine.x + (ZONE_LAYOUT.RobotLine.width / 2),
        minZ: ZONE_LAYOUT.RobotLine.z - (ZONE_LAYOUT.RobotLine.depth / 2),
        maxZ: ZONE_LAYOUT.RobotLine.z + (ZONE_LAYOUT.RobotLine.depth / 2),
        top: ROBOT_LINE_FLOOR.foundationTop,
    },
    // AutomatedCell_FutureFoundation: the zone footprint, 0.12 thick (AUT-043 owner-moved zone).
    {
        minX: ZONE_LAYOUT.AutomatedCell.x - (ZONE_LAYOUT.AutomatedCell.width / 2),
        maxX: ZONE_LAYOUT.AutomatedCell.x + (ZONE_LAYOUT.AutomatedCell.width / 2),
        minZ: ZONE_LAYOUT.AutomatedCell.z - (ZONE_LAYOUT.AutomatedCell.depth / 2),
        maxZ: ZONE_LAYOUT.AutomatedCell.z + (ZONE_LAYOUT.AutomatedCell.depth / 2),
        top: AUTOMATED_CELL_FLOOR.foundationTop,
    },
]);

/** Walkable floor height at a world point (deterministic, used for the Worker Bot's feet). */
export function floorHeightAt(x: number, z: number): number {
    for (const rect of FLOOR_RECTS) {
        if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) return rect.top;
    }
    return SHELL_FLOOR.ground;
}

/** The Assembly zone origin (composition anchor world position). */
export const ASSEMBLY_ZONE_ORIGIN: WorldVec3 = Object.freeze({ x: ZONE_LAYOUT.AssemblyStation.x, y: 0, z: ZONE_LAYOUT.AssemblyStation.z });

/** World -> Assembly composition-anchor local coordinates (the zone is unrotated and unscaled). */
export function assemblyLocal(world: WorldVec3): WorldVec3 {
    return { x: world.x - ASSEMBLY_ZONE_ORIGIN.x, y: world.y - ASSEMBLY_ZONE_ORIGIN.y, z: world.z - ASSEMBLY_ZONE_ORIGIN.z };
}
