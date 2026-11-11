import { FIRST_ROBOT_PROGRESSION_FLAG_ID, WORKER_BOT_BREAKTHROUGH_ID } from '../progression/TemporaryBoosts.ts';
import type { GameState, ProducerRunState } from '../state/GameState.ts';
import type { AssemblyModuleId } from './AssemblySliceLayout.ts';

export const ASSEMBLY_PRODUCER_ID = 'assembly_station';

/**
 * AUT-039 Assembly visual states needed for the slice (ART_DIRECTION §14.2): unbuilt foundation, Lv1 open
 * workstation, Lv10 Worker Bot frontier, automated by Worker Bot. Lv25+ states are out of scope (AUT-039)
 * and keep the Lv10 composition.
 */
export type AssemblyVisualPhase = 'unbuilt' | 'workstation' | 'worker_bot_frontier' | 'automated';

export interface AssemblyVisualDescriptor {
    readonly producerId: typeof ASSEMBLY_PRODUCER_ID;
    readonly constructed: boolean;
    readonly level: number;
    readonly milestoneTier: 0 | 1 | 10;
    readonly automationActive: boolean;
    /** The first Worker Bot exists (Worker Bot owned / `first_robot` run flag). Presentation only. */
    readonly robotPresent: boolean;
    readonly phase: AssemblyVisualPhase;
    /** The AUT-033 inactive shell stays until the station is built (it swaps to the built model until AUT-040). */
    readonly placeholderVisible: boolean;
    /** Status panel pulses while the station is automated. */
    readonly panelLit: boolean;
    /** Bay lamp on once the Worker Bot is active. */
    readonly bayLit: boolean;
    readonly modules: readonly AssemblyModuleId[];
}

export interface AssemblyVisualStateOptions {
    /** Presentation threshold of the Worker Bot frontier composition (ART_DIRECTION §14.2 "Lv10"). */
    readonly frontierLevel?: number;
}

export const ASSEMBLY_FRONTIER_LEVEL = 10;

function producerState(state: GameState): ProducerRunState {
    return state.run.producers[ASSEMBLY_PRODUCER_ID] ?? { level: 0, isUnlocked: false, isBuilt: false };
}

/** The first Worker Bot exists in the authoritative state (a visual fact; no economic worker entity). */
export function isFirstRobotPresent(state: GameState): boolean {
    return state.run.progressionFlags[FIRST_ROBOT_PROGRESSION_FLAG_ID] === true
        || state.run.purchasedBreakthroughIds.includes(WORKER_BOT_BREAKTHROUGH_ID);
}

/** Pure, deterministic projection of the authoritative state into the Assembly slice composition. */
export function resolveAssemblyVisualState(state: GameState, options: AssemblyVisualStateOptions = {}): AssemblyVisualDescriptor {
    const frontierLevel = options.frontierLevel ?? ASSEMBLY_FRONTIER_LEVEL;
    const producer = producerState(state);
    const constructed = producer.isBuilt === true && producer.level > 0;
    const level = constructed ? producer.level : 0;
    const milestoneTier: 0 | 1 | 10 = !constructed ? 0 : level >= frontierLevel ? 10 : 1;
    const automationActive = constructed && state.run.automation[ASSEMBLY_PRODUCER_ID]?.isAutomated === true;
    const robotPresent = constructed && isFirstRobotPresent(state);

    const modules: AssemblyModuleId[] = [];
    if (constructed) modules.push('foundation_slab', 'workstation_bed', 'input_corner');
    if (milestoneTier >= 10) modules.push('assembly_arm');
    if (milestoneTier >= 10 || automationActive || robotPresent) modules.push('status_panel');
    if (milestoneTier >= 10 || robotPresent) modules.push('robot_bay', 'storage_crate');

    const phase: AssemblyVisualPhase = !constructed
        ? 'unbuilt'
        : robotPresent || automationActive
            ? 'automated'
            : milestoneTier >= 10 ? 'worker_bot_frontier' : 'workstation';

    return {
        producerId: ASSEMBLY_PRODUCER_ID,
        constructed,
        level,
        milestoneTier,
        automationActive,
        robotPresent,
        phase,
        placeholderVisible: !constructed,
        panelLit: automationActive,
        bayLit: robotPresent,
        modules,
    };
}
