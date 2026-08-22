import type {
    BreakthroughRequirement,
    GameConfigRepository,
    PermanentBreakthroughRequirementOverrideByRankEffect,
    PermanentUpgradeConfig,
    PermanentUpgradePrerequisite,
    PermanentUpgradeRequirementOverrideRank,
} from '../config/ConfigLoader.ts';
import {
    ModifierSet,
    createGlobalProductionMultiplier,
    createProducerProductionMultiplier,
    type ProductionMultiplierModifier,
} from '../economy/ModifierSet.ts';
import type { GameState, MetaState } from '../state/GameState.ts';
import { resolveEffectiveProducerAutomationState } from './AutomationState.ts';

export const OPTIMIZED_FABRICATION_UPGRADE_ID = 'optimized_fabrication';
export const INDUSTRIAL_SCALING_UPGRADE_ID = 'industrial_scaling';
export const AUTONOMOUS_OPTIMIZATION_UPGRADE_ID = 'autonomous_optimization';
export const CACHED_PROCEDURES_UPGRADE_ID = 'cached_procedures';
export const WORKER_TEMPLATES_UPGRADE_ID = 'worker_templates';
export const INHERITED_AUTOMATION_UPGRADE_ID = 'inherited_automation';
export const COMPACT_BLUEPRINTS_UPGRADE_ID = 'compact_blueprints';
export const ERA_COMPRESSION_UPGRADE_ID = 'era_compression';

export type PermanentUpgradeRankStatus =
    | 'available'
    | 'prerequisite_locked'
    | 'max_rank'
    | 'unknown_upgrade';

export interface MissingPermanentUpgradePrerequisite {
    readonly upgradeId: string;
    readonly requiredRank: number;
    readonly currentRank: number;
}

export interface PermanentUpgradeRankState {
    readonly status: PermanentUpgradeRankStatus;
    readonly upgradeId: string;
    readonly currentRank: number;
    readonly maxRank: number | null;
    readonly nextRank: number | null;
    readonly nextRankCost: number | null;
    readonly missingPrerequisites: readonly MissingPermanentUpgradePrerequisite[];
}

export interface EffectiveBreakthroughDefinition {
    readonly breakthroughId: string;
    readonly baseCost: number;
    readonly cost: number;
    readonly requirements: readonly BreakthroughRequirement[];
}

export class PermanentUpgradeInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'PermanentUpgradeInputError';
    }
}

export function getPermanentUpgradeRank(
    repository: GameConfigRepository,
    meta: MetaState,
    upgradeId: string,
): number {
    validateUpgradeId(upgradeId);
    const upgrade = repository.getPermanentUpgrade(upgradeId);
    if (upgrade === undefined) {
        throw new PermanentUpgradeInputError(`unknown permanent upgrade id "${upgradeId}".`);
    }

    const rank = meta.permanentUpgradeRanks[upgradeId] ?? 0;
    validatePermanentUpgradeRankValue(upgrade, rank);
    return rank;
}

export function getNextPermanentUpgradeRankCost(
    repository: GameConfigRepository,
    meta: MetaState,
    upgradeId: string,
): number | null {
    const state = evaluatePermanentUpgradeRankState(repository, meta, upgradeId);
    return state.nextRankCost;
}

export function evaluatePermanentUpgradeRankState(
    repository: GameConfigRepository,
    meta: MetaState,
    upgradeId: string,
): PermanentUpgradeRankState {
    validatePermanentUpgradeRanks(repository, meta);
    validateUpgradeId(upgradeId);

    const upgrade = repository.getPermanentUpgrade(upgradeId);
    if (upgrade === undefined) {
        return freezeRankState({
            status: 'unknown_upgrade',
            upgradeId,
            currentRank: 0,
            maxRank: null,
            nextRank: null,
            nextRankCost: null,
            missingPrerequisites: [],
        });
    }

    const currentRank = meta.permanentUpgradeRanks[upgradeId] ?? 0;
    if (currentRank >= upgrade.maxRank) {
        return freezeRankState({
            status: 'max_rank',
            upgradeId,
            currentRank,
            maxRank: upgrade.maxRank,
            nextRank: null,
            nextRankCost: null,
            missingPrerequisites: [],
        });
    }

    const missingPrerequisites = resolveMissingPrerequisites(repository, meta, upgrade.prerequisites);
    if (missingPrerequisites.length > 0) {
        return freezeRankState({
            status: 'prerequisite_locked',
            upgradeId,
            currentRank,
            maxRank: upgrade.maxRank,
            nextRank: currentRank + 1,
            nextRankCost: upgrade.rankCosts[currentRank],
            missingPrerequisites,
        });
    }

    return freezeRankState({
        status: 'available',
        upgradeId,
        currentRank,
        maxRank: upgrade.maxRank,
        nextRank: currentRank + 1,
        nextRankCost: upgrade.rankCosts[currentRank],
        missingPrerequisites: [],
    });
}

export function validatePermanentUpgradeRanks(repository: GameConfigRepository, meta: MetaState): void {
    if (!isPlainRecord(meta.permanentUpgradeRanks)) {
        throw new PermanentUpgradeInputError('meta.permanentUpgradeRanks must be a plain record.');
    }

    for (const [upgradeId, rank] of Object.entries(meta.permanentUpgradeRanks).sort(([left], [right]) => left.localeCompare(right))) {
        const upgrade = repository.getPermanentUpgrade(upgradeId);
        if (upgrade === undefined) {
            throw new PermanentUpgradeInputError(`meta references unknown permanent upgrade id "${upgradeId}".`);
        }
        validatePermanentUpgradeRankValue(upgrade, rank);
    }
}

export function createPermanentUpgradeModifierSet(
    repository: GameConfigRepository,
    state: GameState,
): ModifierSet {
    validatePermanentUpgradeRanks(repository, state.meta);
    const modifiers: ProductionMultiplierModifier[] = [];

    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = state.meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (rank === 0) {
            continue;
        }

        for (const effect of upgrade.effects) {
            if (effect.type === 'globalProductionMultiplierPerRank') {
                modifiers.push(createGlobalProductionMultiplier(powFinite(effect.multiplier, rank, `${upgrade.id} global production multiplier`)));
            }
            else if (effect.type === 'automatedProducerMultiplierPerRank') {
                const multiplier = powFinite(effect.multiplier, rank, `${upgrade.id} automated producer multiplier`);
                for (const producer of repository.listProducers()) {
                    const automation = resolveEffectiveProducerAutomationState(repository, state, producer.id);
                    if (automation.isAutomated) {
                        modifiers.push(createProducerProductionMultiplier(producer.id, multiplier));
                    }
                }
            }
        }
    }

    return ModifierSet.fromProductionMultipliers(modifiers);
}

export function resolvePermanentMilestonePowerBonus(repository: GameConfigRepository, meta: MetaState): number {
    validatePermanentUpgradeRanks(repository, meta);
    let bonus = 0;

    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (rank === 0) {
            continue;
        }

        for (const effect of upgrade.effects) {
            if (effect.type === 'milestonePowerBonusPerRank') {
                bonus = addFinite(bonus, effect.bonus * rank, 'milestone power bonus');
            }
        }
    }

    return bonus;
}

export function resolveEffectiveBreakthroughDefinition(
    repository: GameConfigRepository,
    state: GameState,
    breakthroughId: string,
): EffectiveBreakthroughDefinition {
    validateUpgradeId(breakthroughId);
    validatePermanentUpgradeRanks(repository, state.meta);
    const breakthrough = repository.getBreakthrough(breakthroughId);
    if (breakthrough === undefined) {
        throw new PermanentUpgradeInputError(`unknown breakthrough id "${breakthroughId}".`);
    }

    let costMultiplier = 1;
    let requirements = breakthrough.requirements.map(cloneBreakthroughRequirement);

    if (isMajorBreakthrough(breakthrough)) {
        requirements = requirements.map((requirement) => applyMajorReductionToRequirement(repository, state.meta, requirement));
    }

    for (const activeEffect of getActiveBreakthroughOverrideEffects(repository, state.meta, breakthroughId)) {
        const override = selectActiveRequirementOverride(activeEffect.effect, activeEffect.upgradeRank);
        if (override === undefined) {
            continue;
        }

        costMultiplier = multiplyFinite(costMultiplier, override.costMultiplier, `${activeEffect.effect.breakthroughId} cost multiplier`);
        requirements = applyRequirementOverride(requirements, override);
    }

    return Object.freeze({
        breakthroughId,
        baseCost: breakthrough.cost,
        cost: multiplyFinite(breakthrough.cost, costMultiplier, `${breakthroughId} effective cost`),
        requirements: Object.freeze(requirements),
    });
}

function isMajorBreakthrough(breakthrough: { effects: readonly { type: string }[] }): boolean {
    return breakthrough.effects.some((effect) => effect.type === 'constructProducer' || effect.type === 'enterEra');
}

function applyMajorReductionToRequirement(
    repository: GameConfigRepository,
    meta: MetaState,
    requirement: BreakthroughRequirement,
): BreakthroughRequirement {
    if (requirement.type === 'producerLevel') {
        return {
            type: 'producerLevel',
            producerId: requirement.producerId,
            level: resolveEffectiveMajorRequirement(repository, meta, requirement.level),
        };
    }

    if (requirement.type === 'robotsBuilt') {
        return {
            type: 'robotsBuilt',
            count: resolveEffectiveMajorRequirement(repository, meta, requirement.count),
        };
    }

    return cloneBreakthroughRequirement(requirement);
}

export function resolveNewProducerConstructionCostMultiplier(repository: GameConfigRepository, meta: MetaState): number {
    validatePermanentUpgradeRanks(repository, meta);
    let multiplier = 1;

    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (rank === 0) {
            continue;
        }

        for (const effect of upgrade.effects) {
            if (effect.type === 'newProducerConstructionCostMultiplierPerRank') {
                multiplier = multiplyFinite(
                    multiplier,
                    powFinite(effect.multiplier, rank, `${upgrade.id} construction cost multiplier`),
                    'new producer construction cost multiplier',
                );
            }
        }
    }

    return multiplier;
}

export function applyNewProducerConstructionCostMultiplier(
    repository: GameConfigRepository,
    meta: MetaState,
    baseCost: number,
): number {
    validateNonNegativeFinite(baseCost, 'baseCost');
    return multiplyFinite(baseCost, resolveNewProducerConstructionCostMultiplier(repository, meta), 'new producer construction cost');
}

export function resolvePermanentMajorRequirementReduction(repository: GameConfigRepository, meta: MetaState): number {
    validatePermanentUpgradeRanks(repository, meta);
    let reduction = 0;

    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (rank === 0) {
            continue;
        }

        for (const effect of upgrade.effects) {
            if (effect.type === 'majorRequirementReductionPerRank') {
                if (effect.roundingRule !== 'floor') {
                    throw new PermanentUpgradeInputError(`unsupported major requirement rounding rule "${effect.roundingRule}".`);
                }
                reduction = addFinite(reduction, effect.reduction * rank, 'major requirement reduction');
            }
        }
    }

    return Math.min(reduction, 0.99);
}

export function resolveEffectiveMajorRequirement(
    repository: GameConfigRepository,
    meta: MetaState,
    baseRequirement: number,
): number {
    if (!Number.isSafeInteger(baseRequirement) || baseRequirement < 0) {
        throw new PermanentUpgradeInputError('baseRequirement must be a non-negative safe integer.');
    }

    const reduction = resolvePermanentMajorRequirementReduction(repository, meta);
    return Math.floor(baseRequirement * (1 - reduction));
}

export function shouldProducerStartAutomatedOnceConstructed(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): boolean {
    validateUpgradeId(producerId);
    validatePermanentUpgradeRanks(repository, state.meta);

    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = state.meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (rank === 0) {
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

function resolveMissingPrerequisites(
    repository: GameConfigRepository,
    meta: MetaState,
    prerequisites: readonly PermanentUpgradePrerequisite[],
): MissingPermanentUpgradePrerequisite[] {
    const missing: MissingPermanentUpgradePrerequisite[] = [];
    for (const prerequisite of prerequisites) {
        const currentRank = getPermanentUpgradeRank(repository, meta, prerequisite.upgradeId);
        if (currentRank < prerequisite.rank) {
            missing.push({
                upgradeId: prerequisite.upgradeId,
                requiredRank: prerequisite.rank,
                currentRank,
            });
        }
    }

    return missing;
}

function getActiveBreakthroughOverrideEffects(
    repository: GameConfigRepository,
    meta: MetaState,
    breakthroughId: string,
): { effect: PermanentBreakthroughRequirementOverrideByRankEffect; upgradeRank: number }[] {
    const effects: { effect: PermanentBreakthroughRequirementOverrideByRankEffect; upgradeRank: number }[] = [];
    for (const upgrade of repository.listPermanentUpgrades()) {
        const rank = meta.permanentUpgradeRanks[upgrade.id] ?? 0;
        if (rank === 0) {
            continue;
        }

        for (const effect of upgrade.effects) {
            if (effect.type === 'breakthroughRequirementOverrideByRank' && effect.breakthroughId === breakthroughId) {
                effects.push({ effect, upgradeRank: rank });
            }
        }
    }
    return effects;
}

function selectActiveRequirementOverride(
    effect: PermanentBreakthroughRequirementOverrideByRankEffect,
    upgradeRank: number,
): PermanentUpgradeRequirementOverrideRank | undefined {
    let selected: PermanentUpgradeRequirementOverrideRank | undefined;
    for (const rankOverride of effect.ranks) {
        if (rankOverride.rank <= upgradeRank && (selected === undefined || rankOverride.rank > selected.rank)) {
            selected = rankOverride;
        }
    }
    return selected;
}

function applyRequirementOverride(
    baseRequirements: readonly BreakthroughRequirement[],
    override: PermanentUpgradeRequirementOverrideRank,
): BreakthroughRequirement[] {
    if (override.availableImmediately) {
        return [];
    }

    const overriddenProducerIds = new Set(override.producerLevelRequirements.map((requirement) => requirement.producerId));
    return [
        ...baseRequirements
            .filter((requirement) => requirement.type !== 'producerLevel' || !overriddenProducerIds.has(requirement.producerId))
            .map(cloneBreakthroughRequirement),
        ...override.producerLevelRequirements.map((requirement) => ({
            type: 'producerLevel' as const,
            producerId: requirement.producerId,
            level: requirement.level,
        })),
    ];
}

function cloneBreakthroughRequirement(requirement: BreakthroughRequirement): BreakthroughRequirement {
    if (requirement.type === 'producerLevel') {
        return { type: 'producerLevel', producerId: requirement.producerId, level: requirement.level };
    }
    if (requirement.type === 'breakthroughOwned') {
        return { type: 'breakthroughOwned', breakthroughId: requirement.breakthroughId };
    }
    if (requirement.type === 'robotsBuilt') {
        return { type: 'robotsBuilt', count: requirement.count };
    }
    if (requirement.type === 'era') {
        return { type: 'era', eraId: requirement.eraId };
    }
    return { type: 'civilization', civilizationNumber: requirement.civilizationNumber };
}

function validatePermanentUpgradeRankValue(upgrade: PermanentUpgradeConfig, rank: number): void {
    if (!Number.isInteger(rank) || rank < 0 || rank > upgrade.maxRank) {
        throw new PermanentUpgradeInputError(`rank for permanent upgrade "${upgrade.id}" must be an integer from 0 through ${upgrade.maxRank}.`);
    }
}

function validateUpgradeId(upgradeId: string): void {
    if (typeof upgradeId !== 'string' || upgradeId.length === 0) {
        throw new PermanentUpgradeInputError('id must be a non-empty string.');
    }
}

function validateNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new PermanentUpgradeInputError(`${label} must be a non-negative finite number.`);
    }
}

function powFinite(base: number, exponent: number, label: string): number {
    const result = Math.pow(base, exponent);
    if (!Number.isFinite(result)) {
        throw new PermanentUpgradeInputError(`${label} exceeds JavaScript Number range.`);
    }
    return result;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) {
        throw new PermanentUpgradeInputError(`${label} exceeds JavaScript Number range.`);
    }
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new PermanentUpgradeInputError(`${label} exceeds JavaScript Number range.`);
    }
    return result;
}

function freezeRankState(state: PermanentUpgradeRankState): PermanentUpgradeRankState {
    return Object.freeze({
        ...state,
        missingPrerequisites: Object.freeze(state.missingPrerequisites.map((prerequisite) => Object.freeze({ ...prerequisite }))),
    });
}

function isPlainRecord(value: unknown): value is Record<string, number> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
