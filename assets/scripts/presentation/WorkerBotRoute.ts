import { floorHeightAt, type WorldPoint } from './AssemblySliceLayout.ts';

/**
 * AUT-039 engine-free, deterministic Worker Bot route (one robot, predefined waypoints; no pool, no AI,
 * no pathfinding — TECHNICAL_DESIGN §14.1, ART_DIRECTION §15.4). Presentation only: it never reads or
 * writes GameState.
 *
 * Art Director intent (2026-11-11, world x/z):
 * - reveal entry: bay (-3.4, 0.7) -> (-2.6, 0.3) -> station (-1.8, -1.3);
 * - work loop: station (-1.8, -1.3) -> spine crossing (-1.4, -0.3) -> storage pick (-0.8, 0.45)
 *   -> return (-1.2, -0.3) -> station;
 * - clips: `Robot_ThumbsUp` once at activation, then `Robot_Walking` on the route, `Robot_Idle` at the
 *   station (`Robot_Running` is reserved for Overclock);
 * - reveal beat 3.0 s (tunable 2.5..3.5).
 * Speeds and dwell times are implementer tuning values for Scene Presentation (not economy values).
 */

export type WorkerBotClip = 'Robot_ThumbsUp' | 'Robot_Walking' | 'Robot_Idle';
export type WorkerBotMode = 'hidden' | 'reveal' | 'loop';
export type WorkerBotPhase = 'hidden' | 'activation' | 'entry' | 'loop';

export interface WorkerBotStop extends WorldPoint {
    readonly id: string;
    /** Idle time at this stop when it is reached on the loop (0 = walk through). */
    readonly dwellSeconds: number;
    /** Heading while dwelling (degrees about Y, 0 = facing +Z); null keeps the arrival heading. */
    readonly dwellHeadingDeg: number | null;
}

export const WORKER_BOT_REVEAL_SECONDS = 3.0;
/** `Robot_ThumbsUp` plays once (clip length 1.583 s). */
export const WORKER_BOT_ACTIVATION_SECONDS = 1.6;
export const WORKER_BOT_WALK_SPEED = 0.9;

export const WORKER_BOT_BAY: WorkerBotStop = Object.freeze({ id: 'bay', x: -3.4, z: 0.7, dwellSeconds: 0, dwellHeadingDeg: null });

/** Entry path after the bay (the station is its last point). */
export const WORKER_BOT_ENTRY_ROUTE: readonly WorkerBotStop[] = Object.freeze([
    Object.freeze({ id: 'bay_exit', x: -2.6, z: 0.3, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'station', x: -1.8, z: -1.3, dwellSeconds: 0, dwellHeadingDeg: null }),
]);

/** Closed work loop starting at the station (the robot faces the workstation, -X, while working). */
export const WORKER_BOT_LOOP_ROUTE: readonly WorkerBotStop[] = Object.freeze([
    Object.freeze({ id: 'station', x: -1.8, z: -1.3, dwellSeconds: 2.5, dwellHeadingDeg: -90 }),
    Object.freeze({ id: 'spine_crossing', x: -1.4, z: -0.3, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'storage_pick', x: -0.8, z: 0.45, dwellSeconds: 1.0, dwellHeadingDeg: 0 }),
    Object.freeze({ id: 'return', x: -1.2, z: -0.3, dwellSeconds: 0, dwellHeadingDeg: null }),
]);

export interface WorkerBotPose {
    readonly phase: WorkerBotPhase;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly headingDeg: number;
    readonly clip: WorkerBotClip;
}

interface Segment {
    readonly kind: 'dwell' | 'walk';
    readonly start: number;
    readonly duration: number;
    readonly from: WorldPoint;
    readonly to: WorldPoint;
    readonly headingDeg: number;
    readonly clip: WorkerBotClip;
    /** Stop reached at the end of a walk segment. */
    readonly arrivalId: string | null;
}

/** Heading (degrees about Y) that turns a +Z-facing model toward the direction from -> to. */
export function headingBetween(from: WorldPoint, to: WorldPoint): number {
    return (Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI;
}

function distance(a: WorldPoint, b: WorldPoint): number {
    return Math.hypot(b.x - a.x, b.z - a.z);
}

function buildEntryTimeline(): Segment[] {
    const segments: Segment[] = [];
    const firstHeading = headingBetween(WORKER_BOT_BAY, WORKER_BOT_ENTRY_ROUTE[0]);
    segments.push({ kind: 'dwell', start: 0, duration: WORKER_BOT_ACTIVATION_SECONDS, from: WORKER_BOT_BAY, to: WORKER_BOT_BAY, headingDeg: firstHeading, clip: 'Robot_ThumbsUp', arrivalId: null });
    let at = WORKER_BOT_ACTIVATION_SECONDS;
    let from: WorldPoint = WORKER_BOT_BAY;
    for (const stop of WORKER_BOT_ENTRY_ROUTE) {
        const duration = distance(from, stop) / WORKER_BOT_WALK_SPEED;
        segments.push({ kind: 'walk', start: at, duration, from, to: stop, headingDeg: headingBetween(from, stop), clip: 'Robot_Walking', arrivalId: stop.id });
        at += duration;
        from = stop;
    }
    return segments;
}

function buildLoopTimeline(arrivalHeading: number): Segment[] {
    const segments: Segment[] = [];
    let at = 0;
    let heading = arrivalHeading;
    const count = WORKER_BOT_LOOP_ROUTE.length;
    for (let i = 0; i < count; i += 1) {
        const stop = WORKER_BOT_LOOP_ROUTE[i];
        const next = WORKER_BOT_LOOP_ROUTE[(i + 1) % count];
        if (stop.dwellSeconds > 0) {
            segments.push({ kind: 'dwell', start: at, duration: stop.dwellSeconds, from: stop, to: stop, headingDeg: stop.dwellHeadingDeg ?? heading, clip: 'Robot_Idle', arrivalId: null });
            at += stop.dwellSeconds;
        }
        const duration = distance(stop, next) / WORKER_BOT_WALK_SPEED;
        heading = headingBetween(stop, next);
        segments.push({ kind: 'walk', start: at, duration, from: stop, to: next, headingDeg: heading, clip: 'Robot_Walking', arrivalId: next.id });
        at += duration;
    }
    return segments;
}

const ENTRY_TIMELINE: readonly Segment[] = Object.freeze(buildEntryTimeline());
const LOOP_TIMELINE: readonly Segment[] = Object.freeze(buildLoopTimeline(ENTRY_TIMELINE[ENTRY_TIMELINE.length - 1].headingDeg));

function timelineDuration(timeline: readonly Segment[]): number {
    const last = timeline[timeline.length - 1];
    return last.start + last.duration;
}

/** Activation + entry walk: the time from the reveal start until the robot reaches the station. */
export const WORKER_BOT_ENTRY_SECONDS = timelineDuration(ENTRY_TIMELINE);
/** One full work-loop lap. */
export const WORKER_BOT_LOOP_SECONDS = timelineDuration(LOOP_TIMELINE);

function segmentAt(timeline: readonly Segment[], t: number): Segment {
    for (const segment of timeline) {
        if (t < segment.start + segment.duration) return segment;
    }
    return timeline[timeline.length - 1];
}

function poseOn(segment: Segment, t: number, phase: WorkerBotPhase): WorkerBotPose {
    const u = segment.duration > 0 ? Math.min(1, Math.max(0, (t - segment.start) / segment.duration)) : 1;
    const x = segment.from.x + ((segment.to.x - segment.from.x) * u);
    const z = segment.from.z + ((segment.to.z - segment.from.z) * u);
    return { phase, x, y: floorHeightAt(x, z), z, headingDeg: segment.headingDeg, clip: segment.clip };
}

/** Reveal pose at `t` seconds after the reveal start (clamped to the station arrival). */
export function sampleEntryPose(t: number): WorkerBotPose {
    const clamped = Math.min(Math.max(0, t), WORKER_BOT_ENTRY_SECONDS);
    const segment = segmentAt(ENTRY_TIMELINE, clamped);
    return poseOn(segment, clamped, segment.kind === 'dwell' ? 'activation' : 'entry');
}

/** Loop pose at `t` seconds after the loop start (periodic). */
export function sampleLoopPose(t: number): WorkerBotPose {
    const wrapped = ((t % WORKER_BOT_LOOP_SECONDS) + WORKER_BOT_LOOP_SECONDS) % WORKER_BOT_LOOP_SECONDS;
    return poseOn(segmentAt(LOOP_TIMELINE, wrapped), wrapped, 'loop');
}

/** Stops reached while time advances from `t0` (exclusive) to `t1` (inclusive) on a timeline. */
function arrivalsBetween(timeline: readonly Segment[], period: number | null, t0: number, t1: number): string[] {
    const arrivals: string[] = [];
    if (t1 <= t0) return arrivals;
    const firstLap = period === null ? 0 : Math.floor(t0 / period);
    const lastLap = period === null ? 0 : Math.floor(t1 / period);
    for (let lap = firstLap; lap <= lastLap; lap += 1) {
        const offset = period === null ? 0 : lap * period;
        for (const segment of timeline) {
            if (segment.arrivalId === null) continue;
            const at = offset + segment.start + segment.duration;
            if (at > t0 && at <= t1) arrivals.push(segment.arrivalId);
        }
    }
    return arrivals;
}

export interface WorkerBotStep {
    readonly mode: WorkerBotMode;
    readonly pose: WorkerBotPose | null;
    /** Stop ids reached during this step, in order. */
    readonly arrivals: readonly string[];
    /** The 3.0 s reveal beat ended during this step. */
    readonly revealBeatEnded: boolean;
    /** The robot reached the station and the work loop started during this step. */
    readonly loopStarted: boolean;
    readonly lap: number;
}

/** Deterministic route playback: hidden -> reveal (activation + entry) -> loop, or straight to the loop. */
export class WorkerBotRoutePlayer {
    private modeValue: WorkerBotMode = 'hidden';
    private time = 0;

    public get mode(): WorkerBotMode { return this.modeValue; }
    public get elapsedSeconds(): number { return this.time; }

    public startReveal(): void {
        this.modeValue = 'reveal';
        this.time = 0;
    }

    /** A loaded save (or a Civilization 2+ unlock) places the robot directly in its work loop. */
    public startLoop(): void {
        this.modeValue = 'loop';
        this.time = 0;
    }

    public hide(): void {
        this.modeValue = 'hidden';
        this.time = 0;
    }

    public pose(): WorkerBotPose | null {
        if (this.modeValue === 'reveal') return sampleEntryPose(this.time);
        if (this.modeValue === 'loop') return sampleLoopPose(this.time);
        return null;
    }

    public advance(deltaSeconds: number): WorkerBotStep {
        const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
        if (this.modeValue === 'hidden') return { mode: 'hidden', pose: null, arrivals: [], revealBeatEnded: false, loopStarted: false, lap: 0 };
        const arrivals: string[] = [];
        let revealBeatEnded = false;
        let loopStarted = false;
        if (this.modeValue === 'reveal') {
            const t0 = this.time;
            const t1 = t0 + dt;
            revealBeatEnded = t0 < WORKER_BOT_REVEAL_SECONDS && t1 >= WORKER_BOT_REVEAL_SECONDS;
            if (t1 < WORKER_BOT_ENTRY_SECONDS) {
                arrivals.push(...arrivalsBetween(ENTRY_TIMELINE, null, t0, t1));
                this.time = t1;
            } else {
                arrivals.push(...arrivalsBetween(ENTRY_TIMELINE, null, t0, WORKER_BOT_ENTRY_SECONDS));
                const overflow = t1 - WORKER_BOT_ENTRY_SECONDS;
                this.modeValue = 'loop';
                this.time = 0;
                loopStarted = true;
                arrivals.push(...arrivalsBetween(LOOP_TIMELINE, WORKER_BOT_LOOP_SECONDS, 0, overflow));
                this.time = overflow;
            }
        } else {
            const t0 = this.time;
            this.time = t0 + dt;
            arrivals.push(...arrivalsBetween(LOOP_TIMELINE, WORKER_BOT_LOOP_SECONDS, t0, this.time));
        }
        const lap = this.modeValue === 'loop' ? Math.floor(this.time / WORKER_BOT_LOOP_SECONDS) : 0;
        return { mode: this.modeValue, pose: this.pose(), arrivals, revealBeatEnded, loopStarted, lap };
    }
}
