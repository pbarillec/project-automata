/**
 * AUT-GP-001 assisted production rules (owner decision 2026-11-11: reduced floor plus batch).
 *
 * - A producer with `assistedProduction` config (Assembly Station) that is built and not effectively
 *   automated runs at its floor fraction (applied in `ProductionRates`).
 * - While assisted, one batch at a time can be launched (no queue). It completes after the configured
 *   duration and pays `full rate × duration × (1 − floor)` through `economy/AssistedProduction`.
 * - Level 0, automation (Worker Bot) and A3 Inherited Automation (starts automated) make the batch
 *   unavailable. A batch already in flight still completes and pays.
 *
 * The in-flight batch lives in `GameState.run.assistedBatches`; only `GameRuntime` and the offline
 * settlement mutate it, always on drafts.
 */
import type { AssistedProductionConfig, GameConfigRepository } from '../config/ConfigLoader.ts';
import { calculateAssistedBatchPayout } from '../economy/index.ts';
import type { AssistedBatchRunState, GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import { resolveEffectiveProducerAutomationState } from './AutomationState.ts';
import {
    calculateSustainedProducerProductionRateContributions,
    type ProductionRateTemporaryBoostMode,
} from './ProductionRates.ts';

export const ASSEMBLY_STATION_PRODUCER_ID = 'assembly_station';
/** Remaining time at or below this counts as complete (floating-point segment arithmetic). */
export const ASSISTED_BATCH_COMPLETION_EPSILON_SECONDS = 1e-9;

export type AssistedBatchStatus = 'available' | 'running' | 'not_assisted' | 'not_built' | 'automated';

export interface AssistedBatchAvailability {
    readonly producerId: string;
    readonly status: AssistedBatchStatus;
    readonly config: AssistedProductionConfig | null;
    readonly batch: AssistedBatchRunState | null;
}

export type AssistedBatchLaunchResult =
    | {
        readonly status: 'launched';
        readonly state: GameState;
        readonly batch: AssistedBatchRunState;
    }
    | {
        readonly status: Exclude<AssistedBatchStatus, 'available'>;
        readonly availability: AssistedBatchAvailability;
    };

export interface AssistedBatchCompletion {
    readonly producerId: string;
    readonly durationSeconds: number;
    readonly payout: number;
}

export function resolveAssistedBatchAvailability(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): AssistedBatchAvailability {
    const config = repository.getProducer(producerId)?.assistedProduction ?? null;
    const batch = state.run.assistedBatches[producerId] ?? null;
    const result = (status: AssistedBatchStatus): AssistedBatchAvailability => Object.freeze({
        producerId,
        status,
        config,
        batch: batch === null ? null : { ...batch },
    });

    if (config === null) {
        return result('not_assisted');
    }

    const producerState = state.run.producers[producerId];
    if ((producerState?.level ?? 0) <= 0 || producerState?.isBuilt !== true) {
        return result('not_built');
    }

    if (resolveEffectiveProducerAutomationState(repository, state, producerId).isAutomated) {
        return result('automated');
    }

    return result(batch === null ? 'available' : 'running');
}

/** Returns a new state with the batch in flight; the input state is never mutated. */
export function launchAssistedBatch(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): AssistedBatchLaunchResult {
    const availability = resolveAssistedBatchAvailability(repository, state, producerId);
    if (availability.status !== 'available' || availability.config === null) {
        return Object.freeze({
            status: availability.status === 'available' ? 'not_assisted' : availability.status,
            availability,
        });
    }

    const batch: AssistedBatchRunState = {
        durationSeconds: availability.config.batchDurationSeconds,
        remainingSeconds: availability.config.batchDurationSeconds,
    };
    const draft = cloneGameState(state);
    draft.run.assistedBatches[producerId] = { ...batch };
    return Object.freeze({ status: 'launched', state: draft, batch });
}

/** Seconds until the next in-flight batch completes, or null when none is in flight. */
export function getSecondsUntilNextAssistedBatchCompletion(state: GameState): number | null {
    let next: number | null = null;
    for (const batch of Object.values(state.run.assistedBatches)) {
        next = next === null ? batch.remainingSeconds : Math.min(next, batch.remainingSeconds);
    }
    return next;
}

/**
 * Batch payout for `producerId` from the current state: its full (floor-free) rate with the given
 * temporary-boost mode, through the shared economy formula. 0 when the producer is no longer assisted
 * by config (data changed under an in-flight batch).
 */
export function calculateAssistedBatchPayoutForState(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
    durationSeconds: number,
    temporaryBoosts: ProductionRateTemporaryBoostMode,
): number {
    const config = repository.getProducer(producerId)?.assistedProduction;
    if (config === undefined) {
        return 0;
    }

    const fullRate = calculateSustainedProducerProductionRateContributions(repository, state, {
        producerScope: 'all',
        temporaryBoosts,
        assistedFloor: 'ignore',
    }).find((contribution) => contribution.producerId === producerId)?.productionPerSecond ?? 0;

    return calculateAssistedBatchPayout(fullRate, durationSeconds, config.floorFraction);
}

/**
 * Advances every in-flight batch of `draft` by `elapsedSeconds` (mutates the draft). Batches that
 * complete are removed and returned with their payout, computed from the draft before removal; the
 * caller credits the payout. Callers split elapsed time at completions so the rate is the segment's.
 */
export function advanceAssistedBatches(
    repository: GameConfigRepository,
    draft: GameState,
    elapsedSeconds: number,
    temporaryBoosts: ProductionRateTemporaryBoostMode,
): AssistedBatchCompletion[] {
    const completions: AssistedBatchCompletion[] = [];
    for (const producerId of Object.keys(draft.run.assistedBatches).sort()) {
        const batch = draft.run.assistedBatches[producerId];
        const remainingSeconds = batch.remainingSeconds - elapsedSeconds;
        if (remainingSeconds > ASSISTED_BATCH_COMPLETION_EPSILON_SECONDS) {
            batch.remainingSeconds = remainingSeconds;
            continue;
        }

        const payout = calculateAssistedBatchPayoutForState(repository, draft, producerId, batch.durationSeconds, temporaryBoosts);
        delete draft.run.assistedBatches[producerId];
        completions.push(Object.freeze({ producerId, durationSeconds: batch.durationSeconds, payout }));
    }
    return completions;
}
