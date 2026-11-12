import { floorHeightAt, type WorldPoint } from './AssemblySliceLayout.ts';
import { WORKER_BOT_WALK_SPEED, headingBetween, type WorkerBotPose } from './WorkerBotRoute.ts';

/**
 * AUT-043 engine-free Cell -> Storage loop for pooled population robots (AUT-041 extension, same shape as the AUT-042
 * Robot Line loop; no pathfinding, no AI, no state access). A robot waits at the cell output pad, walks west along the
 * south lane (over the one-flow guide strip, clear of the Line -> Storage lane z 0.3..0.7) to the storage crate,
 * dwells, and returns on a parallel lane. World x/z. Dwell times and walk speed are implementer tuning values.
 */
export interface AutomatedCellStop extends WorldPoint {
    readonly id: string;
    readonly dwellSeconds: number;
    /** Heading while dwelling (0 = +Z); null keeps the arrival heading. */
    readonly dwellHeadingDeg: number | null;
}

export const AUTOMATED_CELL_LOOP_ROUTE: readonly AutomatedCellStop[] = Object.freeze([
    // Pad in front of the output conveyor (z 1.105), facing the cell while it dwells.
    Object.freeze({ id: 'cell_pad', x: 2.7, z: 1.0, dwellSeconds: 1.0, dwellHeadingDeg: 0 }),
    Object.freeze({ id: 'pad_exit', x: 2.3, z: 0.88, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'cell_lane', x: 1.0, z: 0.86, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'storage_pick', x: -0.25, z: 1.0, dwellSeconds: 1.0, dwellHeadingDeg: -90 }),
    Object.freeze({ id: 'return_lane', x: 1.0, z: 0.98, dwellSeconds: 0, dwellHeadingDeg: null }),
    Object.freeze({ id: 'return_pad', x: 2.4, z: 0.96, dwellSeconds: 0, dwellHeadingDeg: null }),
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
    const count = AUTOMATED_CELL_LOOP_ROUTE.length;
    let at = 0;
    let heading = headingBetween(AUTOMATED_CELL_LOOP_ROUTE[count - 1], AUTOMATED_CELL_LOOP_ROUTE[0]);
    for (let i = 0; i < count; i += 1) {
        const stop = AUTOMATED_CELL_LOOP_ROUTE[i];
        const next = AUTOMATED_CELL_LOOP_ROUTE[(i + 1) % count];
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

/** One full Cell -> Storage -> return lap. */
export const AUTOMATED_CELL_LOOP_SECONDS = TIMELINE[TIMELINE.length - 1].start + TIMELINE[TIMELINE.length - 1].duration;

/** Loop pose at `t` seconds (periodic, deterministic); the shape matches the AUT-042 loop pose. */
export function sampleCellLoopPose(t: number): WorkerBotPose {
    const wrapped = ((t % AUTOMATED_CELL_LOOP_SECONDS) + AUTOMATED_CELL_LOOP_SECONDS) % AUTOMATED_CELL_LOOP_SECONDS;
    let segment = TIMELINE[TIMELINE.length - 1];
    for (const candidate of TIMELINE) {
        if (wrapped < candidate.start + candidate.duration) { segment = candidate; break; }
    }
    const u = segment.duration > 0 ? Math.min(1, Math.max(0, (wrapped - segment.start) / segment.duration)) : 1;
    const x = segment.from.x + ((segment.to.x - segment.from.x) * u);
    const z = segment.from.z + ((segment.to.z - segment.from.z) * u);
    return { phase: 'loop', x, y: floorHeightAt(x, z), z, headingDeg: segment.headingDeg, clip: segment.clip };
}
