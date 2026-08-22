export type GameCommand =
    | ManualProduceCommand
    | AdvanceAutomationCommand
    | BuyProducerLevelsCommand
    | BuyMaxProducerLevelsCommand
    | PurchaseBreakthroughCommand;

export interface ManualProduceCommand {
    readonly type: 'manualProduce';
}

export interface AdvanceAutomationCommand {
    readonly type: 'advanceAutomation';
    readonly elapsedSeconds: number;
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

export type CommandType = GameCommand['type'];
