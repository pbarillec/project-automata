import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveArcVisualState, type ArcVisualDescriptor } from './AdvancedRoboticsComplexVisualStateResolver.ts';

/**
 * AUT-044 reveal hook (pure, read-only). The Advanced Robotics Complex is built by the `advanced_robotics` breakthrough,
 * which also enters era `robotics_complex`; the era transition presentation (title / door / light sweep) belongs to
 * AUT-048 and is NOT handled here. This view model only produces the descriptor and the single bounded camera focus
 * beat of the live construction. A save load never counts (the controller only asks for a beat when the AUT-040
 * sequence starts, which never happens on load). It never submits a command or writes state.
 */

/** DEBUG `advanced_robotics_complex_state` phases. */
export type ArcStatePhase = 'synced' | 'construction_started' | 'activated' | 'focus_requested' | 'item_cycle';
export const ARC_STATE_PHASES: readonly ArcStatePhase[] = Object.freeze(['synced', 'construction_started', 'activated', 'focus_requested', 'item_cycle']);

export interface ArcRevealSnapshot {
    readonly descriptor: ArcVisualDescriptor;
}

export interface ArcConstructionBeat {
    /** One bounded camera focus beat on the complex (the construction is live). */
    readonly focusRequested: boolean;
}

export class AdvancedRoboticsComplexRevealViewModel {
    /** Initial / restored state or a later snapshot: never starts a reveal by itself. */
    public syncFromState(state: GameState): ArcRevealSnapshot {
        return { descriptor: resolveArcVisualState(state) };
    }

    public consumeEvents(state: GameState, _events: readonly DomainEvent[]): ArcRevealSnapshot {
        return { descriptor: resolveArcVisualState(state) };
    }

    /** The AUT-040 construction sequence started for the complex (never on a save load): one focus beat. */
    public beginConstructionBeat(): ArcConstructionBeat {
        return { focusRequested: true };
    }
}
