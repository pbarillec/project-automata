export {
    AUTOMATED_FACTORY_ERA_ID,
    EraProgressionInputError,
    MANUAL_WORKSHOP_ERA_ID,
    ROBOTICS_COMPLEX_ERA_ID,
    applyEraTransition,
    getEraOrder,
    isCurrentEraAtLeast,
    isEraAtLeast,
} from './EraProgression.ts';

export {
    AutomationStateInputError,
    applyDefaultAutomationForConstructedProducer,
    isProducerDefaultAutomatedWhenBuilt,
    resolveEffectiveProducerAutomationState,
} from './AutomationState.ts';

export {
    calculateAutomatedProductionForElapsedSeconds,
    calculateAutomatedProductionPerSecond,
} from './Automation.ts';

export {
    BreakthroughInputError,
    createBreakthroughModifierSet,
    evaluateBreakthroughEligibility,
    getProducerLevel,
    isBreakthroughOwned,
    purchaseBreakthrough,
} from './Breakthroughs.ts';

export {
    FIRST_ROBOT_PROGRESSION_FLAG_ID,
    FREE_OVERCLOCK_BOOST_ID,
    FREE_OVERCLOCK_COOLDOWN_SECONDS,
    FREE_OVERCLOCK_DURATION_SECONDS,
    FREE_OVERCLOCK_MULTIPLIER,
    TemporaryBoostInputError,
    WORKER_BOT_BREAKTHROUGH_ID,
    activateFreeOverclock,
    activateTemporaryProductionBoost,
    advanceTemporaryBoosts,
    createTemporaryBoostModifierSet,
    getEffectiveTemporaryProductionMultiplier,
    getSecondsUntilNextTemporaryBoostTransition,
    isFreeOverclockUnlocked,
    resumeTemporaryBoost,
    suspendTemporaryBoost,
} from './TemporaryBoosts.ts';

export type {
    EraTransitionResult,
} from './EraProgression.ts';

export type {
    BreakthroughEligibilityResult,
    BreakthroughEligibilityStatus,
    BreakthroughPurchaseAlreadyOwnedResult,
    BreakthroughPurchaseInsufficientBalanceResult,
    BreakthroughPurchaseLockedResult,
    BreakthroughPurchaseResult,
    BreakthroughPurchaseStatus,
    BreakthroughPurchaseSuccessResult,
    BreakthroughPurchaseUnknownResult,
    LockedBreakthroughRequirement,
} from './Breakthroughs.ts';

export type {
    ActivateFreeOverclockResult,
    AdvanceTemporaryBoostsResult,
    TemporaryBoostActivatedEvent,
    TemporaryBoostActivationStatus,
    TemporaryBoostEvent,
    TemporaryBoostExpiredEvent,
    TemporaryBoostResumedEvent,
    TemporaryBoostSuspendedEvent,
    TemporaryBoostTransitionResult,
    TemporaryBoostTransitionStatus,
} from './TemporaryBoosts.ts';
