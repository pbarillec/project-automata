export {
    HeadlessSimulator,
    SimulationGuardError,
} from './HeadlessSimulator.ts';

export {
    runSimulationStrategy,
} from './SimulationStrategy.ts';

export {
    SimulationMetricsCollector,
} from './Metrics.ts';

export {
    ACTIVE_STRATEGY_ID,
    NORMAL_STRATEGY_ID,
    OPTIMIZED_STRATEGY_ID,
    PASSIVE_STRATEGY_ID,
    createActiveSimulationStrategy,
    createNormalSimulationStrategy,
    createOptimizedSimulationStrategy,
    createPassiveSimulationStrategy,
} from './BuiltInStrategies.ts';

export {
    SCRIPTED_STRATEGY_ID,
    createScriptedSimulationStrategy,
} from './ScriptedStrategy.ts';

export {
    PRESTIGE_FRONTIER_LEVEL,
    PRESTIGE_FRONTIER_PRODUCER_ID,
    REFERENCE_ACTIVE_SCENARIO_ID,
    REPRESENTATIVE_ACTIVE_BASELINE_SECONDS,
    runCivilizationOneActiveReferenceScenario,
} from './ReferenceActiveScenario.ts';

export type {
    AdvanceUntilOptions,
    AdvanceUntilResult,
    HeadlessSimulatorOptions,
    SimulationCondition,
} from './HeadlessSimulator.ts';

export type {
    RunSimulationStrategyOptions,
    SimulationStrategy,
    SimulationStrategyContext,
    SimulationStrategyFamily,
    SimulationStrategyResult,
    SimulationStrategyRunSummary,
} from './SimulationStrategy.ts';

export type {
    CommandTraceEntry,
    EconomyObservation,
    EventTraceEntry,
    FinalSimulationSummary,
    ProducerLevelSummary,
    ProgressionCheckpoint,
    SimulationMetricsSnapshot,
    SimulationReport,
} from './Metrics.ts';

export type {
    ReferenceActiveScenarioOptions,
    ReferenceActiveScenarioResult,
} from './ReferenceActiveScenario.ts';

export type {
    ActiveStrategyConfig,
    NormalStrategyConfig,
    OptimizedStrategyConfig,
    PassiveStrategyConfig,
    ProgressionPolicyStrategyConfig,
    SimulationStrategyTarget,
} from './BuiltInStrategies.ts';

export type {
    CreateScriptedSimulationStrategyConfig,
    ScriptedSimulationAction,
    ScriptedSimulationCondition,
    ScriptedSimulationStrategyConfig,
} from './ScriptedStrategy.ts';
