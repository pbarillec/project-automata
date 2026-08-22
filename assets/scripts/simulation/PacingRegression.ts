import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import {
    ACTIVE_STRATEGY_ID,
    NORMAL_STRATEGY_ID,
    OPTIMIZED_STRATEGY_ID,
    PASSIVE_STRATEGY_ID,
    createActiveSimulationStrategy,
    createNormalSimulationStrategy,
    createOptimizedSimulationStrategy,
    createPassiveSimulationStrategy,
    type ActiveStrategyConfig,
    type NormalStrategyConfig,
    type OptimizedStrategyConfig,
    type PassiveStrategyConfig,
} from './BuiltInStrategies.ts';
import type {
    CommandTraceEntry,
    EconomyObservation,
    FinalSimulationSummary,
    ProgressionCheckpoint,
    SimulationReport,
} from './Metrics.ts';
import { runSimulationStrategy, type SimulationStrategy, type SimulationStrategyResult } from './SimulationStrategy.ts';
import type {
    DeadZoneConfig,
    NumericWindow,
    PacingOutcome,
    PacingScenarioConfig,
    PacingTargetConfig,
    PacingTargetDefinition,
} from './PacingTargets.ts';

export interface CanonicalCheckpointSnapshot {
    readonly id: string;
    readonly label: string;
    readonly timeSeconds: number;
    readonly industrialOutput: number;
    readonly productionPerSecond: number;
    readonly automatedProductionPerSecond: number;
    readonly robotsBuilt: number;
    readonly robotsBuiltPerSecond: number;
    readonly eraId: string | null;
    readonly prestigePower: number;
    readonly projectedAiCoreReward: number;
    readonly producerLevels: Readonly<Record<string, number>>;
}

export interface CanonicalSimulationBaseline {
    readonly schemaVersion: 1;
    readonly scenarioId: string;
    readonly strategyId: string;
    readonly strategyFamily: string;
    readonly strategyConfig: Readonly<Record<string, unknown>>;
    readonly contentVersion: string;
    readonly finalSummary: FinalSimulationSummary;
    readonly checkpoints: readonly CanonicalCheckpointSnapshot[];
}

export interface CheckpointTimingResult {
    readonly checkpointId: string;
    readonly label: string;
    readonly timeSeconds: number;
}

export interface TargetEvaluationResult {
    readonly targetId: string;
    readonly status: PacingOutcome;
    readonly metricId: string;
    readonly checkpointId: string | null;
    readonly actualValue: number | null;
    readonly passWindow: NumericWindow;
    readonly warningWindow: NumericWindow;
    readonly description: string;
    readonly source: string;
    readonly message: string;
}

export interface BaselineDiffEntry {
    readonly kind: 'checkpoint' | 'finalMetric';
    readonly id: string;
    readonly label: string;
    readonly metricId: string;
    readonly previousValue: number | null;
    readonly currentValue: number | null;
    readonly delta: number | null;
    readonly direction: 'earlier' | 'later' | 'increased' | 'decreased' | 'added' | 'removed' | 'unchanged';
    readonly message: string;
}

export interface DeadZoneReport {
    readonly status: PacingOutcome;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly durationSeconds: number;
    readonly thresholdSeconds: number;
    readonly previousMarker: string;
    readonly nextMarker: string;
    readonly context: {
        readonly previousCheckpointId: string | null;
        readonly nextCheckpointId: string | null;
        readonly previousCommandLabel: string | null;
        readonly nextCommandLabel: string | null;
        readonly producerLevels: Readonly<Record<string, number>>;
        readonly eraId: string | null;
        readonly robotsBuilt: number;
        readonly productionPerSecond: number;
    };
}

export interface PacingRegressionScenarioReport {
    readonly scenarioId: string;
    readonly strategyId: string;
    readonly strategyFamily: string;
    readonly strategyConfig: Readonly<Record<string, unknown>>;
    readonly status: PacingOutcome;
    readonly checkpointTimings: readonly CheckpointTimingResult[];
    readonly targetEvaluations: readonly TargetEvaluationResult[];
    readonly baselineDiffPolicy: PacingOutcome;
    readonly baselineDiffs: readonly BaselineDiffEntry[];
    readonly deadZones: readonly DeadZoneReport[];
    readonly finalSummary: FinalSimulationSummary;
    readonly humanSummary: readonly string[];
}

export interface PacingRegressionReport {
    readonly schemaVersion: 1;
    readonly targetSetId: string;
    readonly contentVersion: string;
    readonly status: PacingOutcome;
    readonly scenarios: readonly PacingRegressionScenarioReport[];
    readonly warningsBlockExit: boolean;
    readonly failureBlocksExit: true;
}

export interface RunPacingRegressionOptions {
    readonly baselinesByScenarioId?: Readonly<Record<string, CanonicalSimulationBaseline>>;
}

const BASELINE_FINAL_METRICS = [
    'final.simulated_active_seconds',
    'final.production_per_second',
    'final.automated_production_per_second',
    'final.robots_built',
    'final.prestige_power',
    'final.projected_ai_core_reward',
];

export function runPacingRegression(
    repository: GameConfigRepository,
    config: PacingTargetConfig,
    options: RunPacingRegressionOptions = {},
): PacingRegressionReport {
    const scenarios = config.scenarios.map((scenarioConfig) => {
        const strategy = createStrategyForScenario(scenarioConfig);
        const result = runSimulationStrategy(repository, strategy, {
            scenarioId: scenarioConfig.scenarioId,
        });
        const baseline = options.baselinesByScenarioId?.[scenarioConfig.scenarioId];
        return createScenarioReport(config, scenarioConfig, result, baseline);
    });

    return deepFreeze({
        schemaVersion: 1,
        targetSetId: config.targetSetId,
        contentVersion: config.contentVersion,
        status: combineStatuses(scenarios.map((scenario) => scenario.status)),
        scenarios,
        warningsBlockExit: config.warningsBlockExit,
        failureBlocksExit: true,
    });
}

export function shouldPacingRegressionExitNonZero(report: PacingRegressionReport): boolean {
    return report.status === 'FAILURE' || (report.status === 'WARNING' && report.warningsBlockExit);
}

export function createCanonicalBaseline(
    result: SimulationStrategyResult<Readonly<Record<string, unknown>>>,
): CanonicalSimulationBaseline {
    return deepFreeze({
        schemaVersion: 1,
        scenarioId: result.report.scenarioId,
        strategyId: result.strategyId,
        strategyFamily: result.strategyFamily,
        strategyConfig: result.config,
        contentVersion: result.report.contentVersion,
        finalSummary: result.report.finalSummary,
        checkpoints: result.report.checkpoints.map(canonicalCheckpoint),
    });
}

export function createCanonicalBaselineFromScenario(
    repository: GameConfigRepository,
    scenarioConfig: PacingScenarioConfig,
): CanonicalSimulationBaseline {
    const strategy = createStrategyForScenario(scenarioConfig);
    const result = runSimulationStrategy(repository, strategy, {
        scenarioId: scenarioConfig.scenarioId,
    });
    return createCanonicalBaseline(result);
}

export function compareBaseline(
    current: CanonicalSimulationBaseline,
    baseline: CanonicalSimulationBaseline | undefined,
    tolerance: number,
): BaselineDiffEntry[] {
    if (baseline === undefined) {
        return [{
            kind: 'finalMetric',
            id: current.scenarioId,
            label: 'Baseline snapshot',
            metricId: 'baseline.snapshot',
            previousValue: null,
            currentValue: null,
            delta: null,
            direction: 'added',
            message: `No stored baseline exists for ${current.scenarioId}.`,
        }];
    }

    const diffs: BaselineDiffEntry[] = [];
    const previousCheckpoints = new Map(baseline.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    const currentCheckpoints = new Map(current.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    const checkpointIds = Array.from(new Set([...previousCheckpoints.keys(), ...currentCheckpoints.keys()])).sort();

    for (const checkpointId of checkpointIds) {
        const previous = previousCheckpoints.get(checkpointId);
        const next = currentCheckpoints.get(checkpointId);
        const diff = createDiffEntry(
            'checkpoint',
            checkpointId,
            previous?.label ?? next?.label ?? checkpointId,
            'checkpoint.time_seconds',
            previous?.timeSeconds ?? null,
            next?.timeSeconds ?? null,
            tolerance,
        );
        if (diff.direction !== 'unchanged') {
            diffs.push(diff);
        }
    }

    for (const metricId of BASELINE_FINAL_METRICS) {
        const diff = createDiffEntry(
            'finalMetric',
            current.scenarioId,
            metricId,
            metricId,
            readFinalMetric(baseline.finalSummary, metricId),
            readFinalMetric(current.finalSummary, metricId),
            tolerance,
        );
        if (diff.direction !== 'unchanged') {
            diffs.push(diff);
        }
    }

    return diffs;
}

export function evaluateTargets(
    config: PacingTargetConfig,
    scenarioConfig: PacingScenarioConfig,
    report: SimulationReport,
): TargetEvaluationResult[] {
    return config.targets
        .filter((target) => targetAppliesToScenario(target, scenarioConfig))
        .map((target) => evaluateTarget(target, report, config.numericTolerance));
}

export function detectDeadZones(
    scenarioConfig: PacingScenarioConfig,
    report: SimulationReport,
    deadZoneConfig: DeadZoneConfig,
): DeadZoneReport[] {
    if (!deadZoneConfig.enabled) {
        return [];
    }

    const decisionIntervalSeconds = readDecisionIntervalSeconds(scenarioConfig.strategyConfig);
    const thresholdSeconds = Math.max(
        deadZoneConfig.minDurationSeconds,
        decisionIntervalSeconds * deadZoneConfig.intentionalDecisionCadenceMultiplier,
    );
    const markers = createMeaningfulMarkers(report);
    const deadZones: DeadZoneReport[] = [];

    for (let index = 0; index < markers.length - 1; index += 1) {
        const start = markers[index];
        const end = markers[index + 1];
        const durationSeconds = roundNumber(end.timeSeconds - start.timeSeconds);
        if (durationSeconds <= thresholdSeconds) {
            continue;
        }

        const startObservation = findObservationAtOrBefore(report.observations, start.timeSeconds);
        deadZones.push({
            status: deadZoneConfig.policy,
            startSeconds: start.timeSeconds,
            endSeconds: end.timeSeconds,
            durationSeconds,
            thresholdSeconds,
            previousMarker: start.label,
            nextMarker: end.label,
            context: {
                previousCheckpointId: findCheckpointAtOrBefore(report.checkpoints, start.timeSeconds)?.id ?? null,
                nextCheckpointId: findCheckpointAfter(report.checkpoints, start.timeSeconds)?.id ?? null,
                previousCommandLabel: findCommandAtOrBefore(report.commands, start.timeSeconds)?.label ?? null,
                nextCommandLabel: findCommandAfter(report.commands, start.timeSeconds)?.label ?? null,
                producerLevels: startObservation?.producerLevels ?? {},
                eraId: startObservation?.eraId ?? null,
                robotsBuilt: startObservation?.robotsBuilt ?? 0,
                productionPerSecond: startObservation?.productionPerSecond ?? 0,
            },
        });
    }

    return deadZones;
}

export function createHumanScenarioSummary(
    scenario: Pick<PacingRegressionScenarioReport, 'scenarioId' | 'targetEvaluations' | 'baselineDiffs' | 'deadZones'>,
): string[] {
    const lines: string[] = [];

    for (const evaluation of scenario.targetEvaluations) {
        if (evaluation.status !== 'PASS') {
            lines.push(`${evaluation.status}: ${evaluation.message}`);
        }
    }

    for (const diff of scenario.baselineDiffs) {
        lines.push(diff.message);
    }

    for (const deadZone of scenario.deadZones) {
        lines.push(`${deadZone.status}: ${scenario.scenarioId} dead zone ${formatDuration(deadZone.durationSeconds)} from ${formatDuration(deadZone.startSeconds)} to ${formatDuration(deadZone.endSeconds)} before ${deadZone.nextMarker}.`);
    }

    return lines;
}

function createScenarioReport(
    config: PacingTargetConfig,
    scenarioConfig: PacingScenarioConfig,
    result: SimulationStrategyResult<Readonly<Record<string, unknown>>>,
    baseline: CanonicalSimulationBaseline | undefined,
): PacingRegressionScenarioReport {
    const currentBaseline = createCanonicalBaseline(result);
    const targetEvaluations = evaluateTargets(config, scenarioConfig, result.report);
    const baselineDiffs = compareBaseline(currentBaseline, baseline, config.numericTolerance);
    const deadZones = detectDeadZones(scenarioConfig, result.report, config.deadZone);
    const status = combineStatuses([
        ...targetEvaluations.map((evaluation) => evaluation.status),
        baselineDiffs.length > 0 ? config.baselineDiffPolicy : 'PASS',
        ...deadZones.map((deadZone) => deadZone.status),
    ]);
    const partial = {
        scenarioId: scenarioConfig.scenarioId,
        targetEvaluations,
        baselineDiffs,
        deadZones,
    };

    return {
        scenarioId: scenarioConfig.scenarioId,
        strategyId: result.strategyId,
        strategyFamily: result.strategyFamily,
        strategyConfig: result.config,
        status,
        checkpointTimings: result.report.checkpoints.map((checkpoint) => ({
            checkpointId: checkpoint.id,
            label: checkpoint.label,
            timeSeconds: checkpoint.observation.timeSeconds,
        })),
        targetEvaluations,
        baselineDiffPolicy: config.baselineDiffPolicy,
        baselineDiffs,
        deadZones,
        finalSummary: result.report.finalSummary,
        humanSummary: createHumanScenarioSummary(partial),
    };
}

function createStrategyForScenario(scenarioConfig: PacingScenarioConfig): SimulationStrategy<Readonly<Record<string, unknown>>> {
    if (scenarioConfig.strategyId === ACTIVE_STRATEGY_ID) {
        return createActiveSimulationStrategy(scenarioConfig.strategyConfig as ActiveStrategyConfig);
    }
    if (scenarioConfig.strategyId === NORMAL_STRATEGY_ID) {
        return createNormalSimulationStrategy(scenarioConfig.strategyConfig as NormalStrategyConfig);
    }
    if (scenarioConfig.strategyId === PASSIVE_STRATEGY_ID) {
        return createPassiveSimulationStrategy(scenarioConfig.strategyConfig as PassiveStrategyConfig);
    }
    if (scenarioConfig.strategyId === OPTIMIZED_STRATEGY_ID) {
        return createOptimizedSimulationStrategy(scenarioConfig.strategyConfig as OptimizedStrategyConfig);
    }
    throw new Error(`Unsupported pacing regression strategyId "${scenarioConfig.strategyId}".`);
}

function evaluateTarget(
    target: PacingTargetDefinition,
    report: SimulationReport,
    tolerance: number,
): TargetEvaluationResult {
    const actualValue = readReportMetric(report, target.metric.metricId, target.metric.checkpointId);
    if (actualValue === null) {
        return {
            targetId: target.id,
            status: target.violationPolicy,
            metricId: target.metric.metricId,
            checkpointId: target.metric.checkpointId ?? null,
            actualValue,
            passWindow: target.windows.pass,
            warningWindow: target.windows.warning,
            description: target.description,
            source: target.source,
            message: `${report.scenarioId} is missing ${formatMetricName(target.metric.metricId, target.metric.checkpointId)} for target ${target.id}.`,
        };
    }

    const status = valueInWindow(actualValue, target.windows.pass, tolerance)
        ? 'PASS'
        : valueInWindow(actualValue, target.windows.warning, tolerance)
            ? 'WARNING'
            : target.violationPolicy;

    return {
        targetId: target.id,
        status,
        metricId: target.metric.metricId,
        checkpointId: target.metric.checkpointId ?? null,
        actualValue,
        passWindow: target.windows.pass,
        warningWindow: target.windows.warning,
        description: target.description,
        source: target.source,
        message: createTargetMessage(report.scenarioId, target, actualValue, status),
    };
}

function createTargetMessage(
    scenarioId: string,
    target: PacingTargetDefinition,
    actualValue: number,
    status: PacingOutcome,
): string {
    const metricName = formatMetricName(target.metric.metricId, target.metric.checkpointId);
    const actual = target.metric.metricId.endsWith('time_seconds') || target.metric.metricId === 'final.simulated_active_seconds'
        ? formatDuration(actualValue)
        : String(roundNumber(actualValue));
    const pass = `${roundNumber(target.windows.pass.min)}..${roundNumber(target.windows.pass.max)}`;
    return `${scenarioId} ${metricName} is ${actual}; ${status} against pass window ${pass}.`;
}

function targetAppliesToScenario(target: PacingTargetDefinition, scenarioConfig: PacingScenarioConfig): boolean {
    return (target.scope.scenarioIds?.includes(scenarioConfig.scenarioId) ?? false) ||
        (target.scope.strategyIds?.includes(scenarioConfig.strategyId) ?? false);
}

function readReportMetric(report: SimulationReport, metricId: string, checkpointId: string | undefined): number | null {
    if (checkpointId !== undefined) {
        const checkpoint = report.checkpoints.find((item) => item.id === checkpointId);
        if (checkpoint === undefined) {
            return null;
        }
        return readCheckpointMetric(checkpoint, metricId);
    }

    return readFinalMetric(report.finalSummary, metricId);
}

function readCheckpointMetric(checkpoint: ProgressionCheckpoint, metricId: string): number | null {
    const observation = checkpoint.observation;
    if (metricId === 'checkpoint.time_seconds') {
        return observation.timeSeconds;
    }
    if (metricId === 'checkpoint.industrial_output') {
        return observation.industrialOutput;
    }
    if (metricId === 'checkpoint.production_per_second') {
        return observation.productionPerSecond;
    }
    if (metricId === 'checkpoint.automated_production_per_second') {
        return observation.automatedProductionPerSecond;
    }
    if (metricId === 'checkpoint.robots_built') {
        return observation.robotsBuilt;
    }
    if (metricId === 'checkpoint.robots_built_per_second') {
        return observation.robotsBuiltPerSecond;
    }
    if (metricId === 'checkpoint.prestige_power') {
        return observation.prestigePower;
    }
    if (metricId === 'checkpoint.projected_ai_core_reward') {
        return observation.projectedAiCoreReward;
    }
    return null;
}

function readFinalMetric(summary: FinalSimulationSummary, metricId: string): number | null {
    if (metricId === 'final.simulated_active_seconds') {
        return summary.simulatedActiveSeconds;
    }
    if (metricId === 'final.industrial_output') {
        return summary.industrialOutput;
    }
    if (metricId === 'final.production_per_second') {
        return summary.productionPerSecond;
    }
    if (metricId === 'final.automated_production_per_second') {
        return summary.automatedProductionPerSecond;
    }
    if (metricId === 'final.robots_built') {
        return summary.robotsBuilt;
    }
    if (metricId === 'final.robots_built_per_second') {
        return summary.robotsBuiltPerSecond;
    }
    if (metricId === 'final.prestige_power') {
        return summary.prestigePower;
    }
    if (metricId === 'final.projected_ai_core_reward') {
        return summary.projectedAiCoreReward;
    }
    if (metricId === 'final.p0_prestige_power') {
        return summary.p0PrestigePower;
    }
    return null;
}

function canonicalCheckpoint(checkpoint: ProgressionCheckpoint): CanonicalCheckpointSnapshot {
    const observation = checkpoint.observation;
    return {
        id: checkpoint.id,
        label: checkpoint.label,
        timeSeconds: observation.timeSeconds,
        industrialOutput: observation.industrialOutput,
        productionPerSecond: observation.productionPerSecond,
        automatedProductionPerSecond: observation.automatedProductionPerSecond,
        robotsBuilt: observation.robotsBuilt,
        robotsBuiltPerSecond: observation.robotsBuiltPerSecond,
        eraId: observation.eraId,
        prestigePower: observation.prestigePower,
        projectedAiCoreReward: observation.projectedAiCoreReward,
        producerLevels: observation.producerLevels,
    };
}

function createDiffEntry(
    kind: 'checkpoint' | 'finalMetric',
    id: string,
    label: string,
    metricId: string,
    previousValue: number | null,
    currentValue: number | null,
    tolerance: number,
): BaselineDiffEntry {
    if (previousValue === null && currentValue === null) {
        return {
            kind,
            id,
            label,
            metricId,
            previousValue,
            currentValue,
            delta: null,
            direction: 'unchanged',
            message: `${label} unchanged.`,
        };
    }
    if (previousValue === null) {
        return {
            kind,
            id,
            label,
            metricId,
            previousValue,
            currentValue,
            delta: null,
            direction: 'added',
            message: `${label} was added to the current baseline.`,
        };
    }
    if (currentValue === null) {
        return {
            kind,
            id,
            label,
            metricId,
            previousValue,
            currentValue,
            delta: null,
            direction: 'removed',
            message: `${label} was removed from the current baseline.`,
        };
    }

    const delta = roundNumber(currentValue - previousValue);
    if (Math.abs(delta) <= tolerance) {
        return {
            kind,
            id,
            label,
            metricId,
            previousValue,
            currentValue,
            delta: 0,
            direction: 'unchanged',
            message: `${label} unchanged.`,
        };
    }

    const isTime = metricId.endsWith('time_seconds') || metricId === 'final.simulated_active_seconds';
    const direction = isTime
        ? delta < 0 ? 'earlier' : 'later'
        : delta < 0 ? 'decreased' : 'increased';
    const deltaText = isTime ? formatDuration(Math.abs(delta)) : String(Math.abs(delta));
    const currentText = isTime ? formatDuration(currentValue) : String(currentValue);
    const previousText = isTime ? formatDuration(previousValue) : String(previousValue);

    return {
        kind,
        id,
        label,
        metricId,
        previousValue,
        currentValue,
        delta,
        direction,
        message: `${label} became ${direction} by ${deltaText}: ${previousText} -> ${currentText}.`,
    };
}

function createMeaningfulMarkers(report: SimulationReport): Array<{ timeSeconds: number; label: string; kind: string }> {
    const markers = new Map<string, { timeSeconds: number; label: string; kind: string }>();
    addMarker(markers, 0, 'scenario start', 'boundary');
    for (const checkpoint of report.checkpoints) {
        addMarker(markers, checkpoint.observation.timeSeconds, `checkpoint:${checkpoint.id}`, 'checkpoint');
    }
    for (const command of report.commands) {
        if (command.ok && isMeaningfulCommand(command.command)) {
            addMarker(markers, command.timeSeconds, command.label ?? command.command.type, 'command');
        }
    }
    addMarker(markers, report.finalSummary.simulatedActiveSeconds, 'scenario end', 'boundary');
    return Array.from(markers.values()).sort((left, right) => left.timeSeconds - right.timeSeconds || left.label.localeCompare(right.label));
}

function addMarker(
    markers: Map<string, { timeSeconds: number; label: string; kind: string }>,
    timeSeconds: number,
    label: string,
    kind: string,
): void {
    const key = `${roundNumber(timeSeconds)}:${label}`;
    markers.set(key, {
        timeSeconds: roundNumber(timeSeconds),
        label,
        kind,
    });
}

function isMeaningfulCommand(command: GameCommand): boolean {
    return command.type === 'manualProduce' ||
        command.type === 'buyProducerLevels' ||
        command.type === 'buyMaxProducerLevels' ||
        command.type === 'purchaseBreakthrough' ||
        command.type === 'activateFreeOverclock';
}

function findObservationAtOrBefore(observations: readonly EconomyObservation[], timeSeconds: number): EconomyObservation | undefined {
    return observations
        .filter((observation) => observation.timeSeconds <= timeSeconds)
        .sort((left, right) => right.timeSeconds - left.timeSeconds)[0];
}

function findCheckpointAtOrBefore(checkpoints: readonly ProgressionCheckpoint[], timeSeconds: number): ProgressionCheckpoint | undefined {
    return checkpoints
        .filter((checkpoint) => checkpoint.observation.timeSeconds <= timeSeconds)
        .sort((left, right) => right.observation.timeSeconds - left.observation.timeSeconds)[0];
}

function findCheckpointAfter(checkpoints: readonly ProgressionCheckpoint[], timeSeconds: number): ProgressionCheckpoint | undefined {
    return checkpoints
        .filter((checkpoint) => checkpoint.observation.timeSeconds > timeSeconds)
        .sort((left, right) => left.observation.timeSeconds - right.observation.timeSeconds)[0];
}

function findCommandAtOrBefore(commands: readonly CommandTraceEntry[], timeSeconds: number): CommandTraceEntry | undefined {
    return commands
        .filter((command) => command.timeSeconds <= timeSeconds)
        .sort((left, right) => right.timeSeconds - left.timeSeconds)[0];
}

function findCommandAfter(commands: readonly CommandTraceEntry[], timeSeconds: number): CommandTraceEntry | undefined {
    return commands
        .filter((command) => command.timeSeconds > timeSeconds)
        .sort((left, right) => left.timeSeconds - right.timeSeconds)[0];
}

function valueInWindow(value: number, window: NumericWindow, tolerance: number): boolean {
    return value + tolerance >= window.min && value - tolerance <= window.max;
}

function readDecisionIntervalSeconds(strategyConfig: Readonly<Record<string, unknown>>): number {
    const value = strategyConfig.decisionIntervalSeconds;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function combineStatuses(statuses: readonly PacingOutcome[]): PacingOutcome {
    if (statuses.includes('FAILURE')) {
        return 'FAILURE';
    }
    if (statuses.includes('WARNING')) {
        return 'WARNING';
    }
    return 'PASS';
}

function formatMetricName(metricId: string, checkpointId: string | undefined): string {
    return checkpointId === undefined ? metricId : `${checkpointId} ${metricId}`;
}

function formatDuration(seconds: number): string {
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m ${remainingSeconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
}

function roundNumber(value: number): number {
    return Number(value.toFixed(6));
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value.slice()) as T;
    }
    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
        return Object.freeze(value);
    }
    return value;
}
