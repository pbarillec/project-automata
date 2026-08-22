import type { GameConfigRepository, PrestigeConfig } from '../config/ConfigLoader.ts';
import type { GameState } from '../state/GameState.ts';
import { calculateDurableProductionPerSecond } from './ProductionRates.ts';

export const AI_CORE_REWARD_COEFFICIENT = 5;

export interface NextAiCoreProgress {
    readonly currentAiCoreReward: number;
    readonly nextAiCoreReward: number;
    readonly previousCoreRequiredPrestigePower: number;
    readonly nextCoreRequiredPrestigePower: number;
    readonly remainingPrestigePowerForNextCore: number;
    readonly progressToNextCore: number;
}

export interface PrestigePreview {
    readonly currentPrestigePower: number;
    readonly currentEligibleProductionPerSecond: number;
    readonly currentAiCoreReward: number;
    readonly nextAiCoreReward: number;
    readonly previousCoreRequiredPrestigePower: number;
    readonly nextCoreRequiredPrestigePower: number;
    readonly remainingPrestigePowerForNextCore: number;
    readonly progressToNextCore: number;
    readonly p0PrestigePower: number;
}

export class PrestigeInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'PrestigeInputError';
    }
}

export function calculateCurrentPrestigeEligibleProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
): number {
    return calculateDurableProductionPerSecond(repository, state);
}

export function calculateUpdatedPrestigePowerPeak(
    storedPrestigePowerPeak: number,
    currentPrestigeEligibleProductionPerSecond: number,
): number {
    const storedPeak = readNonNegativeFiniteNumber(storedPrestigePowerPeak, 'storedPrestigePowerPeak');
    const currentProduction = readNonNegativeFiniteNumber(
        currentPrestigeEligibleProductionPerSecond,
        'currentPrestigeEligibleProductionPerSecond',
    );
    return Math.max(storedPeak, currentProduction);
}

export function calculateAiCoreReward(prestigePower: number, p0PrestigePower: number): number {
    const prestige = readNonNegativeFiniteNumber(prestigePower, 'prestigePower');
    const p0 = readPositiveFiniteNumber(p0PrestigePower, 'p0PrestigePower');

    if (prestige <= 0) {
        return 0;
    }

    const ratio = divideFinite(prestige, p0, 'prestigePower / p0PrestigePower');
    const reward = AI_CORE_REWARD_COEFFICIENT * Math.sqrt(ratio);
    if (!Number.isFinite(reward)) {
        throw new PrestigeInputError('AI Core reward calculation exceeded JavaScript Number range.');
    }

    return Math.floor(reward);
}

export function calculateRequiredPrestigePowerForAiCores(targetAiCoreReward: number, p0PrestigePower: number): number {
    const target = readNonNegativeSafeInteger(targetAiCoreReward, 'targetAiCoreReward');
    const p0 = readPositiveFiniteNumber(p0PrestigePower, 'p0PrestigePower');
    const rewardRatio = target / AI_CORE_REWARD_COEFFICIENT;
    const required = p0 * rewardRatio * rewardRatio;
    if (!Number.isFinite(required)) {
        throw new PrestigeInputError('required Prestige Power calculation exceeded JavaScript Number range.');
    }
    return required;
}

export function calculateNextAiCoreProgress(prestigePower: number, p0PrestigePower: number): NextAiCoreProgress {
    const prestige = readNonNegativeFiniteNumber(prestigePower, 'prestigePower');
    const currentAiCoreReward = calculateAiCoreReward(prestige, p0PrestigePower);
    const nextAiCoreReward = currentAiCoreReward + 1;
    const previousCoreRequiredPrestigePower = currentAiCoreReward === 0
        ? 0
        : calculateRequiredPrestigePowerForAiCores(currentAiCoreReward, p0PrestigePower);
    const nextCoreRequiredPrestigePower = calculateRequiredPrestigePowerForAiCores(nextAiCoreReward, p0PrestigePower);
    const remainingPrestigePowerForNextCore = Math.max(0, nextCoreRequiredPrestigePower - prestige);
    const requiredRange = nextCoreRequiredPrestigePower - previousCoreRequiredPrestigePower;
    const progressToNextCore = requiredRange <= 0
        ? 1
        : clampUnit((prestige - previousCoreRequiredPrestigePower) / requiredRange);

    return Object.freeze({
        currentAiCoreReward,
        nextAiCoreReward,
        previousCoreRequiredPrestigePower,
        nextCoreRequiredPrestigePower,
        remainingPrestigePowerForNextCore,
        progressToNextCore,
    });
}

export function createPrestigePreview(repository: GameConfigRepository, state: GameState): PrestigePreview {
    const prestigeConfig = readPrestigeConfig(repository.getPrestigeConfig());
    const currentPrestigePower = readNonNegativeFiniteNumber(state.run.prestigePowerPeak, 'state.run.prestigePowerPeak');
    const currentEligibleProductionPerSecond = calculateCurrentPrestigeEligibleProductionPerSecond(repository, state);
    const progress = calculateNextAiCoreProgress(currentPrestigePower, prestigeConfig.p0PrestigePower);

    return Object.freeze({
        currentPrestigePower,
        currentEligibleProductionPerSecond,
        currentAiCoreReward: progress.currentAiCoreReward,
        nextAiCoreReward: progress.nextAiCoreReward,
        previousCoreRequiredPrestigePower: progress.previousCoreRequiredPrestigePower,
        nextCoreRequiredPrestigePower: progress.nextCoreRequiredPrestigePower,
        remainingPrestigePowerForNextCore: progress.remainingPrestigePowerForNextCore,
        progressToNextCore: progress.progressToNextCore,
        p0PrestigePower: prestigeConfig.p0PrestigePower,
    });
}

export function readPrestigeConfig(prestigeConfig: PrestigeConfig): PrestigeConfig {
    if (typeof prestigeConfig !== 'object' || prestigeConfig === null) {
        throw new PrestigeInputError('prestigeConfig is required.');
    }

    if (typeof prestigeConfig.id !== 'string' || prestigeConfig.id.length === 0) {
        throw new PrestigeInputError('prestigeConfig.id must be a non-empty string.');
    }

    return Object.freeze({
        id: prestigeConfig.id,
        p0PrestigePower: readPositiveFiniteNumber(prestigeConfig.p0PrestigePower, 'prestigeConfig.p0PrestigePower'),
    });
}

function readPositiveFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new PrestigeInputError(`${label} must be a positive finite number.`);
    }
    return value;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new PrestigeInputError(`${label} must be a non-negative finite number.`);
    }
    return value;
}

function readNonNegativeSafeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new PrestigeInputError(`${label} must be a non-negative safe integer.`);
    }
    return value;
}

function divideFinite(left: number, right: number, label: string): number {
    const result = left / right;
    if (!Number.isFinite(result)) {
        throw new PrestigeInputError(`${label} exceeded JavaScript Number range.`);
    }
    return result;
}

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) {
        throw new PrestigeInputError('next AI Core progress must be finite.');
    }

    if (value <= 0) {
        return 0;
    }

    if (value >= 1) {
        return 1;
    }

    return value;
}
