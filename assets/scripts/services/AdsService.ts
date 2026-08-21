import type {
    PlatformAvailability,
    PlatformOperationResult,
    PlatformServiceState,
    RewardedPlacementId,
} from './PlatformServiceTypes';

export type RewardedAdResultStatus =
    | 'rewarded'
    | 'closed'
    | 'failed'
    | 'unavailable';

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
}

export interface AdsService {
    initialize(): Promise<PlatformServiceState>;
    getStatus(): PlatformServiceState;
    getRewardedAvailability(placementId: RewardedPlacementId): Promise<PlatformAvailability>;
    preloadRewarded(placementId: RewardedPlacementId): Promise<PlatformOperationResult>;
    showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult>;
}

