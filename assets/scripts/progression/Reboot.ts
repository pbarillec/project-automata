import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { DomainEvent } from '../domain/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState, clonePlainData } from '../state/StateClone.ts';
import { createFreshBoostState, createFreshRunState } from '../state/StateFactory.ts';
import { assertValidGameState } from '../state/StateValidation.ts';
import {
    createPrestigePreview,
    type PrestigePreview,
} from './Prestige.ts';

export type RebootEligibilityStatus = 'eligible' | 'not_eligible';
export type RebootExecutionStatus = 'success' | 'not_confirmed' | 'not_eligible' | 'failure';

export interface RebootPreview {
    readonly eligibility: RebootEligibilityStatus;
    readonly currentCivilization: number;
    readonly resultingCivilization: number;
    readonly prestigePower: number;
    readonly currentEligibleProductionPerSecond: number;
    readonly aiCoresToGain: number;
    readonly currentAiCores: number;
    readonly resultingAiCores: number;
    readonly prestigePreview: PrestigePreview;
}

export interface RebootResetSummary {
    readonly runStateReset: true;
    readonly boostStateReset: true;
    readonly metaStatePreserved: true;
    readonly settingsStatePreserved: true;
    readonly lifetimeStatePreserved: true;
    readonly monetizationStatePreserved: true;
}

export interface RebootSuccessResult {
    readonly status: 'success';
    readonly preview: RebootPreview;
    readonly state: GameState;
    readonly events: readonly DomainEvent[];
    readonly resetSummary: RebootResetSummary;
}

export interface RebootRejectedResult {
    readonly status: 'not_confirmed' | 'not_eligible';
    readonly preview: RebootPreview;
    readonly reason: string;
}

export interface RebootFailureResult {
    readonly status: 'failure';
    readonly preview: RebootPreview;
    readonly reason: string;
}

export type RebootExecutionResult =
    | RebootSuccessResult
    | RebootRejectedResult
    | RebootFailureResult;

const RESET_SUMMARY: RebootResetSummary = Object.freeze({
    runStateReset: true,
    boostStateReset: true,
    metaStatePreserved: true,
    settingsStatePreserved: true,
    lifetimeStatePreserved: true,
    monetizationStatePreserved: true,
});

export function createRebootPreview(repository: GameConfigRepository, state: GameState): RebootPreview {
    const snapshot = cloneGameState(assertValidGameState(state));
    const prestigePreview = createPrestigePreview(repository, snapshot);
    const currentCivilization = readPositiveSafeInteger(snapshot.meta.civilizationNumber, 'meta.civilizationNumber');
    const aiCoresToGain = readNonNegativeSafeInteger(prestigePreview.currentAiCoreReward, 'prestige reward');
    const currentAiCores = readNonNegativeFiniteNumber(snapshot.meta.aiCores, 'meta.aiCores');
    const resultingAiCores = addFinite(currentAiCores, aiCoresToGain, 'resulting AI Cores');

    return deepFreeze({
        eligibility: aiCoresToGain > 0 ? 'eligible' as const : 'not_eligible' as const,
        currentCivilization,
        resultingCivilization: addSafeInteger(currentCivilization, 1, 'resulting Civilization'),
        prestigePower: prestigePreview.currentPrestigePower,
        currentEligibleProductionPerSecond: prestigePreview.currentEligibleProductionPerSecond,
        aiCoresToGain,
        currentAiCores,
        resultingAiCores,
        prestigePreview,
    });
}

export function executeRebootCivilization(
    repository: GameConfigRepository,
    state: GameState,
    input: { readonly confirmed?: boolean },
): RebootExecutionResult {
    const preview = createRebootPreview(repository, state);

    if (input.confirmed !== true) {
        return deepFreeze({
            status: 'not_confirmed' as const,
            preview,
            reason: 'Reboot Civilization requires explicit confirmation.',
        });
    }

    if (preview.eligibility !== 'eligible') {
        return deepFreeze({
            status: 'not_eligible' as const,
            preview,
            reason: 'Reboot Civilization requires a positive projected AI Core reward.',
        });
    }

    const draft = cloneGameState(state);
    try {
        const previousAiCores = draft.meta.aiCores;
        const previousCivilization = draft.meta.civilizationNumber;
        const nextCivilization = preview.resultingCivilization;

        draft.meta = {
            ...draft.meta,
            civilizationNumber: nextCivilization,
            aiCores: preview.resultingAiCores,
            lifetimeAiCoresEarned: addFinite(
                draft.meta.lifetimeAiCoresEarned,
                preview.aiCoresToGain,
                'meta.lifetimeAiCoresEarned',
            ),
        };
        draft.run = createFreshRunState();
        draft.boosts = createFreshBoostState();
        draft.lifetime = {
            ...draft.lifetime,
            rebootsCompleted: draft.lifetime.rebootsCompleted + 1,
            highestCivilizationReached: Math.max(draft.lifetime.highestCivilizationReached, nextCivilization),
        };

        assertValidGameState(draft);

        return deepFreeze({
            status: 'success' as const,
            preview,
            state: draft,
            events: [
                {
                    type: 'aiCoresGranted',
                    amount: preview.aiCoresToGain,
                    previousAiCores,
                    newAiCores: preview.resultingAiCores,
                    source: 'reboot',
                },
                {
                    type: 'civilizationChanged',
                    oldCivilization: previousCivilization,
                    newCivilization: nextCivilization,
                    reason: 'reboot',
                },
            ],
            resetSummary: RESET_SUMMARY,
        });
    }
    catch (error) {
        return deepFreeze({
            status: 'failure' as const,
            preview,
            reason: error instanceof Error ? error.message : 'Reboot Civilization failed.',
        });
    }
}

function readPositiveSafeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${label} must be a positive safe integer.`);
    }
    return value;
}

function readNonNegativeSafeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer.`);
    }
    return value;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative finite number.`);
    }
    return value;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} addition exceeds JavaScript Number range.`);
    }
    return result;
}

function addSafeInteger(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) {
        throw new RangeError(`${label} addition exceeds JavaScript safe integer range.`);
    }
    return result;
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
