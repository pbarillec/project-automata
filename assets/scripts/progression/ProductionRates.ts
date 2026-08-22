import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import {
    applyProductionMultiplier,
    calculateMilestoneAdjustedProducerOutput,
    combineModifierSets,
    resolveEffectiveProducerProductionMultiplier,
    type ModifierSet,
} from '../economy/index.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveEffectiveProducerAutomationState } from './AutomationState.ts';
import { createBreakthroughModifierSet } from './Breakthroughs.ts';
import { createPermanentUpgradeModifierSet, resolvePermanentMilestonePowerBonus } from './PermanentUpgrades.ts';
import { createTemporaryBoostModifierSet } from './TemporaryBoosts.ts';

export type ProductionRateProducerScope = 'all' | 'automated';
export type ProductionRateTemporaryBoostMode = 'include' | 'exclude';

export interface ProductionRateOptions {
    readonly producerScope: ProductionRateProducerScope;
    readonly temporaryBoosts: ProductionRateTemporaryBoostMode;
}

export function calculateSustainedProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
    options: ProductionRateOptions,
): number {
    const milestones = repository.listMilestones();
    const milestonePowerBonus = resolvePermanentMilestonePowerBonus(repository, state.meta);
    const modifierSet = createProductionModifierSet(repository, state, options.temporaryBoosts);
    let total = 0;

    for (const producer of repository.listProducers()) {
        if (options.producerScope === 'automated') {
            const automation = resolveEffectiveProducerAutomationState(repository, state, producer.id);
            if (!automation.isAutomated) {
                continue;
            }
        }

        const level = state.run.producers[producer.id]?.level ?? 0;
        const milestoneAdjusted = calculateMilestoneAdjustedProducerOutput(producer, level, milestones, milestonePowerBonus);
        const modifier = resolveEffectiveProducerProductionMultiplier(modifierSet, producer.id);
        total = addFinite(total, applyProductionMultiplier(milestoneAdjusted, modifier), `${options.producerScope}ProductionPerSecond`);
    }

    return total;
}

export function calculateOnlineProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
): number {
    return calculateSustainedProductionPerSecond(repository, state, {
        producerScope: 'all',
        temporaryBoosts: 'include',
    });
}

export function calculateDurableProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
): number {
    return calculateSustainedProductionPerSecond(repository, state, {
        producerScope: 'all',
        temporaryBoosts: 'exclude',
    });
}

export function calculateOnlineAutomatedProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
): number {
    return calculateSustainedProductionPerSecond(repository, state, {
        producerScope: 'automated',
        temporaryBoosts: 'include',
    });
}

function createProductionModifierSet(
    repository: GameConfigRepository,
    state: GameState,
    temporaryBoosts: ProductionRateTemporaryBoostMode,
): ModifierSet {
    const durableModifierSets = [
        createBreakthroughModifierSet(repository, state),
        createPermanentUpgradeModifierSet(repository, state),
    ];

    if (temporaryBoosts === 'exclude') {
        return combineModifierSets(durableModifierSets);
    }

    return combineModifierSets([
        ...durableModifierSets,
        createTemporaryBoostModifierSet(state.boosts),
    ]);
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} addition exceeds JavaScript Number range.`);
    }
    return result;
}
