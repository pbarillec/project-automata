import { AUTOMATED_CELL_BELT_TOP, AUTOMATED_CELL_MODULE_TRANSFORMS, AUTOMATED_CELL_ROBOT_HEIGHT } from './AutomatedCellLayout.ts';

/**
 * AUT-043 fake cell production (pure, engine-free, deterministic). No per-item simulation, no physics, no state
 * access: every sample is a function of a presentation clock (seconds) and the cycle length. A pooled box rides the
 * input belt and scale-hides into the core; after a fixed dwell a Robot scales up at the output belt, slides out
 * and scale-hides. Pool slots are staggered evenly across the cycle. Arms run a repeating timer yaw / nod. Lamps blink
 * once per cycle. Presentation only.
 */
export const AUTOMATED_CELL_INPUT_X = AUTOMATED_CELL_MODULE_TRANSFORMS.conveyor_in.position.x;
export const AUTOMATED_CELL_OUTPUT_X = AUTOMATED_CELL_MODULE_TRANSFORMS.conveyor_out.position.x;
/** Belt start (slab edge side) and the core front face the items travel to / from (world z). */
export const AUTOMATED_CELL_BELT_START_Z = 1.15;
export const AUTOMATED_CELL_BELT_END_Z = 1.5;
/** The robot slides out to the slab edge region and hides. */
export const AUTOMATED_CELL_ROBOT_EXIT_Z = 1.05;

export const AUTOMATED_CELL_BOX_RIDE_SECONDS = 1.0;
export const AUTOMATED_CELL_DWELL_SECONDS = 1.2;
export const AUTOMATED_CELL_ROBOT_OUT_SECONDS = 1.2;
/** One job: box ride, dwell inside the core, robot out. Must fit inside the shortest cycle (3.6 s). */
export const AUTOMATED_CELL_JOB_SECONDS = AUTOMATED_CELL_BOX_RIDE_SECONDS + AUTOMATED_CELL_DWELL_SECONDS + AUTOMATED_CELL_ROBOT_OUT_SECONDS;
export const AUTOMATED_CELL_POOL_LIMIT = 3;

const BOX_IN_RAMP = 0.15;
const BOX_OUT_RAMP = 0.25;
const ROBOT_IN_RAMP = 0.25;
const ROBOT_OUT_RAMP = 0.35;

export interface AutomatedCellItemSample {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    /** 0..1 visibility multiplier (scale hide, never node.active). */
    readonly visibility: number;
}

export interface AutomatedCellJobSample {
    readonly slot: number;
    readonly box: AutomatedCellItemSample;
    readonly robot: AutomatedCellItemSample;
    /** Heading about Y (degrees) of the finished robot: it leaves toward -z (camera side). */
    readonly robotHeadingDeg: number;
    /** Whole cycles completed by this slot (recycle counter). */
    readonly cycle: number;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** Clock advance (seconds); negative or non-finite deltas are ignored. */
export function advanceCellClock(clock: number, deltaSeconds: number): number {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    return clock + dt;
}

/** Start offset of a pool slot so the slots stay evenly staggered whatever the pool size. */
export function cellSlotOffsetSeconds(slot: number, poolSize: number, cycleSeconds: number): number {
    return poolSize > 0 ? (slot * cycleSeconds) / poolSize : 0;
}

/** One pooled job at clock `clock` (seconds). */
export function sampleCellJob(clock: number, slot: number, poolSize: number, cycleSeconds: number): AutomatedCellJobSample {
    const raw = (clock + cellSlotOffsetSeconds(slot, poolSize, cycleSeconds)) / cycleSeconds;
    const cycle = Math.floor(raw);
    const t = (raw - cycle) * cycleSeconds;

    const boxU = clamp01(t / AUTOMATED_CELL_BOX_RIDE_SECONDS);
    const boxVisible = t < AUTOMATED_CELL_BOX_RIDE_SECONDS
        ? clamp01(t / BOX_IN_RAMP) * clamp01((AUTOMATED_CELL_BOX_RIDE_SECONDS - t) / BOX_OUT_RAMP)
        : 0;
    const box: AutomatedCellItemSample = {
        x: AUTOMATED_CELL_INPUT_X,
        y: AUTOMATED_CELL_BELT_TOP,
        z: AUTOMATED_CELL_BELT_START_Z + (boxU * (AUTOMATED_CELL_BELT_END_Z - AUTOMATED_CELL_BELT_START_Z)),
        visibility: boxVisible,
    };

    const robotStart = AUTOMATED_CELL_BOX_RIDE_SECONDS + AUTOMATED_CELL_DWELL_SECONDS;
    const local = t - robotStart;
    const robotU = clamp01(local / AUTOMATED_CELL_ROBOT_OUT_SECONDS);
    const robotVisible = local >= 0 && local < AUTOMATED_CELL_ROBOT_OUT_SECONDS
        ? clamp01(local / ROBOT_IN_RAMP) * clamp01((AUTOMATED_CELL_ROBOT_OUT_SECONDS - local) / ROBOT_OUT_RAMP)
        : 0;
    const robot: AutomatedCellItemSample = {
        x: AUTOMATED_CELL_OUTPUT_X,
        y: AUTOMATED_CELL_BELT_TOP,
        z: AUTOMATED_CELL_BELT_END_Z + (robotU * (AUTOMATED_CELL_ROBOT_EXIT_Z - AUTOMATED_CELL_BELT_END_Z)),
        visibility: robotVisible,
    };
    return { slot, box, robot, robotHeadingDeg: 180, cycle };
}

export function sampleCellJobs(clock: number, poolSize: number, cycleSeconds: number): readonly AutomatedCellJobSample[] {
    const n = Math.min(AUTOMATED_CELL_POOL_LIMIT, Math.max(0, Math.floor(poolSize)));
    const jobs: AutomatedCellJobSample[] = [];
    for (let slot = 0; slot < n; slot += 1) jobs.push(sampleCellJob(clock, slot, n, cycleSeconds));
    return jobs;
}

export const AUTOMATED_CELL_ARM_YAW_DEG = 15;
export const AUTOMATED_CELL_ARM_PITCH_DEG = 3;
/** Phase offsets (fraction of the arm period) of arm 1 / 2 / 3: arm 2 half a period out, arm 3 a third. */
export const AUTOMATED_CELL_ARM_PHASE_OFFSETS: readonly number[] = Object.freeze([0, 0.5, 1 / 3]);

export interface AutomatedCellArmPose {
    readonly yawDeg: number;
    /** Rotation about X: the nod. */
    readonly pitchDeg: number;
}

/** Repeating timer cycle (not reactive); `armIndex` 0..2 selects arm 1..3. */
export function sampleCellArmPose(timeSeconds: number, armIndex: number, periodSeconds: number): AutomatedCellArmPose {
    const offset = AUTOMATED_CELL_ARM_PHASE_OFFSETS[armIndex] ?? 0;
    const angle = ((timeSeconds / periodSeconds) + offset) * Math.PI * 2;
    return {
        yawDeg: Math.sin(angle) * AUTOMATED_CELL_ARM_YAW_DEG,
        pitchDeg: Math.max(0, Math.sin((angle * 2) + 0.6)) * AUTOMATED_CELL_ARM_PITCH_DEG,
    };
}

/** Each lamp is off for this fraction of the cycle, once per cycle, at its own offset (blink on the cycle). */
export const AUTOMATED_CELL_LAMP_BLINK_FRACTION = 0.08;

/** True while the lamp `lampIndex` of `lampCount` is lit. */
export function sampleCellLampLit(clock: number, lampIndex: number, lampCount: number, cycleSeconds: number): boolean {
    const phase = (((clock / cycleSeconds) - (lampIndex / Math.max(1, lampCount))) % 1 + 1) % 1;
    return phase >= AUTOMATED_CELL_LAMP_BLINK_FRACTION;
}

/** Top of the tallest thing riding the belts: the finished robot standing on the output belt. */
export const AUTOMATED_CELL_ITEM_MAX_TOP = AUTOMATED_CELL_BELT_TOP + AUTOMATED_CELL_ROBOT_HEIGHT;
