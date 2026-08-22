import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { DomainEvent } from '../domain/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState, clonePlainData } from '../state/StateClone.ts';
import { assertValidGameState } from '../state/StateValidation.ts';
import {
    evaluatePermanentUpgradeRankState,
    validatePermanentUpgradeRanks,
    type MissingPermanentUpgradePrerequisite,
    type PermanentUpgradeRankState,
} from './PermanentUpgrades.ts';

export type PermanentUpgradePurchaseStatus =
    | 'success'
    | 'unknown_upgrade'
    | 'prerequisite_locked'
    | 'max_rank'
    | 'insufficient_ai_cores'
    | 'invalid_state';

export interface PermanentUpgradePurchaseSuccessResult {
    readonly status: 'success';
    readonly upgradeId: string;
    readonly state: GameState;
    readonly cost: number;
    readonly previousAiCores: number;
    readonly newAiCores: number;
    readonly previousRank: number;
    readonly newRank: number;
    readonly events: readonly DomainEvent[];
}

export interface PermanentUpgradePurchaseUnknownResult {
    readonly status: 'unknown_upgrade';
    readonly upgradeId: string;
}

export interface PermanentUpgradePurchasePrerequisiteLockedResult {
    readonly status: 'prerequisite_locked';
    readonly upgradeId: string;
    readonly currentRank: number;
    readonly nextRank: number | null;
    readonly cost: number | null;
    readonly missingPrerequisites: readonly MissingPermanentUpgradePrerequisite[];
}

export interface PermanentUpgradePurchaseMaxRankResult {
    readonly status: 'max_rank';
    readonly upgradeId: string;
    readonly currentRank: number;
    readonly maxRank: number;
}

export interface PermanentUpgradePurchaseInsufficientAiCoresResult {
    readonly status: 'insufficient_ai_cores';
    readonly upgradeId: string;
    readonly cost: number;
    readonly balance: number;
}

export interface PermanentUpgradePurchaseInvalidStateResult {
    readonly status: 'invalid_state';
    readonly upgradeId: string;
    readonly reason: string;
}

export type PermanentUpgradePurchaseResult =
    | PermanentUpgradePurchaseSuccessResult
    | PermanentUpgradePurchaseUnknownResult
    | PermanentUpgradePurchasePrerequisiteLockedResult
    | PermanentUpgradePurchaseMaxRankResult
    | PermanentUpgradePurchaseInsufficientAiCoresResult
    | PermanentUpgradePurchaseInvalidStateResult;

export function purchasePermanentUpgrade(
    repository: GameConfigRepository,
    state: GameState,
    upgradeId: string,
): PermanentUpgradePurchaseResult {
    let snapshot: GameState;
    let rankState: PermanentUpgradeRankState;

    try {
        snapshot = cloneGameState(assertValidGameState(state));
        rankState = evaluatePermanentUpgradeRankState(repository, snapshot.meta, upgradeId);
    }
    catch (error) {
        return deepFreeze({
            status: 'invalid_state' as const,
            upgradeId,
            reason: error instanceof Error ? error.message : 'Permanent upgrade state validation failed.',
        });
    }

    if (rankState.status === 'unknown_upgrade') {
        return deepFreeze({
            status: 'unknown_upgrade' as const,
            upgradeId,
        });
    }

    if (rankState.status === 'prerequisite_locked') {
        return deepFreeze({
            status: 'prerequisite_locked' as const,
            upgradeId,
            currentRank: rankState.currentRank,
            nextRank: rankState.nextRank,
            cost: rankState.nextRankCost,
            missingPrerequisites: clonePlainData(rankState.missingPrerequisites),
        });
    }

    if (rankState.status === 'max_rank') {
        return deepFreeze({
            status: 'max_rank' as const,
            upgradeId,
            currentRank: rankState.currentRank,
            maxRank: rankState.maxRank ?? rankState.currentRank,
        });
    }

    let cost: number;
    let nextRank: number;
    let previousAiCores: number;
    try {
        cost = readPurchaseCost(rankState.nextRankCost, upgradeId);
        nextRank = readNextRank(rankState.nextRank, upgradeId);
        previousAiCores = readAiCoreBalance(snapshot.meta.aiCores);
    }
    catch (error) {
        return deepFreeze({
            status: 'invalid_state' as const,
            upgradeId,
            reason: error instanceof Error ? error.message : 'Permanent upgrade purchase input validation failed.',
        });
    }

    if (previousAiCores < cost) {
        return deepFreeze({
            status: 'insufficient_ai_cores' as const,
            upgradeId,
            cost,
            balance: previousAiCores,
        });
    }

    const draft = cloneGameState(snapshot);
    const previousRank = rankState.currentRank;
    const newAiCores = clampNegativeZero(subtractFinite(previousAiCores, cost, 'meta.aiCores'));

    draft.meta = {
        ...draft.meta,
        aiCores: newAiCores,
        permanentUpgradeRanks: {
            ...draft.meta.permanentUpgradeRanks,
            [upgradeId]: nextRank,
        },
    };

    try {
        validatePermanentUpgradeRanks(repository, draft.meta);
        assertValidGameState(draft);
    }
    catch (error) {
        return deepFreeze({
            status: 'invalid_state' as const,
            upgradeId,
            reason: error instanceof Error ? error.message : 'Permanent upgrade purchase produced invalid state.',
        });
    }

    const events: DomainEvent[] = [
        {
            type: 'aiCoreBalanceChanged',
            previousAiCores,
            newAiCores,
            delta: newAiCores - previousAiCores,
            reason: 'permanent_upgrade_purchase',
        },
        {
            type: 'permanentUpgradePurchased',
            upgradeId,
            previousRank,
            newRank: nextRank,
            cost,
        },
    ];

    return deepFreeze({
        status: 'success' as const,
        upgradeId,
        state: draft,
        cost,
        previousAiCores,
        newAiCores,
        previousRank,
        newRank: nextRank,
        events,
    });
}

function readPurchaseCost(cost: number | null, upgradeId: string): number {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
        throw new RangeError(`next rank cost for permanent upgrade "${upgradeId}" must be a non-negative finite number.`);
    }
    return cost;
}

function readNextRank(rank: number | null, upgradeId: string): number {
    if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank <= 0) {
        throw new RangeError(`next rank for permanent upgrade "${upgradeId}" must be a positive safe integer.`);
    }
    return rank;
}

function readAiCoreBalance(balance: number): number {
    if (!Number.isFinite(balance) || balance < 0) {
        throw new RangeError('meta.aiCores must be a non-negative finite number.');
    }
    return balance;
}

function subtractFinite(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} subtraction exceeds JavaScript Number range.`);
    }
    return result;
}

function clampNegativeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

function deepFreeze<T>(value: T): T {
    return freezeRecursive(clonePlainData(value));
}

function freezeRecursive<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            freezeRecursive(item);
        }
        return Object.freeze(value) as T;
    }

    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) {
            freezeRecursive(item);
        }
        return Object.freeze(value);
    }

    return value;
}
