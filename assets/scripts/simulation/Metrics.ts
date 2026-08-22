import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type { CommandExecutionResult } from '../runtime/index.ts';
import { createPrestigePreview } from '../progression/index.ts';
import type { GameState } from '../state/GameState.ts';
import { clonePlainData } from '../state/StateClone.ts';

export interface SimulationMetricsSnapshot {
    readonly simulatedTimeSeconds: number;
    readonly state: GameState;
    readonly productionPerSecond: number;
    readonly automatedProductionPerSecond: number;
    readonly robotsBuiltPerSecond: number;
}

export interface ProducerLevelSummary {
    readonly [producerId: string]: number;
}

export interface EconomyObservation {
    readonly timeSeconds: number;
    readonly label: string;
    readonly industrialOutput: number;
    readonly productionPerSecond: number;
    readonly automatedProductionPerSecond: number;
    readonly robotsBuilt: number;
    readonly robotsBuiltPerSecond: number;
    readonly eraId: string | null;
    readonly prestigePower: number;
    readonly projectedAiCoreReward: number;
    readonly p0PrestigePower: number;
    readonly producerLevels: ProducerLevelSummary;
}

export interface ProgressionCheckpoint {
    readonly id: string;
    readonly label: string;
    readonly observation: EconomyObservation;
}

export interface CommandTraceEntry {
    readonly timeSeconds: number;
    readonly label: string | null;
    readonly command: GameCommand;
    readonly ok: boolean;
    readonly reason: string | null;
}

export interface EventTraceEntry {
    readonly timeSeconds: number;
    readonly event: DomainEvent;
}

export interface FinalSimulationSummary {
    readonly simulatedActiveSeconds: number;
    readonly industrialOutput: number;
    readonly productionPerSecond: number;
    readonly automatedProductionPerSecond: number;
    readonly robotsBuilt: number;
    readonly robotsBuiltPerSecond: number;
    readonly eraId: string | null;
    readonly prestigePower: number;
    readonly projectedAiCoreReward: number;
    readonly p0PrestigePower: number;
    readonly producerLevels: ProducerLevelSummary;
    readonly purchasedBreakthroughIds: readonly string[];
}

export interface SimulationReport {
    readonly schemaVersion: 1;
    readonly scenarioId: string;
    readonly contentVersion: string;
    readonly status: 'success';
    readonly finalSummary: FinalSimulationSummary;
    readonly checkpoints: readonly ProgressionCheckpoint[];
    readonly observations: readonly EconomyObservation[];
    readonly commands: readonly CommandTraceEntry[];
    readonly events: readonly EventTraceEntry[];
    readonly representativeBaselineSeconds: Readonly<Record<string, number>>;
}

export class SimulationMetricsCollector {
    private readonly repository: GameConfigRepository;
    private readonly observations: EconomyObservation[] = [];
    private readonly checkpoints: ProgressionCheckpoint[] = [];
    private readonly checkpointIds = new Set<string>();
    private readonly commands: CommandTraceEntry[] = [];
    private readonly events: EventTraceEntry[] = [];

    constructor(repository: GameConfigRepository) {
        this.repository = repository;
    }

    recordObservation(snapshot: SimulationMetricsSnapshot, label: string): EconomyObservation {
        const observation = createObservation(this.repository, snapshot, label);
        this.observations.push(observation);
        return observation;
    }

    recordCheckpoint(id: string, label: string, snapshot: SimulationMetricsSnapshot): boolean {
        if (this.checkpointIds.has(id)) {
            return false;
        }

        this.checkpointIds.add(id);
        this.checkpoints.push({
            id,
            label,
            observation: this.recordObservation(snapshot, `checkpoint:${id}`),
        });
        return true;
    }

    hasCheckpoint(id: string): boolean {
        return this.checkpointIds.has(id);
    }

    recordCommand(
        timeSeconds: number,
        command: GameCommand,
        result: CommandExecutionResult,
        label?: string,
    ): void {
        this.commands.push({
            timeSeconds,
            label: label ?? null,
            command: clonePlainData(command),
            ok: result.ok,
            reason: result.ok ? null : result.reason,
        });
    }

    recordEvents(timeSeconds: number, events: readonly DomainEvent[]): void {
        for (const event of events) {
            this.events.push({
                timeSeconds,
                event: clonePlainData(event),
            });
        }
    }

    createReport(
        scenarioId: string,
        finalSnapshot: SimulationMetricsSnapshot,
        representativeBaselineSeconds: Readonly<Record<string, number>>,
    ): SimulationReport {
        const finalObservation = this.recordObservation(finalSnapshot, 'final');
        return deepFreeze({
            schemaVersion: 1,
            scenarioId,
            contentVersion: this.repository.contentVersion,
            status: 'success',
            finalSummary: {
                simulatedActiveSeconds: finalObservation.timeSeconds,
                industrialOutput: finalObservation.industrialOutput,
                productionPerSecond: finalObservation.productionPerSecond,
                automatedProductionPerSecond: finalObservation.automatedProductionPerSecond,
                robotsBuilt: finalObservation.robotsBuilt,
                robotsBuiltPerSecond: finalObservation.robotsBuiltPerSecond,
                eraId: finalObservation.eraId,
                prestigePower: finalObservation.prestigePower,
                projectedAiCoreReward: finalObservation.projectedAiCoreReward,
                p0PrestigePower: finalObservation.p0PrestigePower,
                producerLevels: finalObservation.producerLevels,
                purchasedBreakthroughIds: finalSnapshot.state.run.purchasedBreakthroughIds.slice(),
            },
            checkpoints: this.checkpoints.slice(),
            observations: this.observations.slice(),
            commands: this.commands.slice(),
            events: this.events.slice(),
            representativeBaselineSeconds: { ...representativeBaselineSeconds },
        });
    }
}

function createObservation(
    repository: GameConfigRepository,
    snapshot: SimulationMetricsSnapshot,
    label: string,
): EconomyObservation {
    const state = snapshot.state;
    const prestigePreview = createPrestigePreview(repository, state);
    return {
        timeSeconds: snapshot.simulatedTimeSeconds,
        label,
        industrialOutput: state.run.industrialOutput,
        productionPerSecond: snapshot.productionPerSecond,
        automatedProductionPerSecond: snapshot.automatedProductionPerSecond,
        robotsBuilt: state.run.robotsBuilt,
        robotsBuiltPerSecond: snapshot.robotsBuiltPerSecond,
        eraId: state.run.currentEraId,
        prestigePower: prestigePreview.currentPrestigePower,
        projectedAiCoreReward: prestigePreview.currentAiCoreReward,
        p0PrestigePower: prestigePreview.p0PrestigePower,
        producerLevels: Object.fromEntries(repository.listProducers().map((producer) => [
            producer.id,
            state.run.producers[producer.id]?.level ?? 0,
        ])),
    };
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value) as T;
    }

    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
        return Object.freeze(value);
    }

    return value;
}
