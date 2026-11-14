import type {
    PlatformAvailability,
    PlatformOperationResult,
    PlatformServiceState,
    RewardedPlacementId,
} from './PlatformServiceTypes';

/** 'closed' means dismissed without reward. 'timeout' means no outcome within the provider deadline. */
export type RewardedAdResultStatus =
    | 'rewarded'
    | 'closed'
    | 'failed'
    | 'unavailable'
    | 'timeout';

export interface RewardedAdRequest {
    placementId: RewardedPlacementId;
    requestId: string;
}

export interface RewardedAdResult {
    status: RewardedAdResultStatus;
    placementId: RewardedPlacementId;
    requestId: string;
    rewardVerified: boolean;
    reason?: string;
    message?: string;
    /** True when this is a replay of an already-delivered result for the same requestId. */
    duplicate?: boolean;
}

export interface AdsService {
    initialize(): Promise<PlatformServiceState>;
    getStatus(): PlatformServiceState;
    getRewardedAvailability(placementId: RewardedPlacementId): Promise<PlatformAvailability>;
    preloadRewarded(placementId: RewardedPlacementId): Promise<PlatformOperationResult>;
    showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult>;
}

