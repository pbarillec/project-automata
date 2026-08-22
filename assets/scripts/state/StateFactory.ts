import type {
    BoostState,
    GameState,
    LifetimeState,
    MetaState,
    MonetizationState,
    RunState,
    SettingsState,
} from './GameState.ts';

export const INITIAL_CIVILIZATION_NUMBER = 1;
export const INITIAL_RUN_ERA_ID = 'manual_workshop';

export function createFreshGameState(): GameState {
    return {
        run: createFreshRunState(),
        meta: createFreshMetaState(),
        boosts: createFreshBoostState(),
        monetization: createFreshMonetizationState(),
        settings: createFreshSettingsState(),
        lifetime: createFreshLifetimeState(),
    };
}

export function createFreshRunState(): RunState {
    return {
        industrialOutput: 0,
        producers: {},
        automation: {},
        purchasedBreakthroughIds: [],
        currentEraId: INITIAL_RUN_ERA_ID,
        robotsBuilt: 0,
        statistics: {
            industrialOutputEarned: 0,
            industrialOutputSpent: 0,
            manualProductionActions: 0,
            producerLevelsPurchased: 0,
            breakthroughsPurchased: 0,
            robotsBuiltPeak: 0,
        },
        prestigePowerPeak: 0,
        progressionFlags: {},
    };
}

export function createFreshMetaState(): MetaState {
    return {
        civilizationNumber: INITIAL_CIVILIZATION_NUMBER,
        aiCores: 0,
        lifetimeAiCoresEarned: 0,
        permanentUpgradeRanks: {},
        accountFeatureUnlocks: {},
        durableEntitlements: {},
        cosmeticOwnership: {},
    };
}

export function createFreshBoostState(): BoostState {
    return {
        activeBoosts: {},
        cooldowns: {},
        consumedCharges: {},
    };
}

export function createFreshMonetizationState(): MonetizationState {
    return {
        rewardedClaims: {},
        pendingAdRequests: {},
        pendingPurchaseRequests: {},
        productMetadataCache: {},
    };
}

export function createFreshSettingsState(): SettingsState {
    return {
        musicVolume: 0,
        sfxVolume: 0,
        vibrationEnabled: false,
        languageCode: null,
        reducedMotion: false,
    };
}

export function createFreshLifetimeState(): LifetimeState {
    return {
        industrialOutputEarned: 0,
        manualProductionActions: 0,
        producerLevelsPurchased: 0,
        breakthroughsPurchased: 0,
        robotsBuilt: 0,
        rebootsCompleted: 0,
        highestCivilizationReached: INITIAL_CIVILIZATION_NUMBER,
    };
}
