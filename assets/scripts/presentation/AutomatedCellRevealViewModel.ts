import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveAutomatedCellVisualState, type AutomatedCellVisualDescriptor } from './AutomatedCellVisualStateResolver.ts';

/**
 * AUT-043 reveal hook (pure, read-only). The Automated Cell has no Era change of its own; this view model only
 * produces the descriptor and the single bounded camera focus beat of the live construction. A save load never
 * counts (the controller only asks for a beat when the AUT-040 sequence starts, which never happens on load). It never
 * submits a command or writes state and carries no title / door / light sweep (AUT-048).
 */

/** DEBUG `automated_cell_state` phases. */
export type AutomatedCellStatePhase = 'synced' | 'construction_started' | 'activated' | 'focus_requested' | 'item_cycle';
export const AUTOMATED_CELL_STATE_PHASES: readonly AutomatedCellStatePhase[] = Object.freeze(['synced', 'construction_started', 'activated', 'focus_requested', 'item_cycle']);

export interface AutomatedCellRevealSnapshot {
    readonly descriptor: AutomatedCellVisualDescriptor;
}

export interface AutomatedCellConstructionBeat {
    /** One bounded camera focus beat on the cell (the construction is live). */
    readonly focusRequested: boolean;
}

export class AutomatedCellRevealViewModel {
    /** Initial / restored state or a later snapshot: never starts a reveal by itself. */
    public syncFromState(state: GameState): AutomatedCellRevealSnapshot {
        return { descriptor: resolveAutomatedCellVisualState(state) };
    }

    public consumeEvents(state: GameState, _events: readonly DomainEvent[]): AutomatedCellRevealSnapshot {
        return { descriptor: resolveAutomatedCellVisualState(state) };
    }

    /** The AUT-040 construction sequence started for the Automated Cell (never on a save load): one focus beat. */
    public beginConstructionBeat(): AutomatedCellConstructionBeat {
        return { focusRequested: true };
    }
}
