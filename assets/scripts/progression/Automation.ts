import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import { calculateElapsedProduction } from '../economy/index.ts';
import type { GameState } from '../state/GameState.ts';
import { calculateOnlineAutomatedProductionPerSecond } from './ProductionRates.ts';

export function calculateAutomatedProductionPerSecond(
    repository: GameConfigRepository,
    state: GameState,
): number {
    return calculateOnlineAutomatedProductionPerSecond(repository, state);
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

