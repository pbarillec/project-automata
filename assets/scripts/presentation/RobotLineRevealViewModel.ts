import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveRobotLineVisualState, type RobotLineVisualDescriptor } from './RobotLineVisualStateResolver.ts';

/**
 * AUT-042 Era II reveal hook (pure, read-only). Robot Line construction is the authoritative Era II transition
 * (`eraChanged` to `automated_factory`); this view model only remembers whether that era change was SEEN LIVE
 * (a live `eraChanged` event or a live snapshot transition), so the construction beat can report an
 * "Era II reveal" to DEBUG diagnostics. A save load never counts. It never submits a command or writes state, and
 * it carries no title / door / light sweep (that belongs to AUT-048).
 */
export const AUTOMATED_FACTORY_ERA_ID = 'automated_factory';

/** DEBUG `robot_line_state` phases. */
export type RobotLineStatePhase = 'synced' | 'construction_started' | 'activated' | 'focus_requested' | 'item_cycle';
export const ROBOT_LINE_STATE_PHASES: readonly RobotLineStatePhase[] = Object.freeze(['synced', 'construction_started', 'activated', 'focus_requested', 'item_cycle']);

export interface RobotLineRevealSnapshot {
    readonly descriptor: RobotLineVisualDescriptor;
    /** A live Era II change was seen and not yet consumed by a construction beat. */
    readonly eraRevealPending: boolean;
}

export interface RobotLineConstructionBeat {
    /** One bounded camera focus beat on the line (the construction is live). */
    readonly focusRequested: boolean;
    /** The construction coincides with a live Era II change. */
    readonly eraReveal: boolean;
}

function eventKey(event: DomainEvent): string { return JSON.stringify(event); }

export class RobotLineRevealViewModel {
    private initialised = false;
    private wasAutomatedFactory = false;
    private eraRevealSeen = false;
    private readonly handledEvents = new Set<string>();

    /** Initial / restored state or a later snapshot: never starts a reveal by itself on load. */
    public syncFromState(state: GameState): RobotLineRevealSnapshot {
        const descriptor = resolveRobotLineVisualState(state);
        const automated = state.run.currentEraId === AUTOMATED_FACTORY_ERA_ID;
        if (!automated) this.eraRevealSeen = false;
        else if (this.initialised && !this.wasAutomatedFactory) this.eraRevealSeen = true;
        this.wasAutomatedFactory = automated;
        this.initialised = true;
        return { descriptor, eraRevealPending: this.eraRevealSeen };
    }

    public consumeEvents(state: GameState, events: readonly DomainEvent[]): RobotLineRevealSnapshot {
        for (const event of events) {
            if (event.type !== 'eraChanged' || event.newEraId !== AUTOMATED_FACTORY_ERA_ID) continue;
            const key = eventKey(event);
            if (this.handledEvents.has(key)) continue;
            this.handledEvents.add(key);
            if (this.initialised) this.eraRevealSeen = true;
        }
        const descriptor = resolveRobotLineVisualState(state);
        this.wasAutomatedFactory = state.run.currentEraId === AUTOMATED_FACTORY_ERA_ID;
        if (!this.wasAutomatedFactory) this.eraRevealSeen = false;
        return { descriptor, eraRevealPending: this.eraRevealSeen };
    }

    /** The AUT-040 construction sequence started for the Robot Line (never on a save load): one focus beat. */
    public beginConstructionBeat(): RobotLineConstructionBeat {
        const beat = { focusRequested: true, eraReveal: this.eraRevealSeen };
        this.eraRevealSeen = false;
        return beat;
    }
}
