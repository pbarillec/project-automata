import type { GameState, ProducerRunState } from '../state/GameState.ts';

export type FabricatorDebugState = 'lv1' | 'lv10' | 'auto_feeder' | 'lv25' | 'lv50' | 'lv100';
export type VisualMilestoneTier = 0 | 1 | 10 | 25 | 50 | 100;

export interface VisualStateDescriptor {
    producerId: string;
    constructed: boolean;
    level: number;
    milestoneTier: VisualMilestoneTier;
    automationActive: boolean;
    eraId: string | null;
    technologyVariant: string;
    activityTier: 'unconstructed' | 'manual' | 'automated';
    modules: readonly string[];
}

export interface VisualStateResolverOptions {
    /** Presentation thresholds are supplied by the authoritative config boundary. */
    milestoneThresholds?: readonly number[];
    debugState?: FabricatorDebugState | null;
}

const DEFAULT_FABRICATOR_THRESHOLDS = [10, 25, 50, 100] as const;
const DEBUG_LEVELS: Record<FabricatorDebugState, number> = {
    lv1: 1,
    lv10: 10,
    auto_feeder: 15,
    lv25: 25,
    lv50: 50,
    lv100: 100,
};

function producerState(state: GameState, producerId: string): ProducerRunState {
    return state.run.producers[producerId] ?? { level: 0, isUnlocked: false, isBuilt: false };
}

function highestTier(level: number, thresholds: readonly number[]): VisualMilestoneTier {
    if (level < 1) return 0;
    if (level >= (thresholds[3] ?? 100)) return 100;
    if (level >= (thresholds[2] ?? 50)) return 50;
    if (level >= (thresholds[1] ?? 25)) return 25;
    if (level >= (thresholds[0] ?? 10)) return 10;
    return 1;
}

function modulesFor(tier: VisualMilestoneTier, automationActive: boolean): string[] {
    if (tier === 0) return [];

    const modules = ['base_compact_press', 'simple_output_tray'];
    if (tier >= 10) modules.push('secondary_module', 'strong_status_indicator');
    if (automationActive) modules.push('auto_feeder_hopper', 'input_conveyor', 'autonomous_cycle_indicator');
    if (tier >= 25) modules.push('output_conveyor', 'storage_buffer', 'logistics_connection');
    if (tier >= 50) modules.push('dual_fabrication_module', 'shared_industrial_base');
    if (tier >= 100) modules.push('integrated_feeder', 'automated_input_output', 'small_robotic_arm', 'advanced_indicators');
    return modules;
}

/** Pure, deterministic conversion of authoritative state into presentation data. */
export class VisualStateResolver {
    private readonly milestoneThresholds: readonly number[];
    private debugState: FabricatorDebugState | null;

    public constructor(options: VisualStateResolverOptions = {}) {
        this.milestoneThresholds = options.milestoneThresholds ?? DEFAULT_FABRICATOR_THRESHOLDS;
        this.debugState = options.debugState ?? null;
    }

    public setDebugState(debugState: FabricatorDebugState | null): void {
        this.debugState = debugState;
    }

    public clearDebugState(): void {
        this.debugState = null;
    }

    public getDebugState(): FabricatorDebugState | null {
        return this.debugState;
    }

    public resolveFabricator(state: GameState): VisualStateDescriptor {
        const authoritativeProducer = producerState(state, 'fabricator');
        const debugLevel = this.debugState === null ? null : DEBUG_LEVELS[this.debugState];
        const level = debugLevel ?? authoritativeProducer.level;
        const constructed = debugLevel === null ? authoritativeProducer.isBuilt : level > 0;
        const automationActive = this.debugState === 'auto_feeder' || (debugLevel === null && state.run.automation.fabricator?.isAutomated === true);
        const milestoneTier = constructed ? highestTier(level, this.milestoneThresholds) : 0;

        return {
            producerId: 'fabricator',
            constructed,
            level,
            milestoneTier,
            automationActive,
            eraId: state.run.currentEraId,
            technologyVariant: milestoneTier >= 100 ? 'advanced_industrial' : milestoneTier >= 25 ? 'industrial_logistics' : 'manual_workshop',
            activityTier: !constructed ? 'unconstructed' : automationActive ? 'automated' : 'manual',
            modules: modulesFor(milestoneTier, automationActive),
        };
    }

    public resolve(state: GameState, producerId = 'fabricator'): VisualStateDescriptor {
        if (producerId !== 'fabricator') throw new Error(`No visual state profile is registered for producer '${producerId}'.`);
        return this.resolveFabricator(state);
    }
}

export function resolveFabricatorVisualState(state: GameState, options: VisualStateResolverOptions = {}): VisualStateDescriptor {
    return new VisualStateResolver(options).resolveFabricator(state);
}
