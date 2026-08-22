export {
    GameRuntime,
    MANUAL_PRODUCTION_AMOUNT,
    calculateCurrentRobotsBuiltPerSecond,
    calculateCurrentProductionPerSecond,
    executeGameCommand,
} from './GameRuntime.ts';

export {
    calculateCurrentPrestigeEligibleProductionPerSecond,
} from '../progression/index.ts';

export type {
    ClockAdvanceActiveSessionResult,
    CommandExecutionResult,
    CommandRejectionReason,
    CommandRejectionResult,
    CommandSuccessResult,
    GameRuntimeOptions,
} from './GameRuntime.ts';
