import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { DomainEvent, GameCommand } from '../domain/index.ts';
import { getFounderSurgeChargesRemaining } from '../monetization/FounderOffer.ts';
import { getRewardedClaimHistory, recordRewardedClaim } from '../monetization/RewardedClaimHistory.ts';
import {
    EXTENDED_OVERCLOCK_CLAIM_KEY,
    OFFLINE_DOUBLE_CLAIM_KEY,
    OFFLINE_DOUBLE_MULTIPLIER,
    evaluateExtendedOverclockEligibility,
    evaluateOfflineDoubleEligibility,
    type RewardedEligibilityResult,
} from '../monetization/RewardedEligibility.ts';
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
import { EXTENDED_OVERCLOCK_BOOST_ID, isFreeOverclockUnlocked } from '../progression/index.ts';
import type {
    LoadGameFailureResult,
    LoadGameFreshResult,
    LoadGameMainResult,
    LoadGameRecoveredBackupResult,
    PersistenceCoordinator,
    PersistenceSaveRequest,
    PersistenceSaveResult,
} from '../persistence/index.ts';
import { createSaveTimestampUtcIsoFromUnixMilliseconds } from '../persistence/index.ts';
import {
    DEBUG_LIMITS,
    DEBUG_SOURCE,
    GameRuntime,
    isDebugGateEnabled,
    type DebugGate,
    type DebugStatePatch,
    type ClockAdvanceActiveSessionResult,
    type CommandExecutionResult,
    type CommandRejectionResult,
    type CommandSuccessResult,
    type RebootPreview,
} from '../runtime/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import { assertValidGameState } from '../state/StateValidation.ts';
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
    /**
     * AUT-055: request-id idempotency guard for the rewarded Offline Double (structurally a RewardClaimLedger).
     * Defaults to an internal in-memory set.
     */
    readonly rewardClaimLedger?: { tryConsume(requestId: string): boolean };
}

/**
 * AUT-055: structural proof of a rewarded ad result (shape-compatible with the ad provider's result type;
 * declared locally so the lifecycle layer stays free of any ad-provider import).
 */
export interface RewardedAdProof {
    readonly requestId: string;
    readonly placementId: string;
    readonly status: string;
    readonly rewardVerified: boolean;
    readonly duplicate?: boolean;
}

/** AUT-055 name kept so existing code and tests are unchanged. */
export type OfflineDoubleAdProof = RewardedAdProof;

/** AUT-056: the Extended Overclock offer. `activeBlocked` covers the activation preconditions that are not player eligibility. */
export interface LifecycleExtendedOverclockOffer {
    readonly eligibility: RewardedEligibilityResult;
    readonly activeBlocked: boolean;
    readonly blockedReason: 'active' | 'locked' | 'offline_pending' | null;
}

export type ExtendedOverclockNotGrantedReason =
    | OfflineDoubleNotGrantedReason
    | 'offline_pending'
    | 'already_active'
    | 'locked'
    | 'rejected';

export interface LifecycleExtendedOverclockNotGrantedResult {
    readonly status: 'not_granted';
    readonly reason: ExtendedOverclockNotGrantedReason;
    readonly execution?: CommandRejectionResult;
}

export interface LifecycleExtendedOverclockDurableResult {
    readonly status: 'activated_saved';
    readonly execution: CommandSuccessResult;
    readonly save: PersistenceSaveResult & { readonly ok: true };
}

export interface LifecycleExtendedOverclockDurabilityFailureResult {
    readonly status: 'activated_persistence_failed';
    readonly execution: CommandSuccessResult;
    readonly save: PersistenceSaveResult & { readonly ok: false };
}

export type LifecycleExtendedOverclockResult =
    | LifecycleExtendedOverclockNotGrantedResult
    | LifecycleExtendedOverclockDurableResult
    | LifecycleExtendedOverclockDurabilityFailureResult;

/** AUT-058: outcome of a Founder pack purchase delivery / store report. `already_applied`: valid, nothing to persist (replay / not owned). */
export type LifecycleFounderResult =
    | { readonly status: 'rejected'; readonly execution: CommandRejectionResult }
    | { readonly status: 'already_applied'; readonly execution: CommandSuccessResult; readonly save: null }
    | { readonly status: 'applied_saved'; readonly execution: CommandSuccessResult; readonly save: PersistenceSaveResult & { readonly ok: true } }
    | { readonly status: 'applied_persistence_failed'; readonly execution: CommandSuccessResult; readonly save: PersistenceSaveResult & { readonly ok: false } };

export interface LifecycleOfflineDoubleOffer {
    readonly eligibility: RewardedEligibilityResult;
    readonly multiplier: number;
    /** Display only: multiplier x the preview's total reward. The collect grants multiplier x the applied reward. */
    readonly projectedReward: number;
}

export type OfflineDoubleNotGrantedReason =
    | 'not_rewarded'
    | 'not_verified'
    | 'duplicate'
    | 'wrong_placement'
    | 'ineligible'
    | 'bad_request_id';

export interface LifecycleBonusNotGrantedResult {
    readonly status: 'bonus_not_granted';
    readonly reason: OfflineDoubleNotGrantedReason;
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

export type LifecycleBonusCollectResult =
    | LifecycleCollectNoPendingResult
    | LifecycleCollectInvalidResult
    | (LifecycleCollectDurableResult & { readonly bonusGranted: boolean })
    | (LifecycleCollectDurabilityFailureResult & { readonly bonusGranted: boolean })
    | LifecycleBonusNotGrantedResult;

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

/** AUT-069 (DEBUG only): the coordinator's debug entry results (always `source: 'debug'`). */
export interface LifecycleDebugRejectedResult {
    readonly status: 'debug_rejected';
    readonly source: typeof DEBUG_SOURCE;
    readonly reason: string;
    readonly message: string;
}

export interface LifecycleDebugPatchAppliedResult {
    readonly status: 'debug_applied_saved' | 'debug_applied_persistence_failed';
    readonly source: typeof DEBUG_SOURCE;
    readonly patch: DebugStatePatch;
    readonly save: PersistenceSaveResult;
}

export interface LifecycleDebugPendingOfflineCreatedResult {
    readonly status: 'debug_pending_offline_created' | 'debug_pending_offline_persistence_failed';
    readonly source: typeof DEBUG_SOURCE;
    readonly seconds: number;
    readonly save: PersistenceSaveResult;
}

export type LifecycleDebugPatchResult = LifecycleDebugRejectedResult | LifecycleDebugPatchAppliedResult;
export type LifecycleDebugPendingOfflineResult = LifecycleDebugRejectedResult | LifecycleDebugPendingOfflineCreatedResult;

export class LifecycleSessionCoordinator {
    private readonly configRepository: GameConfigRepository;
    private readonly persistence: PersistenceCoordinator;
    private readonly timeService: TimeService;
    private readonly lifecycleTime: LifecycleTimeTracker;
    private readonly offlineConfig: Partial<OfflineProgressConfig> | undefined;
    private readonly rewardClaimLedger: { tryConsume(requestId: string): boolean };
    private runtime: GameRuntime;
    private pendingOfflinePreview: OfflinePreviewResult | null;
    /** AUT-060: true while a Founder grant exists in memory whose critical save failed (a replay retries the save before reporting success). */
    private founderEntitlementUnsaved = false;
    private openAbsenceBoundaryUtcIso: UtcTimestampIsoString | null = null;
    private lastClosedAbsenceUtcIso: UtcTimestampIsoString | null = null;
    /**
     * AUT-051 (D1): the absence-start cursor (the `savedAtUtc` the pending preview was measured from). While a preview is pending,
     * every non-collect save keeps this value instead of stamping "now", so the uncollected reward survives a kill / relaunch.
     */
    private pendingAbsenceStartUtcIso: UtcTimestampIsoString | null;

    private constructor(
        options: LifecycleSessionCoordinatorOptions,
        state: GameState,
        pendingOfflinePreview: OfflinePreviewResult | null,
        pendingAbsenceStartUtcIso: UtcTimestampIsoString | null = null,
    ) {
        this.configRepository = options.configRepository;
        this.persistence = options.persistence;
        this.timeService = options.timeService;
        this.lifecycleTime = new LifecycleTimeTracker(options.timeService);
        this.offlineConfig = options.offlineConfig;
        this.rewardClaimLedger = options.rewardClaimLedger ?? createLocalRequestLedger();
        this.runtime = this.createRuntime(state);
        this.pendingOfflinePreview = pendingOfflinePreview;
        this.pendingAbsenceStartUtcIso = pendingOfflinePreview === null ? null : pendingAbsenceStartUtcIso;
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
        const pendingOfflinePreview = toPendingOfflinePreview(offlinePreview);
        const session = new LifecycleSessionCoordinator(
            options,
            load.state,
            pendingOfflinePreview,
            pendingOfflinePreview === null ? null : load.envelope.savedAtUtc,
        );

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
        if (command.type === 'grantFounderPack' || command.type === 'reconcileFounderEntitlement') {
            // AUT-058: a generic submit can never grant or restore the Founder pack; only the dedicated store-delivery paths do.
            return Object.freeze({
                execution: Object.freeze({
                    ok: false as const,
                    reason: 'malformed_command' as const,
                    message: 'The Founder pack can only be applied from a store purchase delivery or entitlement report.',
                    events: Object.freeze([]) as readonly DomainEvent[],
                }),
                save: null,
            });
        }

        if (command.type === 'activateExtendedOverclock') {
            // AUT-056: a generic submit can never grant the rewarded boost; only a verified proof does.
            return Object.freeze({
                execution: Object.freeze({
                    ok: false as const,
                    reason: 'malformed_command' as const,
                    message: 'Extended Overclock requires a verified rewarded-ad proof.',
                    events: Object.freeze([]) as readonly DomainEvent[],
                }),
                save: null,
            });
        }

        const execution = this.runtime.execute(command);
        let save: PersistenceSaveResult | null = null;
        if (execution.ok) {
            this.persistence.markDirty();
            if (options.requestOrdinarySave === true) {
                save = await this.requestSave({
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
                save = await this.requestSave({
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
        const save = await this.requestSave({
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
        const save = await this.requestSave({
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
        const save = await this.requestSave({
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
        // AUT-INT-001: background time belongs to the offline preview, never to the active clock.
        this.replaceRuntimeState(this.runtime.getStateSnapshot());
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

        const absenceStartUtcIso = this.openAbsenceBoundaryUtcIso;
        const offlinePreview = createOfflineProgressPreviewFromUtc(this.configRepository, this.runtime.getStateSnapshot(), {
            persistedAtUtcIso: absenceStartUtcIso,
            currentUtcIso: boundary.resumedAtUtc.iso,
            config: this.offlineConfig,
        });
        this.openAbsenceBoundaryUtcIso = null;
        this.pendingOfflinePreview = toPendingOfflinePreview(offlinePreview);
        this.pendingAbsenceStartUtcIso = this.pendingOfflinePreview === null ? null : absenceStartUtcIso;

        return Object.freeze({
            status: 'preview_created' as const,
            boundary,
            offlinePreview,
        });
    }

    /** AUT-055: the Offline Double offer for the pending preview, or null without one. Display/eligibility only; no side effects. */
    getOfflineDoubleOffer(): LifecycleOfflineDoubleOffer | null {
        const pending = this.pendingOfflinePreview;
        if (pending === null || pending.status !== 'preview_ready') {
            return null;
        }

        return Object.freeze({
            eligibility: this.evaluateOfflineDoubleEligibility(pending, this.runtime.getStateSnapshot()),
            multiplier: OFFLINE_DOUBLE_MULTIPLIER,
            projectedReward: OFFLINE_DOUBLE_MULTIPLIER * pending.totalIndustrialOutputReward,
        });
    }

    /**
     * AUT-055: collects the pending offline reward with the rewarded x2 bonus, exactly once and atomically
     * (reward + claim record + one critical save). A bad proof / ineligible / replayed request never collects
     * and never changes state: the free collect stays available.
     */
    async collectPendingOfflineWithRewardedBonus(proof: OfflineDoubleAdProof): Promise<LifecycleBonusCollectResult> {
        const pending = this.pendingOfflinePreview;
        if (pending === null) {
            return Object.freeze({ status: 'no_pending_preview' as const });
        }

        const proofReason = readProofFailure(proof, OFFLINE_DOUBLE_CLAIM_KEY);
        if (proofReason !== null) {
            return notGranted(proofReason);
        }

        const snapshot = this.runtime.getStateSnapshot();
        if (!this.evaluateOfflineDoubleEligibility(pending, snapshot).eligible) {
            return notGranted('ineligible');
        }

        if (!this.rewardClaimLedger.tryConsume(proof.requestId)) {
            return notGranted('duplicate');
        }

        const collect = collectOfflineProgress(
            this.configRepository,
            snapshot,
            { preview: pending },
            { rewardMultiplier: OFFLINE_DOUBLE_MULTIPLIER },
        );
        if (collect.status === 'invalid_time' || collect.status === 'invalid_config' || collect.status === 'failure') {
            return Object.freeze({
                status: 'collect_failed' as const,
                collect,
            });
        }

        try {
            const nowUtcMs = this.timeService.nowUtc().unixMilliseconds;
            collect.state.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY] = recordRewardedClaim(
                collect.state,
                OFFLINE_DOUBLE_CLAIM_KEY,
                nowUtcMs,
            );
            assertValidGameState(collect.state);
        }
        catch {
            // Fail closed: the claim cannot be recorded, so grant only the normal reward.
            const fallback = await this.collectPendingOffline();
            return fallback.status === 'collected_saved'
                || fallback.status === 'no_reward_saved'
                || fallback.status === 'collected_persistence_failed'
                || fallback.status === 'no_reward_persistence_failed'
                ? Object.freeze({ ...fallback, bonusGranted: false })
                : fallback;
        }

        const result = await this.commitCollect(collect);
        return Object.freeze({ ...result, bonusGranted: true });
    }

    private evaluateOfflineDoubleEligibility(pending: OfflinePreviewResult, state: GameState): RewardedEligibilityResult {
        let nowUtcMs = Number.NaN;
        try {
            nowUtcMs = this.timeService.nowUtc().unixMilliseconds;
        }
        catch {
            nowUtcMs = Number.NaN;
        }

        return evaluateOfflineDoubleEligibility({
            nowUtcMs,
            hasCollectibleReport: true,
            effectiveOfflineSeconds: pending.effectiveOfflineSeconds,
            claimTimestampsUtcMs: getRewardedClaimHistory(state, OFFLINE_DOUBLE_CLAIM_KEY),
        });
    }

    /** AUT-056: the Extended Overclock offer. Display/eligibility only; no side effects. */
    getExtendedOverclockOffer(): LifecycleExtendedOverclockOffer {
        const state = this.runtime.getStateSnapshot();
        const blockedReason = this.readExtendedOverclockBlockedReason(state);
        return Object.freeze({
            eligibility: this.evaluateExtendedOverclockEligibility(state),
            activeBlocked: blockedReason !== null,
            blockedReason,
        });
    }

    /**
     * AUT-056: starts the rewarded Extended Overclock from a verified proof, exactly once and atomically (boost + claim in one runtime
     * command, then one critical save). Any bad proof / race / replay / rejection leaves state, claim and save untouched.
     */
    async activateExtendedOverclockWithRewardedProof(proof: RewardedAdProof): Promise<LifecycleExtendedOverclockResult> {
        if (this.pendingOfflinePreview !== null) {
            return extendedNotGranted('offline_pending');
        }

        const proofReason = readProofFailure(proof, EXTENDED_OVERCLOCK_CLAIM_KEY);
        if (proofReason !== null) {
            return extendedNotGranted(proofReason);
        }

        const snapshot = this.runtime.getStateSnapshot();
        const blockedReason = this.readExtendedOverclockBlockedReason(snapshot);
        if (blockedReason === 'locked') {
            return extendedNotGranted('locked');
        }
        if (blockedReason === 'active') {
            return extendedNotGranted('already_active');
        }
        if (!this.evaluateExtendedOverclockEligibility(snapshot).eligible) {
            return extendedNotGranted('ineligible');
        }

        if (!this.rewardClaimLedger.tryConsume(proof.requestId)) {
            return extendedNotGranted('duplicate');
        }

        const claimedAtUtcMs = this.readNowUtcMs();
        const execution = this.runtime.execute({
            type: 'activateExtendedOverclock',
            requestId: proof.requestId,
            claimedAtUtcMs,
        });
        if (!execution.ok) {
            return Object.freeze({ status: 'not_granted' as const, reason: 'rejected' as const, execution });
        }

        this.persistence.markDirty();
        const save = await this.requestSave({
            intent: 'critical',
            reason: 'extended_overclock_activation',
        });

        if (!save.ok) {
            return Object.freeze({ status: 'activated_persistence_failed' as const, execution, save });
        }

        return Object.freeze({ status: 'activated_saved' as const, execution, save });
    }

    /**
     * AUT-058: applies a completed Founder pack purchase delivery (store/mock) exactly once, then one critical save. Replays are safe
     * (no extra Surges). The store layer must call this and see `applied_saved` / `already_applied` BEFORE acknowledging the purchase.
     */
    async applyFounderPackPurchase(request: { readonly requestId: string; readonly source: 'store' | 'mock' }): Promise<LifecycleFounderResult> {
        return this.executeFounderCommand({
            type: 'grantFounderPack',
            requestId: request.requestId,
            source: request.source,
            grantedAtUtcMs: this.readNowUtcMs(),
        });
    }

    /** AUT-058: applies a store entitlement report (restore/reconcile). Never grants Surges; not-owned/unknown reports change nothing. */
    async reconcileFounderEntitlement(report: { readonly owned: boolean | null; readonly source: 'store' | 'mock' }): Promise<LifecycleFounderResult> {
        return this.executeFounderCommand({
            type: 'reconcileFounderEntitlement',
            owned: report.owned,
            source: report.source,
            reportedAtUtcMs: this.readNowUtcMs(),
        });
    }

    /**
     * AUT-069 DEBUG-only state patch (see `runtime/DebugStatePatch.ts`). Requires an enabled `DebugGate`; otherwise nothing changes and no save is
     * requested. An applied patch commits in memory, then one critical save (reason `manual`), so a relaunch reproduces the patched state exactly.
     * It is not a GameCommand and emits no domain event (no observer sees it); the result carries `source: 'debug'`.
     */
    async applyDebugStatePatch(patch: unknown, gate: DebugGate): Promise<LifecycleDebugPatchResult> {
        const result = this.runtime.applyDebugStatePatch(patch, gate);
        if (!result.ok) {
            return Object.freeze({ status: 'debug_rejected' as const, source: DEBUG_SOURCE, reason: result.reason, message: result.message });
        }

        this.persistence.markDirty();
        const save = await this.requestSave({ intent: 'critical', reason: 'manual' });
        return Object.freeze({
            status: save.ok ? 'debug_applied_saved' as const : 'debug_applied_persistence_failed' as const,
            source: DEBUG_SOURCE,
            patch: result.patch,
            save,
        });
    }

    /**
     * AUT-069 DEBUG-only: simulates an absence of `seconds` by creating the pending offline preview as if the save had been written `seconds`
     * ago, through the SAME mechanism as a real absence (the pending absence-start cursor that every non-collect save keeps as `savedAtUtc`, so
     * a kill / relaunch still shows the same report). Requires an enabled `DebugGate`; rejected while a preview is already pending or when the
     * state would produce no collectible preview (nothing automated / offline-eligible, or under the card minimum).
     */
    async createDebugPendingOffline(seconds: unknown, gate: DebugGate): Promise<LifecycleDebugPendingOfflineResult> {
        const rejected = (reason: string, message: string) => Object.freeze({ status: 'debug_rejected' as const, source: DEBUG_SOURCE, reason, message });
        if (!isDebugGateEnabled(gate)) return rejected('debug_disabled', 'Debug entries are only available in DEBUG builds with diagnostics enabled.');
        if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < DEBUG_LIMITS.minOfflineSeconds || seconds > DEBUG_LIMITS.maxOfflineSeconds) {
            return rejected('malformed_seconds', 'seconds must be an integer within the debug absence bounds.');
        }
        if (this.pendingOfflinePreview !== null) return rejected('pending_preview_exists', 'An offline report is already pending.');

        const nowMs = this.readNowUtcMs();
        if (!Number.isFinite(nowMs)) return rejected('time_unavailable', 'The clock is unavailable.');
        const absenceStartUtcIso = createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - seconds * 1000);
        const preview = toPendingOfflinePreview(createOfflineProgressPreviewFromUtc(this.configRepository, this.runtime.getStateSnapshot(), {
            persistedAtUtcIso: absenceStartUtcIso,
            currentUtcIso: this.timeService.nowUtcIso(),
            config: this.offlineConfig,
        }));
        if (preview === null) return rejected('no_collectible_preview', 'The current state yields no collectible offline report for this absence.');

        this.pendingOfflinePreview = preview;
        this.pendingAbsenceStartUtcIso = absenceStartUtcIso;
        this.persistence.markDirty();
        const save = await this.requestSave({ intent: 'critical', reason: 'manual' });
        return Object.freeze({
            status: save.ok ? 'debug_pending_offline_created' as const : 'debug_pending_offline_persistence_failed' as const,
            source: DEBUG_SOURCE,
            seconds,
            save,
        });
    }

    getFounderSurgeChargesRemaining(): number {
        return getFounderSurgeChargesRemaining(this.runtime.getStateSnapshot());
    }

    private async executeFounderCommand(command: GameCommand): Promise<LifecycleFounderResult> {
        const execution = this.runtime.execute(command);
        if (!execution.ok) {
            return Object.freeze({ status: 'rejected' as const, execution });
        }

        const changed = execution.events.some((event) => event.type === 'founderPackApplied' && event.changed);
        if (!changed) {
            if (this.founderEntitlementUnsaved) {
                // AUT-060: an earlier delivery applied in memory but its save failed. A replay must not report durable ownership (and so must not
                // let the store acknowledge the purchase) until a critical save succeeds.
                this.persistence.markDirty();
                const retry = await this.requestSave({ intent: 'critical', reason: 'founder_entitlement' });
                this.founderEntitlementUnsaved = !retry.ok;
                return retry.ok
                    ? Object.freeze({ status: 'applied_saved' as const, execution, save: retry })
                    : Object.freeze({ status: 'applied_persistence_failed' as const, execution, save: retry });
            }
            return Object.freeze({ status: 'already_applied' as const, execution, save: null });
        }

        this.persistence.markDirty();
        const save = await this.requestSave({ intent: 'critical', reason: 'founder_entitlement' });
        this.founderEntitlementUnsaved = !save.ok;
        return save.ok
            ? Object.freeze({ status: 'applied_saved' as const, execution, save })
            : Object.freeze({ status: 'applied_persistence_failed' as const, execution, save });
    }

    private readExtendedOverclockBlockedReason(state: GameState): 'active' | 'locked' | 'offline_pending' | null {
        if (this.pendingOfflinePreview !== null) {
            return 'offline_pending';
        }
        if (!isFreeOverclockUnlocked(state)) {
            return 'locked';
        }
        if (state.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID] !== undefined) {
            return 'active';
        }
        return null;
    }

    private evaluateExtendedOverclockEligibility(state: GameState): RewardedEligibilityResult {
        return evaluateExtendedOverclockEligibility({
            nowUtcMs: this.readNowUtcMs(),
            claimTimestampsUtcMs: getRewardedClaimHistory(state, EXTENDED_OVERCLOCK_CLAIM_KEY),
        });
    }

    private readNowUtcMs(): number {
        try {
            return this.timeService.nowUtc().unixMilliseconds;
        }
        catch {
            return Number.NaN;
        }
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

        return this.commitCollect(collect);
    }

    private async commitCollect(
        collect: OfflineCollectSuccessResult | OfflineCollectNoRewardResult,
    ): Promise<LifecycleCollectDurableResult | LifecycleCollectDurabilityFailureResult> {
        this.replaceRuntimeState(collect.state);
        this.pendingOfflinePreview = null;
        this.pendingAbsenceStartUtcIso = null;
        this.lastClosedAbsenceUtcIso = collect.criticalSaveRequest.collectedThroughUtcIso;

        const save = await this.requestSave({
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

    /**
     * AUT-051 (D1): every save goes through here. While an offline preview is pending, anything except the collect save keeps the
     * absence-start cursor as `savedAtUtc`; the collect save (and saves with no pending preview) behave exactly as before.
     */
    private requestSave(request: PersistenceSaveRequest): Promise<PersistenceSaveResult> {
        const preserve = this.pendingOfflinePreview !== null
            && this.pendingAbsenceStartUtcIso !== null
            && request.reason !== 'offline_collect';
        return this.persistence.requestSave(
            this.runtime.getStateSnapshot(),
            preserve ? { ...request, savedAtUtcIso: this.pendingAbsenceStartUtcIso! } : request,
        );
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

function createLocalRequestLedger(): { tryConsume(requestId: string): boolean } {
    const consumed = new Set<string>();
    return {
        tryConsume(requestId: string): boolean {
            if (consumed.has(requestId)) {
                return false;
            }
            consumed.add(requestId);
            return true;
        },
    };
}

function notGranted(reason: OfflineDoubleNotGrantedReason): LifecycleBonusNotGrantedResult {
    return Object.freeze({ status: 'bonus_not_granted' as const, reason });
}

function extendedNotGranted(reason: ExtendedOverclockNotGrantedReason): LifecycleExtendedOverclockNotGrantedResult {
    return Object.freeze({ status: 'not_granted' as const, reason });
}

function readProofFailure(proof: RewardedAdProof | null | undefined, expectedPlacementKey: string): OfflineDoubleNotGrantedReason | null {
    if (proof === null || proof === undefined || proof.status !== 'rewarded') {
        return 'not_rewarded';
    }
    if (proof.rewardVerified !== true) {
        return 'not_verified';
    }
    if (proof.duplicate === true) {
        return 'duplicate';
    }
    if (proof.placementId !== expectedPlacementKey) {
        return 'wrong_placement';
    }
    if (typeof proof.requestId !== 'string' || proof.requestId.trim().length === 0) {
        return 'bad_request_id';
    }
    return null;
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
