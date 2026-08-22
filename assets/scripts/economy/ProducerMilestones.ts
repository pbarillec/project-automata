import type { ProducerConfig, ProducerMilestoneConfig } from '../config/ConfigLoader.ts';
import { calculateProducerBaseOutput } from './ProducerProduction.ts';

export interface CrossedProducerMilestone {
    id: string;
    threshold: number;
    productionMultiplier: number;
    cumulativeMultiplierAfterCrossing: number;
}

export class ProducerMilestoneInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'ProducerMilestoneInputError';
    }
}

export function calculateCumulativeMilestoneMultiplier(
    milestones: readonly ProducerMilestoneConfig[],
    level: number,
): number {
    validateMilestoneCollection(milestones);
    validateMilestoneLevel(level, 'level');

    let multiplier = 1;
    for (const milestone of milestones) {
        if (level >= milestone.threshold) {
            multiplier = multiplyFinite(multiplier, milestone.productionMultiplier, 'cumulative milestone multiplier');
        }
    }

    return multiplier;
}

export function resolveCrossedProducerMilestones(
    milestones: readonly ProducerMilestoneConfig[],
    oldLevel: number,
    newLevel: number,
): CrossedProducerMilestone[] {
    validateMilestoneCollection(milestones);
    validateMilestoneLevel(oldLevel, 'oldLevel');
    validateMilestoneLevel(newLevel, 'newLevel');

    if (oldLevel >= newLevel) {
        return [];
    }

    let cumulativeMultiplier = 1;
    const crossedMilestones: CrossedProducerMilestone[] = [];

    for (const milestone of milestones) {
        if (oldLevel >= milestone.threshold) {
            cumulativeMultiplier = multiplyFinite(cumulativeMultiplier, milestone.productionMultiplier, 'cumulative milestone multiplier');
            continue;
        }

        if (newLevel >= milestone.threshold) {
            cumulativeMultiplier = multiplyFinite(cumulativeMultiplier, milestone.productionMultiplier, 'cumulative milestone multiplier');
            crossedMilestones.push({
                id: milestone.id,
                threshold: milestone.threshold,
                productionMultiplier: milestone.productionMultiplier,
                cumulativeMultiplierAfterCrossing: cumulativeMultiplier,
            });
        }
    }

    return crossedMilestones;
}

export function calculateMilestoneAdjustedProducerOutput(
    producer: ProducerConfig,
    level: number,
    milestones: readonly ProducerMilestoneConfig[],
): number {
    const baseOutput = calculateProducerBaseOutput(producer, level);
    const milestoneMultiplier = calculateCumulativeMilestoneMultiplier(milestones, level);
    return multiplyFinite(baseOutput, milestoneMultiplier, `producer ${producer.id} milestone-adjusted output`);
}

export function calculateTotalMilestoneAdjustedProductionPerSecond(
    producers: readonly ProducerConfig[],
    levelsByProducerId: Readonly<Record<string, number>>,
    milestones: readonly ProducerMilestoneConfig[],
): number {
    validateProducerCollection(producers);
    validateProducerLevelRecord(levelsByProducerId);
    validateMilestoneCollection(milestones);

    const producerIds = new Set(producers.map((producer) => producer.id));
    for (const producerId of Object.keys(levelsByProducerId).sort()) {
        if (!producerIds.has(producerId)) {
            throw new ProducerMilestoneInputError(`producer level map contains unknown producer id "${producerId}".`);
        }
    }

    let total = 0;
    for (const producer of producers) {
        const level = levelsByProducerId[producer.id] ?? 0;
        const output = calculateMilestoneAdjustedProducerOutput(producer, level, milestones);
        total = addFinite(total, output, 'total milestone-adjusted productionPerSecond');
    }

    return total;
}

function validateMilestoneCollection(milestones: readonly ProducerMilestoneConfig[]): void {
    if (!Array.isArray(milestones)) {
        throw new ProducerMilestoneInputError('milestones must be an array.');
    }

    const seenIds = new Set<string>();
    let previousThreshold = Number.NEGATIVE_INFINITY;

    for (const milestone of milestones) {
        validateMilestoneConfig(milestone);

        if (seenIds.has(milestone.id)) {
            throw new ProducerMilestoneInputError(`duplicate milestone id "${milestone.id}".`);
        }
        seenIds.add(milestone.id);

        if (milestone.threshold <= previousThreshold) {
            throw new ProducerMilestoneInputError('milestone thresholds must be strictly ascending.');
        }

        previousThreshold = milestone.threshold;
    }
}

function validateMilestoneConfig(milestone: ProducerMilestoneConfig): void {
    if (typeof milestone !== 'object' || milestone === null) {
        throw new ProducerMilestoneInputError('milestone config is required.');
    }

    if (typeof milestone.id !== 'string' || milestone.id.length === 0) {
        throw new ProducerMilestoneInputError('milestone id must be a non-empty string.');
    }

    if (!Number.isSafeInteger(milestone.threshold) || milestone.threshold <= 0) {
        throw new ProducerMilestoneInputError(`milestone ${milestone.id} threshold must be a positive safe integer.`);
    }

    if (!Number.isFinite(milestone.productionMultiplier) || milestone.productionMultiplier <= 0) {
        throw new ProducerMilestoneInputError(`milestone ${milestone.id} productionMultiplier must be a positive finite number.`);
    }
}

function validateMilestoneLevel(level: number, label: string): void {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new ProducerMilestoneInputError(`${label} must be a non-negative safe integer.`);
    }
}

function validateProducerCollection(producers: readonly ProducerConfig[]): void {
    if (!Array.isArray(producers)) {
        throw new ProducerMilestoneInputError('producers must be an array.');
    }

    const seenIds = new Set<string>();
    for (const producer of producers) {
        if (typeof producer !== 'object' || producer === null) {
            throw new ProducerMilestoneInputError('producer config is required.');
        }
        if (typeof producer.id !== 'string' || producer.id.length === 0) {
            throw new ProducerMilestoneInputError('producer id must be a non-empty string.');
        }
        if (seenIds.has(producer.id)) {
            throw new ProducerMilestoneInputError(`duplicate producer config id "${producer.id}".`);
        }
        seenIds.add(producer.id);
    }
}

function validateProducerLevelRecord(levelsByProducerId: Readonly<Record<string, number>>): void {
    if (!isPlainRecord(levelsByProducerId)) {
        throw new ProducerMilestoneInputError('levelsByProducerId must be a plain producer id to level record.');
    }

    for (const [producerId, level] of Object.entries(levelsByProducerId)) {
        if (producerId.length === 0) {
            throw new ProducerMilestoneInputError('producer level map cannot contain an empty producer id.');
        }
        validateMilestoneLevel(level, `producer ${producerId} level`);
    }
}

function addFinite(left: number, right: number, label: string): number {
    const total = left + right;
    if (!Number.isFinite(total)) {
        throw new ProducerMilestoneInputError(`${label} exceeds JavaScript Number range.`);
    }
    return total;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const product = left * right;
    if (!Number.isFinite(product)) {
        throw new ProducerMilestoneInputError(`${label} exceeds JavaScript Number range.`);
    }
    return product;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, number>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
