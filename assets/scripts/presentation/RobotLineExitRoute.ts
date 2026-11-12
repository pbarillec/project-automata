import { floorHeightAt, type WorldPoint } from './AssemblySliceLayout.ts';
import { WORKER_BOT_WALK_SPEED, headingBetween, type WorkerBotPose } from './WorkerBotRoute.ts';

/**
 * AUT-042 engine-free Line -> Exit -> Storage loop for pooled population robots (AUT-041 extension; no
 * pathfinding, no AI, no state access). A robot waits at the output lip, walks over the slab edge, crosses the
 * spine to its south side, follows the storage lane west to the storage crate, dwells, and returns. World x/z.
 * Art Director route intent: lip -> spine south side -> west to the storage crate, `Robot_Walking`. The east end
 * is pulled in (lip stop x 5.3, crossing x ~4.3) so the whole route stays on screen at the default portrait
 * view; dwell times and the walk speed are implementer tuning values (Scene Presentation).
 */
export interface RobotLineStop extends WorldPoint {
    readonly id: string;
    readonly dwellSeconds: number;
    /** Heading while dwelling (0 = +Z); null keeps the arrival heading. */
    readonly dwellHeadingDeg: number | null;
}

export const ROBOT_LINE_LOOP_ROUTE: readonly RobotLineStop[] = Object.freeze([
    Object.freeze({ id: 'line_lip', x: 5.3, z: -1.9, dwellSeconds: 1.2, dwellHeadingDeg: -90 }),
    Object.freeze({ id: 'lip_exit', x: 5.3, z: -1.6, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'exit_slab', x: 5.22, z: -1.38, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'exit_cross', x: 4.3, z: -0.3, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'exit_south', x: 4.1, z: 0.3, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'storage_pick', x: -0.25, z: 0.7, dwellSeconds: 1.0, dwellHeadingDeg: -90 }),
    Object.freeze({ id: 'return_south', x: 3.9, z: 0.55, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'return_cross', x: 4.4, z: -0.3, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'return_slab', x: 5.22, z: -1.38, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'return_lip', x: 5.3, z: -1.6, dwellSeconds: 0, dwellHeadingDeg: null }),
]);

interface Segment {
    readonly start: number;
    readonly duration: number;
    readonly from: WorldPoint;
    readonly to: WorldPoint;
    readonly headingDeg: number;
    readonly clip: 'Robot_Walking' | 'Robot_Idle';
}

function build(): Segment[] {
    const segments: Segment[] = [];
    const count = ROBOT_LINE_LOOP_ROUTE.length;
    let at = 0;
    let heading = headingBetween(ROBOT_LINE_LOOP_ROUTE[count - 1], ROBOT_LINE_LOOP_ROUTE[0]);
    for (let i = 0; i < count; i += 1) {
        const stop = ROBOT_LINE_LOOP_ROUTE[i];
        const next = ROBOT_LINE_LOOP_ROUTE[(i + 1) % count];
        if (stop.dwellSeconds > 0) {
            segments.push({ start: at, duration: stop.dwellSeconds, from: stop, to: stop, headingDeg: stop.dwellHeadingDeg ?? heading, clip: 'Robot_Idle' });
            at += stop.dwellSeconds;
        }
        const duration = Math.hypot(next.x - stop.x, next.z - stop.z) / WORKER_BOT_WALK_SPEED;
        heading = headingBetween(stop, next);
        segments.push({ start: at, duration, from: stop, to: next, headingDeg: heading, clip: 'Robot_Walking' });
        at += duration;
    }
    return segments;
}

const TIMELINE: readonly Segment[] = Object.freeze(build());

/** One full Line -> Exit -> Storage -> return lap. */
export const ROBOT_LINE_LOOP_SECONDS = TIMELINE[TIMELINE.length - 1].start + TIMELINE[TIMELINE.length - 1].duration;

/** Loop pose at `t` seconds (periodic, deterministic); the shape matches the AUT-039 loop pose. */
export function sampleLineLoopPose(t: number): WorkerBotPose {
    const wrapped = ((t % ROBOT_LINE_LOOP_SECONDS) + ROBOT_LINE_LOOP_SECONDS) % ROBOT_LINE_LOOP_SECONDS;
    let segment = TIMELINE[TIMELINE.length - 1];
    for (const candidate of TIMELINE) {
        if (wrapped < candidate.start + candidate.duration) { segment = candidate; break; }
    }
    const u = segment.duration > 0 ? Math.min(1, Math.max(0, (wrapped - segment.start) / segment.duration)) : 1;
    const x = segment.from.x + ((segment.to.x - segment.from.x) * u);
    const z = segment.from.z + ((segment.to.z - segment.from.z) * u);
    return { phase: 'loop', x, y: floorHeightAt(x, z), z, headingDeg: segment.headingDeg, clip: segment.clip };
}
