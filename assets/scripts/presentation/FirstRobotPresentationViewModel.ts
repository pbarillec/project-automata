import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveAssemblyVisualState, type AssemblyVisualDescriptor } from './AssemblyVisualStateResolver.ts';

/**
 * AUT-039 pure projection for the first Worker Bot payoff (ART_DIRECTION §6.5, GAME_DESIGN §18).
 *
 * - The live runtime Worker Bot unlock (`firstRobotProduced`; the robot appears in a fanned-out snapshot)
 *   in Civilization 1 requests ONE reveal beat (bay light, activation, short camera focus, walk to Assembly,
 *   then the work loop). The event is deduplicated.
 * - A loaded save that already owns Worker Bot rebuilds the robot directly in its work loop: no reveal
 *   replay (AUT-INT-001 pattern).
 * - Civilization 2+: the short acknowledgement is deferred (Game Designer); the robot appears in its loop
 *   with no camera focus.
 * The robot is a visual representation of the breakthrough, never an economic worker entity: this view
 * model only reads GameState and DomainEvents and never emits a command.
 */
export type FirstRobotMode = 'hidden' | 'reveal' | 'loop';

export interface FirstRobotPresentationSnapshot {
    readonly assembly: AssemblyVisualDescriptor;
    readonly robotMode: FirstRobotMode;
    readonly revealRequested: boolean;
    readonly revealId: number | null;
    readonly civilizationNumber: number;
}

function eventKey(event: DomainEvent): string { return JSON.stringify(event); }

export class FirstRobotPresentationViewModel {
    private readonly handledEvents = new Set<string>();
    private modeValue: FirstRobotMode = 'hidden';
    private revealIdValue: number | null = null;
    private revealRequestedValue = false;

    /** Initial / restored state: never starts a reveal. */
    public syncFromState(state: GameState): FirstRobotPresentationSnapshot {
        const assembly = resolveAssemblyVisualState(state);
        if (!assembly.robotPresent) {
            this.modeValue = 'hidden';
            this.revealRequestedValue = false;
        } else if (this.modeValue === 'hidden') {
            this.modeValue = 'loop';
        }
        return this.snapshot(state, assembly);
    }

    public consumeEvents(state: GameState, events: readonly DomainEvent[]): FirstRobotPresentationSnapshot {
        const assembly = resolveAssemblyVisualState(state);
        for (const event of events) {
            if (event.type !== 'firstRobotProduced') continue;
            const key = eventKey(event);
            if (this.handledEvents.has(key)) continue;
            this.handledEvents.add(key);
        }
        if (!assembly.robotPresent) {
            this.modeValue = 'hidden';
            this.revealRequestedValue = false;
        } else if (this.modeValue === 'hidden') {
            // The robot appeared during the live session (never on load: that is `syncFromState`). The binding's
            // tick fan-out can deliver the post-purchase snapshot before the purchase batch that carries
            // `firstRobotProduced` (the command awaits its save request), so the live transition starts the reveal
            // and the event, whichever batch it arrives in, is deduplicated.
            const civilizationOne = state.meta.civilizationNumber <= 1;
            if (civilizationOne && this.revealIdValue === null) {
                this.modeValue = 'reveal';
                this.revealIdValue = 1;
                this.revealRequestedValue = true;
            } else {
                this.modeValue = 'loop';
            }
        }
        return this.snapshot(state, assembly);
    }

    /** The controller started the requested reveal beat. */
    public acknowledgeReveal(): void { this.revealRequestedValue = false; }

    /** The robot reached the station: the reveal is over and the work loop runs. */
    public completeReveal(): void {
        this.revealRequestedValue = false;
        if (this.modeValue === 'reveal') this.modeValue = 'loop';
    }

    public get mode(): FirstRobotMode { return this.modeValue; }
    public get handledEventCount(): number { return this.handledEvents.size; }

    private snapshot(state: GameState, assembly: AssemblyVisualDescriptor): FirstRobotPresentationSnapshot {
        return {
            assembly,
            robotMode: this.modeValue,
            revealRequested: this.revealRequestedValue,
            revealId: this.revealIdValue,
            civilizationNumber: state.meta.civilizationNumber,
        };
    }
}
