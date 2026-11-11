import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type {
    LifecycleActiveClockAdvanceResult,
    LifecycleCommandResult,
    LifecycleResumeResult,
    LifecycleSuspendResult,
} from '../lifecycle/LifecycleSessionCoordinator.ts';
import type { GameState } from '../state/GameState.ts';
import { createAssemblyBatchViewModel, type AssemblyBatchViewModel } from './AssemblyBatchViewModel.ts';
import { createHudViewModel, type HudViewModel } from './HudViewModel.ts';
import { createProducerPanelViewModel, type ProducerPanelViewModel } from './ProducerPanelViewModel.ts';

/** The authoritative persistent session (structurally `LifecycleSessionCoordinator`). */
export interface FactoryWorldSessionPort {
    getStateSnapshot(): GameState;
    execute(command: GameCommand, options?: { readonly requestOrdinarySave?: boolean }): Promise<LifecycleCommandResult>;
    advanceActiveSessionFromClock(options?: { readonly requestOrdinarySave?: boolean }): Promise<LifecycleActiveClockAdvanceResult>;
    suspend(): Promise<LifecycleSuspendResult>;
    resume(): LifecycleResumeResult;
}

/** World automation presentation (structurally `PresentationController`). */
export interface FactoryWorldAutomationSink {
    syncAutomationState(state: GameState): void;
    consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): void;
}

/** AUT-R-031-02: camera pan bounds follow the unlocked zones of each fresh snapshot. */
export interface FactoryWorldCameraSink {
    syncPanBounds(state: GameState): void;
}

export interface FactoryWorldHudSink {
    refresh(viewModel: HudViewModel): void;
}

export interface FactoryWorldPanelSink {
    refresh(viewModel: ProducerPanelViewModel): void;
}

/** AUT-GP-001: the Assembly batch action, refreshed with the panel (same snapshot and selection). */
export interface FactoryWorldAssemblyBatchSink {
    refresh(viewModel: AssemblyBatchViewModel): void;
}

export type FactoryWorldErrorReporter = (context: string, error: unknown) => void;
/** AUT-UI-001: observes every result the session returned for a submitted command (accepted or rejected). */
export type FactoryWorldCommandResultReporter = (command: GameCommand, result: LifecycleCommandResult) => void;

export interface FactoryWorldStateBindingOptions {
    readonly session: FactoryWorldSessionPort;
    readonly configRepository: GameConfigRepository;
    readonly automation: FactoryWorldAutomationSink | null;
    readonly hud: FactoryWorldHudSink | null;
    readonly panel: FactoryWorldPanelSink | null;
    readonly reportError?: FactoryWorldErrorReporter;
    /** AUT-R-031-02: optional camera sink, fed the same snapshots as the automation sink. */
    readonly camera?: FactoryWorldCameraSink | null;
    /** AUT-UI-001: optional observer called after each submit (FactoryWorld passes a DEBUG diagnostic). */
    readonly reportCommandResult?: FactoryWorldCommandResultReporter;
    /** AUT-GP-001: optional Assembly batch action sink. */
    readonly assemblyBatch?: FactoryWorldAssemblyBatchSink | null;
    /** AUT-GP-001: optional observer of the domain events fanned out (FactoryWorld passes a DEBUG diagnostic). */
    readonly observeDomainEvents?: (events: readonly DomainEvent[]) => void;
    /** Minimum active time between ordinary save requests from `tick` (the dirty policy still decides). */
    readonly saveRequestIntervalSeconds?: number;
}

export interface FactoryWorldSessionSummary {
    readonly autoFeederOwned: boolean;
}

export const FACTORY_WORLD_SAVE_REQUEST_INTERVAL_SECONDS = 1;

/** FactoryWorld selection ids (zone names) → authoritative producer config ids. */
export const FACTORY_WORLD_SELECTION_PRODUCER_IDS: Readonly<Record<string, string>> = Object.freeze({
    Fabricator: 'fabricator',
    AssemblyStation: 'assembly_station',
    RobotLine: 'robot_line',
    AutomatedCell: 'automated_cell',
    AdvancedRoboticsComplex: 'advanced_robotics_complex',
});

/** Maps a world selection id to its producer id; producer ids pass through unchanged. */
export function resolveSelectedProducerId(selectionId: string | null): string | null {
    if (selectionId === null) return null;
    return FACTORY_WORLD_SELECTION_PRODUCER_IDS[selectionId] ?? selectionId;
}

/**
 * AUT-INT-001 engine-free bridge between the authoritative session and FactoryWorld presentation.
 * It submits commands, advances the active clock and fans out fresh snapshots; it never mutates
 * state and keeps no GameState copy between calls. Errors are reported, never thrown.
 */
export class FactoryWorldStateBinding {
    private readonly session: FactoryWorldSessionPort;
    private readonly configRepository: GameConfigRepository;
    private readonly automation: FactoryWorldAutomationSink | null;
    private readonly hud: FactoryWorldHudSink | null;
    private readonly panel: FactoryWorldPanelSink | null;
    private readonly camera: FactoryWorldCameraSink | null;
    private readonly assemblyBatch: FactoryWorldAssemblyBatchSink | null;
    private readonly observeDomainEvents: ((events: readonly DomainEvent[]) => void) | null;
    private readonly reportError: FactoryWorldErrorReporter;
    private readonly reportCommandResult: FactoryWorldCommandResultReporter | null;
    private readonly saveRequestIntervalSeconds: number;
    private selectedProducerId: string | null = null;
    private secondsSinceSaveRequest = 0;
    private tickInFlight = false;
    private suspended = false;

    constructor(options: FactoryWorldStateBindingOptions) {
        this.session = options.session;
        this.configRepository = options.configRepository;
        this.automation = options.automation;
        this.hud = options.hud;
        this.panel = options.panel;
        this.camera = options.camera ?? null;
        this.assemblyBatch = options.assemblyBatch ?? null;
        this.observeDomainEvents = options.observeDomainEvents ?? null;
        this.reportError = options.reportError ?? (() => undefined);
        this.reportCommandResult = options.reportCommandResult ?? null;
        this.saveRequestIntervalSeconds = options.saveRequestIntervalSeconds ?? FACTORY_WORLD_SAVE_REQUEST_INTERVAL_SECONDS;
    }

    /** Initial state sync: rebuilds the world from the loaded state without replaying payoff events. */
    init(): void {
        this.guard('init', () => {
            const snapshot = this.session.getStateSnapshot();
            this.automation?.syncAutomationState(snapshot);
            this.refreshViews(snapshot);
            this.camera?.syncPanBounds(snapshot);
        });
    }

    getSelectedProducerId(): string | null {
        return this.selectedProducerId;
    }

    describe(): FactoryWorldSessionSummary {
        let autoFeederOwned = false;
        this.guard('describe', () => {
            autoFeederOwned = this.session.getStateSnapshot().run.purchasedBreakthroughIds.includes('auto_feeder');
        });
        return Object.freeze({ autoFeederOwned });
    }

    /** Accepts a world selection id (`Fabricator`) or a producer id (`fabricator`). */
    onSelectionChanged(selectionId: string | null): void {
        const producerId = resolveSelectedProducerId(selectionId);
        this.selectedProducerId = producerId;
        this.guard('selection', () => {
            const snapshot = this.session.getStateSnapshot();
            this.panel?.refresh(createProducerPanelViewModel(this.configRepository, snapshot, producerId));
            this.assemblyBatch?.refresh(createAssemblyBatchViewModel(this.configRepository, snapshot, producerId));
        });
    }

    async submit(command: GameCommand): Promise<LifecycleCommandResult | null> {
        try {
            const result = await this.session.execute(command, { requestOrdinarySave: true });
            if (result.execution.ok) {
                this.fanOut(result.execution.events);
            }
            const reportCommandResult = this.reportCommandResult;
            if (reportCommandResult) this.guard('command_result', () => reportCommandResult(command, result));
            return result;
        }
        catch (error) {
            this.report('submit', error);
            return null;
        }
    }

    /** Per-frame: advance the active clock; request an ordinary save at most once per interval. */
    async tick(deltaSeconds: number): Promise<LifecycleActiveClockAdvanceResult | null> {
        if (this.suspended) {
            return null;
        }

        this.secondsSinceSaveRequest += Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
        if (this.tickInFlight) {
            return null;
        }

        this.tickInFlight = true;
        try {
            const requestOrdinarySave = this.secondsSinceSaveRequest >= this.saveRequestIntervalSeconds;
            if (requestOrdinarySave) {
                this.secondsSinceSaveRequest = 0;
            }

            const result = await this.session.advanceActiveSessionFromClock({ requestOrdinarySave });
            if (result.runtime.execution.ok && result.runtime.execution.events.length > 0) {
                this.fanOut(result.runtime.execution.events);
            }
            return result;
        }
        catch (error) {
            this.report('tick', error);
            return null;
        }
        finally {
            this.tickInFlight = false;
        }
    }

    async suspend(): Promise<LifecycleSuspendResult | null> {
        this.suspended = true;
        try {
            return await this.session.suspend();
        }
        catch (error) {
            this.report('suspend', error);
            return null;
        }
    }

    resume(): LifecycleResumeResult | null {
        this.suspended = false;
        try {
            return this.session.resume();
        }
        catch (error) {
            this.report('resume', error);
            return null;
        }
    }

    private fanOut(events: readonly DomainEvent[]): void {
        this.guard('fan_out', () => {
            const snapshot = this.session.getStateSnapshot();
            this.automation?.consumeDomainEvents(snapshot, events);
            this.refreshViews(snapshot);
            this.camera?.syncPanBounds(snapshot);
        });
        const observeDomainEvents = this.observeDomainEvents;
        if (observeDomainEvents) this.guard('observe_events', () => observeDomainEvents(events));
    }

    private refreshViews(snapshot: GameState): void {
        this.hud?.refresh(createHudViewModel(this.configRepository, snapshot));
        this.panel?.refresh(createProducerPanelViewModel(this.configRepository, snapshot, this.selectedProducerId));
        this.assemblyBatch?.refresh(createAssemblyBatchViewModel(this.configRepository, snapshot, this.selectedProducerId));
    }

    private guard(context: string, action: () => void): void {
        try {
            action();
        }
        catch (error) {
            this.report(context, error);
        }
    }

    private report(context: string, error: unknown): void {
        try {
            this.reportError(context, error);
        }
        catch {
            // Reporting must never reach the frame loop.
        }
    }
}
