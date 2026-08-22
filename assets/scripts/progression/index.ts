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
    calculateOfflineEligibleDurableProducerProductionRateContributions,
    calculateOfflineEligibleDurableProductionPerSecond,
    calculateDurableProductionPerSecond,
    calculateOnlineAutomatedProductionPerSecond,
    calculateOnlineProductionPerSecond,
    calculateSustainedProducerProductionRateContributions,
    calculateSustainedProductionPerSecond,
} from './ProductionRates.ts';

export {
    AI_CORE_REWARD_COEFFICIENT,
    PrestigeInputError,
    calculateAiCoreReward,
    calculateCurrentPrestigeEligibleProductionPerSecond,
    calculateNextAiCoreProgress,
    calculateRequiredPrestigePowerForAiCores,
    calculateUpdatedPrestigePowerPeak,
    createPrestigePreview,
    readPrestigeConfig,
} from './Prestige.ts';

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

export {
    AUTONOMOUS_OPTIMIZATION_UPGRADE_ID,
    CACHED_PROCEDURES_UPGRADE_ID,
    COMPACT_BLUEPRINTS_UPGRADE_ID,
    ERA_COMPRESSION_UPGRADE_ID,
    INHERITED_AUTOMATION_UPGRADE_ID,
    INDUSTRIAL_SCALING_UPGRADE_ID,
    OPTIMIZED_FABRICATION_UPGRADE_ID,
    PermanentUpgradeInputError,
    WORKER_TEMPLATES_UPGRADE_ID,
    applyNewProducerConstructionCostMultiplier,
    createPermanentUpgradeModifierSet,
    evaluatePermanentUpgradeRankState,
    getNextPermanentUpgradeRankCost,
    getPermanentUpgradeRank,
    resolveEffectiveBreakthroughDefinition,
    resolveEffectiveMajorRequirement,
    resolveNewProducerConstructionCostMultiplier,
    resolvePermanentMajorRequirementReduction,
    resolvePermanentMilestonePowerBonus,
    shouldProducerStartAutomatedOnceConstructed,
    validatePermanentUpgradeRanks,
} from './PermanentUpgrades.ts';

export {
    purchasePermanentUpgrade,
} from './PermanentUpgradePurchase.ts';

export {
    NextGoalInputError,
    resolveNextGoal,
} from './NextGoal.ts';

export {
    createRebootPreview,
    executeRebootCivilization,
} from './Reboot.ts';

export {
    ProducerProgressionInputError,
    ROBOT_LINE_CONSTRUCTION_COST,
    ROBOT_LINE_PRODUCER_ID,
    calculateMaxAffordableProducerProgressionPurchase,
    calculateProducerProgressionPurchase,
    evaluateProducerBuildProgression,
    getProgressionProducerLevel,
    isProducerBuilt,
} from './ProducerProgression.ts';

export type {
    EraTransitionResult,
} from './EraProgression.ts';

export type {
    ProducerProductionRateContribution,
    ProductionRateOptions,
    ProductionRateProducerScope,
    ProductionRateTemporaryBoostMode,
} from './ProductionRates.ts';

export type {
    NextAiCoreProgress,
    PrestigePreview,
} from './Prestige.ts';

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

export type {
    EffectiveBreakthroughDefinition,
    MissingPermanentUpgradePrerequisite,
    PermanentUpgradeRankState,
    PermanentUpgradeRankStatus,
} from './PermanentUpgrades.ts';

export type {
    PermanentUpgradePurchaseInsufficientAiCoresResult,
    PermanentUpgradePurchaseInvalidStateResult,
    PermanentUpgradePurchaseMaxRankResult,
    PermanentUpgradePurchasePrerequisiteLockedResult,
    PermanentUpgradePurchaseResult,
    PermanentUpgradePurchaseStatus,
    PermanentUpgradePurchaseSuccessResult,
    PermanentUpgradePurchaseUnknownResult,
} from './PermanentUpgradePurchase.ts';

export type {
    BreakthroughNextGoal,
    EraNextGoal,
    NextGoal,
    NextGoalAffordability,
    NextGoalBlocking,
    NextGoalBlockingRequirement,
    NextGoalCategory,
    NextGoalFocusTarget,
    NextGoalFocusTargetSource,
    NextGoalProgress,
    NoNextGoal,
    ProducerBuildNextGoal,
    ProducerMilestoneNextGoal,
    RebootAiCoreNextGoal,
} from './NextGoal.ts';

export type {
    RebootEligibilityStatus,
    RebootExecutionResult,
    RebootExecutionStatus,
    RebootFailureResult,
    RebootPreview,
    RebootRejectedResult,
    RebootResetSummary,
    RebootSuccessResult,
} from './Reboot.ts';

export type {
    ProducerBuildBlockingRequirement,
    ProducerBuildProgressionResult,
    ProducerBuildProgressionStatus,
    ProducerProgressionPurchasePreview,
} from './ProducerProgression.ts';
