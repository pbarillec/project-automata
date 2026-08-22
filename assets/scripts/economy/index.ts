export {
    ModifierSet,
    ModifierSetInputError,
    applyProductionMultiplier,
    calculateModifiedProducerOutput,
    combineModifierSets,
    createGlobalProductionMultiplier,
    createProducerProductionMultiplier,
    resolveEffectiveProducerProductionMultiplier,
    resolveEffectiveProductionModifiers,
} from './ModifierSet.ts';

export {
    PRODUCER_COST_ABSOLUTE_TOLERANCE,
    PRODUCER_COST_RELATIVE_TOLERANCE,
    ProducerCostInputError,
    calculateMaxAffordableProducerPurchase,
    calculateNextProducerLevelCost,
    calculateProducerBulkPurchaseCost,
    calculateProducerPurchaseCost,
    isProducerCostAffordable,
} from './ProducerCost.ts';

export {
    PRODUCER_PRODUCTION_ABSOLUTE_TOLERANCE,
    PRODUCER_PRODUCTION_RELATIVE_TOLERANCE,
    ProducerProductionInputError,
    calculateElapsedProduction,
    calculateElapsedProductionFromProducers,
    calculateProducerBaseOutput,
    calculateTotalProductionPerSecond,
    isProductionApproximatelyEqual,
} from './ProducerProduction.ts';

export {
    ProducerMilestoneInputError,
    calculateCumulativeMilestoneMultiplier,
    calculateEffectiveMilestoneProductionMultiplier,
    calculateMilestoneAdjustedProducerOutput,
    calculateTotalMilestoneAdjustedProductionPerSecond,
    resolveCrossedProducerMilestones,
} from './ProducerMilestones.ts';

export {
    ROBOTS_BUILT_ABSOLUTE_TOLERANCE,
    ROBOTS_BUILT_PER_ROBOT_LINE_LEVEL_PER_SECOND,
    ROBOTS_BUILT_RELATIVE_TOLERANCE,
    ROBOTS_BUILT_THRESHOLDS,
    RobotsBuiltInputError,
    calculateRobotsBuiltForElapsedSeconds,
    calculateRobotsBuiltFromRobotLineElapsedSeconds,
    calculateRobotsBuiltPerSecond,
    isRobotsBuiltApproximatelyEqual,
    resolveCrossedRobotsBuiltThresholds,
} from './RobotsBuilt.ts';

export type {
    EffectiveProductionModifiers,
    GlobalProductionMultiplierModifier,
    ModifierSetInput,
    ProducerProductionMultiplierModifier,
    ProductionMultiplierModifier,
} from './ModifierSet.ts';

export type {
    MaxAffordableProducerPurchase,
    ProducerPurchaseCost,
} from './ProducerCost.ts';

export type {
    ProducerLevelMap,
} from './ProducerProduction.ts';

export type {
    CrossedProducerMilestone,
} from './ProducerMilestones.ts';
