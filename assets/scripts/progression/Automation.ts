import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import {
    applyProductionMultiplier,
    calculateElapsedProduction,
    calculateMilestoneAdjustedProducerOutput,
    combineModifierSets,
    resolveEffectiveProducerProductionMultiplier,
} from '../economy/index.ts';
import type { GameState } from '../state/GameState.ts';
import { createBreakthroughModifierSet } from './Breakthroughs.ts';
import { resolveEffectiveProducerAutomationState } from './AutomationState.ts';
import { createTemporaryBoostModifierSet } from './TemporaryBoosts.ts';
import {
    createPermanentUpgradeModifierSet,
    resolvePermanentMilestonePowerBonus,
} from './PermanentUpgrades.ts';

export function calculateAutomatedProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
): number {
    const milestones = repository.listMilestones();
    const milestonePowerBonus = resolvePermanentMilestonePowerBonus(repository, state.meta);
    const modifierSet = combineModifierSets([
        createBreakthroughModifierSet(repository, state),
        createPermanentUpgradeModifierSet(repository, state),
        createTemporaryBoostModifierSet(state.boosts),
    ]);
    let total = 0;

    for (const producer of repository.listProducers()) {
        const automation = resolveEffectiveProducerAutomationState(repository, state, producer.id);
        if (!automation.isAutomated) {
            continue;
        }

        const level = state.run.producers[producer.id]?.level ?? 0;
        const milestoneAdjusted = calculateMilestoneAdjustedProducerOutput(producer, level, milestones, milestonePowerBonus);
        const modifier = resolveEffectiveProducerProductionMultiplier(modifierSet, producer.id);
        total = addFinite(total, applyProductionMultiplier(milestoneAdjusted, modifier), 'automatedProductionPerSecond');
    }

    return total;
}

export function calculateAutomatedProductionForElapsedSeconds(
    repository: GameConfigRepository,
    state: GameState,
    elapsedSeconds: number,
): number {
    return calculateElapsedProduction(
        calculateAutomatedProductionPerSecond(repository, state),
        elapsedSeconds,
    );
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} addition exceeds JavaScript Number range.`);
    }
    return result;
}

