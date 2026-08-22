import type {
    BreakthroughConfig,
    BreakthroughRequirement,
    GameConfigRepository,
    ProducerConfig,
    ProducerMilestoneConfig,
} from '../config/ConfigLoader.ts';
import { calculateProducerProgressionPurchase } from './ProducerProgression.ts';
import type { GameState } from '../state/GameState.ts';
import {
    evaluateBreakthroughEligibility,
    type BreakthroughEligibilityResult,
    type LockedBreakthroughRequirement,
} from './Breakthroughs.ts';
import { getEraOrder, isCurrentEraAtLeast } from './EraProgression.ts';
import { createPrestigePreview, type PrestigePreview } from './Prestige.ts';
import {
    evaluateProducerBuildProgression,
    getProgressionProducerLevel,
    isProducerBuilt,
    type ProducerBuildProgressionResult,
} from './ProducerProgression.ts';
import { resolveEffectiveBreakthroughDefinition } from './PermanentUpgrades.ts';

export type NextGoalCategory =
    | 'producer_build'
    | 'producer_milestone'
    | 'breakthrough'
    | 'era'
    | 'reboot_ai_core'
    | 'none';

export type NextGoalFocusTarget =
    | {
        readonly kind: 'producer';
        readonly producerId: string;
    }
    | {
        readonly kind: 'producer_milestone';
        readonly producerId: string;
        readonly milestoneId: string;
    }
    | {
        readonly kind: 'breakthrough';
        readonly breakthroughId: string;
    }
    | {
        readonly kind: 'era';
        readonly eraId: string;
        readonly source: NextGoalFocusTargetSource | null;
    }
    | {
        readonly kind: 'progression_target';
        readonly targetKind: 'reboot_ai_core';
    };

export type NextGoalFocusTargetSource =
    | {
        readonly kind: 'producer';
        readonly producerId: string;
    }
    | {
        readonly kind: 'breakthrough';
        readonly breakthroughId: string;
    };

export type NextGoalBlocking =
    | {
        readonly state: 'unblocked';
        readonly requirements: readonly [];
    }
    | {
        readonly state: 'requirement_locked';
        readonly requirements: readonly NextGoalBlockingRequirement[];
    };

export type NextGoalBlockingRequirement =
    | {
        readonly type: 'producerBuilt';
        readonly producerId: string;
        readonly isBuilt: boolean;
    }
    | {
        readonly type: 'producerLevel';
        readonly producerId: string;
        readonly requiredLevel: number;
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
    }
    | {
        readonly type: 'robotsBuilt';
        readonly requiredCount: number;
        readonly currentCount: number;
    }
    | {
        readonly type: 'era';
        readonly eraId: string;
        readonly currentEraId: string | null;
    }
    | {
        readonly type: 'civilization';
        readonly requiredCivilizationNumber: number;
        readonly currentCivilizationNumber: number;
    };

export type NextGoalAffordability =
    | {
        readonly state: 'not_applicable';
        readonly cost: null;
        readonly balance: number;
    }
    | {
        readonly state: 'affordable' | 'unaffordable';
        readonly cost: number;
        readonly balance: number;
    };

export interface NextGoalProgress {
    readonly currentValue: number;
    readonly requiredValue: number;
    readonly ratio: number;
}

interface NextGoalBase {
    readonly category: NextGoalCategory;
    readonly id: string;
    readonly semanticKey: string;
    readonly focusTarget: NextGoalFocusTarget;
    readonly isComplete: boolean;
    readonly progress: NextGoalProgress | null;
    readonly blocking: NextGoalBlocking;
    readonly affordability: NextGoalAffordability;
}

export interface ProducerBuildNextGoal extends NextGoalBase {
    readonly category: 'producer_build';
    readonly producerId: string;
    readonly targetLevel: number;
}

export interface ProducerMilestoneNextGoal extends NextGoalBase {
    readonly category: 'producer_milestone';
    readonly producerId: string;
    readonly milestoneId: string;
    readonly threshold: number;
}

export interface BreakthroughNextGoal extends NextGoalBase {
    readonly category: 'breakthrough';
    readonly breakthroughId: string;
    readonly eligibilityStatus: BreakthroughEligibilityResult['status'];
}

export interface EraNextGoal extends NextGoalBase {
    readonly category: 'era';
    readonly eraId: string;
    readonly source: NextGoalFocusTargetSource | null;
}

export interface RebootAiCoreNextGoal extends NextGoalBase {
    readonly category: 'reboot_ai_core';
    readonly prestigePreview: PrestigePreview;
}

export interface NoNextGoal extends NextGoalBase {
    readonly category: 'none';
}

export type NextGoal =
    | ProducerBuildNextGoal
    | ProducerMilestoneNextGoal
    | BreakthroughNextGoal
    | EraNextGoal
    | RebootAiCoreNextGoal
    | NoNextGoal;

export class NextGoalInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'NextGoalInputError';
    }
}

export function resolveNextGoal(repository: GameConfigRepository, state: GameState): NextGoal {
    const immediateBreakthrough = findAffordableRequirementlessBreakthrough(repository, state);
    if (immediateBreakthrough !== undefined) {
        return freezeGoal(immediateBreakthrough);
    }

    const firstUnbuiltProducer = findFirstUnbuiltDirectProducer(repository, state);
    if (firstUnbuiltProducer !== undefined && firstUnbuiltProducer.prerequisiteProducerIds.length === 0) {
        return freezeGoal(createProducerBuildGoal(repository, state, firstUnbuiltProducer.id));
    }

    for (const breakthrough of repository.listBreakthroughs()) {
        if (state.run.purchasedBreakthroughIds.includes(breakthrough.id)) {
            continue;
        }

        const dependencyGoal = resolveBreakthroughDependencyGoal(repository, state, breakthrough);
        if (dependencyGoal !== undefined) {
            return freezeGoal(dependencyGoal);
        }

        const eligibility = evaluateBreakthroughEligibility(repository, state, breakthrough.id);
        const enterEraId = getBreakthroughEnterEraId(breakthrough);
        if (enterEraId !== null && !isCurrentEraAtLeast(repository, state, enterEraId)) {
            return freezeGoal(createEraBreakthroughGoal(repository, state, breakthrough, eligibility, enterEraId));
        }

        return freezeGoal(createBreakthroughGoal(repository, state, breakthrough, eligibility));
    }

    const firstRemainingProducer = findFirstUnbuiltDirectProducer(repository, state);
    if (firstRemainingProducer !== undefined) {
        return freezeGoal(createProducerBuildGoal(repository, state, firstRemainingProducer.id));
    }

    const prestigePreview = createPrestigePreview(repository, state);
    if (state.run.currentEraId !== null &&
        isCurrentEraAtLeast(repository, state, 'robotics_complex') &&
        prestigePreview.currentAiCoreReward > 0) {
        return freezeGoal(createRebootAiCoreGoal(state, prestigePreview));
    }

    const frontierMilestone = findFrontierMilestoneGoal(repository, state);
    if (frontierMilestone !== undefined) {
        return freezeGoal(frontierMilestone);
    }

    return freezeGoal(createNoNextGoal(state));
}

function findAffordableRequirementlessBreakthrough(repository: GameConfigRepository, state: GameState): BreakthroughNextGoal | EraNextGoal | undefined {
    for (const breakthrough of repository.listBreakthroughs()) {
        if (state.run.purchasedBreakthroughIds.includes(breakthrough.id)) {
            continue;
        }

        const effectiveBreakthrough = resolveEffectiveBreakthroughDefinition(repository, state, breakthrough.id);
        if (effectiveBreakthrough.requirements.length > 0) {
            continue;
        }

        const eligibility = evaluateBreakthroughEligibility(repository, state, breakthrough.id);
        if (eligibility.status !== 'eligible' || !eligibility.isAffordable) {
            continue;
        }

        const enterEraId = getBreakthroughEnterEraId(breakthrough);
        if (enterEraId !== null && !isCurrentEraAtLeast(repository, state, enterEraId)) {
            return createEraBreakthroughGoal(repository, state, breakthrough, eligibility, enterEraId);
        }

        return createBreakthroughGoal(repository, state, breakthrough, eligibility);
    }

    return undefined;
}

function resolveBreakthroughDependencyGoal(
    repository: GameConfigRepository,
    state: GameState,
    breakthrough: BreakthroughConfig,
): NextGoal | undefined {
    const sortedRequirements = resolveEffectiveBreakthroughDefinition(repository, state, breakthrough.id).requirements.slice();
    for (const requirement of sortedRequirements) {
        if (requirement.type !== 'producerLevel') {
            continue;
        }

        if (!isProducerBuilt(state, requirement.producerId) && isDirectProducerBuildGoal(repository, requirement.producerId)) {
            const producer = repository.getProducer(requirement.producerId);
            if (producer !== undefined && isFutureEraProducer(repository, state, producer)) {
                return createEraProducerBuildGoal(repository, state, producer);
            }
            return createProducerBuildGoal(repository, state, requirement.producerId);
        }

        const milestone = findNextMilestoneAtOrBeforeRequirement(repository, state, requirement.producerId, requirement.level);
        if (milestone !== undefined) {
            return createProducerMilestoneGoal(repository, state, requirement.producerId, milestone);
        }
    }

    for (const requirement of sortedRequirements) {
        if (requirement.type === 'breakthroughOwned' && !state.run.purchasedBreakthroughIds.includes(requirement.breakthroughId)) {
            return undefined;
        }
    }

    return undefined;
}

function createProducerBuildGoal(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): ProducerBuildNextGoal {
    const buildProgression = evaluateProducerBuildProgression(repository, state, producerId);
    const targetLevel = buildProgression.targetLevel ?? 1;
    return {
        category: 'producer_build',
        id: `producer_build:${producerId}:level_${targetLevel}`,
        semanticKey: 'next_goal.producer_build',
        producerId,
        targetLevel,
        focusTarget: {
            kind: 'producer',
            producerId,
        },
        isComplete: buildProgression.status === 'already_built',
        progress: createProgress(buildProgression.currentLevel, targetLevel),
        blocking: createBlockingFromProducerBuild(buildProgression),
        affordability: createAffordability(buildProgression.cost, buildProgression.balance),
    };
}

function createEraProducerBuildGoal(
    repository: GameConfigRepository,
    state: GameState,
    producer: ProducerConfig,
): EraNextGoal {
    const buildProgression = evaluateProducerBuildProgression(repository, state, producer.id);
    return {
        category: 'era',
        id: `era:${producer.eraId}:producer_build:${producer.id}`,
        semanticKey: 'next_goal.era',
        eraId: producer.eraId,
        source: {
            kind: 'producer',
            producerId: producer.id,
        },
        focusTarget: {
            kind: 'era',
            eraId: producer.eraId,
            source: {
                kind: 'producer',
                producerId: producer.id,
            },
        },
        isComplete: isCurrentEraAtLeast(repository, state, producer.eraId),
        progress: createProgress(getCurrentEraOrder(repository, state), getEraOrder(repository, producer.eraId)),
        blocking: createBlockingFromProducerBuild(buildProgression),
        affordability: createAffordability(buildProgression.cost, buildProgression.balance),
    };
}

function createProducerMilestoneGoal(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
    milestone: ProducerMilestoneConfig,
): ProducerMilestoneNextGoal {
    const currentLevel = getProgressionProducerLevel(state, producerId);
    const producer = requireProducer(repository, producerId);
    const quantity = milestone.threshold - currentLevel;
    const purchase = quantity > 0
        ? calculateProducerProgressionPurchase(repository, state.meta, producer, currentLevel, quantity)
        : null;

    return {
        category: 'producer_milestone',
        id: `producer_milestone:${producerId}:${milestone.id}`,
        semanticKey: 'next_goal.producer_milestone',
        producerId,
        milestoneId: milestone.id,
        threshold: milestone.threshold,
        focusTarget: {
            kind: 'producer_milestone',
            producerId,
            milestoneId: milestone.id,
        },
        isComplete: currentLevel >= milestone.threshold,
        progress: createProgress(currentLevel, milestone.threshold),
        blocking: createUnblocked(),
        affordability: createAffordability(purchase?.cost ?? null, state.run.industrialOutput),
    };
}

function createBreakthroughGoal(
    repository: GameConfigRepository,
    state: GameState,
    breakthrough: BreakthroughConfig,
    eligibility: BreakthroughEligibilityResult,
): BreakthroughNextGoal {
    return {
        category: 'breakthrough',
        id: `breakthrough:${breakthrough.id}`,
        semanticKey: 'next_goal.breakthrough',
        breakthroughId: breakthrough.id,
        eligibilityStatus: eligibility.status,
        focusTarget: {
            kind: 'breakthrough',
            breakthroughId: breakthrough.id,
        },
        isComplete: eligibility.status === 'already_owned',
        progress: createBreakthroughProgress(repository, state, breakthrough),
        blocking: createBlockingFromBreakthrough(eligibility.lockedRequirements),
        affordability: createAffordability(eligibility.cost, eligibility.balance),
    };
}

function createEraBreakthroughGoal(
    repository: GameConfigRepository,
    state: GameState,
    breakthrough: BreakthroughConfig,
    eligibility: BreakthroughEligibilityResult,
    eraId: string,
): EraNextGoal {
    return {
        category: 'era',
        id: `era:${eraId}:breakthrough:${breakthrough.id}`,
        semanticKey: 'next_goal.era',
        eraId,
        source: {
            kind: 'breakthrough',
            breakthroughId: breakthrough.id,
        },
        focusTarget: {
            kind: 'era',
            eraId,
            source: {
                kind: 'breakthrough',
                breakthroughId: breakthrough.id,
            },
        },
        isComplete: isCurrentEraAtLeast(repository, state, eraId),
        progress: createProgress(getCurrentEraOrder(repository, state), getEraOrder(repository, eraId)),
        blocking: createBlockingFromBreakthrough(eligibility.lockedRequirements),
        affordability: createAffordability(eligibility.cost, eligibility.balance),
    };
}

function createRebootAiCoreGoal(state: GameState, prestigePreview: PrestigePreview): RebootAiCoreNextGoal {
    return {
        category: 'reboot_ai_core',
        id: 'reboot_ai_core:current_civilization',
        semanticKey: 'next_goal.reboot_ai_core',
        prestigePreview,
        focusTarget: {
            kind: 'progression_target',
            targetKind: 'reboot_ai_core',
        },
        isComplete: false,
        progress: createProgress(
            prestigePreview.currentPrestigePower,
            prestigePreview.nextCoreRequiredPrestigePower,
        ),
        blocking: createUnblocked(),
        affordability: {
            state: 'not_applicable',
            cost: null,
            balance: state.run.industrialOutput,
        },
    };
}

function createNoNextGoal(state: GameState): NoNextGoal {
    return {
        category: 'none',
        id: 'none:current_content_complete',
        semanticKey: 'next_goal.none',
        focusTarget: {
            kind: 'progression_target',
            targetKind: 'reboot_ai_core',
        },
        isComplete: true,
        progress: null,
        blocking: createUnblocked(),
        affordability: {
            state: 'not_applicable',
            cost: null,
            balance: state.run.industrialOutput,
        },
    };
}

function findFirstUnbuiltDirectProducer(repository: GameConfigRepository, state: GameState): ProducerConfig | undefined {
    return repository.listProducers().find((producer) => (
        isDirectProducerBuildGoal(repository, producer.id) && !isProducerBuilt(state, producer.id)
    ));
}

function isDirectProducerBuildGoal(repository: GameConfigRepository, producerId: string): boolean {
    return !repository.listBreakthroughs().some((breakthrough) => breakthrough.effects.some((effect) => (
        effect.type === 'constructProducer' && effect.producerId === producerId
    )));
}

function isFutureEraProducer(repository: GameConfigRepository, state: GameState, producer: ProducerConfig): boolean {
    const currentEraOrder = getCurrentEraOrder(repository, state);
    return getEraOrder(repository, producer.eraId) > currentEraOrder;
}

function findNextMilestoneAtOrBeforeRequirement(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
    requiredLevel: number,
): ProducerMilestoneConfig | undefined {
    const currentLevel = getProgressionProducerLevel(state, producerId);
    return repository.listMilestones().find((milestone) => (
        currentLevel < milestone.threshold && milestone.threshold <= requiredLevel
    ));
}

function findFrontierMilestoneGoal(repository: GameConfigRepository, state: GameState): ProducerMilestoneNextGoal | undefined {
    const builtProducers = repository.listProducers()
        .filter((producer) => isProducerBuilt(state, producer.id))
        .sort((left, right) => compareProducersByFrontier(repository, left, right));

    for (const producer of builtProducers) {
        const currentLevel = getProgressionProducerLevel(state, producer.id);
        const milestone = repository.listMilestones().find((item) => currentLevel < item.threshold);
        if (milestone !== undefined) {
            return createProducerMilestoneGoal(repository, state, producer.id, milestone);
        }
    }

    return undefined;
}

function compareProducersByFrontier(repository: GameConfigRepository, left: ProducerConfig, right: ProducerConfig): number {
    const eraCompare = getEraOrder(repository, right.eraId) - getEraOrder(repository, left.eraId);
    if (eraCompare !== 0) {
        return eraCompare;
    }

    const producers = repository.listProducers();
    return producers.findIndex((producer) => producer.id === right.id) -
        producers.findIndex((producer) => producer.id === left.id);
}

function getBreakthroughEnterEraId(breakthrough: BreakthroughConfig): string | null {
    const effect = breakthrough.effects.find((item) => item.type === 'enterEra');
    return effect?.type === 'enterEra' ? effect.eraId : null;
}

function createBreakthroughProgress(
    repository: GameConfigRepository,
    state: GameState,
    breakthrough: BreakthroughConfig,
): NextGoalProgress | null {
    const progressParts: NextGoalProgress[] = [];
    const effectiveBreakthrough = resolveEffectiveBreakthroughDefinition(repository, state, breakthrough.id);
    for (const requirement of effectiveBreakthrough.requirements) {
        const progress = createRequirementProgress(repository, state, requirement);
        if (progress !== null) {
            progressParts.push(progress);
        }
    }

    if (progressParts.length === 0) {
        return null;
    }

    const ratio = progressParts.reduce((sum, progress) => sum + progress.ratio, 0) / progressParts.length;
    return {
        currentValue: progressParts.reduce((sum, progress) => sum + progress.currentValue, 0),
        requiredValue: progressParts.reduce((sum, progress) => sum + progress.requiredValue, 0),
        ratio,
    };
}

function createRequirementProgress(
    repository: GameConfigRepository,
    state: GameState,
    requirement: BreakthroughRequirement,
): NextGoalProgress | null {
    if (requirement.type === 'producerLevel') {
        return createProgress(getProgressionProducerLevel(state, requirement.producerId), requirement.level);
    }

    if (requirement.type === 'robotsBuilt') {
        return createProgress(state.run.robotsBuilt, requirement.count);
    }

    if (requirement.type === 'era') {
        return createProgress(getCurrentEraOrder(repository, state), getEraOrder(repository, requirement.eraId));
    }

    if (requirement.type === 'civilization') {
        return createProgress(state.meta.civilizationNumber, requirement.civilizationNumber);
    }

    return null;
}

function createBlockingFromProducerBuild(buildProgression: ProducerBuildProgressionResult): NextGoalBlocking {
    if (buildProgression.blockingRequirements.length === 0) {
        return createUnblocked();
    }

    return {
        state: 'requirement_locked',
        requirements: buildProgression.blockingRequirements.map((requirement) => {
            if (requirement.type === 'producerLevel') {
                return {
                    type: 'producerLevel',
                    producerId: requirement.producerId,
                    requiredLevel: requirement.level,
                    currentLevel: requirement.currentLevel,
                };
            }
            return requirement;
        }),
    };
}

function createBlockingFromBreakthrough(lockedRequirements: readonly LockedBreakthroughRequirement[]): NextGoalBlocking {
    if (lockedRequirements.length === 0) {
        return createUnblocked();
    }

    return {
        state: 'requirement_locked',
        requirements: lockedRequirements.map((item) => createBlockingRequirementFromBreakthrough(item)),
    };
}

function createBlockingRequirementFromBreakthrough(item: LockedBreakthroughRequirement): NextGoalBlockingRequirement {
    const requirement = item.requirement;
    if (requirement.type === 'producerLevel') {
        return {
            type: 'producerLevel',
            producerId: requirement.producerId,
            requiredLevel: requirement.level,
            currentLevel: readNumericCurrentValue(item.currentValue, requirement.producerId),
        };
    }

    if (requirement.type === 'breakthroughOwned') {
        return {
            type: 'breakthroughOwned',
            breakthroughId: requirement.breakthroughId,
            isOwned: item.currentValue === true,
        };
    }

    if (requirement.type === 'robotsBuilt') {
        return {
            type: 'robotsBuilt',
            requiredCount: requirement.count,
            currentCount: readNumericCurrentValue(item.currentValue, 'robotsBuilt'),
        };
    }

    if (requirement.type === 'era') {
        return {
            type: 'era',
            eraId: requirement.eraId,
            currentEraId: typeof item.currentValue === 'string' ? item.currentValue : null,
        };
    }

    return {
        type: 'civilization',
        requiredCivilizationNumber: requirement.civilizationNumber,
        currentCivilizationNumber: readNumericCurrentValue(item.currentValue, 'civilizationNumber'),
    };
}

function createAffordability(cost: number | null, balance: number): NextGoalAffordability {
    if (cost === null) {
        return {
            state: 'not_applicable',
            cost: null,
            balance,
        };
    }

    return {
        state: balance >= cost ? 'affordable' : 'unaffordable',
        cost,
        balance,
    };
}

function createUnblocked(): NextGoalBlocking {
    return {
        state: 'unblocked',
        requirements: [],
    };
}

function createProgress(currentValue: number, requiredValue: number): NextGoalProgress {
    if (!Number.isFinite(currentValue) || !Number.isFinite(requiredValue) || requiredValue < 0) {
        throw new NextGoalInputError('progress values must be finite and requiredValue must be non-negative.');
    }

    return {
        currentValue,
        requiredValue,
        ratio: requiredValue <= 0 ? 1 : clampUnit(currentValue / requiredValue),
    };
}

function getCurrentEraOrder(repository: GameConfigRepository, state: GameState): number {
    return state.run.currentEraId === null ? -1 : getEraOrder(repository, state.run.currentEraId);
}

function requireProducer(repository: GameConfigRepository, producerId: string): ProducerConfig {
    const producer = repository.getProducer(producerId);
    if (producer === undefined) {
        throw new NextGoalInputError(`unknown producer id "${producerId}".`);
    }
    return producer;
}

function readNumericCurrentValue(value: number | string | boolean | null, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new NextGoalInputError(`${label} current value must be numeric.`);
    }
    return value;
}

function clampUnit(value: number): number {
    if (value <= 0) {
        return 0;
    }

    if (value >= 1) {
        return 1;
    }

    return value;
}

function freezeGoal<T extends NextGoal>(goal: T): T {
    return deepFreeze(goal);
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value) as T;
    }

    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
        return Object.freeze(value);
    }

    return value;
}
