/**
 * AUT-045 era environment layout (pure data, engine-free; Art Director approved proposals, world coordinates on the ground
 * plane of the FactorySite which sits at the origin). Three additive groups grow on the unused north-west block of the site:
 * the Automation Hall (Era II+), the vertical group (Era III) and the static AI Megafactory teaser (Era III only, Era IV
 * foreshadowing; no label, never interactive). Primitives are `builtin-unlit` boxes built by FactoryWorldBootstrap; the
 * posts / pylons / flanks reuse the AUT-032 `structure-high` prefab. Presentation only: no node here is selectable and
 * none changes pan bounds, zones, routes or robot lanes.
 */

export interface Rgb { readonly r: number; readonly g: number; readonly b: number }
export interface EnvVec3 { readonly x: number; readonly y: number; readonly z: number }

export const ERA_ENV_ERA_IDS = ['manual_workshop', 'automated_factory', 'robotics_complex'] as const;
export type EraEnvironmentEraId = typeof ERA_ENV_ERA_IDS[number];

export type EraEnvironmentGroupId = 'hall' | 'vertical' | 'teaser';
export const ERA_ENV_GROUP_IDS: readonly EraEnvironmentGroupId[] = Object.freeze(['hall', 'vertical', 'teaser']);

/** Names of the node tree built by the bootstrap (a root per group under `EraEnvironment`). */
export const ERA_ENV_ROOT_NODE_NAME = 'EraEnvironment';
export const ERA_ENV_GROUP_NODE_NAMES: Readonly<Record<EraEnvironmentGroupId, string>> = Object.freeze({
    hall: 'EraEnvironment_Hall',
    vertical: 'EraEnvironment_Vertical',
    teaser: 'EraEnvironment_Teaser',
});

/** The three existing AUT-033 shell boxes whose colour follows the era (the only pre-existing nodes this task recolours). */
export const ERA_ENV_SHELL_NODE_NAMES = Object.freeze(['SiteBoundary', 'MainLogisticsSpine', 'FutureAccessBarrier'] as const);
export type EraEnvironmentShellNodeName = typeof ERA_ENV_SHELL_NODE_NAMES[number];

/** Colour roles of the hall primitives (the palette carries one colour per role and era). */
export type EraEnvironmentHallRole = 'hallFloor' | 'hallWall' | 'hallCap' | 'hallLightBar' | 'hallRoute';

export interface EraEnvironmentPalette {
    readonly siteBoundary: Rgb;
    readonly mainLogisticsSpine: Rgb;
    readonly futureAccessBarrier: Rgb;
    readonly clear: Rgb;
    readonly keyLightColor: Rgb;
    readonly keyLightIlluminance: number;
    readonly hallFloor: Rgb;
    readonly hallWall: Rgb;
    readonly hallCap: Rgb;
    readonly hallLightBar: Rgb;
    readonly hallRoute: Rgb;
}

const rgb = (r: number, g: number, b: number): Rgb => Object.freeze({ r, g, b });

/** Era II hall colours (also the colours the hall starts to rise in when the era is entered). */
const HALL_ERA_II = Object.freeze({
    hallFloor: rgb(96, 106, 112), hallWall: rgb(66, 76, 82), hallCap: rgb(120, 130, 134), hallLightBar: rgb(255, 244, 214), hallRoute: rgb(200, 150, 60),
});
const HALL_ERA_III = Object.freeze({
    hallFloor: rgb(70, 78, 86), hallWall: rgb(54, 62, 70), hallCap: rgb(196, 201, 203), hallLightBar: rgb(214, 236, 240), hallRoute: rgb(74, 85, 88),
});

/** Era -> palette. Manual Workshop equals the pre-AUT-045 shell colours (and is the Reboot state). */
export const ERA_ENV_PALETTES: Readonly<Record<EraEnvironmentEraId, EraEnvironmentPalette>> = Object.freeze({
    manual_workshop: Object.freeze({
        siteBoundary: rgb(76, 82, 87), mainLogisticsSpine: rgb(92, 101, 104), futureAccessBarrier: rgb(52, 59, 62),
        clear: rgb(36, 40, 44), keyLightColor: rgb(255, 244, 226), keyLightIlluminance: 45000, ...HALL_ERA_II,
    }),
    automated_factory: Object.freeze({
        siteBoundary: rgb(82, 91, 98), mainLogisticsSpine: rgb(104, 114, 119), futureAccessBarrier: rgb(58, 68, 74),
        clear: rgb(30, 36, 42), keyLightColor: rgb(255, 252, 245), keyLightIlluminance: 47000, ...HALL_ERA_II,
    }),
    robotics_complex: Object.freeze({
        siteBoundary: rgb(62, 69, 77), mainLogisticsSpine: rgb(84, 96, 104), futureAccessBarrier: rgb(46, 56, 64),
        clear: rgb(22, 28, 36), keyLightColor: rgb(238, 246, 255), keyLightIlluminance: 43000, ...HALL_ERA_III,
    }),
});

/** Era -> which groups are visible (the teaser only in robotics_complex: the AI Megafactory is a foreshadowing). */
export const ERA_ENV_GROUP_VISIBILITY: Readonly<Record<EraEnvironmentEraId, Readonly<Record<EraEnvironmentGroupId, boolean>>>> = Object.freeze({
    manual_workshop: Object.freeze({ hall: false, vertical: false, teaser: false }),
    automated_factory: Object.freeze({ hall: true, vertical: false, teaser: false }),
    robotics_complex: Object.freeze({ hall: true, vertical: true, teaser: true }),
});

/** Transition timing (s): palette / light / clear colour cross-fade (cap 1.5 s) and the scale-Y rise of new groups. */
export const ERA_ENV_FADE_SECONDS = 1.2;
export const ERA_ENV_FADE_CAP_SECONDS = 1.5;
export const ERA_ENV_RISE_SECONDS = 1.0;

/** Environment cyan is never brighter than this (producer status lamps 82,206,224 stay the brightest cyan). */
export const ERA_ENV_CYAN: Rgb = rgb(59, 112, 121);
export const ERA_ENV_GRAPHITE: Rgb = rgb(74, 85, 88);

/** One primitive box of a group. `role` ties it to the era palette; otherwise `color` is fixed. */
export interface EraEnvironmentBox {
    readonly id: string;
    readonly group: EraEnvironmentGroupId;
    readonly size: EnvVec3;
    readonly center: EnvVec3;
    readonly role?: EraEnvironmentHallRole;
    readonly color?: Rgb;
}

/** One `structure-high` prefab instance of a group (all use the single serialized `environmentPrefabs[0]`). */
export interface EraEnvironmentPrefabInstance {
    readonly id: string;
    readonly group: EraEnvironmentGroupId;
    readonly position: EnvVec3;
    readonly rotationY: number;
    readonly scale: number;
}

export const ERA_ENV_PREFAB_SLOTS = Object.freeze(['structure_high'] as const);
/** structure-high.glb of AUT-032 (the same prefab the AUT-044 frames use). */
export const ERA_ENV_ASSET_REFERENCES: Readonly<Record<typeof ERA_ENV_PREFAB_SLOTS[number], string>> = Object.freeze({
    structure_high: 'a0320000-0000-4000-8000-00000000000f@5fe1c',
});
/** structure-high.glb measured bounds (unit scale): 0.3 x 1.5 x 1.1, pivot bottom-centre (AUT-044 measured facts). */
export const STRUCTURE_HIGH_BOUNDS = Object.freeze({ width: 0.3, height: 1.5, depth: 1.1 });

const v = (x: number, y: number, z: number): EnvVec3 => Object.freeze({ x, y, z });

// ---------------------------------------------------------------------------------------------------------------
// Automation Hall (Era II+): the free north-west block x -10..-4, z 0.1..7.1

export const HALL_FLOOR_CENTER = v(-7, 0.04, 3.6);
export const HALL_FLOOR_SIZE = v(6.0, 0.08, 7.0);

export const ERA_ENV_HALL_BOXES: readonly EraEnvironmentBox[] = Object.freeze([
    { id: 'hall_floor', group: 'hall', size: HALL_FLOOR_SIZE, center: HALL_FLOOR_CENTER, role: 'hallFloor' },
    { id: 'hall_wall_rear', group: 'hall', size: v(6.0, 1.1, 0.18), center: v(-7, 0.55, 7.2), role: 'hallWall' },
    { id: 'hall_wall_west', group: 'hall', size: v(0.18, 1.1, 7.0), center: v(-9.9, 0.55, 3.6), role: 'hallWall' },
    { id: 'hall_cap_rear', group: 'hall', size: v(6.0, 0.06, 0.22), center: v(-7, 1.13, 7.2), role: 'hallCap' },
    { id: 'hall_cap_west', group: 'hall', size: v(0.22, 0.06, 7.0), center: v(-9.9, 1.13, 3.6), role: 'hallCap' },
    { id: 'hall_light_1', group: 'hall', size: v(1.2, 0.06, 0.12), center: v(-8.6, 0.95, 7.05), role: 'hallLightBar' },
    { id: 'hall_light_2', group: 'hall', size: v(1.2, 0.06, 0.12), center: v(-7.0, 0.95, 7.05), role: 'hallLightBar' },
    { id: 'hall_light_3', group: 'hall', size: v(1.2, 0.06, 0.12), center: v(-5.4, 0.95, 7.05), role: 'hallLightBar' },
    { id: 'hall_route_1', group: 'hall', size: v(5.0, 0.03, 0.08), center: v(-7, 0.095, 2.4), role: 'hallRoute' },
    { id: 'hall_route_2', group: 'hall', size: v(5.0, 0.03, 0.08), center: v(-7, 0.095, 5.0), role: 'hallRoute' },
]);

/** Four corner posts (structure-high scale 1.0, top 1.5; the base is sunk in the 0.08 floor). */
export const ERA_ENV_HALL_POSTS: readonly EraEnvironmentPrefabInstance[] = Object.freeze([
    { id: 'hall_post_1', group: 'hall', position: v(-9.85, 0, 0.7), rotationY: 0, scale: 1.0 },
    { id: 'hall_post_2', group: 'hall', position: v(-9.85, 0, 6.5), rotationY: 0, scale: 1.0 },
    { id: 'hall_post_3', group: 'hall', position: v(-4.15, 0, 0.7), rotationY: 0, scale: 1.0 },
    { id: 'hall_post_4', group: 'hall', position: v(-4.15, 0, 6.5), rotationY: 0, scale: 1.0 },
]);

// ---------------------------------------------------------------------------------------------------------------
// Vertical group (Era III): two pylons behind the rear wall, a catwalk between them, dim cyan lamps and the hall front trim

export const ERA_ENV_PYLON_TOP = 3.0;
export const ERA_ENV_CATWALK_Y = 2.2;

export const ERA_ENV_VERTICAL_BOXES: readonly EraEnvironmentBox[] = Object.freeze([
    { id: 'catwalk', group: 'vertical', size: v(4.2, 0.1, 0.5), center: v(-7.1, ERA_ENV_CATWALK_Y, 7.4), color: ERA_ENV_GRAPHITE },
    { id: 'catwalk_lamp_1', group: 'vertical', size: v(0.14, 0.06, 0.14), center: v(-8.3, 2.28, 7.4), color: ERA_ENV_CYAN },
    { id: 'catwalk_lamp_2', group: 'vertical', size: v(0.14, 0.06, 0.14), center: v(-7.5, 2.28, 7.4), color: ERA_ENV_CYAN },
    { id: 'catwalk_lamp_3', group: 'vertical', size: v(0.14, 0.06, 0.14), center: v(-6.7, 2.28, 7.4), color: ERA_ENV_CYAN },
    { id: 'catwalk_lamp_4', group: 'vertical', size: v(0.14, 0.06, 0.14), center: v(-5.9, 2.28, 7.4), color: ERA_ENV_CYAN },
    { id: 'hall_front_trim', group: 'vertical', size: v(6.0, 0.03, 0.06), center: v(-7, 0.095, 0.13), color: ERA_ENV_CYAN },
]);

/** Pylons: two structure-high stacked at scale 1.0 (top 3.0), turned 90 deg so they stand flat against the rear wall. */
export const ERA_ENV_PYLONS: readonly EraEnvironmentPrefabInstance[] = Object.freeze([
    { id: 'pylon_west_low', group: 'vertical', position: v(-9.2, 0, 7.4), rotationY: 90, scale: 1.0 },
    { id: 'pylon_west_high', group: 'vertical', position: v(-9.2, 1.5, 7.4), rotationY: 90, scale: 1.0 },
    { id: 'pylon_east_low', group: 'vertical', position: v(-5.0, 0, 7.4), rotationY: 90, scale: 1.0 },
    { id: 'pylon_east_high', group: 'vertical', position: v(-5.0, 1.5, 7.4), rotationY: 90, scale: 1.0 },
]);

// ---------------------------------------------------------------------------------------------------------------
// AI Megafactory teaser (Era III only; static, non-interactive; no label)

export const TEASER_CENTER_X = -7.5;
export const TEASER_APRON_COLOR = rgb(44, 52, 60);
export const TEASER_GATE_COLOR = rgb(38, 46, 56);
export const TEASER_CORE_SIZE = 0.4;
export const TEASER_CORE_CENTER = v(TEASER_CENTER_X, 2.9, 10.0);
export const TEASER_CORE_TILT_DEG = 45;
export const TEASER_CORE_SPIN_DEG_PER_SECOND = 10;
/** Door seam pulse: 60..100% of the environment cyan every 3 s. */
export const TEASER_SEAM_PULSE_SECONDS = 3;
export const TEASER_SEAM_PULSE_MIN = 0.6;

export const ERA_ENV_TEASER_BOXES: readonly EraEnvironmentBox[] = Object.freeze([
    { id: 'teaser_apron', group: 'teaser', size: v(5.0, 0.1, 1.8), center: v(TEASER_CENTER_X, 0.05, 9.9), color: TEASER_APRON_COLOR },
    { id: 'teaser_gate', group: 'teaser', size: v(4.0, 2.6, 0.4), center: v(TEASER_CENTER_X, 1.3, 10.4), color: TEASER_GATE_COLOR },
    { id: 'teaser_seam', group: 'teaser', size: v(0.12, 1.8, 0.05), center: v(TEASER_CENTER_X, 1.1, 10.175), color: ERA_ENV_CYAN },
    { id: 'teaser_core', group: 'teaser', size: v(TEASER_CORE_SIZE, TEASER_CORE_SIZE, TEASER_CORE_SIZE), center: TEASER_CORE_CENTER, color: ERA_ENV_CYAN },
]);

/** Two flanking structure-high at scale 1.6 (top 2.4). */
export const ERA_ENV_TEASER_FLANKS: readonly EraEnvironmentPrefabInstance[] = Object.freeze([
    { id: 'teaser_flank_west', group: 'teaser', position: v(TEASER_CENTER_X - 2.4, 0, 10.4), rotationY: 0, scale: 1.6 },
    { id: 'teaser_flank_east', group: 'teaser', position: v(TEASER_CENTER_X + 2.4, 0, 10.4), rotationY: 0, scale: 1.6 },
]);

export const ERA_ENV_TEASER_NODE_LIMIT = 7;

// ---------------------------------------------------------------------------------------------------------------
// Aggregates

export const ERA_ENV_BOXES: readonly EraEnvironmentBox[] = Object.freeze([...ERA_ENV_HALL_BOXES, ...ERA_ENV_VERTICAL_BOXES, ...ERA_ENV_TEASER_BOXES]);
export const ERA_ENV_PREFAB_INSTANCES: readonly EraEnvironmentPrefabInstance[] = Object.freeze([...ERA_ENV_HALL_POSTS, ...ERA_ENV_PYLONS, ...ERA_ENV_TEASER_FLANKS]);
/** Every node id the environment owns (the only nodes it may scale or recolour besides the three shell boxes). */
export const ERA_ENV_NODE_IDS: readonly string[] = Object.freeze([...ERA_ENV_BOXES.map((box) => box.id), ...ERA_ENV_PREFAB_INSTANCES.map((instance) => instance.id)]);

export interface EraEnvironmentBounds { readonly min: EnvVec3; readonly max: EnvVec3 }

/** Axis-aligned world bounds of a box. */
export function boxBounds(box: EraEnvironmentBox): EraEnvironmentBounds {
    return {
        min: v(box.center.x - (box.size.x / 2), box.center.y - (box.size.y / 2), box.center.z - (box.size.z / 2)),
        max: v(box.center.x + (box.size.x / 2), box.center.y + (box.size.y / 2), box.center.z + (box.size.z / 2)),
    };
}

/** Conservative axis-aligned world bounds of a structure-high instance (yaw 0 or 90 only). */
export function prefabBounds(instance: EraEnvironmentPrefabInstance): EraEnvironmentBounds {
    const quarter = Math.abs(Math.round(instance.rotationY / 90)) % 2 === 1;
    const halfX = ((quarter ? STRUCTURE_HIGH_BOUNDS.depth : STRUCTURE_HIGH_BOUNDS.width) * instance.scale) / 2;
    const halfZ = ((quarter ? STRUCTURE_HIGH_BOUNDS.width : STRUCTURE_HIGH_BOUNDS.depth) * instance.scale) / 2;
    return {
        min: v(instance.position.x - halfX, instance.position.y, instance.position.z - halfZ),
        max: v(instance.position.x + halfX, instance.position.y + (STRUCTURE_HIGH_BOUNDS.height * instance.scale), instance.position.z + halfZ),
    };
}

/** Conservative bounds of the spinning core cube (sphere of the cube diagonal). */
export function teaserCoreBounds(): EraEnvironmentBounds {
    const r = (TEASER_CORE_SIZE * Math.sqrt(3)) / 2;
    return { min: v(TEASER_CORE_CENTER.x - r, TEASER_CORE_CENTER.y - r, TEASER_CORE_CENTER.z - r), max: v(TEASER_CORE_CENTER.x + r, TEASER_CORE_CENTER.y + r, TEASER_CORE_CENTER.z + r) };
}

/** Teaser node count (primitives + prefab flanks). */
export function teaserNodeCount(): number {
    return ERA_ENV_TEASER_BOXES.length + ERA_ENV_TEASER_FLANKS.length;
}
