export type PlatformServiceKind = 'ads' | 'purchase' | 'entitlement';

export type PlatformServiceStatus =
    | 'uninitialized'
    | 'initializing'
    | 'ready'
    | 'unavailable'
    | 'failed';

export interface PlatformServiceState {
    kind: PlatformServiceKind;
    status: PlatformServiceStatus;
    reason?: string;
    message?: string;
}

export interface PlatformOperationResult {
    ok: boolean;
    status: PlatformServiceStatus;
    reason?: string;
    message?: string;
}

export interface PlatformAvailability {
    available: boolean;
    status: PlatformServiceStatus;
    reason?: string;
    message?: string;
}

export const REWARDED_PLACEMENTS = {
    offlineDouble: 'rewarded.offline_double',
    extendedOverclock: 'rewarded.extended_overclock',
} as const;

export type RewardedPlacementId =
    (typeof REWARDED_PLACEMENTS)[keyof typeof REWARDED_PLACEMENTS] | string;

export const ENTITLEMENTS = {
    founderPack: 'entitlement.founder_pack',
} as const;

export type EntitlementId = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS] | string;

export const PRODUCTS = {
    founderPack: 'founder_pack',
} as const;

export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS] | string;

