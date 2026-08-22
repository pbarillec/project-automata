export {
    HeadlessSimulator,
    SimulationGuardError,
} from './HeadlessSimulator.ts';

export {
    SimulationMetricsCollector,
} from './Metrics.ts';

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
