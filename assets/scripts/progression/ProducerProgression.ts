import type { GameConfigRepository, ProducerConfig } from '../config/ConfigLoader.ts';
import {
    calculateMaxAffordableProducerPurchase,
    calculateProducerPurchaseCost,
} from '../economy/ProducerCost.ts';
import type { GameState, MetaState } from '../state/GameState.ts';
import {
    applyNewProducerConstructionCostMultiplier,
    resolveEffectiveMajorRequirement,
    resolveNewProducerConstructionCostMultiplier,
} from './PermanentUpgrades.ts';

export const ROBOT_LINE_PRODUCER_ID = 'robot_line';
export const ROBOT_LINE_CONSTRUCTION_COST = 500000;

export type ProducerBuildProgressionStatus =
    | 'available'
    | 'locked'
    | 'already_built'
    | 'unknown_producer';

export type ProducerBuildBlockingRequirement =
    | {
        readonly type: 'producerBuilt';
        readonly producerId: string;
        readonly isBuilt: boolean;
    }
    | {
        readonly type: 'producerLevel';
        readonly producerId: string;
        readonly level: number;
        readonly currentLevel: number;
    }
    | {
        readonly type: 'breakthroughOwned';
        readonly breakthroughId: string;
        readonly isOwned: boolean;
    }
    | {
        readonly type: 'breakthroughConstruction';
        readonly breakthroughId: string;
        readonly isOwned: boolean;
    };

export interface ProducerProgressionPurchasePreview {
    readonly producerId: string;
    readonly currentLevel: number;
    readonly quantity: number;
    readonly nextLevel: number;
    readonly cost: number;
}

export interface ProducerBuildProgressionResult {
    readonly status: ProducerBuildProgressionStatus;
    readonly producerId: string;
    readonly currentLevel: number;
    readonly targetLevel: number | null;
    readonly cost: number | null;
    readonly balance: number;
    readonly isAffordable: boolean;
    readonly blockingRequirements: readonly ProducerBuildBlockingRequirement[];
}

export class ProducerProgressionInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'ProducerProgressionInputError';
    }
}

export function evaluateProducerBuildProgression(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): ProducerBuildProgressionResult {
    validateProducerId(producerId);
    const balance = readBalance(state);
    const producer = repository.getProducer(producerId);
    const currentLevel = getProducerLevel(state, producerId);

    if (producer === undefined) {
        return freezeBuildResult({
            status: 'unknown_producer',
            producerId,
            currentLevel,
            targetLevel: null,
            cost: null,
            balance,
            isAffordable: false,
            blockingRequirements: [],
        });
    }

    if (isProducerBuilt(state, producerId)) {
        return freezeBuildResult({
            status: 'already_built',
            producerId,
            currentLevel,
            targetLevel: currentLevel,
            cost: null,
            balance,
            isAffordable: false,
            blockingRequirements: [],
        });
    }

    const purchase = calculateProducerProgressionPurchase(repository, state.meta, producer, currentLevel, 1);
    const blockingRequirements = resolveProducerBuildBlockingRequirements(repository, state, producer);

    return freezeBuildResult({
        status: blockingRequirements.length > 0 ? 'locked' : 'available',
        producerId,
        currentLevel,
        targetLevel: purchase.nextLevel,
        cost: purchase.cost,
        balance,
        isAffordable: purchase.cost <= balance,
        blockingRequirements,
    });
}

export function calculateProducerProgressionPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    currentLevel: number,
    quantity: number,
): ProducerProgressionPurchasePreview {
    if (!isRobotLineConstructionPurchase(producer.id, currentLevel)) {
        if (currentLevel === 0) {
            return calculateConstructionAdjustedProducerPurchase(repository, meta, producer, quantity);
        }
        return calculateProducerPurchaseCost(producer, currentLevel, quantity);
    }

    const constructionCost = applyNewProducerConstructionCostMultiplier(repository, meta, ROBOT_LINE_CONSTRUCTION_COST);
    if (quantity === 1) {
        return {
            producerId: producer.id,
            currentLevel,
            quantity,
            nextLevel: 1,
            cost: constructionCost,
        };
    }

    const additionalLevels = calculateProducerPurchaseCost(producer, 1, quantity - 1);
    return {
        producerId: producer.id,
        currentLevel,
        quantity,
        nextLevel: quantity,
        cost: addFinite(constructionCost, additionalLevels.cost, 'robotLineConstructionCost'),
    };
}

export function calculateMaxAffordableProducerProgressionPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    currentLevel: number,
    balance: number,
): ProducerProgressionPurchasePreview {
    if (!isRobotLineConstructionPurchase(producer.id, currentLevel)) {
        if (currentLevel === 0) {
            return calculateMaxAffordableConstructionAdjustedProducerPurchase(repository, meta, producer, balance);
        }
        return calculateMaxAffordableProducerPurchase(producer, currentLevel, balance);
    }

    const constructionCost = applyNewProducerConstructionCostMultiplier(repository, meta, ROBOT_LINE_CONSTRUCTION_COST);
    if (balance < constructionCost) {
        return {
            producerId: producer.id,
            currentLevel,
            quantity: 0,
            nextLevel: currentLevel,
            cost: 0,
        };
    }

    const additionalLevels = calculateMaxAffordableProducerPurchase(
        producer,
        1,
        balance - constructionCost,
    );
    const quantity = 1 + additionalLevels.quantity;

    return {
        producerId: producer.id,
        currentLevel,
        quantity,
        nextLevel: quantity,
        cost: addFinite(constructionCost, additionalLevels.cost, 'robotLineConstructionCost'),
    };
}

export function isProducerBuilt(state: GameState, producerId: string): boolean {
    validateProducerId(producerId);
    const producer = state.run.producers[producerId];
    return producer !== undefined && producer.isBuilt && producer.level > 0;
}

export function getProgressionProducerLevel(state: GameState, producerId: string): number {
    validateProducerId(producerId);
    return getProducerLevel(state, producerId);
}

function resolveProducerBuildBlockingRequirements(
    repository: GameConfigRepository,
    state: GameState,
    producer: ProducerConfig,
): ProducerBuildBlockingRequirement[] {
    const blockingRequirements: ProducerBuildBlockingRequirement[] = [];

    for (const prerequisiteProducerId of producer.prerequisiteProducerIds) {
        if (!isProducerBuilt(state, prerequisiteProducerId)) {
            blockingRequirements.push({
                type: 'producerBuilt',
                producerId: prerequisiteProducerId,
                isBuilt: false,
            });
        }
    }

    if (producer.id === ROBOT_LINE_PRODUCER_ID) {
        blockingRequirements.push(...resolveRobotLineBlockingRequirements(repository, state));
    }

    for (const breakthroughId of getConstructingBreakthroughIds(repository, producer.id)) {
        blockingRequirements.push({
            type: 'breakthroughConstruction',
            breakthroughId,
            isOwned: state.run.purchasedBreakthroughIds.includes(breakthroughId),
        });
    }

    return blockingRequirements;
}

function resolveRobotLineBlockingRequirements(
    repository: GameConfigRepository,
    state: GameState,
): ProducerBuildBlockingRequirement[] {
    const requiredFabricatorLevel = resolveEffectiveMajorRequirement(repository, state.meta, 50);
    const requiredAssemblyLevel = resolveEffectiveMajorRequirement(repository, state.meta, 25);
    const requiredBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics'];
    const blockingRequirements: ProducerBuildBlockingRequirement[] = [];

    for (const breakthroughId of requiredBreakthroughIds) {
        if (!state.run.purchasedBreakthroughIds.includes(breakthroughId)) {
            blockingRequirements.push({
                type: 'breakthroughOwned',
                breakthroughId,
                isOwned: false,
            });
        }
    }

    for (const requirement of [
        { producerId: 'fabricator', level: requiredFabricatorLevel },
        { producerId: 'assembly_station', level: requiredAssemblyLevel },
    ]) {
        const currentLevel = getProducerLevel(state, requirement.producerId);
        if (currentLevel < requirement.level) {
            blockingRequirements.push({
                type: 'producerLevel',
                producerId: requirement.producerId,
                level: requirement.level,
                currentLevel,
            });
        }
    }

    return blockingRequirements;
}

function getConstructingBreakthroughIds(repository: GameConfigRepository, producerId: string): string[] {
    return repository.listBreakthroughs()
        .filter((breakthrough) => breakthrough.effects.some((effect) => (
            effect.type === 'constructProducer' && effect.producerId === producerId
        )))
        .map((breakthrough) => breakthrough.id)
        .sort((left, right) => left.localeCompare(right));
}

function calculateConstructionAdjustedProducerPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    quantity: number,
): ProducerProgressionPurchasePreview {
    const constructionMultiplier = resolveNewProducerConstructionCostMultiplier(repository, meta);
    if (constructionMultiplier === 1) {
        return calculateProducerPurchaseCost(producer, 0, quantity);
    }

    const constructionCost = producer.baseCost * constructionMultiplier;
    if (quantity === 1) {
        return {
            producerId: producer.id,
            currentLevel: 0,
            quantity,
            nextLevel: 1,
            cost: constructionCost,
        };
    }

    const additionalLevels = calculateProducerPurchaseCost(producer, 1, quantity - 1);
    return {
        producerId: producer.id,
        currentLevel: 0,
        quantity,
        nextLevel: quantity,
        cost: addFinite(constructionCost, additionalLevels.cost, `${producer.id}ConstructionCost`),
    };
}

function calculateMaxAffordableConstructionAdjustedProducerPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    balance: number,
): ProducerProgressionPurchasePreview {
    const constructionMultiplier = resolveNewProducerConstructionCostMultiplier(repository, meta);
    if (constructionMultiplier === 1) {
        return calculateMaxAffordableProducerPurchase(producer, 0, balance);
    }

    const constructionCost = producer.baseCost * constructionMultiplier;
    if (balance < constructionCost) {
        return {
            producerId: producer.id,
            currentLevel: 0,
            quantity: 0,
            nextLevel: 0,
            cost: 0,
        };
    }

    const additionalLevels = calculateMaxAffordableProducerPurchase(producer, 1, balance - constructionCost);
    const quantity = 1 + additionalLevels.quantity;
    return {
        producerId: producer.id,
        currentLevel: 0,
        quantity,
        nextLevel: quantity,
        cost: addFinite(constructionCost, additionalLevels.cost, `${producer.id}ConstructionCost`),
    };
}

function isRobotLineConstructionPurchase(producerId: string, currentLevel: number): boolean {
    return producerId === ROBOT_LINE_PRODUCER_ID && currentLevel === 0;
}

function getProducerLevel(state: GameState, producerId: string): number {
    return state.run.producers[producerId]?.level ?? 0;
}

function readBalance(state: GameState): number {
    const balance = state.run.industrialOutput;
    if (!Number.isFinite(balance) || balance < 0) {
        throw new ProducerProgressionInputError('state.run.industrialOutput must be a non-negative finite number.');
    }
    return balance;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new ProducerProgressionInputError(`${label} addition exceeds JavaScript Number range.`);
    }
    return result;
}

function validateProducerId(producerId: string): void {
    if (typeof producerId !== 'string' || producerId.length === 0) {
        throw new ProducerProgressionInputError('producerId must be a non-empty string.');
    }
}

function freezeBuildResult(result: ProducerBuildProgressionResult): ProducerBuildProgressionResult {
    return Object.freeze({
        ...result,
        blockingRequirements: Object.freeze(result.blockingRequirements.map((requirement) => Object.freeze({ ...requirement }))),
    });
}
