import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameState } from '../state/GameState.ts';

export const MANUAL_WORKSHOP_ERA_ID = 'manual_workshop';
export const AUTOMATED_FACTORY_ERA_ID = 'automated_factory';
export const ROBOTICS_COMPLEX_ERA_ID = 'robotics_complex';

export class EraProgressionInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'EraProgressionInputError';
    }
}

export interface EraTransitionResult {
    readonly changed: boolean;
    readonly oldEraId: string | null;
    readonly newEraId: string;
}

export function isCurrentEraAtLeast(
    repository: GameConfigRepository,
    state: GameState,
    requiredEraId: string,
): boolean {
    const currentEraId = state.run.currentEraId;
    if (currentEraId === null) {
        return false;
    }

    return getEraOrder(repository, currentEraId) >= getEraOrder(repository, requiredEraId);
}

export function isEraAtLeast(
    repository: GameConfigRepository,
    eraId: string,
    requiredEraId: string,
): boolean {
    return getEraOrder(repository, eraId) >= getEraOrder(repository, requiredEraId);
}

export function applyEraTransition(
    repository: GameConfigRepository,
    state: GameState,
    targetEraId: string,
): EraTransitionResult {
    const oldEraId = state.run.currentEraId;
    const targetOrder = getEraOrder(repository, targetEraId);

    if (oldEraId !== null) {
        const oldOrder = getEraOrder(repository, oldEraId);
        if (targetOrder <= oldOrder) {
            return {
                changed: false,
                oldEraId,
                newEraId: oldEraId,
            };
        }
    }

    state.run.currentEraId = targetEraId;
    return {
        changed: true,
        oldEraId,
        newEraId: targetEraId,
    };
}

export function getEraOrder(repository: GameConfigRepository, eraId: string): number {
    if (typeof eraId !== 'string' || eraId.length === 0) {
        throw new EraProgressionInputError('eraId must be a non-empty string.');
    }

    const era = repository.getEra(eraId);
    if (era === undefined) {
        throw new EraProgressionInputError(`unknown era id "${eraId}".`);
    }

    return era.order;
}

