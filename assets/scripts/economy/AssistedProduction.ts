/**
 * AUT-GP-001 assisted production formulas (owner decision 2026-11-11: reduced floor plus batch).
 *
 * Before its automating breakthrough, an assisted producer runs continuously at `floorFraction` of its
 * full rate. A launched batch of `batchDurationSeconds` pays the missing share in one completion payout:
 * `fullRatePerSecond × batchDurationSeconds × (1 − floorFraction)`. Floor plus a continuous chain of
 * batches therefore averages the full rate. Values come from `data/economy/producers.json`.
 */
import type { AssistedProductionConfig } from '../config/ConfigLoader.ts';

export class AssistedProductionInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'AssistedProductionInputError';
    }
}

/** Continuous rate of an assisted (not yet automated) producer. */
export function calculateAssistedFloorProductionPerSecond(
    fullProductionPerSecond: number,
    config: AssistedProductionConfig,
): number {
    validateFullRate(fullProductionPerSecond);
    validateAssistedProductionConfig(config);
    return assertFinite(fullProductionPerSecond * config.floorFraction, 'assisted floor productionPerSecond');
}

/** Industrial Output paid when one batch completes. */
export function calculateAssistedBatchPayout(
    fullProductionPerSecond: number,
    batchDurationSeconds: number,
    floorFraction: number,
): number {
    validateFullRate(fullProductionPerSecond);
    validateAssistedProductionConfig({ floorFraction, batchDurationSeconds });
    return assertFinite(fullProductionPerSecond * batchDurationSeconds * (1 - floorFraction), 'assisted batch payout');
}

export function validateAssistedProductionConfig(config: AssistedProductionConfig): void {
    if (typeof config.floorFraction !== 'number' || !Number.isFinite(config.floorFraction) ||
        config.floorFraction < 0 || config.floorFraction >= 1) {
        throw new AssistedProductionInputError('assisted floorFraction must be a finite number in [0, 1).');
    }

    if (typeof config.batchDurationSeconds !== 'number' || !Number.isFinite(config.batchDurationSeconds) ||
        config.batchDurationSeconds <= 0) {
        throw new AssistedProductionInputError('assisted batchDurationSeconds must be a positive finite number.');
    }
}

function validateFullRate(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new AssistedProductionInputError('full productionPerSecond must be a non-negative finite number.');
    }
}

function assertFinite(value: number, label: string): number {
    if (!Number.isFinite(value)) {
        throw new AssistedProductionInputError(`${label} exceeds JavaScript Number range.`);
    }
    return value;
}
