import type { GameState, ProducerRunState } from '../state/GameState.ts';
import { ARC_LAMP_IDS, ARC_LV1_LAMPS, ARC_LV1_MODULE_IDS, ARC_MODULE_IDS, ARC_PRODUCER_ID, type ArcLampId, type ArcModuleId } from './AdvancedRoboticsComplexLayout.ts';

/**
 * AUT-044 Advanced Robotics Complex visual states (Art Director 2026-11-12): unbuilt AUT-033 inactive shell only,
 * Lv1 complex (slab, L-shaped frames, entry / exit conveyors, core, head tower, arms 1 + 2, 8 lamps, 3+3 fake items),
 * Lv10 (adds the second bay, arm B, the gantry bridge with the overhead belt, the spire, 14 lamps, 4+4 fake items and
 * a faster cycle). Lv25+ keep the Lv10 composition. Pure and deterministic from GameState; presentation only.
 */
export type ArcVisualPhase = 'unbuilt' | 'arc_lv1' | 'arc_lv10';

export const ARC_FRONTIER_LEVEL = 10;
export const ARC_LV1_POOL = 3;
export const ARC_LV10_POOL = 4;
/** Seconds between two finished products (the production cadence). */
export const ARC_LV1_CYCLE_SECONDS = 3.0;
export const ARC_LV10_CYCLE_SECONDS = 2.4;

export interface ArcVisualDescriptor {
    readonly producerId: typeof ARC_PRODUCER_ID;
    readonly constructed: boolean;
    readonly level: number;
    readonly milestoneTier: 0 | 1 | 10;
    readonly phase: ArcVisualPhase;
    /** The AUT-033 inactive shell stays until the complex is built. */
    readonly placeholderVisible: boolean;
    readonly modules: readonly ArcModuleId[];
    /** Status lamps that are lit (cyan) while the complex runs. */
    readonly litLamps: readonly ArcLampId[];
    /** Pooled fake boxes (and as many robots) cycling (0 while unbuilt). */
    readonly poolSize: number;
    /** Seconds per production cycle (the cadence between finished robots; 0 while unbuilt). */
    readonly cycleSeconds: number;
    /** Seconds per arm swing period (equals the cycle; 0 while unbuilt). */
    readonly armPeriodSeconds: number;
    /** The connector guide is cyan (the complex is built). */
    readonly guideLit: boolean;
}

export interface ArcVisualStateOptions {
    readonly frontierLevel?: number;
}

function producerState(state: GameState): ProducerRunState {
    return state.run.producers[ARC_PRODUCER_ID] ?? { level: 0, isUnlocked: false, isBuilt: false };
}

export function resolveArcVisualState(state: GameState, options: ArcVisualStateOptions = {}): ArcVisualDescriptor {
    const frontierLevel = options.frontierLevel ?? ARC_FRONTIER_LEVEL;
    const producer = producerState(state);
    const constructed = producer.isBuilt === true && producer.level > 0;
    const level = constructed ? producer.level : 0;
    const milestoneTier: 0 | 1 | 10 = !constructed ? 0 : level >= frontierLevel ? 10 : 1;
    const cycle = !constructed ? 0 : milestoneTier >= 10 ? ARC_LV10_CYCLE_SECONDS : ARC_LV1_CYCLE_SECONDS;

    return {
        producerId: ARC_PRODUCER_ID,
        constructed,
        level,
        milestoneTier,
        phase: !constructed ? 'unbuilt' : milestoneTier >= 10 ? 'arc_lv10' : 'arc_lv1',
        placeholderVisible: !constructed,
        modules: !constructed ? [] : milestoneTier >= 10 ? ARC_MODULE_IDS : ARC_LV1_MODULE_IDS,
        litLamps: !constructed ? [] : milestoneTier >= 10 ? ARC_LAMP_IDS : ARC_LV1_LAMPS,
        poolSize: !constructed ? 0 : milestoneTier >= 10 ? ARC_LV10_POOL : ARC_LV1_POOL,
        cycleSeconds: cycle,
        armPeriodSeconds: cycle,
        guideLit: constructed,
    };
}
