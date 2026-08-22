export {
    GameRuntime,
    MANUAL_PRODUCTION_AMOUNT,
    calculateCurrentRobotsBuiltPerSecond,
    calculateCurrentProductionPerSecond,
    executeGameCommand,
} from './GameRuntime.ts';

export type {
    CommandExecutionResult,
    CommandRejectionReason,
    CommandRejectionResult,
    CommandSuccessResult,
} from './GameRuntime.ts';
