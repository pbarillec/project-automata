export type GameCommand =
    | ManualProduceCommand
    | AdvanceActiveSessionCommand
    | AdvanceAutomationCommand
    | ActivateFreeOverclockCommand
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
