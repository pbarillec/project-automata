import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import {
    ERA_ENV_TRANSITION_DURATION,
    blendEraEnvironmentFrame,
    frameOfDescriptor,
    resolveEraEnvironment,
    resolveEraEnvironmentForEra,
    type EraEnvironmentDescriptor,
    type EraEnvironmentFrame,
} from './EraEnvironmentStateResolver.ts';

/**
 * AUT-045 era environment view model (pure, read-only). First sync / save load / any non-progressive change (a Reboot
 * returns the run to `manual_workshop`) SNAPS. Only a LIVE era change to a higher era (`currentEraId` moves forward while
 * the session runs) starts the fade / rise. The decision is taken from the authoritative state (the era id), never from
 * replayed events, so a snapshot that arrives before or after its `eraChanged` event (AUT-040 / AUT-043 ordering) starts
 * the transition exactly once: a second look at the same era is a no-op. No title, door sweep, camera move or replay
 * (AUT-048); it never submits a command or writes state.
 */

/** DEBUG `era_environment_state` phases. */
export type EraEnvironmentStatePhase = 'synced' | 'transition_started' | 'transition_finished' | 'snapped';
export const ERA_ENVIRONMENT_STATE_PHASES: readonly EraEnvironmentStatePhase[] = Object.freeze(['synced', 'transition_started', 'transition_finished', 'snapped']);

export interface EraEnvironmentSnapshot {
    readonly descriptor: EraEnvironmentDescriptor;
    readonly frame: EraEnvironmentFrame;
    /** Seconds into the live transition (null = settled). */
    readonly transitionElapsed: number | null;
    /** This call started a live transition. */
    readonly transitionStarted: boolean;
    /** This call snapped to a different era without animation (Reboot / non-progressive change). */
    readonly snapped: boolean;
}

export class EraEnvironmentViewModel {
    private descriptor: EraEnvironmentDescriptor | null = null;
    private frame: EraEnvironmentFrame | null = null;
    private from: EraEnvironmentFrame | null = null;
    private elapsed: number | null = null;

    /** Initial / restored state: the environment is rebuilt instantly, never animated. */
    public syncFromState(state: GameState): EraEnvironmentSnapshot {
        return this.syncFromEra(state.run.currentEraId);
    }

    public syncFromEra(eraId: string | null): EraEnvironmentSnapshot {
        const descriptor = resolveEraEnvironmentForEra(eraId);
        this.descriptor = descriptor;
        this.frame = frameOfDescriptor(descriptor);
        this.from = null;
        this.elapsed = null;
        return this.snapshot(false, false);
    }

    /** A state snapshot that follows a command (the events only mark that something happened; the era id decides). */
    public consumeEvents(state: GameState, _events: readonly DomainEvent[]): EraEnvironmentSnapshot {
        const next = resolveEraEnvironment(state);
        const current = this.descriptor;
        if (current === null || this.frame === null) return this.syncFromState(state);
        if (next.eraId === current.eraId) return this.snapshot(false, false);
        if (next.order > current.order) {
            this.from = this.frame;
            this.descriptor = next;
            this.elapsed = 0;
            this.frame = blendEraEnvironmentFrame(this.from, next, 0);
            return this.snapshot(true, false);
        }
        // Reboot (or any move back): snap, no animation.
        this.descriptor = next;
        this.frame = frameOfDescriptor(next);
        this.from = null;
        this.elapsed = null;
        return this.snapshot(false, true);
    }

    /** Advances a live transition by presentation time; returns the frame to show (the settled frame when idle). */
    public advance(deltaSeconds: number): EraEnvironmentFrame | null {
        if (this.descriptor === null) return null;
        if (this.elapsed === null || this.from === null) return this.frame;
        this.elapsed += Math.max(0, deltaSeconds);
        if (this.elapsed >= ERA_ENV_TRANSITION_DURATION) {
            this.frame = frameOfDescriptor(this.descriptor);
            this.from = null;
            this.elapsed = null;
            return this.frame;
        }
        this.frame = blendEraEnvironmentFrame(this.from, this.descriptor, this.elapsed);
        return this.frame;
    }

    public isTransitioning(): boolean { return this.elapsed !== null; }
    public getDescriptor(): EraEnvironmentDescriptor | null { return this.descriptor; }
    public getFrame(): EraEnvironmentFrame | null { return this.frame; }

    private snapshot(transitionStarted: boolean, snapped: boolean): EraEnvironmentSnapshot {
        return { descriptor: this.descriptor as EraEnvironmentDescriptor, frame: this.frame as EraEnvironmentFrame, transitionElapsed: this.elapsed, transitionStarted, snapped };
    }
}
