/**
 * AUT-040 reusable construction/reveal sequence (pure, engine-free, deterministic).
 * One generic timeline for any producer or module group: staged module reveal (ghost -> solid), a spark burst, a
 * construction light and one activation hook. Not a bespoke cinematic per producer. Presentation only.
 */

export const CONSTRUCTION_MIN_SECONDS = 1.5;
export const CONSTRUCTION_MAX_SECONDS = 3.0;
export const CONSTRUCTION_DEFAULT_SECONDS = 2.2;
/** Fraction of the timeline reserved at the end for activation (lights on, sparks settle). */
export const CONSTRUCTION_ACTIVATION_FRACTION = 0.2;
/** Scale factor of a module at the end of its ghost stage, before it builds up to full size. */
export const CONSTRUCTION_GHOST_SCALE = 0.35;

export type ConstructionModulePhase = 'pending' | 'ghost' | 'building' | 'done';

export interface ConstructionPlanOptions {
    readonly durationSeconds?: number;
}

export interface ConstructionPlan {
    readonly moduleIds: readonly string[];
    readonly durationSeconds: number;
}

export interface ConstructionModuleSample {
    readonly id: string;
    readonly phase: ConstructionModulePhase;
    /** 0..1 multiplier of the module's resting scale. 0 = hidden, 1 = fully built. */
    readonly scaleFactor: number;
}

export interface ConstructionSample {
    readonly progress: number;
    readonly complete: boolean;
    /** True once the activation window has started (lights on); the activation hook fires on `complete`. */
    readonly activating: boolean;
    readonly modules: readonly ConstructionModuleSample[];
    /** 0..1 spark burst strength: strong while modules build, fading at activation. */
    readonly sparkIntensity: number;
    /** 0..1 construction light level: ramps up with progress, flashes at activation. */
    readonly lightLevel: number;
}

export function clampConstructionDuration(seconds: number): number {
    if (!Number.isFinite(seconds)) return CONSTRUCTION_DEFAULT_SECONDS;
    return Math.min(CONSTRUCTION_MAX_SECONDS, Math.max(CONSTRUCTION_MIN_SECONDS, seconds));
}

export function buildConstructionPlan(moduleIds: readonly string[], options: ConstructionPlanOptions = {}): ConstructionPlan {
    return Object.freeze({
        moduleIds: Object.freeze([...moduleIds]),
        durationSeconds: clampConstructionDuration(options.durationSeconds ?? CONSTRUCTION_DEFAULT_SECONDS),
    });
}

function easeOutCubic(t: number): number {
    const x = 1 - t;
    return 1 - x * x * x;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * Samples the plan at `elapsedSeconds`. Modules reveal in plan order over the build window (the first
 * `1 - CONSTRUCTION_ACTIVATION_FRACTION` of the timeline) with overlapping windows: a module is a ghost for the
 * first 40% of its window, then builds to full scale.
 */
export function sampleConstruction(plan: ConstructionPlan, elapsedSeconds: number): ConstructionSample {
    const progress = clamp01(plan.durationSeconds > 0 ? elapsedSeconds / plan.durationSeconds : 1);
    const buildWindow = 1 - CONSTRUCTION_ACTIVATION_FRACTION;
    const count = plan.moduleIds.length;
    // Each module window spans two slots, so the last one ends exactly at the end of the build window.
    const slot = buildWindow / (count + 1);
    const windowLength = slot * 2;

    const modules: ConstructionModuleSample[] = plan.moduleIds.map((id, index) => {
        const start = index * slot;
        if (progress < start) return { id, phase: 'pending', scaleFactor: 0 };
        const local = clamp01((progress - start) / windowLength);
        if (local >= 1) return { id, phase: 'done', scaleFactor: 1 };
        if (local < 0.4) return { id, phase: 'ghost', scaleFactor: CONSTRUCTION_GHOST_SCALE * easeOutCubic(local / 0.4) };
        const build = (local - 0.4) / 0.6;
        return { id, phase: 'building', scaleFactor: CONSTRUCTION_GHOST_SCALE + (1 - CONSTRUCTION_GHOST_SCALE) * easeOutCubic(build) };
    });

    const complete = progress >= 1;
    const activating = progress >= buildWindow;
    const activation = clamp01((progress - buildWindow) / CONSTRUCTION_ACTIVATION_FRACTION);
    const sparkIntensity = complete ? 0 : activating ? 0.5 * (1 - activation) : 1;
    const lightLevel = complete ? 0 : activating ? 1 - Math.abs(activation * 2 - 1) * 0.5 : clamp01(progress / buildWindow) * 0.6;

    return { progress, complete, activating, modules, sparkIntensity, lightLevel };
}
