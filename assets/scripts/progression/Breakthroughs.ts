import type {
    BreakthroughConfig,
    BreakthroughEffect,
    BreakthroughRequirement,
    GameConfigRepository,
} from '../config/ConfigLoader.ts';
import {
    ModifierSet,
    createGlobalProductionMultiplier,
    createProducerProductionMultiplier,
    type ProductionMultiplierModifier,
} from '../economy/ModifierSet.ts';
import type { GameState, ProducerRunState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import { applyDefaultAutomationForConstructedProducer } from './AutomationState.ts';
import { applyEraTransition, isCurrentEraAtLeast } from './EraProgression.ts';
import { resolveEffectiveBreakthroughDefinition } from './PermanentUpgrades.ts';

export type BreakthroughEligibilityStatus =
    | 'eligible'
    | 'locked'
    | 'already_owned'
    | 'unknown_breakthrough';

export type BreakthroughPurchaseStatus =
    | 'success'
    | 'locked'
    | 'insufficient_balance'
    | 'already_owned'
    | 'unknown_breakthrough';

export interface LockedBreakthroughRequirement {
    readonly requirement: BreakthroughRequirement;
    readonly currentValue: number | string | boolean | null;
}

export interface BreakthroughEligibilityResult {
    readonly status: BreakthroughEligibilityStatus;
    readonly breakthroughId: string;
    readonly cost: number | null;
    readonly balance: number;
    readonly isAffordable: boolean;
    readonly lockedRequirements: readonly LockedBreakthroughRequirement[];
}

export interface BreakthroughPurchaseSuccessResult {
    readonly status: 'success';
    readonly breakthroughId: string;
    readonly state: GameState;
    readonly cost: number;
}

export interface BreakthroughPurchaseLockedResult {
    readonly status: 'locked';
    readonly breakthroughId: string;
    readonly lockedRequirements: readonly LockedBreakthroughRequirement[];
}

export interface BreakthroughPurchaseInsufficientBalanceResult {
    readonly status: 'insufficient_balance';
    readonly breakthroughId: string;
    readonly cost: number;
    readonly balance: number;
}

export interface BreakthroughPurchaseAlreadyOwnedResult {
    readonly status: 'already_owned';
    readonly breakthroughId: string;
}

export interface BreakthroughPurchaseUnknownResult {
    readonly status: 'unknown_breakthrough';
    readonly breakthroughId: string;
}

export type BreakthroughPurchaseResult =
    | BreakthroughPurchaseSuccessResult
    | BreakthroughPurchaseLockedResult
    | BreakthroughPurchaseInsufficientBalanceResult
    | BreakthroughPurchaseAlreadyOwnedResult
    | BreakthroughPurchaseUnknownResult;

export class BreakthroughInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'BreakthroughInputError';
    }
}

export function evaluateBreakthroughEligibility(
    repository: GameConfigRepository,
    state: GameState,
    breakthroughId: string,
): BreakthroughEligibilityResult {
    validateBreakthroughId(breakthroughId);
    const balance = readBalance(state);
    const breakthrough = repository.getBreakthrough(breakthroughId);

    if (breakthrough === undefined) {
        return {
            status: 'unknown_breakthrough',
            breakthroughId,
            cost: null,
            balance,
            isAffordable: false,
            lockedRequirements: [],
        };
    }

    if (isBreakthroughOwned(state, breakthroughId)) {
        return {
            status: 'already_owned',
            breakthroughId,
            cost: breakthrough.cost,
            balance,
            isAffordable: balance >= breakthrough.cost,
            lockedRequirements: [],
        };
    }

    const effectiveBreakthrough = resolveEffectiveBreakthroughDefinition(repository, state, breakthroughId);
    const lockedRequirements = evaluateLockedRequirements(repository, state, effectiveBreakthrough.requirements);
    if (lockedRequirements.length > 0) {
        return {
            status: 'locked',
            breakthroughId,
            cost: effectiveBreakthrough.cost,
            balance,
            isAffordable: balance >= effectiveBreakthrough.cost,
            lockedRequirements,
        };
    }

    return {
        status: 'eligible',
        breakthroughId,
        cost: effectiveBreakthrough.cost,
        balance,
        isAffordable: balance >= effectiveBreakthrough.cost,
        lockedRequirements: [],
    };
}

export function purchaseBreakthrough(
    repository: GameConfigRepository,
    state: GameState,
    breakthroughId: string,
): BreakthroughPurchaseResult {
    const eligibility = evaluateBreakthroughEligibility(repository, state, breakthroughId);
    if (eligibility.status === 'unknown_breakthrough') {
        return { status: 'unknown_breakthrough', breakthroughId };
    }

    if (eligibility.status === 'already_owned') {
        return { status: 'already_owned', breakthroughId };
    }

    if (eligibility.status === 'locked') {
        return {
            status: 'locked',
            breakthroughId,
            lockedRequirements: eligibility.lockedRequirements,
        };
    }

    const breakthrough = repository.getBreakthrough(breakthroughId);
    if (breakthrough === undefined) {
        return { status: 'unknown_breakthrough', breakthroughId };
    }

    const effectiveBreakthrough = resolveEffectiveBreakthroughDefinition(repository, state, breakthrough.id);
    if (state.run.industrialOutput < effectiveBreakthrough.cost) {
        return {
            status: 'insufficient_balance',
            breakthroughId,
            cost: effectiveBreakthrough.cost,
            balance: state.run.industrialOutput,
        };
    }

    const draft = cloneGameState(state);
    draft.run.industrialOutput = subtractFinite(draft.run.industrialOutput, effectiveBreakthrough.cost, 'industrialOutput');
    draft.run.industrialOutput = clampNegativeZero(draft.run.industrialOutput);
    draft.run.statistics.industrialOutputSpent = addFinite(
        draft.run.statistics.industrialOutputSpent,
        effectiveBreakthrough.cost,
        'run.statistics.industrialOutputSpent',
    );
    draft.run.statistics.breakthroughsPurchased += 1;
    draft.lifetime.breakthroughsPurchased += 1;
    draft.run.purchasedBreakthroughIds.push(breakthrough.id);
    applyBreakthroughEffects(repository, draft, breakthrough);

    return {
        status: 'success',
        breakthroughId,
        state: draft,
        cost: effectiveBreakthrough.cost,
    };
}

export function createBreakthroughModifierSet(
    repository: GameConfigRepository,
    state: GameState,
): ModifierSet {
    const modifiers: ProductionMultiplierModifier[] = [];

    for (const breakthroughId of state.run.purchasedBreakthroughIds) {
        const breakthrough = repository.getBreakthrough(breakthroughId);
        if (breakthrough === undefined) {
            throw new BreakthroughInputError(`state references unknown breakthrough id "${breakthroughId}".`);
        }

        for (const effect of breakthrough.effects) {
            if (effect.type === 'globalProductionMultiplier') {
                modifiers.push(createGlobalProductionMultiplier(effect.multiplier));
            }
            else if (effect.type === 'producerProductionMultiplier') {
                modifiers.push(createProducerProductionMultiplier(effect.producerId, effect.multiplier));
            }
        }
    }

    return ModifierSet.fromProductionMultipliers(modifiers);
}

export function isBreakthroughOwned(state: GameState, breakthroughId: string): boolean {
    validateBreakthroughId(breakthroughId);
    return state.run.purchasedBreakthroughIds.includes(breakthroughId);
}

export function getProducerLevel(state: GameState, producerId: string): number {
    validateProducerId(producerId);
    return state.run.producers[producerId]?.level ?? 0;
}

function evaluateLockedRequirements(
    repository: GameConfigRepository,
    state: GameState,
    requirements: readonly BreakthroughRequirement[],
): LockedBreakthroughRequirement[] {
    const lockedRequirements: LockedBreakthroughRequirement[] = [];

    for (const requirement of requirements) {
        const currentValue = getRequirementCurrentValue(repository, state, requirement);
        if (!isRequirementMet(repository, state, requirement)) {
            lockedRequirements.push({
                requirement,
                currentValue,
            });
        }
    }

    return lockedRequirements;
}

function isRequirementMet(
    repository: GameConfigRepository,
    state: GameState,
    requirement: BreakthroughRequirement,
): boolean {
    if (requirement.type === 'producerLevel') {
        return getProducerLevel(state, requirement.producerId) >= requirement.level;
    }

    if (requirement.type === 'breakthroughOwned') {
        return isBreakthroughOwned(state, requirement.breakthroughId);
    }

    if (requirement.type === 'robotsBuilt') {
        return state.run.robotsBuilt >= requirement.count;
    }

    if (requirement.type === 'era') {
        return isCurrentEraAtLeast(repository, state, requirement.eraId);
    }

    if (requirement.type === 'civilization') {
        return state.meta.civilizationNumber >= requirement.civilizationNumber;
    }

    throw new BreakthroughInputError(`unsupported breakthrough requirement type "${String(requirement.type)}".`);
}

function getRequirementCurrentValue(
    repository: GameConfigRepository,
    state: GameState,
    requirement: BreakthroughRequirement,
): number | string | boolean | null {
    if (requirement.type === 'producerLevel') {
        return getProducerLevel(state, requirement.producerId);
    }

    if (requirement.type === 'breakthroughOwned') {
        return isBreakthroughOwned(state, requirement.breakthroughId);
    }

    if (requirement.type === 'robotsBuilt') {
        return state.run.robotsBuilt;
    }

    if (requirement.type === 'era') {
        return state.run.currentEraId;
    }

    if (requirement.type === 'civilization') {
        return state.meta.civilizationNumber;
    }

    throw new BreakthroughInputError(`unsupported breakthrough requirement type "${String(requirement.type)}".`);
}

function applyBreakthroughEffects(repository: GameConfigRepository, state: GameState, breakthrough: BreakthroughConfig): void {
    for (const effect of breakthrough.effects) {
        applyBreakthroughEffect(repository, state, breakthrough.id, effect);
    }
}

function applyBreakthroughEffect(
    repository: GameConfigRepository,
    state: GameState,
    breakthroughId: string,
    effect: BreakthroughEffect,
): void {
    if (effect.type === 'globalProductionMultiplier' || effect.type === 'producerProductionMultiplier') {
        return;
    }

    if (effect.type === 'setProducerAutomation') {
        const existing = state.run.automation[effect.producerId];
        state.run.automation[effect.producerId] = {
            isAutomated: effect.automated,
            isOfflineEligible: effect.offlineEligible,
            unlockedByBreakthroughId: effect.automated
                ? existing?.unlockedByBreakthroughId ?? breakthroughId
                : existing?.unlockedByBreakthroughId ?? null,
        };
        return;
    }

    if (effect.type === 'constructProducer') {
        const existing = state.run.producers[effect.producerId];
        state.run.producers[effect.producerId] = constructProducer(existing, effect.level);
        applyDefaultAutomationForConstructedProducer(repository, state, effect.producerId, breakthroughId);
        return;
    }

    if (effect.type === 'enterEra') {
        applyEraTransition(repository, state, effect.eraId);
        return;
    }

    if (effect.type === 'setProgressionFlag') {
        state.run.progressionFlags[effect.flagId] = effect.value;
        return;
    }

    throw new BreakthroughInputError(`unsupported breakthrough effect type "${String(effect.type)}".`);
}

function constructProducer(existing: ProducerRunState | undefined, level: number): ProducerRunState {
    const existingLevel = existing?.level ?? 0;
    return {
        level: Math.max(existingLevel, level),
        isUnlocked: true,
        isBuilt: true,
    };
}

function readBalance(state: GameState): number {
    const balance = state.run.industrialOutput;
    if (!Number.isFinite(balance) || balance < 0) {
        throw new BreakthroughInputError('state.run.industrialOutput must be a non-negative finite number.');
    }
    return balance;
}

function subtractFinite(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result)) {
        throw new BreakthroughInputError(`${label} subtraction exceeds JavaScript Number range.`);
    }
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new BreakthroughInputError(`${label} addition exceeds JavaScript Number range.`);
    }
    return result;
}

function clampNegativeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

function validateBreakthroughId(breakthroughId: string): void {
    if (typeof breakthroughId !== 'string' || breakthroughId.length === 0) {
        throw new BreakthroughInputError('breakthroughId must be a non-empty string.');
    }
}

function validateProducerId(producerId: string): void {
    if (typeof producerId !== 'string' || producerId.length === 0) {
        throw new BreakthroughInputError('producerId must be a non-empty string.');
    }
}
