import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type {
    LifecycleActiveClockAdvanceResult,
    LifecycleBonusCollectResult,
    LifecycleCollectResult,
    LifecycleCommandResult,
    LifecycleExtendedOverclockOffer,
    LifecycleExtendedOverclockResult,
    LifecycleOfflineDoubleOffer,
    LifecyclePermanentUpgradePurchaseResult,
    LifecycleRebootResult,
    LifecycleResumeResult,
    LifecycleSuspendResult,
    OfflineDoubleAdProof,
    RewardedAdProof,
} from '../lifecycle/LifecycleSessionCoordinator.ts';
import type { OfflinePreviewResult } from '../offline/index.ts';
import type { GameState } from '../state/GameState.ts';
import { createAssemblyBatchViewModel, type AssemblyBatchViewModel } from './AssemblyBatchViewModel.ts';
import { createHudViewModel, type HudViewModel } from './HudViewModel.ts';
import { createPermanentUpgradePanelViewModel, type PermanentUpgradePanelViewModel } from './PermanentUpgradePanelViewModel.ts';
import { createProducerPanelViewModel, type ProducerPanelViewModel } from './ProducerPanelViewModel.ts';
import { createRebootPanelViewModel, type RebootPanelViewModel } from './RebootPanelViewModel.ts';

/** The authoritative persistent session (structurally `LifecycleSessionCoordinator`). */
export interface FactoryWorldSessionPort {
    getStateSnapshot(): GameState;
    execute(command: GameCommand, options?: { readonly requestOrdinarySave?: boolean }): Promise<LifecycleCommandResult>;
    advanceActiveSessionFromClock(options?: { readonly requestOrdinarySave?: boolean }): Promise<LifecycleActiveClockAdvanceResult>;
    suspend(): Promise<LifecycleSuspendResult>;
    resume(): LifecycleResumeResult;
    /** AUT-049: the confirmed Reboot transaction (critical save, then the durable `rebootCompleted` event). Optional so minimal ports still work. */
    rebootCivilizationConfirmed?(): Promise<LifecycleRebootResult>;
    /** AUT-051: the collectible offline preview the session keeps pending (null when none). Optional so minimal ports still work. */
    getPendingOfflinePreview?(): OfflinePreviewResult | null;
    /** AUT-051: the explicit, idempotent offline collection (critical save with the collection cursor). */
    collectPendingOffline?(): Promise<LifecycleCollectResult>;
    /** AUT-055: the Offline Double (rewarded x2) offer for the pending preview (null without one). Optional so minimal ports still work. */
    getOfflineDoubleOffer?(): LifecycleOfflineDoubleOffer | null;
    /** AUT-055: the atomic, exactly-once x2 collection from a verified rewarded-ad proof. Optional so minimal ports still work. */
    collectPendingOfflineWithRewardedBonus?(proof: OfflineDoubleAdProof): Promise<LifecycleBonusCollectResult>;
    /** AUT-056: the Extended Overclock offer (eligibility + activation preconditions). Optional so minimal ports still work. */
    getExtendedOverclockOffer?(): LifecycleExtendedOverclockOffer;
    /** AUT-056: starts the Extended Overclock from a verified rewarded-ad proof (boost + claim atomically, one critical save). Optional so minimal ports still work. */
    activateExtendedOverclockWithRewardedProof?(proof: RewardedAdProof): Promise<LifecycleExtendedOverclockResult>;
    /** AUT-050: the permanent-upgrade purchase transaction (in-memory commit, then a critical save). Optional so minimal ports still work. */
    purchasePermanentUpgrade?(upgradeId: string): Promise<LifecyclePermanentUpgradePurchaseResult>;
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

/** AUT-050: the AI Upgrades chip / panel, refreshed with every fresh snapshot (balance, ranks, affordability). */
export interface FactoryWorldPermanentUpgradeSink {
    refresh(viewModel: PermanentUpgradePanelViewModel): void;
}

/** AUT-RBT-001: the Reboot entry chip / confirmation modal, refreshed with every fresh snapshot (eligibility, reward, progress). */
export interface FactoryWorldRebootSink {
    refresh(viewModel: RebootPanelViewModel): void;
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
    /** AUT-050: optional AI Upgrades sink. */
    readonly permanentUpgrades?: FactoryWorldPermanentUpgradeSink | null;
    /** AUT-RBT-001: optional Reboot chip / modal sink. */
    readonly reboot?: FactoryWorldRebootSink | null;
    /** AUT-GP-001: optional observer of the domain events fanned out (FactoryWorld passes a DEBUG diagnostic). */
    readonly observeDomainEvents?: (events: readonly DomainEvent[]) => void;
    /** Minimum active time between ordinary save requests from `tick` (the dirty policy still decides). */
    readonly saveRequestIntervalSeconds?: number;
    /** AUT-051: called when a Reboot was blocked by a pending offline report (FactoryWorld re-surfaces the card and emits a DEBUG event). */
    readonly onRebootBlockedByPendingOffline?: () => void;
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
    private readonly permanentUpgrades: FactoryWorldPermanentUpgradeSink | null;
    private readonly reboot: FactoryWorldRebootSink | null;
    private readonly observeDomainEvents: ((events: readonly DomainEvent[]) => void) | null;
    private readonly reportError: FactoryWorldErrorReporter;
    private readonly reportCommandResult: FactoryWorldCommandResultReporter | null;
    private readonly saveRequestIntervalSeconds: number;
    private readonly onRebootBlockedByPendingOffline: (() => void) | null;
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
        this.permanentUpgrades = options.permanentUpgrades ?? null;
        this.reboot = options.reboot ?? null;
        this.observeDomainEvents = options.observeDomainEvents ?? null;
        this.reportError = options.reportError ?? (() => undefined);
        this.reportCommandResult = options.reportCommandResult ?? null;
        this.saveRequestIntervalSeconds = options.saveRequestIntervalSeconds ?? FACTORY_WORLD_SAVE_REQUEST_INTERVAL_SECONDS;
        this.onRebootBlockedByPendingOffline = options.onRebootBlockedByPendingOffline ?? null;
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

    /** AUT-047: read-only state snapshot for presentation re-sync after a foreground (null on error). */
    getStateSnapshot(): GameState | null {
        let snapshot: GameState | null = null;
        this.guard('state_snapshot', () => { snapshot = this.session.getStateSnapshot(); });
        return snapshot;
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
            // AUT-049: a Reboot goes through the session's Reboot transaction, so `rebootCompleted` exists only after `reboot_saved`.
            if (command.type === 'rebootCivilization' && typeof this.session.rebootCivilizationConfirmed === 'function') return await this.submitReboot(command);
            // AUT-050: a permanent-upgrade purchase goes through the session's purchase transaction (critical save), not the ordinary-save path.
            if (command.type === 'purchasePermanentUpgrade' && typeof this.session.purchasePermanentUpgrade === 'function') return await this.submitPermanentUpgrade(command);
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

    private async submitReboot(command: GameCommand): Promise<LifecycleCommandResult | null> {
        const reboot = await this.session.rebootCivilizationConfirmed!();
        // A pending offline report blocks the Reboot: nothing executed, nothing to fan out.
        if (reboot.status === 'pending_offline_preview') {
            const blocked = this.onRebootBlockedByPendingOffline;
            if (blocked) this.guard('reboot_blocked', blocked);
            return null;
        }
        const result: LifecycleCommandResult = { execution: reboot.execution, save: reboot.save };
        // `reboot_saved` carries the durable `rebootCompleted` event; `reboot_persistence_failed` still fans out the state change but never that event.
        if (result.execution.ok) this.fanOut(result.execution.events);
        const reportCommandResult = this.reportCommandResult;
        if (reportCommandResult) this.guard('command_result', () => reportCommandResult(command, result));
        return result;
    }

    private async submitPermanentUpgrade(command: GameCommand & { type: 'purchasePermanentUpgrade' }): Promise<LifecycleCommandResult> {
        const purchase = await this.session.purchasePermanentUpgrade!(command.upgradeId);
        const result: LifecycleCommandResult = { execution: purchase.execution, save: purchase.save };
        // `permanent_upgrade_persistence_failed` still fans out the in-memory change (the session does not roll back); a rejection changes nothing.
        if (result.execution.ok) this.fanOut(result.execution.events);
        const reportCommandResult = this.reportCommandResult;
        if (reportCommandResult) this.guard('command_result', () => reportCommandResult(command, result));
        return result;
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

    /** AUT-051: the pending collectible offline preview (null when none, when the port has no offline support, or on error). */
    getPendingOfflinePreview(): OfflinePreviewResult | null {
        let preview: OfflinePreviewResult | null = null;
        this.guard('pending_offline', () => { preview = typeof this.session.getPendingOfflinePreview === 'function' ? this.session.getPendingOfflinePreview() : null; });
        return preview;
    }

    /**
     * AUT-051: collects the pending offline report through the session (idempotent). A collection that applied (durable or not) refreshes
     * the HUD / panel views from the fresh snapshot; it emits no domain event, so no milestone / fanfare / camera beat can start.
     * Returns null when the port has no offline support or the call threw.
     */
    async collectOfflineReport(): Promise<LifecycleCollectResult | null> {
        try {
            if (typeof this.session.collectPendingOffline !== 'function') return null;
            const result = await this.session.collectPendingOffline();
            if (result.status !== 'collect_failed' && result.status !== 'no_pending_preview') this.guard('collect_refresh', () => this.refreshViews(this.session.getStateSnapshot()));
            return result;
        }
        catch (error) {
            this.report('collect_offline', error);
            return null;
        }
    }

    /** AUT-055: the Offline Double offer (null when none, when the port has no support, or on error). */
    getOfflineDoubleOffer(): LifecycleOfflineDoubleOffer | null {
        let offer: LifecycleOfflineDoubleOffer | null = null;
        this.guard('offline_double_offer', () => { offer = typeof this.session.getOfflineDoubleOffer === 'function' ? this.session.getOfflineDoubleOffer() : null; });
        return offer;
    }

    /**
     * AUT-055: collects the pending offline report with the verified rewarded x2 bonus (same guard / refresh / report pattern as
     * `collectOfflineReport`). A collection that applied (granted or not durably saved) refreshes the HUD / panel views; a bonus_not_granted
     * changes nothing. Returns null when the port has no support or the call threw.
     */
    async collectOfflineReportWithBonus(proof: OfflineDoubleAdProof): Promise<LifecycleBonusCollectResult | null> {
        try {
            if (typeof this.session.collectPendingOfflineWithRewardedBonus !== 'function') return null;
            const result = await this.session.collectPendingOfflineWithRewardedBonus(proof);
            if (result.status !== 'collect_failed' && result.status !== 'no_pending_preview' && result.status !== 'bonus_not_granted') this.guard('collect_bonus_refresh', () => this.refreshViews(this.session.getStateSnapshot()));
            return result;
        }
        catch (error) {
            this.report('collect_offline_bonus', error);
            return null;
        }
    }

    /** AUT-056: the Extended Overclock offer (null when the port has no support or on error). */
    getExtendedOverclockOffer(): LifecycleExtendedOverclockOffer | null {
        let offer: LifecycleExtendedOverclockOffer | null = null;
        this.guard('extended_overclock_offer', () => { offer = typeof this.session.getExtendedOverclockOffer === 'function' ? this.session.getExtendedOverclockOffer() : null; });
        return offer;
    }

    /**
     * AUT-056: starts the Extended Overclock from a verified rewarded-ad proof. An activation (durable or not) fans out its events
     * (AUT-047 impulse + HUD refresh) and reports the command result; a not_granted changes and fans out nothing. Null when the port has
     * no support or the call threw.
     */
    async activateExtendedOverclockWithProof(proof: RewardedAdProof): Promise<LifecycleExtendedOverclockResult | null> {
        try {
            if (typeof this.session.activateExtendedOverclockWithRewardedProof !== 'function') return null;
            const result = await this.session.activateExtendedOverclockWithRewardedProof(proof);
            if (result.status === 'activated_saved' || result.status === 'activated_persistence_failed') {
                this.fanOut(result.execution.events);
                const reportCommandResult = this.reportCommandResult;
                if (reportCommandResult) this.guard('command_result', () => reportCommandResult(result.execution.command, { execution: result.execution, save: result.save }));
            }
            return result;
        }
        catch (error) {
            this.report('activate_extended_overclock', error);
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
        this.permanentUpgrades?.refresh(createPermanentUpgradePanelViewModel(this.configRepository, snapshot));
        this.reboot?.refresh(createRebootPanelViewModel(this.configRepository, snapshot));
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
