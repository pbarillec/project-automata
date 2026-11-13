import { MILESTONE_FOCUS_OFF_CENTRE_DISTANCE } from './MilestoneFeedback.ts';
import type { MilestoneAccent, MilestoneTrigger } from './MilestoneTier.ts';

/**
 * AUT-048 era transition presentation (pure data + rules, no `cc`). The layer is a TITLE CARD (a new Exceptional tier of the AUT-046
 * toast band) plus an optional camera focus beat, on top of the AUT-045 environment fade (which is NOT re-implemented here).
 * Everything is derived from the era id (snapshot) or the `eraChanged` event; the dedupe fact key is `e:<newEraId>`.
 * Presentation holds no state and issues no command.
 */

/** How the focus beat is gated. Era II: the Robot Line construction sequence owns the camera. Era III: only the on-centre rule. */
export type EraFocusRule = 'construction_gated' | 'on_centre';

export interface EraTransitionSpec {
    readonly eraId: string;
    /** Title card wording (all caps, one line, no subtitle). English text lives here until the catalogue move (AUT-052). */
    readonly title: string;
    /** Underline accent: Era II amber, Era III cyan (AUT-045 environment cyan). */
    readonly accent: MilestoneAccent;
    /** The card starts this many seconds after the transition was observed (t0 = `eraChanged` observed; the environment fade starts at t0). */
    readonly cardDelaySeconds: number;
    /** Producer whose `Zone_<Zone>/<Zone>_FocusAnchor` the focus beat targets. */
    readonly focusProducerId: string;
    readonly focusRule: EraFocusRule;
}

/** One row per presented era. Era I (workshop) and any unknown era have no row: nothing is presented. Era IV does not exist. */
export const ERA_TRANSITION_SPECS: Readonly<Record<string, EraTransitionSpec>> = Object.freeze({
    automated_factory: Object.freeze({ eraId: 'automated_factory', title: 'AUTOMATED FACTORY', accent: 'amber' as const, cardDelaySeconds: 0.6, focusProducerId: 'robot_line', focusRule: 'construction_gated' as const }),
    robotics_complex: Object.freeze({ eraId: 'robotics_complex', title: 'ROBOTICS COMPLEX ONLINE', accent: 'cyan' as const, cardDelaySeconds: 0.4, focusProducerId: 'advanced_robotics_complex', focusRule: 'on_centre' as const }),
});

export function eraTransitionSpec(eraId: string | null | undefined): EraTransitionSpec | null {
    return typeof eraId === 'string' && Object.prototype.hasOwnProperty.call(ERA_TRANSITION_SPECS, eraId) ? ERA_TRANSITION_SPECS[eraId] : null;
}

/** Dedupe fact key of an era transition. */
export function eraFactKey(eraId: string): string {
    return `e:${eraId}`;
}

/** The title card trigger (Exceptional tier, no pulse / sparks), or null for an era that has no card. */
export function buildEraTrigger(eraId: string | null | undefined): MilestoneTrigger | null {
    const spec = eraTransitionSpec(eraId);
    if (!spec) return null;
    return Object.freeze({
        key: eraFactKey(spec.eraId),
        tier: 'exceptional' as const,
        kind: 'era_title' as const,
        accent: spec.accent,
        producerId: null,
        breakthroughId: null,
        milestoneId: null,
        threshold: null,
        focusProducerId: spec.focusProducerId,
        sparks: false,
        pulse: false,
        eraId: spec.eraId,
        focusSuppressed: false,
    });
}

export type EraFocusSkipReason = 'no_era' | 'no_camera' | 'no_target' | 'reveal_active' | 'camera_busy' | 'on_centre';

export interface EraFocusInput {
    readonly eraId: string;
    /** Current camera focus (XZ), null when there is no camera. */
    readonly cameraFocus: { readonly x: number; readonly z: number } | null;
    /** World position of the focus anchor of the era's producer, null when it does not exist. */
    readonly target: { readonly x: number; readonly z: number } | null;
    /** An AUT-040 construction sequence is running (it owns the camera). */
    readonly constructionActive: boolean;
    /** A camera focus transition is already running. */
    readonly cameraFocusActive: boolean;
}

export interface EraFocusDecision {
    readonly focus: boolean;
    readonly reason: EraFocusSkipReason | 'requested';
}

/**
 * Whether the title card also asks the existing reveal focus API for a beat (never a new camera API, never the Era III teaser).
 * Era II: skipped while the Robot Line construction sequence (or any camera focus) is active, else the Robot Line anchor.
 * Era III: the Robotics Complex anchor, skipped when it is already within 2.5 world units of the camera focus (on-centre rule).
 * A touch / pan cancels the focus inside the camera itself (no re-snap); the card and the environment fade continue.
 */
export function resolveEraFocus(input: EraFocusInput): EraFocusDecision {
    const spec = eraTransitionSpec(input.eraId);
    if (!spec) return { focus: false, reason: 'no_era' };
    if (spec.focusRule === 'construction_gated') {
        if (input.constructionActive) return { focus: false, reason: 'reveal_active' };
        if (input.cameraFocusActive) return { focus: false, reason: 'camera_busy' };
    }
    if (!input.cameraFocus) return { focus: false, reason: 'no_camera' };
    if (!input.target) return { focus: false, reason: 'no_target' };
    if (spec.focusRule === 'on_centre') {
        const distance = Math.hypot(input.target.x - input.cameraFocus.x, input.target.z - input.cameraFocus.z);
        if (distance < MILESTONE_FOCUS_OFF_CENTRE_DISTANCE) return { focus: false, reason: 'on_centre' };
    }
    return { focus: true, reason: 'requested' };
}
