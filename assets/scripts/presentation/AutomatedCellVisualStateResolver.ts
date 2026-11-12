import type { GameState, ProducerRunState } from '../state/GameState.ts';
import { AUTOMATED_CELL_LAMP_IDS, AUTOMATED_CELL_LV1_LAMPS, AUTOMATED_CELL_PRODUCER_ID, type AutomatedCellLampId, type AutomatedCellModuleId } from './AutomatedCellLayout.ts';

/**
 * AUT-043 Automated Cell visual states (Art Director 2026-11-12): unbuilt AUT-033 inactive shell only, Lv1 cell
 * (slab, both walls, input + output conveyors, core, arm 1, arm 2, 4 lamps, 2+2 fake items), Lv10 (adds arm 3, the
 * hopper, 6 lamps, 3+3 fake items and faster cycles). Lv25+ keep the Lv10 composition.
 * Pure and deterministic from GameState; presentation only.
 */
export type AutomatedCellVisualPhase = 'unbuilt' | 'cell_lv1' | 'cell_lv10';

export const AUTOMATED_CELL_FRONTIER_LEVEL = 10;
export const AUTOMATED_CELL_LV1_POOL = 2;
export const AUTOMATED_CELL_LV10_POOL = 3;
export const AUTOMATED_CELL_LV1_CYCLE_SECONDS = 4.8;
export const AUTOMATED_CELL_LV10_CYCLE_SECONDS = 3.6;
export const AUTOMATED_CELL_LV1_ARM_PERIOD_SECONDS = 2.4;
export const AUTOMATED_CELL_LV10_ARM_PERIOD_SECONDS = 1.9;

export interface AutomatedCellVisualDescriptor {
    readonly producerId: typeof AUTOMATED_CELL_PRODUCER_ID;
    readonly constructed: boolean;
    readonly level: number;
    readonly milestoneTier: 0 | 1 | 10;
    readonly phase: AutomatedCellVisualPhase;
    /** The AUT-033 inactive shell stays until the cell is built. */
    readonly placeholderVisible: boolean;
    readonly modules: readonly AutomatedCellModuleId[];
    /** Status lamps that are lit (cyan) while the cell runs. */
    readonly litLamps: readonly AutomatedCellLampId[];
    /** Pooled fake boxes (and as many robots) cycling (0 while unbuilt). */
    readonly poolSize: number;
    /** Seconds per production cycle (0 while unbuilt). */
    readonly cycleSeconds: number;
    /** Seconds per arm swing period (0 while unbuilt). */
    readonly armPeriodSeconds: number;
    /** The one-flow floor guide is cyan (the cell is built). */
    readonly guideLit: boolean;
}

export interface AutomatedCellVisualStateOptions {
    readonly frontierLevel?: number;
}

function producerState(state: GameState): ProducerRunState {
    return state.run.producers[AUTOMATED_CELL_PRODUCER_ID] ?? { level: 0, isUnlocked: false, isBuilt: false };
}

export function resolveAutomatedCellVisualState(state: GameState, options: AutomatedCellVisualStateOptions = {}): AutomatedCellVisualDescriptor {
    const frontierLevel = options.frontierLevel ?? AUTOMATED_CELL_FRONTIER_LEVEL;
    const producer = producerState(state);
    const constructed = producer.isBuilt === true && producer.level > 0;
    const level = constructed ? producer.level : 0;
    const milestoneTier: 0 | 1 | 10 = !constructed ? 0 : level >= frontierLevel ? 10 : 1;

    const modules: AutomatedCellModuleId[] = [];
    if (constructed) modules.push('foundation_slab', 'wall_west', 'wall_back', 'conveyor_in', 'conveyor_out', 'core', 'arm_1', 'arm_2');
    if (milestoneTier >= 10) modules.push('arm_3', 'hopper');

    return {
        producerId: AUTOMATED_CELL_PRODUCER_ID,
        constructed,
        level,
        milestoneTier,
        phase: !constructed ? 'unbuilt' : milestoneTier >= 10 ? 'cell_lv10' : 'cell_lv1',
        placeholderVisible: !constructed,
        modules,
        litLamps: !constructed ? [] : milestoneTier >= 10 ? AUTOMATED_CELL_LAMP_IDS : AUTOMATED_CELL_LV1_LAMPS,
        poolSize: !constructed ? 0 : milestoneTier >= 10 ? AUTOMATED_CELL_LV10_POOL : AUTOMATED_CELL_LV1_POOL,
        cycleSeconds: !constructed ? 0 : milestoneTier >= 10 ? AUTOMATED_CELL_LV10_CYCLE_SECONDS : AUTOMATED_CELL_LV1_CYCLE_SECONDS,
        armPeriodSeconds: !constructed ? 0 : milestoneTier >= 10 ? AUTOMATED_CELL_LV10_ARM_PERIOD_SECONDS : AUTOMATED_CELL_LV1_ARM_PERIOD_SECONDS,
        guideLit: constructed,
    };
}
