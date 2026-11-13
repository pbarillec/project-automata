import { FACTORY_WORLD_SELECTION_PRODUCER_IDS } from './FactoryWorldStateBinding.ts';
import type { MilestoneAccent, MilestoneTrigger, PresentedMilestoneTier } from './MilestoneTier.ts';

/** Light pulse length on the producer (Minor short, Major about 1 s) and Major spark length, in seconds. */
export const MILESTONE_PULSE_SECONDS: Readonly<Record<PresentedMilestoneTier, number>> = Object.freeze({ minor: 0.5, major: 1.0 });
export const MILESTONE_SPARK_SECONDS = 0.8;
/** Major sparks: 4-6 nodes from the existing AUT-040 spark pool. */
export const MILESTONE_SPARK_COUNT = 6;
export const MILESTONE_SPARK_COUNT_RANGE = Object.freeze({ min: 4, max: 6 });

/** Accent colours (RGB). Cyan is dimmer than the producer lamps (82,206,224); amber is the construction / breakthrough colour. Never red. */
export const MILESTONE_ACCENT_RGB: Readonly<Record<MilestoneAccent, { readonly r: number; readonly g: number; readonly b: number }>> = Object.freeze({
    amber: Object.freeze({ r: 255, g: 190, b: 80 }),
    cyan: Object.freeze({ r: 80, g: 190, b: 205 }),
});

export interface MilestoneEffectSample {
    /** 0..1 pulse envelope (the pulse plate scale). */
    readonly pulse: number;
    /** 0..1 spark intensity (0 when the trigger has no sparks). */
    readonly sparkIntensity: number;
    readonly complete: boolean;
}

/** Pure effect envelope at `elapsed` seconds after the toast started. */
export function sampleMilestoneEffect(trigger: MilestoneTrigger, elapsed: number): MilestoneEffectSample {
    const t = Math.max(0, elapsed);
    const pulseSeconds = MILESTONE_PULSE_SECONDS[trigger.tier];
    const pulseDone = !trigger.pulse || t >= pulseSeconds;
    const sparkDone = !trigger.sparks || t >= MILESTONE_SPARK_SECONDS;
    // Wide plateau (clamped) so the pulse is clearly visible for most of its length.
    const pulse = trigger.pulse && t < pulseSeconds ? Math.min(1, 1.6 * Math.sin(Math.PI * (t / pulseSeconds))) : 0;
    const sparkIntensity = trigger.sparks && t < MILESTONE_SPARK_SECONDS ? Math.sin(Math.PI * (t / MILESTONE_SPARK_SECONDS)) : 0;
    return { pulse, sparkIntensity, complete: pulseDone && sparkDone };
}

/** A focus is "off-centre" when the target is at least this far (world units, XZ) from the current camera focus. */
export const MILESTONE_FOCUS_OFF_CENTRE_DISTANCE = 2.5;

export type MilestoneFocusSkipReason = 'not_major' | 'no_target' | 'suppressed_by_exceptional' | 'reveal_active' | 'camera_busy' | 'on_centre' | 'no_camera';

export interface MilestoneFocusInput {
    readonly trigger: MilestoneTrigger;
    /** Current camera focus (XZ), null when there is no camera. */
    readonly cameraFocus: { readonly x: number; readonly z: number } | null;
    /** World position of the target producer's focus anchor, null when it does not exist. */
    readonly target: { readonly x: number; readonly z: number } | null;
    /** An Exceptional reveal / construction sequence is running right now. */
    readonly exceptionalRevealActive: boolean;
    /** A camera focus transition is already running (any beat, or the player's own pan owns the camera). */
    readonly cameraFocusActive: boolean;
}

export interface MilestoneFocusDecision {
    readonly focus: boolean;
    readonly reason: MilestoneFocusSkipReason | 'requested';
}

/**
 * Whether a Major toast also asks the existing reveal focus API for a beat. Minor never focuses; a Major only focuses when its
 * target is off-centre, when nothing else owns the camera and when no Exceptional reveal / construction is running or shares the
 * burst (the toast is shown regardless). The beat itself is the existing camera's ease; a touch / pan interrupts it there.
 */
export function resolveMilestoneFocus(input: MilestoneFocusInput): MilestoneFocusDecision {
    if (input.trigger.tier !== 'major') return { focus: false, reason: 'not_major' };
    if (input.trigger.focusProducerId === null) return { focus: false, reason: 'no_target' };
    if (input.trigger.focusSuppressed) return { focus: false, reason: 'suppressed_by_exceptional' };
    if (input.exceptionalRevealActive) return { focus: false, reason: 'reveal_active' };
    if (input.cameraFocusActive) return { focus: false, reason: 'camera_busy' };
    if (!input.cameraFocus) return { focus: false, reason: 'no_camera' };
    if (!input.target) return { focus: false, reason: 'no_target' };
    const distance = Math.hypot(input.target.x - input.cameraFocus.x, input.target.z - input.cameraFocus.z);
    if (distance < MILESTONE_FOCUS_OFF_CENTRE_DISTANCE) return { focus: false, reason: 'on_centre' };
    return { focus: true, reason: 'requested' };
}

/**
 * Zone node name of a producer id (`assembly_station` -> `AssemblyStation`). The world nodes are named by zone
 * (`Zone_AssemblyStation/AssemblyStation_FocusAnchor`), NOT by the snake_case producer id; AUT-046's first lookup used the producer id and
 * never found an anchor, so no pulse, spark or focus was ever placed.
 */
export function producerZoneName(producerId: string): string | null {
    for (const [zone, id] of Object.entries(FACTORY_WORLD_SELECTION_PRODUCER_IDS)) if (id === producerId) return zone;
    return null;
}
