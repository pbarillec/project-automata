export type {
    ActiveBoostState,
    AutomationRunState,
    BoostCooldownState,
    BoostState,
    DurableEntitlementState,
    GameState,
    LifetimeState,
    MetaState,
    MonetizationState,
    PendingMonetizationRequestState,
    ProducerRunState,
    ProductMetadataCacheState,
    RewardedClaimState,
    RunState,
    RunStatisticsState,
    SettingsState,
    StateRecord,
} from './GameState.ts';

export {
    INITIAL_CIVILIZATION_NUMBER,
    createFreshBoostState,
    createFreshGameState,
    createFreshLifetimeState,
    createFreshMetaState,
    createFreshMonetizationState,
    createFreshRunState,
    createFreshSettingsState,
} from './StateFactory.ts';

export {
    cloneGameState,
    clonePlainData,
} from './StateClone.ts';

export {
    StateValidationError,
    assertValidGameState,
    formatStateDiagnostic,
    validateGameState,
} from './StateValidation.ts';

export type {
    StateDiagnostic,
    StateValidationResult,
    StateValidationStage,
} from './StateValidation.ts';
