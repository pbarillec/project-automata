import type { ProducerConfig } from '../config/ConfigLoader.ts';

export const PRODUCER_PRODUCTION_RELATIVE_TOLERANCE = 32 * Number.EPSILON;
export const PRODUCER_PRODUCTION_ABSOLUTE_TOLERANCE = 1e-12;

export type ProducerLevelMap = Readonly<Record<string, number>>;

export class ProducerProductionInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'ProducerProductionInputError';
    }
}

export function calculateProducerBaseOutput(producer: ProducerConfig, level: number): number {
    validateProducerProductionConfig(producer);
    validateProducerLevel(level, `producer ${producer.id} level`);

    const output = producer.baseProductionPerLevel * level;
    assertFiniteProduction(output, `producer ${producer.id} base output`);
    return output;
}

export function calculateTotalProductionPerSecond(producers: readonly ProducerConfig[], levelsByProducerId: ProducerLevelMap): number {
    validateProducerCollection(producers);
    validateProducerLevelMap(levelsByProducerId);

    const producerIds = new Set(producers.map((producer) => producer.id));
    for (const producerId of Object.keys(levelsByProducerId).sort()) {
        if (!producerIds.has(producerId)) {
            throw new ProducerProductionInputError(`producer level map contains unknown producer id "${producerId}".`);
        }
    }

    let total = 0;
    for (const producer of producers) {
        validateProducerProductionConfig(producer);
        const level = levelsByProducerId[producer.id] ?? 0;
        validateProducerLevel(level, `producer ${producer.id} level`);
        total = addFiniteProduction(total, calculateProducerBaseOutput(producer, level), 'total productionPerSecond');
    }

    return total;
}

export function calculateElapsedProduction(productionPerSecond: number, elapsedSeconds: number): number {
    validateProductionPerSecond(productionPerSecond);
    validateElapsedSeconds(elapsedSeconds);

    const produced = productionPerSecond * elapsedSeconds;
    assertFiniteProduction(produced, 'elapsed production');
    return produced;
}

export function calculateElapsedProductionFromProducers(
    producers: readonly ProducerConfig[],
    levelsByProducerId: ProducerLevelMap,
    elapsedSeconds: number,
): number {
    return calculateElapsedProduction(
        calculateTotalProductionPerSecond(producers, levelsByProducerId),
        elapsedSeconds,
    );
}

export function isProductionApproximatelyEqual(left: number, right: number): boolean {
    validateComparableProduction(left, 'left production value');
    validateComparableProduction(right, 'right production value');
    return Math.abs(left - right) <= productionTolerance(left, right);
}

function validateProducerCollection(producers: readonly ProducerConfig[]): void {
    if (!Array.isArray(producers)) {
        throw new ProducerProductionInputError('producers must be an array.');
    }

    const seenIds = new Set<string>();
    for (const producer of producers) {
        validateProducerProductionConfig(producer);
        if (seenIds.has(producer.id)) {
            throw new ProducerProductionInputError(`duplicate producer config id "${producer.id}".`);
        }
        seenIds.add(producer.id);
    }
}

function validateProducerProductionConfig(producer: ProducerConfig): void {
    if (typeof producer !== 'object' || producer === null) {
        throw new ProducerProductionInputError('producer config is required.');
    }

    const producerId = typeof producer.id === 'string' && producer.id.length > 0 ? producer.id : '<unknown>';

    if (typeof producer.id !== 'string' || producer.id.length === 0) {
        throw new ProducerProductionInputError('producer id must be a non-empty string.');
    }

    if (!Number.isFinite(producer.baseProductionPerLevel) || producer.baseProductionPerLevel <= 0) {
        throw new ProducerProductionInputError(`producer ${producerId} baseProductionPerLevel must be a positive finite number.`);
    }
}

function validateProducerLevelMap(levelsByProducerId: ProducerLevelMap): void {
    if (!isPlainRecord(levelsByProducerId)) {
        throw new ProducerProductionInputError('levelsByProducerId must be a plain producer id to level record.');
    }

    for (const [producerId, level] of Object.entries(levelsByProducerId)) {
        if (producerId.length === 0) {
            throw new ProducerProductionInputError('producer level map cannot contain an empty producer id.');
        }
        validateProducerLevel(level, `producer ${producerId} level`);
    }
}

function validateProducerLevel(level: number, label: string): void {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new ProducerProductionInputError(`${label} must be a non-negative safe integer.`);
    }
}

function validateProductionPerSecond(productionPerSecond: number): void {
    if (!Number.isFinite(productionPerSecond) || productionPerSecond < 0) {
        throw new ProducerProductionInputError('productionPerSecond must be a non-negative finite number.');
    }
}

function validateElapsedSeconds(elapsedSeconds: number): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
        throw new ProducerProductionInputError('elapsedSeconds must be a non-negative finite number.');
    }
}

function validateComparableProduction(value: number, label: string): void {
    if (!Number.isFinite(value)) {
        throw new ProducerProductionInputError(`${label} must be finite.`);
    }
}

function addFiniteProduction(left: number, right: number, label: string): number {
    const total = left + right;
    assertFiniteProduction(total, label);
    return total;
}

function assertFiniteProduction(value: number, label: string): void {
    if (!Number.isFinite(value)) {
        throw new ProducerProductionInputError(`${label} exceeds JavaScript Number range.`);
    }
}

function productionTolerance(left: number, right: number): number {
    return Math.max(
        PRODUCER_PRODUCTION_ABSOLUTE_TOLERANCE,
        PRODUCER_PRODUCTION_RELATIVE_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right)),
    );
}

function isPlainRecord(value: unknown): value is ProducerLevelMap {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
