import type { GameState, ProducerRunState } from '../state/GameState.ts';
import { ROBOT_LINE_LAMP_IDS, ROBOT_LINE_LV1_LAMPS, ROBOT_LINE_PRODUCER_ID, type RobotLineLampId, type RobotLineModuleId } from './RobotLineLayout.ts';

/**
 * AUT-042 Robot Line visual states (Art Director 2026-11-12): unbuilt grey footprint / AUT-033 shell only, Lv1
 * line (slab, gate, feed corner, belt, machine 1, arm 1, output lip, 2 fake items), Lv10 (adds machine 2, arm 2,
 * status panel, 4 fake items, belt cadence x1.2). Lv25+ keep the Lv10 composition.
 * Pure and deterministic from GameState; presentation only.
 */
export type RobotLineVisualPhase = 'unbuilt' | 'line_lv1' | 'line_lv10';

export const ROBOT_LINE_FRONTIER_LEVEL = 10;
export const ROBOT_LINE_LV1_ITEM_COUNT = 2;
export const ROBOT_LINE_LV10_ITEM_COUNT = 4;
export const ROBOT_LINE_LV10_CADENCE = 1.2;

export interface RobotLineVisualDescriptor {
    readonly producerId: typeof ROBOT_LINE_PRODUCER_ID;
    readonly constructed: boolean;
    readonly level: number;
    readonly milestoneTier: 0 | 1 | 10;
    readonly phase: RobotLineVisualPhase;
    /** The AUT-033 inactive shell stays until the line is built. */
    readonly placeholderVisible: boolean;
    readonly modules: readonly RobotLineModuleId[];
    /** Status lamps that are lit (cyan) while the line runs. */
    readonly litLamps: readonly RobotLineLampId[];
    /** Pooled fake belt items looping (0 while unbuilt). */
    readonly itemCount: number;
    /** Belt speed multiplier (presentation only). */
    readonly beltCadence: number;
    /** The authoritative state is in the Automated Factory era (Era II). */
    readonly eraAutomatedFactory: boolean;
}

export interface RobotLineVisualStateOptions {
    readonly frontierLevel?: number;
}

function producerState(state: GameState): ProducerRunState {
    return state.run.producers[ROBOT_LINE_PRODUCER_ID] ?? { level: 0, isUnlocked: false, isBuilt: false };
}

export function resolveRobotLineVisualState(state: GameState, options: RobotLineVisualStateOptions = {}): RobotLineVisualDescriptor {
    const frontierLevel = options.frontierLevel ?? ROBOT_LINE_FRONTIER_LEVEL;
    const producer = producerState(state);
    const constructed = producer.isBuilt === true && producer.level > 0;
    const level = constructed ? producer.level : 0;
    const milestoneTier: 0 | 1 | 10 = !constructed ? 0 : level >= frontierLevel ? 10 : 1;

    const modules: RobotLineModuleId[] = [];
    if (constructed) modules.push('foundation_slab', 'entry_gate', 'feed_corner', 'belt', 'machine_a', 'arm_a');
    if (milestoneTier >= 10) modules.push('machine_b', 'arm_b', 'status_panel');
    if (constructed) modules.push('output_lip');

    return {
        producerId: ROBOT_LINE_PRODUCER_ID,
        constructed,
        level,
        milestoneTier,
        phase: !constructed ? 'unbuilt' : milestoneTier >= 10 ? 'line_lv10' : 'line_lv1',
        placeholderVisible: !constructed,
        modules,
        litLamps: !constructed ? [] : milestoneTier >= 10 ? ROBOT_LINE_LAMP_IDS : ROBOT_LINE_LV1_LAMPS,
        itemCount: !constructed ? 0 : milestoneTier >= 10 ? ROBOT_LINE_LV10_ITEM_COUNT : ROBOT_LINE_LV1_ITEM_COUNT,
        beltCadence: milestoneTier >= 10 ? ROBOT_LINE_LV10_CADENCE : 1,
        eraAutomatedFactory: state.run.currentEraId === 'automated_factory',
    };
}
