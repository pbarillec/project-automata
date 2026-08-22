import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { DomainEvent, GameCommand } from '../domain/index.ts';
import {
    collectOfflineProgress,
    createOfflineProgressPreviewFromUtc,
    type OfflineCollectInvalidResult,
    type OfflineCollectFailureResult,
    type OfflineCollectNoRewardResult,
    type OfflineCollectSuccessResult,
    type OfflinePreviewResult,
    type OfflineProgressConfig,
} from '../offline/index.ts';
import type {
    LoadGameFailureResult,
    LoadGameFreshResult,
    LoadGameMainResult,
    LoadGameRecoveredBackupResult,
    PersistenceCoordinator,
    PersistenceSaveResult,
} from '../persistence/index.ts';
import {
    GameRuntime,
    type ClockAdvanceActiveSessionResult,
    type CommandExecutionResult,
    type CommandRejectionResult,
    type CommandSuccessResult,
    type RebootPreview,
} from '../runtime/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import type {
    LifecycleResumeBoundary,
    LifecycleSuspendBoundary,
    TimeService,
    UtcTimestampIsoString,
} from '../time/index.ts';
import {
    LifecycleTimeTracker,
} from '../time/index.ts';

export type LifecycleStartupStatus = 'loaded_main' | 'recovered_backup' | 'fresh_game';

export interface LifecycleSessionCoordinatorOptions {
    readonly configRepository: GameConfigRepository;
    readonly persistence: PersistenceCoordinator;
    readonly timeService: TimeService;
    readonly offlineConfig?: Partial<OfflineProgressConfig>;
}

export interface LifecycleStartupSuccessResult {
    readonly ok: true;
    readonly status: LifecycleStartupStatus;
    readonly load: LoadGameMainResult | LoadGameRecoveredBackupResult | LoadGameFreshResult;
    readonly session: LifecycleSessionCoordinator;
    readonly offlinePreview: OfflinePreviewResult | null;
}

export interface LifecycleStartupFailureResult {
    readonly ok: false;
    readonly status: 'load_failed';
    readonly load: LoadGameFailureResult;
}

export type LifecycleStartupResult = LifecycleStartupSuccessResult | LifecycleStartupFailureResult;

export interface LifecycleSuspendResult {
    readonly status: 'suspended_saved' | 'suspend_save_failed';
    readonly boundary: LifecycleSuspendBoundary;
    readonly save: PersistenceSaveResult;
}

export interface LifecycleResumePreviewCreatedResult {
    readonly status: 'preview_created';
    readonly boundary: LifecycleResumeBoundary;
    readonly offlinePreview: OfflinePreviewResult;
}

export interface LifecycleResumeExistingPendingResult {
    readonly status: 'existing_pending_preview';
    readonly offlinePreview: OfflinePreviewResult;
}

export interface LifecycleResumeNoAbsenceResult {
    readonly status: 'no_absence';
    readonly boundary: LifecycleResumeBoundary;
    readonly offlinePreview: null;
}

export type LifecycleResumeResult =
    | LifecycleResumePreviewCreatedResult
    | LifecycleResumeExistingPendingResult
    | LifecycleResumeNoAbsenceResult;

export interface LifecycleCommandResult {
    readonly execution: CommandExecutionResult;
    readonly save: PersistenceSaveResult | null;
}

export interface LifecycleActiveClockAdvanceResult {
    readonly runtime: ClockAdvanceActiveSessionResult;
    readonly save: PersistenceSaveResult | null;
}

export interface LifecycleCollectNoPendingResult {
    readonly status: 'no_pending_preview';
}

export interface LifecycleCollectInvalidResult {
    readonly status: 'collect_failed';
    readonly collect: OfflineCollectInvalidResult | OfflineCollectFailureResult;
}

export interface LifecycleCollectDurableResult {
    readonly status: 'collected_saved' | 'no_reward_saved';
    readonly collect: OfflineCollectSuccessResult | OfflineCollectNoRewardResult;
    readonly save: PersistenceSaveResult & { readonly ok: true };
}

export interface LifecycleCollectDurabilityFailureResult {
    readonly status: 'collected_persistence_failed' | 'no_reward_persistence_failed';
    readonly collect: OfflineCollectSuccessResult | OfflineCollectNoRewardResult;
    readonly save: PersistenceSaveResult & { readonly ok: false };
}

export type LifecycleCollectResult =
    | LifecycleCollectNoPendingResult
    | LifecycleCollectInvalidResult
    | LifecycleCollectDurableResult
    | LifecycleCollectDurabilityFailureResult;

export interface LifecycleRebootPendingOfflineResult {
    readonly status: 'pending_offline_preview';
    readonly offlinePreview: OfflinePreviewResult;
}

export interface LifecycleRebootRejectedResult {
    readonly status: 'reboot_rejected';
    readonly execution: CommandRejectionResult;
    readonly save: null;
}

export interface LifecycleRebootDurableResult {
    readonly status: 'reboot_saved';
    readonly execution: CommandSuccessResult;
    readonly save: PersistenceSaveResult & { readonly ok: true };
}

export interface LifecycleRebootDurabilityFailureResult {
    readonly status: 'reboot_persistence_failed';
    readonly execution: CommandSuccessResult;
    readonly save: PersistenceSaveResult & { readonly ok: false };
}

export type LifecycleRebootResult =
    | LifecycleRebootPendingOfflineResult
    | LifecycleRebootRejectedResult
    | LifecycleRebootDurableResult
    | LifecycleRebootDurabilityFailureResult;

export interface LifecyclePermanentUpgradeRejectedResult {
    readonly status: 'permanent_upgrade_rejected';
    readonly execution: CommandRejectionResult;
    readonly save: null;
}

export interface LifecyclePermanentUpgradeDurableResult {
    readonly status: 'permanent_upgrade_saved';
    readonly execution: CommandSuccessResult;
    readonly save: PersistenceSaveResult & { readonly ok: true };
}

export interface LifecyclePermanentUpgradeDurabilityFailureResult {
    readonly status: 'permanent_upgrade_persistence_failed';
    readonly execution: CommandSuccessResult;
    readonly save: PersistenceSaveResult & { readonly ok: false };
}

export type LifecyclePermanentUpgradePurchaseResult =
    | LifecyclePermanentUpgradeRejectedResult
    | LifecyclePermanentUpgradeDurableResult
    | LifecyclePermanentUpgradeDurabilityFailureResult;

export class LifecycleSessionCoordinator {
    private readonly configRepository: GameConfigRepository;
    private readonly persistence: PersistenceCoordinator;
    private readonly timeService: TimeService;
    private readonly lifecycleTime: LifecycleTimeTracker;
    private readonly offlineConfig: Partial<OfflineProgressConfig> | undefined;
    private runtime: GameRuntime;
    private pendingOfflinePreview: OfflinePreviewResult | null;
    private openAbsenceBoundaryUtcIso: UtcTimestampIsoString | null = null;
    private lastClosedAbsenceUtcIso: UtcTimestampIsoString | null = null;

    private constructor(
        options: LifecycleSessionCoordinatorOptions,
        state: GameState,
        pendingOfflinePreview: OfflinePreviewResult | null,
    ) {
        this.configRepository = options.configRepository;
        this.persistence = options.persistence;
        this.timeService = options.timeService;
        this.lifecycleTime = new LifecycleTimeTracker(options.timeService);
        this.offlineConfig = options.offlineConfig;
        this.runtime = this.createRuntime(state);
        this.pendingOfflinePreview = pendingOfflinePreview;
    }

    static async startup(options: LifecycleSessionCoordinatorOptions): Promise<LifecycleStartupResult> {
        const load = await options.persistence.load();
        if (!load.ok) {
            return Object.freeze({
                ok: false as const,
                status: 'load_failed' as const,
                load,
            });
        }

        const offlinePreview = load.status === 'fresh_started'
            ? null
            : createOfflineProgressPreviewFromUtc(options.configRepository, load.state, {
                persistedAtUtcIso: load.envelope.savedAtUtc,
                currentUtcIso: options.timeService.nowUtcIso(),
                config: options.offlineConfig,
            });
        const session = new LifecycleSessionCoordinator(options, load.state, toPendingOfflinePreview(offlinePreview));

        return Object.freeze({
            ok: true as const,
            status: mapLoadStatus(load.status),
            load,
            session,
            offlinePreview,
        });
    }

    getStateSnapshot(): GameState {
        return this.runtime.getStateSnapshot();
    }

    getPendingOfflinePreview(): OfflinePreviewResult | null {
        return this.pendingOfflinePreview;
    }

    createRebootPreview(): RebootPreview {
        return this.runtime.createRebootPreview();
    }

    async execute(command: GameCommand, options: { readonly requestOrdinarySave?: boolean } = {}): Promise<LifecycleCommandResult> {
        const execution = this.runtime.execute(command);
        let save: PersistenceSaveResult | null = null;
        if (execution.ok) {
            this.persistence.markDirty();
            if (options.requestOrdinarySave === true) {
                save = await this.persistence.requestSave(this.runtime.getStateSnapshot(), {
                    intent: 'ordinary',
                    reason: 'runtime_command',
                });
            }
        }

        return Object.freeze({ execution, save });
    }

    async advanceActiveSessionFromClock(options: { readonly requestOrdinarySave?: boolean } = {}): Promise<LifecycleActiveClockAdvanceResult> {
        const runtime = this.runtime.advanceActiveSessionFromClock();
        let save: PersistenceSaveResult | null = null;
        if (runtime.execution.ok && runtime.execution.events.length > 0) {
            this.persistence.markDirty();
            if (options.requestOrdinarySave === true) {
                save = await this.persistence.requestSave(this.runtime.getStateSnapshot(), {
                    intent: 'ordinary',
                    reason: 'dirty_tick',
                });
            }
        }

        return Object.freeze({ runtime, save });
    }

    async rebootCivilizationConfirmed(): Promise<LifecycleRebootResult> {
        if (this.pendingOfflinePreview !== null) {
            return Object.freeze({
                status: 'pending_offline_preview' as const,
                offlinePreview: this.pendingOfflinePreview,
            });
        }

        const preview = this.runtime.createRebootPreview();
        const execution = this.runtime.rebootCivilizationConfirmed();
        if (!execution.ok) {
            return Object.freeze({
                status: 'reboot_rejected' as const,
                execution,
                save: null,
            });
        }

        this.persistence.markDirty();
        const save = await this.persistence.requestSave(this.runtime.getStateSnapshot(), {
            intent: 'critical',
            reason: 'reboot',
        });

        if (!save.ok) {
            return Object.freeze({
                status: 'reboot_persistence_failed' as const,
                execution,
                save,
            });
        }

        return Object.freeze({
            status: 'reboot_saved' as const,
            execution: appendDurableRebootCompletedEvent(execution, preview),
            save,
        });
    }

    async purchasePermanentUpgrade(upgradeId: string): Promise<LifecyclePermanentUpgradePurchaseResult> {
        const execution = this.runtime.purchasePermanentUpgrade(upgradeId);
        if (!execution.ok) {
            return Object.freeze({
                status: 'permanent_upgrade_rejected' as const,
                execution,
                save: null,
            });
        }

        this.persistence.markDirty();
        const save = await this.persistence.requestSave(this.runtime.getStateSnapshot(), {
            intent: 'critical',
            reason: 'permanent_upgrade_purchase',
        });

        if (!save.ok) {
            return Object.freeze({
                status: 'permanent_upgrade_persistence_failed' as const,
                execution,
                save,
            });
        }

        return Object.freeze({
            status: 'permanent_upgrade_saved' as const,
            execution,
            save,
        });
    }

    async suspend(): Promise<LifecycleSuspendResult> {
        const boundary = this.lifecycleTime.recordSuspend();
        this.openAbsenceBoundaryUtcIso = boundary.persistedUtcTimestamp;
        const save = await this.persistence.requestSave(this.runtime.getStateSnapshot(), {
            intent: 'critical',
            reason: 'suspend',
            savedAtUtcIso: boundary.persistedUtcTimestamp,
        });

        return Object.freeze({
            status: save.ok ? 'suspended_saved' as const : 'suspend_save_failed' as const,
            boundary,
            save,
        });
    }

    resume(): LifecycleResumeResult {
        if (this.pendingOfflinePreview !== null) {
            return Object.freeze({
                status: 'existing_pending_preview' as const,
                offlinePreview: this.pendingOfflinePreview,
            });
        }

        const boundary = this.lifecycleTime.recordResume(this.openAbsenceBoundaryUtcIso);
        if (this.openAbsenceBoundaryUtcIso === null) {
            return Object.freeze({
                status: 'no_absence' as const,
                boundary,
                offlinePreview: null,
            });
        }

        const offlinePreview = createOfflineProgressPreviewFromUtc(this.configRepository, this.runtime.getStateSnapshot(), {
            persistedAtUtcIso: this.openAbsenceBoundaryUtcIso,
            currentUtcIso: boundary.resumedAtUtc.iso,
            config: this.offlineConfig,
        });
        this.openAbsenceBoundaryUtcIso = null;
        this.pendingOfflinePreview = toPendingOfflinePreview(offlinePreview);

        return Object.freeze({
            status: 'preview_created' as const,
            boundary,
            offlinePreview,
        });
    }

    async collectPendingOffline(): Promise<LifecycleCollectResult> {
        const pending = this.pendingOfflinePreview;
        if (pending === null) {
            return Object.freeze({
                status: 'no_pending_preview' as const,
            });
        }

        const collect = collectOfflineProgress(this.configRepository, this.runtime.getStateSnapshot(), { preview: pending });
        if (collect.status === 'invalid_time' || collect.status === 'invalid_config' || collect.status === 'failure') {
            return Object.freeze({
                status: 'collect_failed' as const,
                collect,
            });
        }

        this.replaceRuntimeState(collect.state);
        this.pendingOfflinePreview = null;
        this.lastClosedAbsenceUtcIso = collect.criticalSaveRequest.collectedThroughUtcIso;

        const save = await this.persistence.requestSave(this.runtime.getStateSnapshot(), {
            intent: 'critical',
            reason: 'offline_collect',
            savedAtUtcIso: collect.criticalSaveRequest.collectedThroughUtcIso,
        });

        if (!save.ok) {
            return Object.freeze({
                status: collect.status === 'success'
                    ? 'collected_persistence_failed' as const
                    : 'no_reward_persistence_failed' as const,
                collect,
                save,
            });
        }

        return Object.freeze({
            status: collect.status === 'success' ? 'collected_saved' as const : 'no_reward_saved' as const,
            collect,
            save,
        });
    }

    getLastClosedAbsenceUtcIso(): UtcTimestampIsoString | null {
        return this.lastClosedAbsenceUtcIso;
    }

    private replaceRuntimeState(state: GameState): void {
        this.runtime = this.createRuntime(cloneGameState(state));
    }

    private createRuntime(state: GameState): GameRuntime {
        return new GameRuntime(this.configRepository, state, { timeService: this.timeService });
    }
}

function mapLoadStatus(status: LoadGameMainResult['status'] | LoadGameRecoveredBackupResult['status'] | LoadGameFreshResult['status']): LifecycleStartupStatus {
    if (status === 'loaded_main') {
        return 'loaded_main';
    }

    if (status === 'recovered_backup') {
        return 'recovered_backup';
    }

    return 'fresh_game';
}

function toPendingOfflinePreview(offlinePreview: OfflinePreviewResult | null): OfflinePreviewResult | null {
    return offlinePreview?.status === 'preview_ready' ? offlinePreview : null;
}

function appendDurableRebootCompletedEvent(
    execution: CommandSuccessResult,
    preview: RebootPreview,
): CommandSuccessResult {
    const completionEvent: DomainEvent = Object.freeze({
        type: 'rebootCompleted' as const,
        oldCivilization: preview.currentCivilization,
        newCivilization: preview.resultingCivilization,
        aiCoresGranted: preview.aiCoresToGain,
        prestigePower: preview.prestigePower,
    });

    return Object.freeze({
        ...execution,
        events: Object.freeze([
            ...execution.events,
            completionEvent,
        ]),
    });
}
