import { ARC_BELT_TOP, ARC_MODULE_TRANSFORMS, ARC_OVERHEAD_BELT_TOP, ARC_ROBOT_HEIGHT } from './AdvancedRoboticsComplexLayout.ts';
import { sampleArcExitPoint } from './AdvancedRoboticsComplexExitRoute.ts';

/**
 * AUT-044 fake complex production (pure, engine-free, deterministic). No per-item simulation, no physics, no state
 * access: every sample is a function of a presentation clock (seconds) and the cycle length. A pooled box rides the
 * entry belt (or, for the Lv10 fourth slot, the overhead gantry belt) and scale-hides into the core / head; after a
 * fixed 1.5 s dwell a Robot scales up at the exit belt, slides to the apron pad and scale-hides. The cycle is the
 * cadence between two finished products: pool slots are staggered by one cycle and each slot loops once per
 * `cycle x pool` seconds. Arms run a repeating timer yaw / nod, lamps blink once per cycle, the spire lamp pulses
 * once per cycle. Presentation only.
 */
export const ARC_INPUT_X = ARC_MODULE_TRANSFORMS.conveyor_in.position.x;
/** Entry belt start (slab edge side) and the core front face the boxes travel to (world z). */
export const ARC_BELT_START_Z = 3.7;
export const ARC_BELT_END_Z = 4.2;
/** Overhead belt: the box rides from the west end of the belt into the head (world x, z 5.0). */
export const ARC_OVERHEAD_START_X = -1.55;
export const ARC_OVERHEAD_END_X = -1.25;
export const ARC_OVERHEAD_Z = ARC_MODULE_TRANSFORMS.overhead_belt.position.z;
/** The Lv10 slot whose box rides the overhead belt (the second feed). */
export const ARC_OVERHEAD_SLOT = 3;

export const ARC_BOX_RIDE_SECONDS = 1.0;
export const ARC_DWELL_SECONDS = 1.5;
export const ARC_ROBOT_OUT_SECONDS = 1.6;
/** One job: box ride, dwell inside the core, robot out. Must fit inside the shortest slot period (2.4 x 4 = 9.6 s; Lv1 3.0 x 3 = 9.0 s). */
export const ARC_JOB_SECONDS = ARC_BOX_RIDE_SECONDS + ARC_DWELL_SECONDS + ARC_ROBOT_OUT_SECONDS;
export const ARC_POOL_LIMIT = 4;

const BOX_IN_RAMP = 0.15;
const BOX_OUT_RAMP = 0.25;
const ROBOT_IN_RAMP = 0.25;
const ROBOT_OUT_RAMP = 0.35;

export type ArcFeedRoute = 'input_belt' | 'overhead_belt';

export interface ArcItemSample {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    /** 0..1 visibility multiplier (scale hide, never node.active). */
    readonly visibility: number;
}

export interface ArcJobSample {
    readonly slot: number;
    readonly route: ArcFeedRoute;
    readonly box: ArcItemSample;
    readonly robot: ArcItemSample;
    /** Heading about Y (degrees) of the finished robot: it leaves toward -z (camera side). */
    readonly robotHeadingDeg: number;
    /** Whole slot loops completed by this slot (recycle counter). */
    readonly cycle: number;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** Clock advance (seconds); negative or non-finite deltas are ignored. */
export function advanceArcClock(clock: number, deltaSeconds: number): number {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    return clock + dt;
}

/** Start offset of a pool slot: slots are staggered by one production cycle (the cadence between finished robots). */
export function arcSlotOffsetSeconds(slot: number, poolSize: number, cycleSeconds: number): number {
    return poolSize > 0 ? slot * cycleSeconds : 0;
}

/** Seconds one slot needs for a full loop. */
export function arcSlotPeriodSeconds(poolSize: number, cycleSeconds: number): number {
    return Math.max(1, Math.floor(poolSize)) * cycleSeconds;
}

/** One pooled job at clock `clock` (seconds). */
export function sampleArcJob(clock: number, slot: number, poolSize: number, cycleSeconds: number): ArcJobSample {
    const period = arcSlotPeriodSeconds(poolSize, cycleSeconds);
    const raw = (clock + arcSlotOffsetSeconds(slot, poolSize, cycleSeconds)) / period;
    const cycle = Math.floor(raw);
    const t = (raw - cycle) * period;
    const route: ArcFeedRoute = slot === ARC_OVERHEAD_SLOT && poolSize >= ARC_POOL_LIMIT ? 'overhead_belt' : 'input_belt';

    const boxU = clamp01(t / ARC_BOX_RIDE_SECONDS);
    const boxVisible = t < ARC_BOX_RIDE_SECONDS
        ? clamp01(t / BOX_IN_RAMP) * clamp01((ARC_BOX_RIDE_SECONDS - t) / BOX_OUT_RAMP)
        : 0;
    const box: ArcItemSample = route === 'overhead_belt'
        ? { x: ARC_OVERHEAD_START_X + (boxU * (ARC_OVERHEAD_END_X - ARC_OVERHEAD_START_X)), y: ARC_OVERHEAD_BELT_TOP, z: ARC_OVERHEAD_Z, visibility: boxVisible }
        : { x: ARC_INPUT_X, y: ARC_BELT_TOP, z: ARC_BELT_START_Z + (boxU * (ARC_BELT_END_Z - ARC_BELT_START_Z)), visibility: boxVisible };

    const robotStart = ARC_BOX_RIDE_SECONDS + ARC_DWELL_SECONDS;
    const local = t - robotStart;
    const robotU = clamp01(local / ARC_ROBOT_OUT_SECONDS);
    const robotVisible = local >= 0 && local < ARC_ROBOT_OUT_SECONDS
        ? clamp01(local / ROBOT_IN_RAMP) * clamp01((ARC_ROBOT_OUT_SECONDS - local) / ROBOT_OUT_RAMP)
        : 0;
    const point = sampleArcExitPoint(robotU);
    const robot: ArcItemSample = { x: point.x, y: point.y, z: point.z, visibility: robotVisible };
    return { slot, route, box, robot, robotHeadingDeg: 180, cycle };
}

export function sampleArcJobs(clock: number, poolSize: number, cycleSeconds: number): readonly ArcJobSample[] {
    const n = Math.min(ARC_POOL_LIMIT, Math.max(0, Math.floor(poolSize)));
    const jobs: ArcJobSample[] = [];
    for (let slot = 0; slot < n; slot += 1) jobs.push(sampleArcJob(clock, slot, n, cycleSeconds));
    return jobs;
}

export const ARC_ARM_YAW_DEG = 15;
export const ARC_ARM_PITCH_DEG = 3;
/** Phase offsets (fraction of the arm period) of arm 1 / arm 2 / arm B: arm 2 half a period out, arm B a third. */
export const ARC_ARM_PHASE_OFFSETS: readonly number[] = Object.freeze([0, 0.5, 1 / 3]);

export interface ArcArmPose {
    readonly yawDeg: number;
    /** Rotation about X: the nod. */
    readonly pitchDeg: number;
}

/** Repeating timer cycle (not reactive); `armIndex` 0..2 selects arm 1, arm 2, arm B. */
export function sampleArcArmPose(timeSeconds: number, armIndex: number, periodSeconds: number): ArcArmPose {
    const offset = ARC_ARM_PHASE_OFFSETS[armIndex] ?? 0;
    const angle = ((timeSeconds / periodSeconds) + offset) * Math.PI * 2;
    return {
        yawDeg: Math.sin(angle) * ARC_ARM_YAW_DEG,
        pitchDeg: Math.max(0, Math.sin((angle * 2) + 0.6)) * ARC_ARM_PITCH_DEG,
    };
}

/** Each lamp is off for this fraction of the cycle, once per cycle, at its own offset (blink on the cycle). */
export const ARC_LAMP_BLINK_FRACTION = 0.08;

/** True while the lamp `lampIndex` of `lampCount` is lit. */
export function sampleArcLampLit(clock: number, lampIndex: number, lampCount: number, cycleSeconds: number): boolean {
    const phase = (((clock / cycleSeconds) - (lampIndex / Math.max(1, lampCount))) % 1 + 1) % 1;
    return phase >= ARC_LAMP_BLINK_FRACTION;
}

/** Spire lamp pulse (Lv10): a smooth 0.6..1 scale factor, once per cycle. */
export function sampleArcSpirePulse(clock: number, cycleSeconds: number): number {
    return 0.8 + (0.2 * Math.cos((clock / cycleSeconds) * Math.PI * 2));
}

/** Top of the tallest thing riding the belts: the finished robot standing on the exit belt. */
export const ARC_ITEM_MAX_TOP = ARC_BELT_TOP + ARC_ROBOT_HEIGHT;
