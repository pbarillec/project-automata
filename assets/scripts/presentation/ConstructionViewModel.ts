import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import {
    buildConstructionPlan,
    sampleConstruction,
    type ConstructionPlan,
    type ConstructionPlanOptions,
    type ConstructionSample,
} from './ConstructionSequence.ts';

export interface ConstructionStartRequest {
    readonly producerId: string;
    readonly plan: ConstructionPlan;
}

export interface ConstructionFrame {
    readonly producerId: string;
    readonly sample: ConstructionSample;
}

export interface ConstructionTick {
    readonly frames: readonly ConstructionFrame[];
    /** Activation hooks: producers whose construction finished during this tick (each reported once). */
    readonly completed: readonly string[];
}

/** Modules to reveal for a producer; an empty list means "no sequence for this producer". */
export type ConstructionModulesResolver = (producerId: string, state: GameState) => readonly string[];

/**
 * AUT-040: decides when a construction sequence plays. Read-only: it never submits a command or writes GameState.
 * - The first `syncFromState` (save load) never starts a sequence; it only records what is already built.
 * - A live `producerConstructed` event starts one; a live unbuilt -> built transition seen by a later sync starts
 *   one too (the AUT-039 snapshot-before-event ordering). The pair is deduplicated per producer.
 * - A producer that becomes unbuilt (Reboot) cancels its sequence and can be constructed again.
 */
export class ConstructionViewModel {
    private readonly built = new Map<string, boolean>();
    private readonly active = new Map<string, { plan: ConstructionPlan; elapsed: number }>();
    private initialised = false;

    private readonly resolveModules: ConstructionModulesResolver;
    private readonly options: ConstructionPlanOptions;

    public constructor(resolveModules: ConstructionModulesResolver, options: ConstructionPlanOptions = {}) {
        this.resolveModules = resolveModules;
        this.options = options;
    }

    public syncFromState(state: GameState): readonly ConstructionStartRequest[] {
        const started: ConstructionStartRequest[] = [];
        for (const [producerId, producer] of Object.entries(state.run.producers)) {
            const isBuilt = producer.isBuilt === true && producer.level > 0;
            const wasBuilt = this.built.get(producerId) === true;
            this.built.set(producerId, isBuilt);
            if (!isBuilt) {
                this.active.delete(producerId);
            } else if (this.initialised && !wasBuilt) {
                const request = this.start(producerId, state);
                if (request) started.push(request);
            }
        }
        this.initialised = true;
        return started;
    }

    public consumeEvents(state: GameState, events: readonly DomainEvent[]): readonly ConstructionStartRequest[] {
        const started: ConstructionStartRequest[] = [];
        for (const event of events) {
            if (event.type !== 'producerConstructed') continue;
            const alreadyBuilt = this.built.get(event.producerId) === true;
            this.built.set(event.producerId, true);
            // Already built: either loaded from a save or already started by the snapshot sync. Never replay.
            if (alreadyBuilt) continue;
            const request = this.start(event.producerId, state);
            if (request) started.push(request);
        }
        return started;
    }

    public isActive(producerId: string): boolean {
        return this.active.has(producerId);
    }

    public tick(deltaSeconds: number): ConstructionTick {
        const frames: ConstructionFrame[] = [];
        const completed: string[] = [];
        for (const [producerId, entry] of [...this.active]) {
            entry.elapsed += Math.max(0, deltaSeconds);
            const sample = sampleConstruction(entry.plan, entry.elapsed);
            frames.push({ producerId, sample });
            if (sample.complete) {
                this.active.delete(producerId);
                completed.push(producerId);
            }
        }
        return { frames, completed };
    }

    private start(producerId: string, state: GameState): ConstructionStartRequest | null {
        const moduleIds = this.resolveModules(producerId, state);
        if (moduleIds.length === 0) return null;
        const plan = buildConstructionPlan(moduleIds, this.options);
        this.active.set(producerId, { plan, elapsed: 0 });
        return { producerId, plan };
    }
}
