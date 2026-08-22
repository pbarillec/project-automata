import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameState } from '../state/GameState.ts';
import { createFreshGameState } from '../state/index.ts';
import { HeadlessSimulator } from './HeadlessSimulator.ts';
import type { SimulationReport } from './Metrics.ts';

export type SimulationStrategyFamily =
    | 'active'
    | 'normal'
    | 'passive'
    | 'optimized'
    | 'scripted';

export interface SimulationStrategyContext {
    readonly repository: GameConfigRepository;
    readonly simulator: HeadlessSimulator;
}

export interface SimulationStrategyRunSummary {
    readonly completed: true;
    readonly decisionCount: number;
    readonly terminationReason: string;
}

export interface SimulationStrategy<TConfig extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
    readonly id: string;
    readonly family: SimulationStrategyFamily;
    readonly config: TConfig;
    readonly assumptions: readonly string[];
    readonly representativeBaselineSeconds?: Readonly<Record<string, number>>;
    run(context: SimulationStrategyContext): SimulationStrategyRunSummary;
}

export interface RunSimulationStrategyOptions {
    readonly initialState?: GameState;
    readonly simulator?: HeadlessSimulator;
    readonly scenarioId?: string;
}

export interface SimulationStrategyResult<TConfig extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
    readonly strategyId: string;
    readonly strategyFamily: SimulationStrategyFamily;
    readonly config: TConfig;
    readonly assumptions: readonly string[];
    readonly decisionCount: number;
    readonly terminationReason: string;
    readonly simulator: HeadlessSimulator;
    readonly report: SimulationReport;
}

export function runSimulationStrategy<TConfig extends Readonly<Record<string, unknown>>>(
    repository: GameConfigRepository,
    strategy: SimulationStrategy<TConfig>,
    options: RunSimulationStrategyOptions = {},
): SimulationStrategyResult<TConfig> {
    const simulator = options.simulator ?? new HeadlessSimulator(repository, {
        initialState: options.initialState ?? createFreshGameState(),
    });
    const summary = strategy.run({ repository, simulator });
    const scenarioId = options.scenarioId ?? `civilization_1:${strategy.id}`;
    const report = simulator.metrics.createReport(
        scenarioId,
        simulator.createSnapshot(),
        strategy.representativeBaselineSeconds ?? {},
    );

    return Object.freeze({
        strategyId: strategy.id,
        strategyFamily: strategy.family,
        config: strategy.config,
        assumptions: strategy.assumptions,
        decisionCount: summary.decisionCount,
        terminationReason: summary.terminationReason,
        simulator,
        report,
    });
}
