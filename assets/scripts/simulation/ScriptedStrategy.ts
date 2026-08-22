import type { GameCommand } from '../domain/Commands.ts';
import { isCurrentEraAtLeast } from '../progression/index.ts';
import { SimulationGuardError } from './HeadlessSimulator.ts';
import type {
    SimulationStrategy,
    SimulationStrategyContext,
    SimulationStrategyRunSummary,
} from './SimulationStrategy.ts';

export const SCRIPTED_STRATEGY_ID = 'scripted.v1';

export type ScriptedSimulationCondition =
    | {
        readonly type: 'industrialOutputAtLeast';
        readonly amount: number;
    }
    | {
        readonly type: 'producerLevelAtLeast';
        readonly producerId: string;
        readonly level: number;
    }
    | {
        readonly type: 'breakthroughOwned';
        readonly breakthroughId: string;
    }
    | {
        readonly type: 'robotsBuiltAtLeast';
        readonly count: number;
    }
    | {
        readonly type: 'eraReached';
        readonly eraId: string;
    }
    | {
        readonly type: 'simulatedTimeAtLeast';
        readonly seconds: number;
    }
    | {
        readonly type: 'productionPerSecondAtLeast';
        readonly amount: number;
    };

export type ScriptedSimulationAction =
    | {
        readonly type: 'executeCommand';
        readonly command: GameCommand;
        readonly label?: string;
    }
    | {
        readonly type: 'advanceTime';
        readonly seconds: number;
        readonly label?: string;
    }
    | {
        readonly type: 'advanceUntil';
        readonly condition: ScriptedSimulationCondition;
        readonly maxSimulatedSeconds: number;
        readonly maxIterations: number;
        readonly stepSeconds: number;
    };

export interface ScriptedSimulationStrategyConfig extends Readonly<Record<string, unknown>> {
    readonly scriptId: string;
    readonly actions: readonly ScriptedSimulationAction[];
    readonly maxActions: number;
}

export interface CreateScriptedSimulationStrategyConfig extends Partial<ScriptedSimulationStrategyConfig> {
    readonly actions: readonly ScriptedSimulationAction[];
}

export function createScriptedSimulationStrategy(
    config: CreateScriptedSimulationStrategyConfig,
): SimulationStrategy<ScriptedSimulationStrategyConfig> {
    const normalized = normalizeScriptedConfig(config);

    return Object.freeze({
        id: `${SCRIPTED_STRATEGY_ID}:${normalized.scriptId}`,
        family: 'scripted',
        config: normalized,
        assumptions: Object.freeze([
            'Executes a caller-provided deterministic action sequence.',
            'Supports runtime command execution, active time advancement, and guarded advance-until conditions.',
            'Does not evaluate dynamic expressions or a general scripting language.',
            'Fails explicitly for unknown actions, invalid runtime commands, and unreachable guarded conditions.',
        ]),
        run(context: SimulationStrategyContext): SimulationStrategyRunSummary {
            return runScriptedStrategy(context, normalized);
        },
    });
}

function runScriptedStrategy(
    context: SimulationStrategyContext,
    config: ScriptedSimulationStrategyConfig,
): SimulationStrategyRunSummary {
    let actionCount = 0;

    for (const action of config.actions) {
        if (actionCount >= config.maxActions) {
            throw new SimulationGuardError(`Script "${config.scriptId}" exceeded maxActions ${config.maxActions}.`);
        }

        executeScriptedAction(context, action, actionCount);
        actionCount += 1;
    }

    return {
        completed: true,
        decisionCount: actionCount,
        terminationReason: 'script_complete',
    };
}

function executeScriptedAction(
    context: SimulationStrategyContext,
    action: ScriptedSimulationAction,
    actionIndex: number,
): void {
    if (action.type === 'executeCommand') {
        const result = context.simulator.execute(action.command, action.label ?? `script:${actionIndex}:execute`);
        if (!result.ok) {
            throw new SimulationGuardError(
                `Script action ${actionIndex} command ${action.command.type} failed: ${result.reason} ${result.message}`,
            );
        }
        return;
    }

    if (action.type === 'advanceTime') {
        const result = context.simulator.advanceTime(action.seconds, action.label ?? `script:${actionIndex}:advance_time`);
        if (!result.ok) {
            throw new SimulationGuardError(`Script action ${actionIndex} advanceTime failed: ${result.reason} ${result.message}`);
        }
        return;
    }

    if (action.type === 'advanceUntil') {
        const condition = createConditionPredicate(context, action.condition);
        context.simulator.advanceUntil(condition, {
            maxSimulatedSeconds: action.maxSimulatedSeconds,
            maxIterations: action.maxIterations,
            stepSeconds: action.stepSeconds,
        });
        return;
    }

    throw new SimulationGuardError(
        `Unknown scripted action type "${String((action as { type?: unknown }).type)}" at index ${actionIndex}.`,
    );
}

function createConditionPredicate(
    context: SimulationStrategyContext,
    condition: ScriptedSimulationCondition,
): Parameters<SimulationStrategyContext['simulator']['advanceUntil']>[0] {
    validateCondition(condition);

    if (condition.type === 'industrialOutputAtLeast') {
        return (snapshot) => snapshot.state.run.industrialOutput >= condition.amount;
    }

    if (condition.type === 'producerLevelAtLeast') {
        return (snapshot) => (snapshot.state.run.producers[condition.producerId]?.level ?? 0) >= condition.level;
    }

    if (condition.type === 'breakthroughOwned') {
        return (snapshot) => snapshot.state.run.purchasedBreakthroughIds.includes(condition.breakthroughId);
    }

    if (condition.type === 'robotsBuiltAtLeast') {
        return (snapshot) => snapshot.state.run.robotsBuilt >= condition.count;
    }

    if (condition.type === 'eraReached') {
        return (snapshot) => isCurrentEraAtLeast(context.repository, snapshot.state, condition.eraId);
    }

    if (condition.type === 'simulatedTimeAtLeast') {
        return (snapshot) => snapshot.simulatedTimeSeconds >= condition.seconds;
    }

    if (condition.type === 'productionPerSecondAtLeast') {
        return (snapshot) => snapshot.productionPerSecond >= condition.amount;
    }

    throw new SimulationGuardError(`Unknown scripted condition type "${String((condition as { type?: unknown }).type)}".`);
}

function normalizeScriptedConfig(config: CreateScriptedSimulationStrategyConfig): ScriptedSimulationStrategyConfig {
    const normalized = {
        scriptId: config.scriptId ?? 'custom',
        actions: config.actions,
        maxActions: config.maxActions ?? Math.max(config.actions.length, 1),
    };

    readNonEmptyString(normalized.scriptId, 'scriptId');
    if (!Array.isArray(normalized.actions)) {
        throw new SimulationGuardError('actions must be an array.');
    }
    readPositiveSafeInteger(normalized.maxActions, 'maxActions');
    if (normalized.actions.length > normalized.maxActions) {
        throw new SimulationGuardError('actions length must not exceed maxActions.');
    }

    for (const action of normalized.actions) {
        validateAction(action);
    }

    return Object.freeze({
        ...normalized,
        actions: Object.freeze(normalized.actions.slice()),
    });
}

function validateAction(action: ScriptedSimulationAction): void {
    if (action.type === 'executeCommand') {
        if (typeof action.command !== 'object' || action.command === null) {
            throw new SimulationGuardError('executeCommand.action command must be an object.');
        }
        return;
    }

    if (action.type === 'advanceTime') {
        readNonNegativeFiniteNumber(action.seconds, 'advanceTime.seconds');
        return;
    }

    if (action.type === 'advanceUntil') {
        validateCondition(action.condition);
        readPositiveFiniteNumber(action.maxSimulatedSeconds, 'advanceUntil.maxSimulatedSeconds');
        readPositiveSafeInteger(action.maxIterations, 'advanceUntil.maxIterations');
        readPositiveFiniteNumber(action.stepSeconds, 'advanceUntil.stepSeconds');
        return;
    }

    throw new SimulationGuardError(`Unknown scripted action type "${String((action as { type?: unknown }).type)}".`);
}

function validateCondition(condition: ScriptedSimulationCondition): void {
    if (condition.type === 'industrialOutputAtLeast') {
        readNonNegativeFiniteNumber(condition.amount, 'industrialOutputAtLeast.amount');
        return;
    }

    if (condition.type === 'producerLevelAtLeast') {
        readNonEmptyString(condition.producerId, 'producerLevelAtLeast.producerId');
        readPositiveSafeInteger(condition.level, 'producerLevelAtLeast.level');
        return;
    }

    if (condition.type === 'breakthroughOwned') {
        readNonEmptyString(condition.breakthroughId, 'breakthroughOwned.breakthroughId');
        return;
    }

    if (condition.type === 'robotsBuiltAtLeast') {
        readNonNegativeFiniteNumber(condition.count, 'robotsBuiltAtLeast.count');
        return;
    }

    if (condition.type === 'eraReached') {
        readNonEmptyString(condition.eraId, 'eraReached.eraId');
        return;
    }

    if (condition.type === 'simulatedTimeAtLeast') {
        readNonNegativeFiniteNumber(condition.seconds, 'simulatedTimeAtLeast.seconds');
        return;
    }

    if (condition.type === 'productionPerSecondAtLeast') {
        readNonNegativeFiniteNumber(condition.amount, 'productionPerSecondAtLeast.amount');
        return;
    }

    throw new SimulationGuardError(`Unknown scripted condition type "${String((condition as { type?: unknown }).type)}".`);
}

function readPositiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new SimulationGuardError(`${label} must be a positive safe integer.`);
    }
    return value;
}

function readPositiveFiniteNumber(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new SimulationGuardError(`${label} must be a positive finite number.`);
    }
    return value;
}

function readNonNegativeFiniteNumber(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new SimulationGuardError(`${label} must be a non-negative finite number.`);
    }
    return value;
}

function readNonEmptyString(value: string, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new SimulationGuardError(`${label} must be a non-empty string.`);
    }
    return value;
}
