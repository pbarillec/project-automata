export type DomainEvent =
    | IndustrialOutputChangedEvent
    | ProductionGrantedEvent
    | TemporaryBoostActivatedEvent
    | TemporaryBoostExpiredEvent
    | TemporaryBoostSuspendedEvent
    | TemporaryBoostResumedEvent
    | AssistedBatchLaunchedEvent
    | AssistedBatchCompletedEvent
    | ProducerLevelsPurchasedEvent
    | ProducerConstructedEvent
    | ProducerMilestoneReachedEvent
    | BreakthroughPurchasedEvent
    | AutomationStateChangedEvent
    | EraChangedEvent
    | ProgressionFlagChangedEvent
    | FirstRobotProducedEvent
    | RobotsBuiltThresholdReachedEvent
    | AiCoresGrantedEvent
    | AiCoreBalanceChangedEvent
    | PermanentUpgradePurchasedEvent
    | CivilizationChangedEvent
    | RebootCompletedEvent
    | FounderPackAppliedEvent;

export interface IndustrialOutputChangedEvent {
    readonly type: 'industrialOutputChanged';
    readonly previousAmount: number;
    readonly newAmount: number;
    readonly delta: number;
    readonly reason: 'manual_production' | 'automation_production' | 'assisted_batch_production' | 'producer_purchase' | 'breakthrough_purchase';
}

export interface ProductionGrantedEvent {
    readonly type: 'productionGranted';
    readonly source: 'manual' | 'automation' | 'assisted_batch';
    readonly amount: number;
}

/** AUT-GP-001: an assisted batch was launched (it completes after `durationSeconds` of active time). */
export interface AssistedBatchLaunchedEvent {
    readonly type: 'assistedBatchLaunched';
    readonly producerId: string;
    readonly durationSeconds: number;
}

/** AUT-GP-001: an assisted batch completed and paid `payout` Industrial Output. */
export interface AssistedBatchCompletedEvent {
    readonly type: 'assistedBatchCompleted';
    readonly producerId: string;
    readonly durationSeconds: number;
    readonly payout: number;
}

export interface TemporaryBoostActivatedEvent {
    readonly type: 'temporaryBoostActivated';
    readonly boostId: string;
    readonly source: string;
    readonly multiplier: number;
    readonly durationSeconds: number;
    readonly cooldownSeconds: number;
    readonly requestId: string | null;
}

export interface TemporaryBoostExpiredEvent {
    readonly type: 'temporaryBoostExpired';
    readonly boostId: string;
    readonly source: string;
}

export interface TemporaryBoostSuspendedEvent {
    readonly type: 'temporaryBoostSuspended';
    readonly boostId: string;
    readonly suspendedByBoostId: string;
    readonly remainingSeconds: number;
}

export interface TemporaryBoostResumedEvent {
    readonly type: 'temporaryBoostResumed';
    readonly boostId: string;
    readonly remainingSeconds: number;
}

export interface ProducerLevelsPurchasedEvent {
    readonly type: 'producerLevelsPurchased';
    readonly producerId: string;
    readonly quantity: number;
    readonly oldLevel: number;
    readonly newLevel: number;
    readonly cost: number;
}

export interface ProducerConstructedEvent {
    readonly type: 'producerConstructed';
    readonly producerId: string;
    readonly level: number;
    readonly source: 'producer_purchase' | 'breakthrough';
    readonly breakthroughId?: string;
}

export interface ProducerMilestoneReachedEvent {
    readonly type: 'producerMilestoneReached';
    readonly producerId: string;
    readonly milestoneId: string;
    readonly threshold: number;
    readonly productionMultiplier: number;
    readonly cumulativeMultiplierAfterCrossing: number;
}

export interface BreakthroughPurchasedEvent {
    readonly type: 'breakthroughPurchased';
    readonly breakthroughId: string;
    readonly cost: number;
}

export interface AutomationStateChangedEvent {
    readonly type: 'automationStateChanged';
    readonly producerId: string;
    readonly isAutomated: boolean;
    readonly isOfflineEligible: boolean;
    readonly unlockedByBreakthroughId: string | null;
}

export interface EraChangedEvent {
    readonly type: 'eraChanged';
    readonly oldEraId: string | null;
    readonly newEraId: string;
    readonly breakthroughId?: string;
}

export interface ProgressionFlagChangedEvent {
    readonly type: 'progressionFlagChanged';
    readonly flagId: string;
    readonly value: boolean;
    readonly breakthroughId?: string;
}

export interface FirstRobotProducedEvent {
    readonly type: 'firstRobotProduced';
    readonly breakthroughId?: string;
}

export interface RobotsBuiltThresholdReachedEvent {
    readonly type: 'robotsBuiltThresholdReached';
    readonly threshold: number;
    readonly previousAmount: number;
    readonly newAmount: number;
}

export interface AiCoresGrantedEvent {
    readonly type: 'aiCoresGranted';
    readonly amount: number;
    readonly previousAiCores: number;
    readonly newAiCores: number;
    readonly source: 'reboot';
}

export interface AiCoreBalanceChangedEvent {
    readonly type: 'aiCoreBalanceChanged';
    readonly previousAiCores: number;
    readonly newAiCores: number;
    readonly delta: number;
    readonly reason: 'permanent_upgrade_purchase';
}

export interface PermanentUpgradePurchasedEvent {
    readonly type: 'permanentUpgradePurchased';
    readonly upgradeId: string;
    readonly previousRank: number;
    readonly newRank: number;
    readonly cost: number;
}

export interface CivilizationChangedEvent {
    readonly type: 'civilizationChanged';
    readonly oldCivilization: number;
    readonly newCivilization: number;
    readonly reason: 'reboot';
}

export interface RebootCompletedEvent {
    readonly type: 'rebootCompleted';
    readonly oldCivilization: number;
    readonly newCivilization: number;
    readonly aiCoresGranted: number;
    readonly prestigePower: number;
}

/**
 * AUT-058: a Founder's Factory Pack purchase delivery (`origin: 'purchase'`) or a store-report restore (`origin: 'restore'`) was applied.
 * A replayed delivery still emits it with every flag false / 0 (nothing changed, the pack is already owned).
 */
export interface FounderPackAppliedEvent {
    readonly type: 'founderPackApplied';
    readonly origin: 'purchase' | 'restore';
    readonly requestId: string | null;
    readonly entitlementGranted: boolean;
    readonly cosmeticGranted: boolean;
    readonly surgesGranted: number;
    readonly changed: boolean;
}
