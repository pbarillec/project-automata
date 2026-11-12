import { ROBOT_LINE_LOOP_SECONDS, sampleLineLoopPose } from './RobotLineExitRoute.ts';
import { WORKER_BOT_LOOP_SECONDS, sampleLoopPose, type WorkerBotClip } from './WorkerBotRoute.ts';

/**
 * AUT-041 engine-free robot population model (ART_DIRECTION 15.2-15.4, TECHNICAL_DESIGN 14.1).
 * `Robots Built` is a cumulative metric, never a 1:1 node count: it maps to a small capped number of visible
 * robots (milestone anchors, interpolated on log10, saturating), each following a predefined loop with
 * deterministic per-robot variation. No pathfinding, no job AI, no state access. Presentation only.
 */

/** Approved anchors (ART_DIRECTION 15.2): Robots Built -> approx. visible 3D robots. */
export const ROBOT_POPULATION_ANCHORS: readonly (readonly [number, number])[] = Object.freeze([
    Object.freeze([0, 0] as const),
    Object.freeze([1, 1] as const),
    Object.freeze([10, 3] as const),
    Object.freeze([100, 7] as const),
    Object.freeze([1000, 12] as const),
    Object.freeze([10000, 14] as const),
]);

/** Baseline maximum visible robots (14). The device benchmark may raise it up to the pool limit. */
export const ROBOT_POPULATION_BASELINE_MAX = 14;
export const ROBOT_POPULATION_POOL_LIMIT = 30;
/** Device benchmark sizes (TECHNICAL_DESIGN 14.1 / CODEX_PLAN AUT-041). */
export const ROBOT_POPULATION_BENCHMARK_SIZES: readonly number[] = Object.freeze([1, 8, 14, 20, 30]);

/** DEBUG-only benchmark override file in the app writable path: `{ "maxVisible": 1 | 8 | 14 | 20 | 30 }`. Never read in release builds. */
export const POPULATION_BENCHMARK_FILE = 'population_benchmark.json';

export interface RobotPopulationOptions {
    /** Cap on visible robots (default 14, hard limit 30). */
    readonly maxVisible?: number;
}

/** Visible robot count for a Robots Built value: monotone, saturating, at least 1 once any robot is built. */
export function resolveVisibleRobotCount(robotsBuilt: number, options: RobotPopulationOptions = {}): number {
    const cap = Math.min(ROBOT_POPULATION_POOL_LIMIT, Math.max(0, Math.floor(options.maxVisible ?? ROBOT_POPULATION_BASELINE_MAX)));
    if (!Number.isFinite(robotsBuilt) || robotsBuilt < 1) return 0;
    const anchors = ROBOT_POPULATION_ANCHORS;
    const last = anchors[anchors.length - 1];
    let visible = last[1];
    if (robotsBuilt < last[0]) {
        for (let i = 1; i < anchors.length; i += 1) {
            const [x1, y1] = anchors[i];
            if (robotsBuilt > x1) continue;
            const [x0, y0] = anchors[i - 1];
            const u = x0 < 1 ? 0 : (Math.log10(robotsBuilt) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0));
            visible = i === 1 ? y1 : y0 + ((y1 - y0) * u);
            break;
        }
    }
    // A benchmark cap above the baseline stretches the whole curve so the larger sizes are reachable.
    const stretch = cap > ROBOT_POPULATION_BASELINE_MAX ? cap / ROBOT_POPULATION_BASELINE_MAX : 1;
    return Math.min(cap, Math.max(1, Math.round(visible * stretch)));
}

/** Rank 0 is always the first Worker Bot (AUT-039); the rest of the population is pooled. */
export function resolvePooledRobotCount(visible: number, firstRobotPresent: boolean): number {
    return firstRobotPresent ? Math.max(0, visible - 1) : 0;
}

export interface RobotSlotVariation {
    /** Pool slot, 0-based (overall rank = slot + 1). */
    readonly slot: number;
    /** Start phase inside the Assembly <-> Storage loop, in seconds. */
    readonly phaseSeconds: number;
    /** Start phase as a fraction (0..1) of any loop; the Line -> Exit -> Storage loop scales it by its own period. */
    readonly phaseFraction: number;
    /** Walk/idle time scale (0.92..1.08). */
    readonly speedFactor: number;
    /** Sideways offset from the loop, world units (at most 0.12). */
    readonly lateralOffset: number;
    /** Model scale multiplier (0.96..1.04). */
    readonly scaleFactor: number;
}

export const ROBOT_LATERAL_MAX = 0.12;

function hash01(slot: number, salt: number): number {
    let h = Math.imul((slot + 1) ^ Math.imul(salt + 7, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export function robotSlotVariation(slot: number): RobotSlotVariation {
    // Golden-ratio phase spacing keeps robots spread around the loop whatever the count.
    const phase = ((slot + 1) * 0.6180339887498949) % 1;
    return Object.freeze({
        slot,
        phaseSeconds: phase * WORKER_BOT_LOOP_SECONDS,
        phaseFraction: phase,
        speedFactor: 0.92 + (hash01(slot, 1) * 0.16),
        lateralOffset: (hash01(slot, 2) * 2 - 1) * ROBOT_LATERAL_MAX,
        scaleFactor: 0.96 + (hash01(slot, 3) * 0.08),
    });
}

export interface RobotPoolPose {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly headingDeg: number;
    readonly clip: WorkerBotClip;
}

/** AUT-042: which predefined loop a pooled robot follows. */
export type PoolRobotRoute = 'assembly_storage' | 'line_storage';

/** About one third of the pooled robots (slots 1, 4, 7, ... = ranks 2, 5, 8, ...) take the Line -> Exit -> Storage loop once the Robot Line is built. */
export const ROBOT_LINE_ROUTE_STRIDE = 3;
export const ROBOT_LINE_ROUTE_FIRST_SLOT = 1;

export function resolvePoolRobotRoute(slot: number, robotLineBuilt: boolean): PoolRobotRoute {
    return robotLineBuilt && slot >= ROBOT_LINE_ROUTE_FIRST_SLOT && (slot - ROBOT_LINE_ROUTE_FIRST_SLOT) % ROBOT_LINE_ROUTE_STRIDE === 0 ? 'line_storage' : 'assembly_storage';
}

/** Pose of a pooled robot `t` seconds after the population clock start (periodic, deterministic). */
export function sampleRobotPoolPose(variation: RobotSlotVariation, t: number, route: PoolRobotRoute = 'assembly_storage'): RobotPoolPose {
    const pose = route === 'line_storage'
        ? sampleLineLoopPose((t * variation.speedFactor) + (variation.phaseFraction * ROBOT_LINE_LOOP_SECONDS))
        : sampleLoopPose((t * variation.speedFactor) + variation.phaseSeconds);
    const radians = (pose.headingDeg * Math.PI) / 180;
    // Perpendicular to the heading (heading 0 faces +Z, so the right-hand side is +X).
    return {
        x: pose.x + (Math.cos(radians) * variation.lateralOffset),
        y: pose.y,
        z: pose.z - (Math.sin(radians) * variation.lateralOffset),
        headingDeg: pose.headingDeg,
        clip: pose.clip,
    };
}

export interface RobotPoolPlan {
    readonly visibleSlots: number;
    /** Slots newly shown by this change. */
    readonly shown: readonly number[];
    /** Slots newly hidden by this change (highest first). */
    readonly hidden: readonly number[];
    /** Pool nodes that must exist (instantiated lazily, never destroyed). */
    readonly instantiate: number;
}

/** Instance pool bookkeeping: growth instantiates once, shrink only hides. */
export class RobotPopulationPool {
    private visibleCount = 0;
    private created = 0;

    public get visible(): number { return this.visibleCount; }
    public get instantiated(): number { return this.created; }

    public resize(pooled: number): RobotPoolPlan {
        const target = Math.min(ROBOT_POPULATION_POOL_LIMIT - 1, Math.max(0, Math.floor(pooled)));
        const shown: number[] = [];
        const hidden: number[] = [];
        for (let slot = this.visibleCount; slot < target; slot += 1) shown.push(slot);
        for (let slot = this.visibleCount - 1; slot >= target; slot -= 1) hidden.push(slot);
        this.visibleCount = target;
        this.created = Math.max(this.created, target);
        return { visibleSlots: target, shown, hidden, instantiate: this.created };
    }
}
