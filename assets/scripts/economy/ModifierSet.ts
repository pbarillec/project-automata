import type { ProducerConfig } from '../config/ConfigLoader.ts';
import { calculateProducerBaseOutput } from './ProducerProduction.ts';

export interface GlobalProductionMultiplierModifier {
    readonly type: 'globalProductionMultiplier';
    readonly multiplier: number;
}

export interface ProducerProductionMultiplierModifier {
    readonly type: 'producerProductionMultiplier';
    readonly producerId: string;
    readonly multiplier: number;
}

export type ProductionMultiplierModifier =
    | GlobalProductionMultiplierModifier
    | ProducerProductionMultiplierModifier;

export interface ModifierSetInput {
    readonly productionMultipliers?: readonly ProductionMultiplierModifier[];
}

export interface EffectiveProductionModifiers {
    readonly globalMultiplier: number;
    readonly producerMultipliers: Readonly<Record<string, number>>;
}

export class ModifierSetInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'ModifierSetInputError';
    }
}

export class ModifierSet {
    private readonly productionMultipliers: readonly ProductionMultiplierModifier[];

    constructor(input: ModifierSetInput = {}) {
        validateModifierSetInput(input);
        this.productionMultipliers = Object.freeze(normalizeProductionMultipliers(input.productionMultipliers ?? []));
    }

    static empty(): ModifierSet {
        return new ModifierSet();
    }

    static fromProductionMultipliers(productionMultipliers: readonly ProductionMultiplierModifier[]): ModifierSet {
        return new ModifierSet({ productionMultipliers });
    }

    getProductionMultipliers(): ProductionMultiplierModifier[] {
        return this.productionMultipliers.map(cloneProductionMultiplier);
    }

    withProductionMultiplier(modifier: ProductionMultiplierModifier): ModifierSet {
        return new ModifierSet({
            productionMultipliers: [
                ...this.productionMultipliers,
                modifier,
            ],
        });
    }
}

export function createGlobalProductionMultiplier(multiplier: number): GlobalProductionMultiplierModifier {
    validateProductionMultiplier(multiplier, 'global production multiplier');
    return Object.freeze({
        type: 'globalProductionMultiplier',
        multiplier,
    });
}

export function createProducerProductionMultiplier(
    producerId: string,
    multiplier: number,
): ProducerProductionMultiplierModifier {
    validateProducerId(producerId, 'producer production multiplier producerId');
    validateProductionMultiplier(multiplier, `producer ${producerId} production multiplier`);
    return Object.freeze({
        type: 'producerProductionMultiplier',
        producerId,
        multiplier,
    });
}

export function combineModifierSets(modifierSets: readonly ModifierSet[]): ModifierSet {
    if (!Array.isArray(modifierSets)) {
        throw new ModifierSetInputError('modifierSets must be an array.');
    }

    const productionMultipliers: ProductionMultiplierModifier[] = [];
    for (const modifierSet of modifierSets) {
        if (!(modifierSet instanceof ModifierSet)) {
            throw new ModifierSetInputError('modifierSets must contain only ModifierSet instances.');
        }
        productionMultipliers.push(...modifierSet.getProductionMultipliers());
    }

    return new ModifierSet({ productionMultipliers });
}

export function resolveEffectiveProductionModifiers(modifierSet: ModifierSet = ModifierSet.empty()): EffectiveProductionModifiers {
    if (!(modifierSet instanceof ModifierSet)) {
        throw new ModifierSetInputError('modifierSet must be a ModifierSet.');
    }

    let globalMultiplier = 1;
    const mutableProducerMultipliers: Record<string, number> = {};

    for (const modifier of modifierSet.getProductionMultipliers()) {
        if (modifier.type === 'globalProductionMultiplier') {
            globalMultiplier = multiplyFinite(globalMultiplier, modifier.multiplier, 'global production multiplier');
            continue;
        }

        const previousMultiplier = mutableProducerMultipliers[modifier.producerId] ?? 1;
        mutableProducerMultipliers[modifier.producerId] = multiplyFinite(
            previousMultiplier,
            modifier.multiplier,
            `producer ${modifier.producerId} production multiplier`,
        );
    }

    const producerMultipliers: Record<string, number> = {};
    for (const producerId of Object.keys(mutableProducerMultipliers).sort()) {
        producerMultipliers[producerId] = mutableProducerMultipliers[producerId];
    }

    return Object.freeze({
        globalMultiplier,
        producerMultipliers: Object.freeze(producerMultipliers),
    });
}

export function resolveEffectiveProducerProductionMultiplier(modifierSet: ModifierSet, producerId: string): number {
    validateProducerId(producerId, 'producerId');
    const effectiveModifiers = resolveEffectiveProductionModifiers(modifierSet);
    return multiplyFinite(
        effectiveModifiers.globalMultiplier,
        effectiveModifiers.producerMultipliers[producerId] ?? 1,
        `producer ${producerId} effective production multiplier`,
    );
}

export function applyProductionMultiplier(baseProduction: number, multiplier: number): number {
    validateBaseProduction(baseProduction);
    validateProductionMultiplier(multiplier, 'production multiplier');

    const output = baseProduction * multiplier;
    if (!Number.isFinite(output)) {
        throw new ModifierSetInputError('modified production exceeds JavaScript Number range.');
    }
    return output;
}

export function calculateModifiedProducerOutput(
    producer: ProducerConfig,
    level: number,
    modifierSet: ModifierSet = ModifierSet.empty(),
): number {
    const baseOutput = calculateProducerBaseOutput(producer, level);
    const multiplier = resolveEffectiveProducerProductionMultiplier(modifierSet, producer.id);
    return applyProductionMultiplier(baseOutput, multiplier);
}

function validateModifierSetInput(input: ModifierSetInput): void {
    if (!isPlainRecord(input)) {
        throw new ModifierSetInputError('modifier set input must be a plain object.');
    }

    if (input.productionMultipliers !== undefined && !Array.isArray(input.productionMultipliers)) {
        throw new ModifierSetInputError('productionMultipliers must be an array when provided.');
    }
}

function normalizeProductionMultipliers(
    productionMultipliers: readonly ProductionMultiplierModifier[],
): ProductionMultiplierModifier[] {
    return productionMultipliers
        .map(cloneValidatedProductionMultiplier)
        .sort(compareProductionMultiplier);
}

function cloneValidatedProductionMultiplier(modifier: unknown): ProductionMultiplierModifier {
    if (!isPlainRecord(modifier)) {
        throw new ModifierSetInputError('production multiplier modifier must be a plain object.');
    }

    const modifierType = modifier.type;

    if (modifierType === 'globalProductionMultiplier') {
        const multiplier = readProductionMultiplier(modifier.multiplier, 'global production multiplier');
        return Object.freeze({
            type: 'globalProductionMultiplier',
            multiplier,
        });
    }

    if (modifierType === 'producerProductionMultiplier') {
        const producerId = readProducerId(modifier.producerId, 'producer production multiplier producerId');
        const multiplier = readProductionMultiplier(modifier.multiplier, `producer ${producerId} production multiplier`);
        return Object.freeze({
            type: 'producerProductionMultiplier',
            producerId,
            multiplier,
        });
    }

    throw new ModifierSetInputError(`unsupported production multiplier modifier type "${String(modifierType)}".`);
}

function cloneProductionMultiplier(modifier: ProductionMultiplierModifier): ProductionMultiplierModifier {
    if (modifier.type === 'globalProductionMultiplier') {
        return {
            type: 'globalProductionMultiplier',
            multiplier: modifier.multiplier,
        };
    }

    return {
        type: 'producerProductionMultiplier',
        producerId: modifier.producerId,
        multiplier: modifier.multiplier,
    };
}

function compareProductionMultiplier(left: ProductionMultiplierModifier, right: ProductionMultiplierModifier): number {
    const leftKey = productionMultiplierSortKey(left);
    const rightKey = productionMultiplierSortKey(right);
    return leftKey.localeCompare(rightKey);
}

function productionMultiplierSortKey(modifier: ProductionMultiplierModifier): string {
    if (modifier.type === 'globalProductionMultiplier') {
        return `0|${modifier.multiplier}`;
    }

    return `1|${modifier.producerId}|${modifier.multiplier}`;
}

function validateProductionMultiplier(multiplier: number, label: string): void {
    readProductionMultiplier(multiplier, label);
}

function readProductionMultiplier(multiplier: unknown, label: string): number {
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
        throw new ModifierSetInputError(`${label} must be a positive finite number.`);
    }
    return multiplier;
}

function validateBaseProduction(baseProduction: number): void {
    if (!Number.isFinite(baseProduction) || baseProduction < 0) {
        throw new ModifierSetInputError('baseProduction must be a non-negative finite number.');
    }
}

function validateProducerId(producerId: string, label: string): void {
    readProducerId(producerId, label);
}

function readProducerId(producerId: unknown, label: string): string {
    if (typeof producerId !== 'string' || producerId.length === 0) {
        throw new ModifierSetInputError(`${label} must be a non-empty string.`);
    }
    return producerId;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const product = left * right;
    if (!Number.isFinite(product)) {
        throw new ModifierSetInputError(`${label} exceeds JavaScript Number range.`);
    }
    return product;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
