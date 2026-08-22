import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { AutomationRunState, GameState } from '../state/GameState.ts';
import { AUTOMATED_FACTORY_ERA_ID, isEraAtLeast } from './EraProgression.ts';

export class AutomationStateInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'AutomationStateInputError';
    }
}

export function resolveEffectiveProducerAutomationState(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): AutomationRunState {
    validateProducerId(producerId);
    const producer = repository.getProducer(producerId);
    if (producer === undefined) {
        throw new AutomationStateInputError(`unknown producer id "${producerId}".`);
    }

    const producerState = state.run.producers[producerId];
    if ((producerState?.level ?? 0) <= 0 || producerState?.isBuilt !== true) {
        return createManualAutomationState();
    }

    const explicitAutomation = state.run.automation[producerId];
    if (explicitAutomation !== undefined) {
        return {
            isAutomated: explicitAutomation.isAutomated,
            isOfflineEligible: explicitAutomation.isOfflineEligible,
            unlockedByBreakthroughId: explicitAutomation.unlockedByBreakthroughId,
        };
    }

    if (hasPermanentStartAutomatedEffect(repository, state, producerId)) {
        return {
            isAutomated: true,
            isOfflineEligible: true,
            unlockedByBreakthroughId: null,
        };
    }

    if (isProducerDefaultAutomatedWhenBuilt(repository, producerId)) {
        return {
            isAutomated: true,
            isOfflineEligible: true,
            unlockedByBreakthroughId: null,
        };
    }

    return createManualAutomationState();
}

export function applyDefaultAutomationForConstructedProducer(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
    breakthroughId: string | null = null,
): boolean {
    if (state.run.automation[producerId] !== undefined) {
        return false;
    }

    if (!hasPermanentStartAutomatedEffect(repository, state, producerId) && !isProducerDefaultAutomatedWhenBuilt(repository, producerId)) {
        return false;
    }

    state.run.automation[producerId] = {
        isAutomated: true,
        isOfflineEligible: true,
        unlockedByBreakthroughId: breakthroughId,
    };
    return true;
}

function hasPermanentStartAutomatedEffect(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): boolean {
    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = state.meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (!Number.isInteger(rank) || rank <= 0) {
            continue;
        }

        for (const effect of upgrade.effects) {
            if (effect.type === 'producerStartsAutomatedOnceConstructed' && effect.producerId === producerId) {
                return true;
            }
        }
    }

    return false;
}

export function isProducerDefaultAutomatedWhenBuilt(
    repository: GameConfigRepository,
    producerId: string,
): boolean {
    validateProducerId(producerId);
    const producer = repository.getProducer(producerId);
    if (producer === undefined) {
        throw new AutomationStateInputError(`unknown producer id "${producerId}".`);
    }

    return isEraAtLeast(repository, producer.eraId, AUTOMATED_FACTORY_ERA_ID);
}

function createManualAutomationState(): AutomationRunState {
    return {
        isAutomated: false,
        isOfflineEligible: false,
        unlockedByBreakthroughId: null,
    };
}

function validateProducerId(producerId: string): void {
    if (typeof producerId !== 'string' || producerId.length === 0) {
        throw new AutomationStateInputError('producerId must be a non-empty string.');
    }
}

