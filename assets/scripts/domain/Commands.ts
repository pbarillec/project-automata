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
    | RebootCivilizationCommand;

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

export type CommandType = GameCommand['type'];
