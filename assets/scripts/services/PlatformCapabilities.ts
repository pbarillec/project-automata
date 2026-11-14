export type PlatformId = 'editor' | 'android' | 'ios' | 'noop';

export interface PlatformCapabilities {
    platform: PlatformId;
    rewardedAds: boolean;
    billing: boolean;
    restorePurchases: boolean;
    analytics: boolean;
    fullscreenOverlays: boolean;
}

export const NO_PLATFORM_CAPABILITIES: PlatformCapabilities = Object.freeze({
    platform: 'noop',
    rewardedAds: false,
    billing: false,
    restorePurchases: false,
    analytics: false,
    fullscreenOverlays: false,
});
