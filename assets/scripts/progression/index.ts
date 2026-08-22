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
