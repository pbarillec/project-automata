export type DomainEvent =
    | IndustrialOutputChangedEvent
    | ProductionGrantedEvent
    | TemporaryBoostActivatedEvent
    | TemporaryBoostExpiredEvent
    | TemporaryBoostSuspendedEvent
    | TemporaryBoostResumedEvent
    | ProducerLevelsPurchasedEvent
    | ProducerConstructedEvent
    | ProducerMilestoneReachedEvent
    | BreakthroughPurchasedEvent
    | AutomationStateChangedEvent
    | EraChangedEvent
    | ProgressionFlagChangedEvent
    | FirstRobotProducedEvent
    | RobotsBuiltThresholdReachedEvent;

export interface IndustrialOutputChangedEvent {
    readonly type: 'industrialOutputChanged';
    readonly previousAmount: number;
    readonly newAmount: number;
    readonly delta: number;
    readonly reason: 'manual_production' | 'automation_production' | 'producer_purchase' | 'breakthrough_purchase';
}

export interface ProductionGrantedEvent {
    readonly type: 'productionGranted';
    readonly source: 'manual' | 'automation';
    readonly amount: number;
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
