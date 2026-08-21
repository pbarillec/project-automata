import type { ProducerConfig } from '../config/ConfigLoader.ts';

export const PRODUCER_COST_RELATIVE_TOLERANCE = 32 * Number.EPSILON;
export const PRODUCER_COST_ABSOLUTE_TOLERANCE = 1e-12;

export interface ProducerPurchaseCost {
    producerId: string;
    currentLevel: number;
    quantity: number;
    nextLevel: number;
    cost: number;
}

export interface MaxAffordableProducerPurchase {
    producerId: string;
    currentLevel: number;
    quantity: number;
    nextLevel: number;
    cost: number;
}

export class ProducerCostInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'ProducerCostInputError';
    }
}

export function calculateNextProducerLevelCost(producer: ProducerConfig, currentLevel: number): number {
    return calculateProducerBulkPurchaseCost(producer, currentLevel, 1);
}

export function calculateProducerBulkPurchaseCost(producer: ProducerConfig, currentLevel: number, quantity: number): number {
    return calculateProducerPurchaseCost(producer, currentLevel, quantity).cost;
}

export function calculateProducerPurchaseCost(producer: ProducerConfig, currentLevel: number, quantity: number): ProducerPurchaseCost {
    validateProducerCostConfig(producer);
    validateCurrentLevel(currentLevel);
    validatePurchaseQuantity(quantity);
    validateSafeNextLevel(currentLevel, quantity);

    const cost = calculateBulkCostUnchecked(producer.baseCost, producer.costGrowth, currentLevel, quantity);
    assertFiniteCost(cost, producer.id, currentLevel, quantity);

    return {
        producerId: producer.id,
        currentLevel,
        quantity,
        nextLevel: currentLevel + quantity,
        cost,
    };
}

export function calculateMaxAffordableProducerPurchase(
    producer: ProducerConfig,
    currentLevel: number,
    balance: number,
): MaxAffordableProducerPurchase {
    validateProducerCostConfig(producer);
    validateCurrentLevel(currentLevel);
    validateBalance(balance);

    const maxSafeQuantity = Number.MAX_SAFE_INTEGER - currentLevel;
    if (maxSafeQuantity < 1) {
        throw new ProducerCostInputError(`currentLevel ${currentLevel} cannot be increased without exceeding Number.MAX_SAFE_INTEGER.`);
    }

    const nextLevelCost = calculateBulkCostUnchecked(producer.baseCost, producer.costGrowth, currentLevel, 1);
    assertFiniteCost(nextLevelCost, producer.id, currentLevel, 1);

    if (!isAffordableCost(nextLevelCost, balance)) {
        return {
            producerId: producer.id,
            currentLevel,
            quantity: 0,
            nextLevel: currentLevel,
            cost: 0,
        };
    }

    const estimatedQuantity = estimateAffordableQuantity(producer.baseCost, producer.costGrowth, currentLevel, balance);
    const initialHigh = Number.isFinite(estimatedQuantity)
        ? Math.min(maxSafeQuantity, Math.max(1, Math.ceil(estimatedQuantity) + 2))
        : maxSafeQuantity;

    const upperBound = findUnaffordableUpperBound(producer, currentLevel, balance, initialHigh, maxSafeQuantity);
    const quantity = findLargestAffordableQuantity(producer, currentLevel, balance, upperBound.low, upperBound.high);
    const cost = calculateBulkCostUnchecked(producer.baseCost, producer.costGrowth, currentLevel, quantity);
    assertFiniteCost(cost, producer.id, currentLevel, quantity);

    return {
        producerId: producer.id,
        currentLevel,
        quantity,
        nextLevel: currentLevel + quantity,
        cost,
    };
}

export function isProducerCostAffordable(cost: number, balance: number): boolean {
    if (!Number.isFinite(cost) || cost < 0) {
        throw new ProducerCostInputError('cost must be a non-negative finite number.');
    }

    validateBalance(balance);
    return isAffordableCost(cost, balance);
}

function validateProducerCostConfig(producer: ProducerConfig): void {
    if (typeof producer !== 'object' || producer === null) {
        throw new ProducerCostInputError('producer config is required.');
    }

    const producerId = typeof producer.id === 'string' && producer.id.length > 0 ? producer.id : '<unknown>';

    if (!Number.isFinite(producer.baseCost) || producer.baseCost <= 0) {
        throw new ProducerCostInputError(`producer ${producerId} baseCost must be a positive finite number.`);
    }

    if (!Number.isFinite(producer.costGrowth) || producer.costGrowth <= 1) {
        throw new ProducerCostInputError(`producer ${producerId} costGrowth must be a finite number greater than 1.`);
    }
}

function validateCurrentLevel(currentLevel: number): void {
    if (!Number.isSafeInteger(currentLevel) || currentLevel < 0) {
        throw new ProducerCostInputError('currentLevel must be a non-negative safe integer.');
    }
}

function validatePurchaseQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new ProducerCostInputError('quantity must be a positive safe integer.');
    }
}

function validateBalance(balance: number): void {
    if (!Number.isFinite(balance) || balance < 0) {
        throw new ProducerCostInputError('balance must be a non-negative finite number.');
    }
}

function validateSafeNextLevel(currentLevel: number, quantity: number): void {
    if (quantity > Number.MAX_SAFE_INTEGER - currentLevel) {
        throw new ProducerCostInputError('purchase would exceed Number.MAX_SAFE_INTEGER for producer level.');
    }
}

function calculateBulkCostUnchecked(baseCost: number, costGrowth: number, currentLevel: number, quantity: number): number {
    const firstLevelCost = baseCost * Math.pow(costGrowth, currentLevel);
    if (!Number.isFinite(firstLevelCost)) {
        return Number.POSITIVE_INFINITY;
    }

    const seriesFactor = calculateGeometricSeriesFactor(costGrowth, quantity);
    return firstLevelCost * seriesFactor;
}

function calculateGeometricSeriesFactor(costGrowth: number, quantity: number): number {
    if (quantity === 1) {
        return 1;
    }

    return Math.expm1(quantity * Math.log(costGrowth)) / (costGrowth - 1);
}

function estimateAffordableQuantity(baseCost: number, costGrowth: number, currentLevel: number, balance: number): number {
    const firstLevelCost = baseCost * Math.pow(costGrowth, currentLevel);
    if (!Number.isFinite(firstLevelCost) || firstLevelCost <= 0) {
        return Number.POSITIVE_INFINITY;
    }

    const inverseArgument = 1 + (balance * (costGrowth - 1)) / firstLevelCost;
    if (!Number.isFinite(inverseArgument)) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.floor(Math.log(inverseArgument) / Math.log(costGrowth));
}

function findUnaffordableUpperBound(
    producer: ProducerConfig,
    currentLevel: number,
    balance: number,
    initialHigh: number,
    maxSafeQuantity: number,
): { low: number; high: number } {
    let low = 0;
    let high = Math.max(1, Math.min(maxSafeQuantity, initialHigh));

    while (isQuantityAffordable(producer, currentLevel, high, balance)) {
        low = high;
        if (high === maxSafeQuantity) {
            return { low: high, high };
        }

        high = Math.min(maxSafeQuantity, Math.max(high + 1, Math.floor(high * 2)));
    }

    return { low, high };
}

function findLargestAffordableQuantity(
    producer: ProducerConfig,
    currentLevel: number,
    balance: number,
    knownAffordableLow: number,
    knownUnaffordableOrMaxHigh: number,
): number {
    let low = knownAffordableLow;
    let high = knownUnaffordableOrMaxHigh;

    if (low === high) {
        return low;
    }

    while (high - low > 1) {
        const midpoint = low + Math.floor((high - low) / 2);
        if (isQuantityAffordable(producer, currentLevel, midpoint, balance)) {
            low = midpoint;
        }
        else {
            high = midpoint;
        }
    }

    return low;
}

function isQuantityAffordable(producer: ProducerConfig, currentLevel: number, quantity: number, balance: number): boolean {
    const cost = calculateBulkCostUnchecked(producer.baseCost, producer.costGrowth, currentLevel, quantity);
    return Number.isFinite(cost) && isAffordableCost(cost, balance);
}

function isAffordableCost(cost: number, balance: number): boolean {
    return cost <= balance || Math.abs(cost - balance) <= costTolerance(cost, balance);
}

function costTolerance(cost: number, balance: number): number {
    return Math.max(
        PRODUCER_COST_ABSOLUTE_TOLERANCE,
        PRODUCER_COST_RELATIVE_TOLERANCE * Math.max(1, Math.abs(cost), Math.abs(balance)),
    );
}

function assertFiniteCost(cost: number, producerId: string, currentLevel: number, quantity: number): void {
    if (!Number.isFinite(cost)) {
        throw new ProducerCostInputError(
            `producer ${producerId} cost overflows JavaScript Number range for currentLevel ${currentLevel} and quantity ${quantity}.`,
        );
    }
}
