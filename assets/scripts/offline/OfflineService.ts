import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import {
    calculateElapsedProduction,
    calculateRobotsBuiltFromRobotLineElapsedSeconds,
    resolveCrossedRobotsBuiltThresholds,
} from '../economy/index.ts';
import {
    calculateOfflineEligibleDurableProducerProductionRateContributions,
    resolveEffectiveProducerAutomationState,
} from '../progression/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState, clonePlainData } from '../state/StateClone.ts';
import { assertValidGameState } from '../state/StateValidation.ts';
import {
    calculateUtcElapsedSeconds,
    type TimeService,
    type UtcElapsedStatus,
    type UtcTimestampIsoString,
} from '../time/index.ts';

export const OFFLINE_EFFICIENCY = 0.75;
export const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const ROBOT_LINE_PRODUCER_ID = 'robot_line';

export interface OfflineProgressConfig {
    readonly efficiency: number;
    readonly capSeconds: number;
}

export const DEFAULT_OFFLINE_PROGRESS_CONFIG: OfflineProgressConfig = Object.freeze({
    efficiency: OFFLINE_EFFICIENCY,
    capSeconds: OFFLINE_CAP_SECONDS,
});

export type OfflinePreviewStatus = 'preview_ready' | 'no_reward' | 'invalid_time' | 'invalid_config';
export type OfflineCollectStatus = 'success' | 'no_reward' | 'invalid_time' | 'invalid_config' | 'failure';
export type OfflineProducerContributionReason =
    | 'eligible'
    | 'not_built'
    | 'not_automated'
    | 'not_offline_eligible';

export interface OfflineProgressClockInput {
    readonly persistedAtUtcIso: UtcTimestampIsoString | null | undefined;
    readonly timeService: TimeService;
    readonly config?: Partial<OfflineProgressConfig>;
}

export interface OfflineProgressUtcInput {
    readonly persistedAtUtcIso: UtcTimestampIsoString | null | undefined;
    readonly currentUtcIso: UtcTimestampIsoString | null | undefined;
    readonly config?: Partial<OfflineProgressConfig>;
}

export interface OfflineProducerContribution {
    readonly producerId: string;
    readonly isEligible: boolean;
    readonly reason: OfflineProducerContributionReason;
    readonly productionPerSecond: number;
    readonly industrialOutputReward: number;
}

export interface OfflinePreviewBase {
    readonly status: OfflinePreviewStatus;
    readonly persistedAtUtcIso: UtcTimestampIsoString | null;
    readonly currentUtcIso: UtcTimestampIsoString | null;
    readonly utcElapsedStatus: UtcElapsedStatus;
    readonly rawAbsenceSeconds: number | null;
    readonly effectiveOfflineSeconds: number;
    readonly capSeconds: number;
    readonly efficiency: number;
    readonly capApplied: boolean;
    readonly producerContributions: readonly OfflineProducerContribution[];
    readonly totalEligibleProductionPerSecond: number;
    readonly totalIndustrialOutputReward: number;
    readonly robotsBuiltDelta: number;
}

export interface OfflinePreviewReadyResult extends OfflinePreviewBase {
    readonly status: 'preview_ready';
}

export interface OfflineNoRewardPreviewResult extends OfflinePreviewBase {
    readonly status: 'no_reward';
}

export interface OfflineInvalidPreviewResult extends OfflinePreviewBase {
    readonly status: 'invalid_time' | 'invalid_config';
    readonly reason: string;
}

export type OfflinePreviewResult =
    | OfflinePreviewReadyResult
    | OfflineNoRewardPreviewResult
    | OfflineInvalidPreviewResult;

export interface OfflineCriticalSaveRequest {
    readonly reason: 'offline_collect';
    readonly collectedThroughUtcIso: UtcTimestampIsoString;
    readonly industrialOutputReward: number;
    readonly robotsBuiltDelta: number;
}

export interface OfflineCollectSuccessResult {
    readonly status: 'success';
    readonly preview: OfflinePreviewReadyResult;
    readonly state: GameState;
    readonly criticalSaveRequest: OfflineCriticalSaveRequest;
}

export interface OfflineCollectNoRewardResult {
    readonly status: 'no_reward';
    readonly preview: OfflineNoRewardPreviewResult;
    readonly state: GameState;
    readonly criticalSaveRequest: OfflineCriticalSaveRequest;
}

export interface OfflineCollectInvalidResult {
    readonly status: 'invalid_time' | 'invalid_config';
    readonly preview: OfflineInvalidPreviewResult;
    readonly reason: string;
}

export interface OfflineCollectFailureResult {
    readonly status: 'failure';
    readonly preview: OfflinePreviewReadyResult | OfflineNoRewardPreviewResult;
    readonly reason: string;
}

export type OfflineCollectResult =
    | OfflineCollectSuccessResult
    | OfflineCollectNoRewardResult
    | OfflineCollectInvalidResult
    | OfflineCollectFailureResult;

export function createOfflineProgressPreview(
    repository: GameConfigRepository,
    state: GameState,
    input: OfflineProgressClockInput,
): OfflinePreviewResult {
    return createOfflineProgressPreviewFromUtc(repository, state, {
        persistedAtUtcIso: input.persistedAtUtcIso,
        currentUtcIso: input.timeService.nowUtcIso(),
        config: input.config,
    });
}

export function createOfflineProgressPreviewFromUtc(
    repository: GameConfigRepository,
    state: GameState,
    input: OfflineProgressUtcInput,
): OfflinePreviewResult {
    const config = readOfflineConfig(input.config);
    if (config.status === 'invalid_config') {
        return invalidPreview(input.persistedAtUtcIso, input.currentUtcIso, 'invalid_config', config.reason);
    }

    const elapsed = calculateUtcElapsedSeconds(input.persistedAtUtcIso, input.currentUtcIso);
    const rawAbsenceSeconds = elapsed.rawElapsedSeconds;
    const currentUtcIso = elapsed.endUtcIso;
    const persistedAtUtcIso = elapsed.startUtcIso;

    if (elapsed.status === 'missing_start' || elapsed.status === 'missing_end' ||
        elapsed.status === 'invalid_start' || elapsed.status === 'invalid_end') {
        return invalidPreviewWithBase({
            status: 'invalid_time',
            reason: `Offline UTC interval is ${elapsed.status}.`,
            persistedAtUtcIso,
            currentUtcIso,
            utcElapsedStatus: elapsed.status,
            rawAbsenceSeconds,
            config: config.value,
        });
    }

    const effectiveOfflineSeconds = elapsed.status === 'valid'
        ? Math.min(elapsed.elapsedSeconds, config.value.capSeconds)
        : 0;
    const producerContributions = createProducerContributions(repository, state, effectiveOfflineSeconds, config.value.efficiency);
    const totalEligibleProductionPerSecond = producerContributions.reduce((total, contribution) => addFinite(
        total,
        contribution.productionPerSecond,
        'offline eligible productionPerSecond',
    ), 0);
    const totalIndustrialOutputReward = producerContributions.reduce((total, contribution) => addFinite(
        total,
        contribution.industrialOutputReward,
        'offline Industrial Output reward',
    ), 0);
    const robotsBuiltDelta = calculateOfflineRobotsBuiltDelta(repository, state, effectiveOfflineSeconds, config.value.efficiency);
    const capApplied = elapsed.status === 'valid' && rawAbsenceSeconds !== null && rawAbsenceSeconds > config.value.capSeconds;
    const base = freezePlainObject({
        persistedAtUtcIso,
        currentUtcIso,
        utcElapsedStatus: elapsed.status,
        rawAbsenceSeconds,
        effectiveOfflineSeconds,
        capSeconds: config.value.capSeconds,
        efficiency: config.value.efficiency,
        capApplied,
        producerContributions,
        totalEligibleProductionPerSecond,
        totalIndustrialOutputReward,
        robotsBuiltDelta,
    });

    if (totalIndustrialOutputReward <= 0 && robotsBuiltDelta <= 0) {
        return {
            status: 'no_reward',
            ...base,
        };
    }

    return {
        status: 'preview_ready',
        ...base,
    };
}

export function collectOfflineProgress(
    repository: GameConfigRepository,
    state: GameState,
    input: OfflineProgressClockInput | OfflineProgressUtcInput | { readonly preview: OfflinePreviewResult },
): OfflineCollectResult {
    const preview = 'preview' in input
        ? input.preview
        : 'timeService' in input
            ? createOfflineProgressPreview(repository, state, input)
            : createOfflineProgressPreviewFromUtc(repository, state, input);

    if (preview.status === 'invalid_time' || preview.status === 'invalid_config') {
        return {
            status: preview.status,
            preview,
            reason: preview.reason,
        };
    }

    if (preview.currentUtcIso === null) {
        return {
            status: 'failure',
            preview,
            reason: 'Offline collection requires a valid current UTC timestamp.',
        };
    }

    const draft = cloneGameState(state);
    try {
        applyOfflineReward(draft, preview);
        assertValidGameState(draft);
    }
    catch (error) {
        return {
            status: 'failure',
            preview,
            reason: error instanceof Error ? error.message : 'Offline collection failed.',
        };
    }

    const criticalSaveRequest = Object.freeze({
        reason: 'offline_collect' as const,
        collectedThroughUtcIso: preview.currentUtcIso,
        industrialOutputReward: preview.totalIndustrialOutputReward,
        robotsBuiltDelta: preview.robotsBuiltDelta,
    });

    if (preview.status === 'no_reward') {
        return {
            status: 'no_reward',
            preview,
            state: draft,
            criticalSaveRequest,
        };
    }

    return {
        status: 'success',
        preview,
        state: draft,
        criticalSaveRequest,
    };
}

function createProducerContributions(
    repository: GameConfigRepository,
    state: GameState,
    effectiveOfflineSeconds: number,
    efficiency: number,
): OfflineProducerContribution[] {
    const eligibleRates = new Map(calculateOfflineEligibleDurableProducerProductionRateContributions(repository, state)
        .map((contribution) => [contribution.producerId, contribution.productionPerSecond]));
    const rewardSeconds = effectiveOfflineSeconds * efficiency;

    return repository.listProducers().map((producer) => {
        const reason = resolveOfflineProducerContributionReason(repository, state, producer.id);
        const productionPerSecond = reason === 'eligible'
            ? eligibleRates.get(producer.id) ?? 0
            : 0;
        const industrialOutputReward = productionPerSecond > 0 && rewardSeconds > 0
            ? calculateElapsedProduction(productionPerSecond, rewardSeconds)
            : 0;

        return Object.freeze({
            producerId: producer.id,
            isEligible: reason === 'eligible',
            reason,
            productionPerSecond,
            industrialOutputReward,
        });
    });
}

function resolveOfflineProducerContributionReason(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): OfflineProducerContributionReason {
    const producerState = state.run.producers[producerId];
    if ((producerState?.level ?? 0) <= 0 || producerState?.isBuilt !== true) {
        return 'not_built';
    }

    const automation = resolveEffectiveProducerAutomationState(repository, state, producerId);
    if (!automation.isAutomated) {
        return 'not_automated';
    }

    if (!automation.isOfflineEligible) {
        return 'not_offline_eligible';
    }

    return 'eligible';
}

function calculateOfflineRobotsBuiltDelta(
    repository: GameConfigRepository,
    state: GameState,
    effectiveOfflineSeconds: number,
    efficiency: number,
): number {
    const robotLineState = state.run.producers[ROBOT_LINE_PRODUCER_ID];
    const robotLineLevel = robotLineState?.level ?? 0;
    if (robotLineLevel <= 0 || robotLineState?.isBuilt !== true) {
        return 0;
    }

    const automation = resolveEffectiveProducerAutomationState(repository, state, ROBOT_LINE_PRODUCER_ID);
    if (!automation.isAutomated) {
        return 0;
    }

    return calculateRobotsBuiltFromRobotLineElapsedSeconds(robotLineLevel, effectiveOfflineSeconds * efficiency);
}

function applyOfflineReward(draft: GameState, preview: OfflinePreviewReadyResult | OfflineNoRewardPreviewResult): void {
    if (preview.totalIndustrialOutputReward > 0) {
        draft.run.industrialOutput = addFinite(
            draft.run.industrialOutput,
            preview.totalIndustrialOutputReward,
            'industrialOutput',
        );
        draft.run.statistics.industrialOutputEarned = addFinite(
            draft.run.statistics.industrialOutputEarned,
            preview.totalIndustrialOutputReward,
            'run.statistics.industrialOutputEarned',
        );
        draft.lifetime.industrialOutputEarned = addFinite(
            draft.lifetime.industrialOutputEarned,
            preview.totalIndustrialOutputReward,
            'lifetime.industrialOutputEarned',
        );
    }

    if (preview.robotsBuiltDelta > 0) {
        const previousRobotsBuilt = draft.run.robotsBuilt;
        draft.run.robotsBuilt = addFinite(draft.run.robotsBuilt, preview.robotsBuiltDelta, 'robotsBuilt');
        draft.run.statistics.robotsBuiltPeak = Math.max(draft.run.statistics.robotsBuiltPeak, draft.run.robotsBuilt);
        draft.lifetime.robotsBuilt = addFinite(draft.lifetime.robotsBuilt, preview.robotsBuiltDelta, 'lifetime.robotsBuilt');
        resolveCrossedRobotsBuiltThresholds(previousRobotsBuilt, draft.run.robotsBuilt);
    }
}

function readOfflineConfig(config: Partial<OfflineProgressConfig> | undefined): {
    readonly status: 'valid';
    readonly value: OfflineProgressConfig;
} | {
    readonly status: 'invalid_config';
    readonly reason: string;
} {
    const efficiency = config?.efficiency ?? DEFAULT_OFFLINE_PROGRESS_CONFIG.efficiency;
    const capSeconds = config?.capSeconds ?? DEFAULT_OFFLINE_PROGRESS_CONFIG.capSeconds;

    if (typeof efficiency !== 'number' || !Number.isFinite(efficiency) || efficiency < 0) {
        return {
            status: 'invalid_config',
            reason: 'offline efficiency must be a non-negative finite number.',
        };
    }

    if (typeof capSeconds !== 'number' || !Number.isFinite(capSeconds) || capSeconds < 0) {
        return {
            status: 'invalid_config',
            reason: 'offline capSeconds must be a non-negative finite number.',
        };
    }

    return {
        status: 'valid',
        value: Object.freeze({
            efficiency,
            capSeconds,
        }),
    };
}

function invalidPreview(
    persistedAtUtcIso: UtcTimestampIsoString | null | undefined,
    currentUtcIso: UtcTimestampIsoString | null | undefined,
    status: 'invalid_time' | 'invalid_config',
    reason: string,
): OfflineInvalidPreviewResult {
    return invalidPreviewWithBase({
        status,
        reason,
        persistedAtUtcIso: persistedAtUtcIso === undefined ? null : persistedAtUtcIso,
        currentUtcIso: currentUtcIso === undefined ? null : currentUtcIso,
        utcElapsedStatus: status === 'invalid_time' ? 'invalid_start' : 'valid',
        rawAbsenceSeconds: null,
        config: DEFAULT_OFFLINE_PROGRESS_CONFIG,
    });
}

function invalidPreviewWithBase(input: {
    readonly status: 'invalid_time' | 'invalid_config';
    readonly reason: string;
    readonly persistedAtUtcIso: UtcTimestampIsoString | null;
    readonly currentUtcIso: UtcTimestampIsoString | null;
    readonly utcElapsedStatus: UtcElapsedStatus;
    readonly rawAbsenceSeconds: number | null;
    readonly config: OfflineProgressConfig;
}): OfflineInvalidPreviewResult {
    return {
        status: input.status,
        reason: input.reason,
        persistedAtUtcIso: input.persistedAtUtcIso,
        currentUtcIso: input.currentUtcIso,
        utcElapsedStatus: input.utcElapsedStatus,
        rawAbsenceSeconds: input.rawAbsenceSeconds,
        effectiveOfflineSeconds: 0,
        capSeconds: input.config.capSeconds,
        efficiency: input.config.efficiency,
        capApplied: false,
        producerContributions: [],
        totalEligibleProductionPerSecond: 0,
        totalIndustrialOutputReward: 0,
        robotsBuiltDelta: 0,
    };
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} addition exceeds JavaScript Number range.`);
    }

    return result;
}

function freezePlainObject<T>(value: T): T {
    return Object.freeze(clonePlainData(value));
}
