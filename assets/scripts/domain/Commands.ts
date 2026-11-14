export type GameCommand =
    | ManualProduceCommand
    | AdvanceActiveSessionCommand
    | AdvanceAutomationCommand
    | ActivateFreeOverclockCommand
    | ActivateExtendedOverclockCommand
    | LaunchAssemblyBatchCommand
    | BuyProducerLevelsCommand
    | BuyMaxProducerLevelsCommand
    | PurchaseBreakthroughCommand
    | PurchasePermanentUpgradeCommand
    | RebootCivilizationCommand
    | GrantFounderPackCommand
    | ReconcileFounderEntitlementCommand;

export interface ManualProduceCommand {
    readonly type: 'manualProduce';
}

export interface AdvanceActiveSessionCommand {
    readonly type: 'advanceActiveSession';
    readonly elapsedSeconds: number;
}

export interface AdvanceAutomationCommand {
    readonly type: 'advanceAutomation';
    readonly elapsedSeconds: number;
}

export interface ActivateFreeOverclockCommand {
    readonly type: 'activateFreeOverclock';
}

/**
 * AUT-056: starts the rewarded Extended Overclock. Only the session's verified-proof path submits it; `requestId` is the ad request id
 * and `claimedAtUtcMs` the grant time (stamped into the rewarded claim history).
 */
export interface ActivateExtendedOverclockCommand {
    readonly type: 'activateExtendedOverclock';
    readonly requestId: string;
    readonly claimedAtUtcMs: number;
}

/** AUT-GP-001: launch one Assembly Station batch while it is assisted (one at a time, no queue). */
export interface LaunchAssemblyBatchCommand {
    readonly type: 'launchAssemblyBatch';
}

export interface BuyProducerLevelsCommand {
    readonly type: 'buyProducerLevels';
    readonly producerId: string;
    readonly quantity: number;
}

export interface BuyMaxProducerLevelsCommand {
    readonly type: 'buyMaxProducerLevels';
    readonly producerId: string;
}

export interface PurchaseBreakthroughCommand {
    readonly type: 'purchaseBreakthrough';
    readonly breakthroughId: string;
}

export interface PurchasePermanentUpgradeCommand {
    readonly type: 'purchasePermanentUpgrade';
    readonly upgradeId: string;
}

export interface RebootCivilizationCommand {
    readonly type: 'rebootCivilization';
    readonly confirmed: true;
}

/**
 * AUT-058: delivers a completed Founder's Factory Pack purchase (store/mock). Idempotent: a replay keeps the entitlement and cosmetic and
 * never grants the two Factory Surges again. Only the lifecycle coordinator's dedicated purchase path submits it (never a generic UI submit).
 */
export interface GrantFounderPackCommand {
    readonly type: 'grantFounderPack';
    /** Store transaction / purchase request id (echoed in the event; idempotency is carried by the stored grant flag). */
    readonly requestId: string;
    readonly source: 'store' | 'mock';
    readonly grantedAtUtcMs: number;
}

/**
 * AUT-058: applies a store entitlement report. `owned: true` restores entitlement + cosmetic (never Surges); `false`/`null`
 * (not owned / unknown / failed) changes nothing. Only the coordinator's dedicated reconcile path submits it.
 */
export interface ReconcileFounderEntitlementCommand {
    readonly type: 'reconcileFounderEntitlement';
    readonly owned: boolean | null;
    readonly source: 'store' | 'mock';
    readonly reportedAtUtcMs: number;
}

export type CommandType = GameCommand['type'];
