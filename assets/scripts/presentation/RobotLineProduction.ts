import {
    ROBOT_LINE_AXIS_Z,
    ROBOT_LINE_BELT_TOP,
    ROBOT_LINE_FINISHED_ROBOT_HEIGHT,
    ROBOT_LINE_MODULE_TRANSFORMS,
} from './RobotLineLayout.ts';

/**
 * AUT-042 fake robot production (pure, engine-free, deterministic). Pooled belt items enter at x 1.2, ride the
 * belt to the output lip, scale out and recycle; each item starts as a blank chassis and swaps to a finished
 * Robot while hidden under the first machine roof. No per-item simulation, no physics, no state access: item
 * positions are a function of a belt clock. Arms run a repeating timer nod / rotate cycle (timer, not
 * reactive). Presentation only.
 */
export const ROBOT_LINE_ITEM_ENTRY_X = 1.2;
/** End of the lip plate (x 4.8..5.2): items scale out here. */
export const ROBOT_LINE_ITEM_LIP_X = 5.2;
/** Belt speed (units per second) at the baseline cadence. */
export const ROBOT_LINE_BELT_SPEED = 0.5;
export const ROBOT_LINE_ITEM_POOL_SIZE = 4;

const MACHINE_A_X = ROBOT_LINE_MODULE_TRANSFORMS.machine_a.position.x;
const MACHINE_B_X = ROBOT_LINE_MODULE_TRANSFORMS.machine_b.position.x;
/** machine.glb half length at scale 0.5. */
const MACHINE_HALF = 0.3;
const ENTRY_RAMP = 0.2;
const EXIT_RAMP = 0.25;
const EMERGE_RAMP = 0.2;

export type RobotLineItemKind = 'chassis' | 'robot';

export interface RobotLineItemSample {
    readonly slot: number;
    /** Position along the belt, world units. */
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly kind: RobotLineItemKind;
    /** 0..1 visibility multiplier (scale hide, never node.active). */
    readonly visibility: number;
    /** Heading about Y (degrees): the finished robot faces +X, along the belt. */
    readonly headingDeg: number;
    /** Whole belt cycles completed by this item (recycle counter). */
    readonly cycle: number;
}

/** Belt travel (entry to lip), world units. */
export const ROBOT_LINE_ITEM_TRAVEL = ROBOT_LINE_ITEM_LIP_X - ROBOT_LINE_ITEM_ENTRY_X;

/** Belt clock advance in cycles: `cadence` 1 (Lv1) or 1.2 (Lv10). */
export function advanceBeltClock(clock: number, deltaSeconds: number, cadence: number): number {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    return clock + ((dt * ROBOT_LINE_BELT_SPEED * cadence) / ROBOT_LINE_ITEM_TRAVEL);
}

/** Seconds per belt cycle at a cadence. */
export function beltCycleSeconds(cadence: number): number {
    return ROBOT_LINE_ITEM_TRAVEL / (ROBOT_LINE_BELT_SPEED * cadence);
}

/** Golden-ratio phase of a pool slot (0..1) so items stay staggered whatever the count. */
export function beltItemPhase(slot: number): number {
    return ((slot + 1) * 0.6180339887498949) % 1;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** One item at belt-clock `clock` (cycles). `machineB` adds the Lv10 second machine tunnel. */
export function sampleBeltItem(clock: number, slot: number, machineB: boolean): RobotLineItemSample {
    const raw = clock + beltItemPhase(slot);
    const cycle = Math.floor(raw);
    const u = raw - cycle;
    const x = ROBOT_LINE_ITEM_ENTRY_X + (u * ROBOT_LINE_ITEM_TRAVEL);
    const kind: RobotLineItemKind = x < MACHINE_A_X ? 'chassis' : 'robot';
    let visibility = clamp01((x - ROBOT_LINE_ITEM_ENTRY_X) / ENTRY_RAMP) * clamp01((ROBOT_LINE_ITEM_LIP_X - x) / EXIT_RAMP);
    if (kind === 'robot') {
        // Emerges from under the first machine roof.
        visibility *= clamp01((x - (MACHINE_A_X + MACHINE_HALF)) / EMERGE_RAMP);
        if (machineB) {
            // The Lv10 second machine is a tunnel: the robot shrinks into it and emerges after it.
            visibility *= x < MACHINE_B_X
                ? clamp01((MACHINE_B_X - MACHINE_HALF - x) / EMERGE_RAMP)
                : clamp01((x - (MACHINE_B_X + MACHINE_HALF)) / EMERGE_RAMP);
        }
    }
    return { slot, x, y: ROBOT_LINE_BELT_TOP, z: ROBOT_LINE_AXIS_Z, kind, visibility, headingDeg: 90, cycle };
}

export function sampleBeltItems(clock: number, count: number, machineB: boolean): readonly RobotLineItemSample[] {
    const n = Math.min(ROBOT_LINE_ITEM_POOL_SIZE, Math.max(0, Math.floor(count)));
    const items: RobotLineItemSample[] = [];
    for (let slot = 0; slot < n; slot += 1) items.push(sampleBeltItem(clock, slot, machineB));
    return items;
}

/** Top of the tallest thing on the belt: a finished robot standing on it. */
export const ROBOT_LINE_ITEM_MAX_TOP = ROBOT_LINE_BELT_TOP + ROBOT_LINE_FINISHED_ROBOT_HEIGHT;

export const ROBOT_LINE_ARM_PERIOD_SECONDS = 3.2;
export const ROBOT_LINE_ARM_YAW_DEG = 12;
export const ROBOT_LINE_ARM_PITCH_DEG = 3;

export interface RobotLineArmPose {
    readonly yawDeg: number;
    /** Rotation about X (toward the belt, +Z): the nod. */
    readonly pitchDeg: number;
}

/** Repeating timer cycle (not reactive); `armIndex` offsets the phase so the two arms never move in sync. */
export function sampleArmPose(timeSeconds: number, armIndex: number): RobotLineArmPose {
    const turns = (timeSeconds / ROBOT_LINE_ARM_PERIOD_SECONDS) + (armIndex * 0.37);
    const angle = turns * Math.PI * 2;
    return {
        yawDeg: Math.sin(angle) * ROBOT_LINE_ARM_YAW_DEG,
        pitchDeg: Math.max(0, Math.sin((angle * 2) + 0.6)) * ROBOT_LINE_ARM_PITCH_DEG,
    };
}
