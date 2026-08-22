export type StateRecord<T> = Record<string, T>;

export interface GameState {
    run: RunState;
    meta: MetaState;
    boosts: BoostState;
    monetization: MonetizationState;
    settings: SettingsState;
    lifetime: LifetimeState;
}

export interface RunState {
    industrialOutput: number;
    producers: StateRecord<ProducerRunState>;
    automation: StateRecord<AutomationRunState>;
    purchasedBreakthroughIds: string[];
    currentEraId: string | null;
    robotsBuilt: number;
    statistics: RunStatisticsState;
    prestigePowerPeak: number;
    progressionFlags: StateRecord<boolean>;
}

export interface ProducerRunState {
    level: number;
    isUnlocked: boolean;
    isBuilt: boolean;
}

export interface AutomationRunState {
    isAutomated: boolean;
    isOfflineEligible: boolean;
    unlockedByBreakthroughId: string | null;
}

export interface RunStatisticsState {
    industrialOutputEarned: number;
    industrialOutputSpent: number;
    manualProductionActions: number;
    producerLevelsPurchased: number;
    breakthroughsPurchased: number;
    robotsBuiltPeak: number;
}

export interface MetaState {
    civilizationNumber: number;
    aiCores: number;
    lifetimeAiCoresEarned: number;
    permanentUpgradeRanks: StateRecord<number>;
    accountFeatureUnlocks: StateRecord<boolean>;
    durableEntitlements: StateRecord<DurableEntitlementState>;
    cosmeticOwnership: StateRecord<boolean>;
}

export interface DurableEntitlementState {
    owned: boolean;
    source: string;
    lastKnownValidUtcMs: number | null;
}

export interface BoostState {
    activeBoosts: StateRecord<ActiveBoostState>;
    cooldowns: StateRecord<BoostCooldownState>;
    consumedCharges: StateRecord<number>;
}

export interface ActiveBoostState {
    boostId: string;
    remainingSeconds: number;
    cooldownSeconds: number;
    source: string;
    requestId: string | null;
    effect: TemporaryBoostEffectState;
    isSuspended: boolean;
    suspendedByBoostId: string | null;
}

export interface BoostCooldownState {
    remainingSeconds: number;
}

export interface TemporaryProductionMultiplierEffectState {
    type: 'productionMultiplier';
    multiplier: number;
}

export type TemporaryBoostEffectState = TemporaryProductionMultiplierEffectState;

export interface MonetizationState {
    rewardedClaims: StateRecord<RewardedClaimState>;
    pendingAdRequests: StateRecord<PendingMonetizationRequestState>;
    pendingPurchaseRequests: StateRecord<PendingMonetizationRequestState>;
    productMetadataCache: StateRecord<ProductMetadataCacheState>;
}

export interface RewardedClaimState {
    placementId: string;
    claimCount: number;
    lastClaimUtcMs: number | null;
}

export interface PendingMonetizationRequestState {
    requestId: string;
    createdUtcMs: number;
}

export interface ProductMetadataCacheState {
    productId: string;
    localizedPrice: string;
    updatedUtcMs: number;
}

export interface SettingsState {
    musicVolume: number;
    sfxVolume: number;
    vibrationEnabled: boolean;
    languageCode: string | null;
    reducedMotion: boolean;
}

export interface LifetimeState {
    industrialOutputEarned: number;
    manualProductionActions: number;
    producerLevelsPurchased: number;
    breakthroughsPurchased: number;
    robotsBuilt: number;
    rebootsCompleted: number;
    highestCivilizationReached: number;
}

