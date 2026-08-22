import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { DomainEvent } from '../domain/Events.ts';
import { GameRuntime, type CommandExecutionResult } from '../runtime/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import { createFreshGameState } from '../state/StateFactory.ts';
import { SimulationMetricsCollector, type SimulationMetricsSnapshot } from './Metrics.ts';
import type { SimulationStrategy, SimulationStrategyRunSummary } from './SimulationStrategy.ts';

export interface HeadlessSimulatorOptions {
    readonly initialState?: GameState;
    readonly metricsCollector?: SimulationMetricsCollector;
}

export interface AdvanceUntilOptions {
    readonly maxSimulatedSeconds: number;
    readonly maxIterations: number;
    readonly stepSeconds: number | ((snapshot: SimulationMetricsSnapshot) => number);
}

export interface AdvanceUntilResult {
    readonly reached: true;
    readonly simulatedTimeSeconds: number;
    readonly iterations: number;
}

export type SimulationCondition = (snapshot: SimulationMetricsSnapshot) => boolean;

export class SimulationGuardError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SimulationGuardError';
    }
}

export class HeadlessSimulator {
    readonly repository: GameConfigRepository;
    readonly runtime: GameRuntime;
    readonly metrics: SimulationMetricsCollector;

    private simulatedTimeSecondsValue = 0;

    constructor(repository: GameConfigRepository, options: HeadlessSimulatorOptions = {}) {
        this.repository = repository;
        this.runtime = new GameRuntime(repository, options.initialState ?? createFreshGameState());
        this.metrics = options.metricsCollector ?? new SimulationMetricsCollector(repository);
        this.metrics.recordObservation(this.createSnapshot(), 'initial');
    }

    get simulatedTimeSeconds(): number {
        return this.simulatedTimeSecondsValue;
    }

    getStateSnapshot(): GameState {
        return this.runtime.getStateSnapshot();
    }

    createSnapshot(): SimulationMetricsSnapshot {
        const state = this.runtime.getStateSnapshot();
        return {
            simulatedTimeSeconds: this.simulatedTimeSecondsValue,
            state,
            productionPerSecond: this.runtime.getProductionPerSecond(),
            automatedProductionPerSecond: this.runtime.getAutomatedProductionPerSecond(),
            robotsBuiltPerSecond: this.runtime.getRobotsBuiltPerSecond(),
        };
    }

    execute(command: GameCommand, label?: string): CommandExecutionResult {
        const result = this.runtime.execute(command);
        this.metrics.recordCommand(this.simulatedTimeSecondsValue, command, result, label);
        this.metrics.recordEvents(this.simulatedTimeSecondsValue, result.events);
        return result;
    }

    runStrategy(strategy: SimulationStrategy): SimulationStrategyRunSummary {
        return strategy.run({
            repository: this.repository,
            simulator: this,
        });
    }

    advanceTime(elapsedSeconds: number, label = 'advance_time'): CommandExecutionResult {
        const seconds = readNonNegativeFiniteNumber(elapsedSeconds, 'elapsedSeconds');
        const result = this.runtime.advanceActiveSession(seconds);
        if (result.ok) {
            this.simulatedTimeSecondsValue = clampNegativeZero(this.simulatedTimeSecondsValue + seconds);
        }
        this.metrics.recordCommand(this.simulatedTimeSecondsValue, result.ok ? result.command : { type: 'advanceActiveSession', elapsedSeconds: seconds }, result, label);
        this.metrics.recordEvents(this.simulatedTimeSecondsValue, result.events);
        return result;
    }

    advanceUntil(condition: SimulationCondition, options: AdvanceUntilOptions): AdvanceUntilResult {
        const maxSimulatedSeconds = readPositiveFiniteNumber(options.maxSimulatedSeconds, 'maxSimulatedSeconds');
        const maxIterations = readPositiveSafeInteger(options.maxIterations, 'maxIterations');
        let iterations = 0;
        let advancedSeconds = 0;

        if (condition(this.createSnapshot())) {
            return {
                reached: true,
                simulatedTimeSeconds: this.simulatedTimeSecondsValue,
                iterations,
            };
        }

        while (advancedSeconds < maxSimulatedSeconds && iterations < maxIterations) {
            const snapshot = this.createSnapshot();
            const requestedStep = typeof options.stepSeconds === 'function'
                ? options.stepSeconds(snapshot)
                : options.stepSeconds;
            const stepSeconds = Math.min(
                readPositiveFiniteNumber(requestedStep, 'stepSeconds'),
                maxSimulatedSeconds - advancedSeconds,
            );

            const result = this.advanceTime(stepSeconds, 'advance_until');
            if (!result.ok) {
                throw new SimulationGuardError(`advanceUntil command failed: ${result.reason} ${result.message}`);
            }

            iterations += 1;
            advancedSeconds = clampNegativeZero(advancedSeconds + stepSeconds);

            if (condition(this.createSnapshot())) {
                return {
                    reached: true,
                    simulatedTimeSeconds: this.simulatedTimeSecondsValue,
                    iterations,
                };
            }
        }

        throw new SimulationGuardError(
            `advanceUntil guard exhausted after ${advancedSeconds} simulated seconds and ${iterations} iterations.`,
        );
    }

    cloneFinalState(): GameState {
        return cloneGameState(this.runtime.getStateSnapshot());
    }
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

function clampNegativeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}
