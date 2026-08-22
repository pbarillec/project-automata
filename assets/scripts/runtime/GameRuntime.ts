import type { BreakthroughEffect, GameConfigRepository, ProducerConfig } from '../config/ConfigLoader.ts';
import type { DomainEvent, GameCommand } from '../domain/index.ts';
import {
    applyProductionMultiplier,
    calculateElapsedProduction,
    calculateMaxAffordableProducerPurchase,
    calculateProducerPurchaseCost,
    calculateRobotsBuiltFromRobotLineElapsedSeconds,
    calculateRobotsBuiltPerSecond,
    calculateMilestoneAdjustedProducerOutput,
    resolveCrossedProducerMilestones,
    resolveCrossedRobotsBuiltThresholds,
    combineModifierSets,
    resolveEffectiveProducerProductionMultiplier,
} from '../economy/index.ts';
import {
    AUTOMATED_FACTORY_ERA_ID,
    activateFreeOverclock,
    advanceTemporaryBoosts,
    applyDefaultAutomationForConstructedProducer,
    applyEraTransition,
    calculateAutomatedProductionPerSecond,
    createBreakthroughModifierSet,
    createTemporaryBoostModifierSet,
    getSecondsUntilNextTemporaryBoostTransition,
    purchaseBreakthrough,
    createPermanentUpgradeModifierSet,
    applyNewProducerConstructionCostMultiplier,
    resolveEffectiveMajorRequirement,
    resolveNewProducerConstructionCostMultiplier,
    resolvePermanentMilestonePowerBonus,
} from '../progression/index.ts';
import type { AutomationRunState, GameState, MetaState, ProducerRunState } from '../state/GameState.ts';
import { cloneGameState, clonePlainData } from '../state/StateClone.ts';
import { assertValidGameState } from '../state/StateValidation.ts';

export const MANUAL_PRODUCTION_AMOUNT = 1;
const ROBOT_LINE_PRODUCER_ID = 'robot_line';
const ROBOT_LINE_CONSTRUCTION_COST = 500000;

interface RuntimeProducerPurchase {
    readonly producerId: string;
    readonly currentLevel: number;
    readonly quantity: number;
    readonly nextLevel: number;
    readonly cost: number;
}

export type CommandRejectionReason =
    | 'malformed_command'
    | 'invalid_producer_id'
    | 'invalid_quantity'
    | 'invalid_elapsed_seconds'
    | 'boost_locked'
    | 'boost_already_active'
    | 'boost_suspended'
    | 'boost_on_cooldown'
    | 'locked_producer'
    | 'insufficient_balance'
    | 'no_affordable_levels'
    | 'unknown_breakthrough'
    | 'locked_breakthrough'
    | 'insufficient_breakthrough_balance'
    | 'breakthrough_already_owned'
    | 'invalid_resulting_state'
    | 'execution_error';

export interface CommandSuccessResult {
    readonly ok: true;
    readonly command: GameCommand;
    readonly events: readonly DomainEvent[];
}

export interface CommandRejectionResult {
    readonly ok: false;
    readonly reason: CommandRejectionReason;
    readonly message: string;
    readonly events: readonly DomainEvent[];
    readonly details?: Readonly<Record<string, unknown>>;
}

export type CommandExecutionResult = CommandSuccessResult | CommandRejectionResult;

export class GameRuntime {
    private currentState: GameState;
    private readonly repository: GameConfigRepository;

    constructor(repository: GameConfigRepository, initialState: GameState) {
        this.repository = repository;
        this.currentState = cloneGameState(assertValidGameState(initialState));
    }

    getStateSnapshot(): GameState {
        return cloneGameState(this.currentState);
    }

    getProductionPerSecond(): number {
        return calculateCurrentProductionPerSecond(this.repository, this.currentState);
    }

    getAutomatedProductionPerSecond(): number {
        return calculateAutomatedProductionPerSecond(this.repository, this.currentState);
    }

    calculateProductionForElapsedSeconds(elapsedSeconds: number): number {
        return calculateElapsedProduction(this.getProductionPerSecond(), elapsedSeconds);
    }

    calculateAutomationProductionForElapsedSeconds(elapsedSeconds: number): number {
        const draft = cloneGameState(this.currentState);
        const previousAmount = draft.run.industrialOutput;
        applyOnlineProductionAndBoostProgression(this.repository, draft, elapsedSeconds);
        return draft.run.industrialOutput - previousAmount;
    }

    getRobotsBuiltPerSecond(): number {
        return calculateCurrentRobotsBuiltPerSecond(this.currentState);
    }

    calculateRobotsBuiltForElapsedSeconds(elapsedSeconds: number): number {
        return calculateRobotsBuiltFromRobotLineElapsedSeconds(getRobotLineLevel(this.currentState), elapsedSeconds);
    }

    activateFreeOverclock(): CommandExecutionResult {
        return this.execute({ type: 'activateFreeOverclock' });
    }

    advanceAutomation(elapsedSeconds: number): CommandExecutionResult {
        return this.execute({ type: 'advanceAutomation', elapsedSeconds });
    }

    execute(command: unknown): CommandExecutionResult {
        const result = executeGameCommandInternal(this.repository, this.currentState, command);
        if (result.ok) {
            this.currentState = result.state;
            return freezeResult({
                ok: true,
                command: result.command,
                events: result.events,
            });
        }

        return result;
    }
}

interface InternalCommandSuccessResult {
    readonly ok: true;
    readonly command: GameCommand;
    readonly events: readonly DomainEvent[];
    readonly state: GameState;
}

type InternalCommandExecutionResult = InternalCommandSuccessResult | CommandRejectionResult;

export function executeGameCommand(
    repository: GameConfigRepository,
    state: GameState,
    command: unknown,
): CommandExecutionResult {
    const result = executeGameCommandInternal(repository, cloneGameState(state), command);
    if (result.ok) {
        return freezeResult({
            ok: true,
            command: result.command,
            events: result.events,
        });
    }

    return result;
}

function executeGameCommandInternal(
    repository: GameConfigRepository,
    state: GameState,
    command: unknown,
): InternalCommandExecutionResult {
    const parsedCommand = parseGameCommand(command);
    if (!parsedCommand.ok) {
        return parsedCommand;
    }

    try {
        if (parsedCommand.command.type === 'manualProduce') {
            return executeManualProduce(state, parsedCommand.command);
        }

        if (parsedCommand.command.type === 'advanceAutomation') {
            return executeAdvanceAutomation(repository, state, parsedCommand.command);
        }

        if (parsedCommand.command.type === 'activateFreeOverclock') {
            return executeActivateFreeOverclock(state, parsedCommand.command);
        }

        if (parsedCommand.command.type === 'buyProducerLevels') {
            return executeBuyProducerLevels(repository, state, parsedCommand.command);
        }

        if (parsedCommand.command.type === 'buyMaxProducerLevels') {
            return executeBuyMaxProducerLevels(repository, state, parsedCommand.command);
        }

        return executePurchaseBreakthrough(repository, state, parsedCommand.command);
    }
    catch (error) {
        return reject(
            'execution_error',
            error instanceof Error ? error.message : 'Command execution failed.',
        );
    }
}

export function calculateCurrentProductionPerSecond(repository: GameConfigRepository, state: GameState): number {
    const milestones = repository.listMilestones();
    const milestonePowerBonus = resolvePermanentMilestonePowerBonus(repository, state.meta);
    const modifierSet = combineModifierSets([
        createBreakthroughModifierSet(repository, state),
        createPermanentUpgradeModifierSet(repository, state),
        createTemporaryBoostModifierSet(state.boosts),
    ]);
    let total = 0;

    for (const producer of repository.listProducers()) {
        const level = state.run.producers[producer.id]?.level ?? 0;
        const milestoneAdjusted = calculateMilestoneAdjustedProducerOutput(producer, level, milestones, milestonePowerBonus);
        const modifier = resolveEffectiveProducerProductionMultiplier(modifierSet, producer.id);
        total = addFinite(total, applyProductionMultiplier(milestoneAdjusted, modifier), 'productionPerSecond');
    }

    return total;
}

export function calculateCurrentRobotsBuiltPerSecond(state: GameState): number {
    return calculateRobotsBuiltPerSecond(getRobotLineLevel(state));
}

function calculateRuntimeProducerPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    currentLevel: number,
    quantity: number,
): RuntimeProducerPurchase {
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

function calculateMaxAffordableRuntimeProducerPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    currentLevel: number,
    balance: number,
): RuntimeProducerPurchase {
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

function calculateConstructionAdjustedProducerPurchase(
    repository: GameConfigRepository,
    meta: MetaState,
    producer: ProducerConfig,
    quantity: number,
): RuntimeProducerPurchase {
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
): RuntimeProducerPurchase {
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

function executeAdvanceAutomation(
    repository: GameConfigRepository,
    state: GameState,
    command: GameCommand & { type: 'advanceAutomation' },
): InternalCommandExecutionResult {
    const draft = cloneGameState(state);
    const productionAndBoostEvents = applyOnlineProductionAndBoostProgression(repository, draft, command.elapsedSeconds);
    const robotsBuilt = calculateRobotsBuiltFromRobotLineElapsedSeconds(getRobotLineLevel(state), command.elapsedSeconds);

    if (productionAndBoostEvents.length === 0 && robotsBuilt === 0) {
        return commit(command, draft, []);
    }

    const events: DomainEvent[] = [...productionAndBoostEvents];

    if (robotsBuilt > 0) {
        const previousRobotsBuilt = draft.run.robotsBuilt;
        draft.run.robotsBuilt = addFinite(draft.run.robotsBuilt, robotsBuilt, 'robotsBuilt');
        draft.run.statistics.robotsBuiltPeak = Math.max(draft.run.statistics.robotsBuiltPeak, draft.run.robotsBuilt);
        draft.lifetime.robotsBuilt = addFinite(draft.lifetime.robotsBuilt, robotsBuilt, 'lifetime.robotsBuilt');

        for (const threshold of resolveCrossedRobotsBuiltThresholds(previousRobotsBuilt, draft.run.robotsBuilt)) {
            events.push({
                type: 'robotsBuiltThresholdReached',
                threshold,
                previousAmount: previousRobotsBuilt,
                newAmount: draft.run.robotsBuilt,
            });
        }
    }

    return commit(command, draft, events);
}

function executeActivateFreeOverclock(
    state: GameState,
    command: GameCommand & { type: 'activateFreeOverclock' },
): InternalCommandExecutionResult {
    const result = activateFreeOverclock(state);

    if (result.status !== 'activated') {
        return reject(mapBoostActivationStatusToRejectionReason(result.status), createBoostActivationRejectionMessage(result.status), {
            boostId: 'free_overclock',
            remainingCooldownSeconds: result.remainingCooldownSeconds,
        });
    }

    const draft = cloneGameState(state);
    draft.boosts = result.boosts;

    return commit(command, draft, result.events);
}

function applyOnlineProductionAndBoostProgression(
    repository: GameConfigRepository,
    draft: GameState,
    elapsedSeconds: number,
): DomainEvent[] {
    let remainingSeconds = elapsedSeconds;
    const events: DomainEvent[] = [];

    while (remainingSeconds > 0) {
        const nextBoostTransitionSeconds = getSecondsUntilNextTemporaryBoostTransition(draft.boosts);
        const segmentSeconds = nextBoostTransitionSeconds === null
            ? remainingSeconds
            : Math.min(remainingSeconds, nextBoostTransitionSeconds);

        if (segmentSeconds <= 0) {
            break;
        }

        const productionPerSecond = calculateAutomatedProductionPerSecond(repository, draft);
        const produced = calculateElapsedProduction(productionPerSecond, segmentSeconds);
        if (produced > 0) {
            const previousAmount = draft.run.industrialOutput;
            draft.run.industrialOutput = addFinite(draft.run.industrialOutput, produced, 'industrialOutput');
            draft.run.statistics.industrialOutputEarned = addFinite(
                draft.run.statistics.industrialOutputEarned,
                produced,
                'run.statistics.industrialOutputEarned',
            );
            draft.lifetime.industrialOutputEarned = addFinite(
                draft.lifetime.industrialOutputEarned,
                produced,
                'lifetime.industrialOutputEarned',
            );

            events.push(
                {
                    type: 'productionGranted',
                    source: 'automation',
                    amount: produced,
                },
                industrialOutputChanged(previousAmount, draft.run.industrialOutput, 'automation_production'),
            );
        }

        const boostResult = advanceTemporaryBoosts(draft.boosts, segmentSeconds);
        draft.boosts = boostResult.boosts;
        events.push(...boostResult.events);

        remainingSeconds = clampNegativeZero(remainingSeconds - segmentSeconds);
    }

    return events;
}

function executeManualProduce(state: GameState, command: GameCommand & { type: 'manualProduce' }): InternalCommandExecutionResult {
    const draft = cloneGameState(state);
    const previousAmount = draft.run.industrialOutput;
    draft.run.industrialOutput = addFinite(draft.run.industrialOutput, MANUAL_PRODUCTION_AMOUNT, 'industrialOutput');
    draft.run.statistics.industrialOutputEarned = addFinite(
        draft.run.statistics.industrialOutputEarned,
        MANUAL_PRODUCTION_AMOUNT,
        'run.statistics.industrialOutputEarned',
    );
    draft.run.statistics.manualProductionActions += 1;
    draft.lifetime.industrialOutputEarned = addFinite(
        draft.lifetime.industrialOutputEarned,
        MANUAL_PRODUCTION_AMOUNT,
        'lifetime.industrialOutputEarned',
    );
    draft.lifetime.manualProductionActions += 1;

    return commit(command, draft, [
        {
            type: 'productionGranted',
            source: 'manual',
            amount: MANUAL_PRODUCTION_AMOUNT,
        },
        industrialOutputChanged(previousAmount, draft.run.industrialOutput, 'manual_production'),
    ]);
}

function executeBuyProducerLevels(
    repository: GameConfigRepository,
    state: GameState,
    command: GameCommand & { type: 'buyProducerLevels' },
): InternalCommandExecutionResult {
    const producer = repository.getProducer(command.producerId);
    if (producer === undefined) {
        return reject('invalid_producer_id', `Unknown producer id "${command.producerId}".`, { producerId: command.producerId });
    }

    const currentLevel = state.run.producers[producer.id]?.level ?? 0;
    if (currentLevel === 0) {
        const constructionLock = evaluateProducerConstructionLock(repository, state, producer.id);
        if (constructionLock !== undefined) {
            return reject('locked_producer', `Producer "${producer.id}" is locked for construction.`, constructionLock);
        }
    }

    const purchase = calculateRuntimeProducerPurchase(repository, state.meta, producer, currentLevel, command.quantity);
    if (purchase.cost > state.run.industrialOutput) {
        return reject('insufficient_balance', 'Insufficient Industrial Output for producer purchase.', {
            producerId: producer.id,
            cost: purchase.cost,
            balance: state.run.industrialOutput,
        });
    }

    return applyProducerPurchase(repository, state, command, producer.id, purchase.quantity, purchase.cost);
}

function executeBuyMaxProducerLevels(
    repository: GameConfigRepository,
    state: GameState,
    command: GameCommand & { type: 'buyMaxProducerLevels' },
): InternalCommandExecutionResult {
    const producer = repository.getProducer(command.producerId);
    if (producer === undefined) {
        return reject('invalid_producer_id', `Unknown producer id "${command.producerId}".`, { producerId: command.producerId });
    }

    const currentLevel = state.run.producers[producer.id]?.level ?? 0;
    if (currentLevel === 0) {
        const constructionLock = evaluateProducerConstructionLock(repository, state, producer.id);
        if (constructionLock !== undefined) {
            return reject('locked_producer', `Producer "${producer.id}" is locked for construction.`, constructionLock);
        }
    }

    const purchase = calculateMaxAffordableRuntimeProducerPurchase(repository, state.meta, producer, currentLevel, state.run.industrialOutput);
    if (purchase.quantity === 0) {
        return reject('no_affordable_levels', 'No affordable producer levels are available.', {
            producerId: producer.id,
            balance: state.run.industrialOutput,
        });
    }

    return applyProducerPurchase(repository, state, command, producer.id, purchase.quantity, purchase.cost);
}

function applyProducerPurchase(
    repository: GameConfigRepository,
    state: GameState,
    command: GameCommand,
    producerId: string,
    quantity: number,
    cost: number,
): InternalCommandExecutionResult {
    const draft = cloneGameState(state);
    const previousAmount = draft.run.industrialOutput;
    const existingProducer = draft.run.producers[producerId];
    const oldLevel = existingProducer?.level ?? 0;
    const newLevel = oldLevel + quantity;

    draft.run.industrialOutput = clampNegativeZero(subtractFinite(draft.run.industrialOutput, cost, 'industrialOutput'));
    draft.run.statistics.industrialOutputSpent = addFinite(
        draft.run.statistics.industrialOutputSpent,
        cost,
        'run.statistics.industrialOutputSpent',
    );
    draft.run.statistics.producerLevelsPurchased += quantity;
    draft.lifetime.producerLevelsPurchased += quantity;
    draft.run.producers[producerId] = {
        level: newLevel,
        isUnlocked: true,
        isBuilt: true,
    };

    const events: DomainEvent[] = [
        industrialOutputChanged(previousAmount, draft.run.industrialOutput, 'producer_purchase'),
        {
            type: 'producerLevelsPurchased',
            producerId,
            quantity,
            oldLevel,
            newLevel,
            cost,
        },
    ];

    if ((existingProducer?.isBuilt ?? false) === false && oldLevel === 0) {
        events.push({
            type: 'producerConstructed',
            producerId,
            level: newLevel,
            source: 'producer_purchase',
        });

        applyDefaultAutomationForConstructedProducer(repository, draft, producerId);
        const automation = draft.run.automation[producerId];
        if (automation !== undefined) {
            events.push({
                type: 'automationStateChanged',
                producerId,
                isAutomated: automation.isAutomated,
                isOfflineEligible: automation.isOfflineEligible,
                unlockedByBreakthroughId: automation.unlockedByBreakthroughId,
            });
        }

        if (producerId === ROBOT_LINE_PRODUCER_ID) {
            const transition = applyEraTransition(repository, draft, AUTOMATED_FACTORY_ERA_ID);
            if (transition.changed) {
                events.push({
                    type: 'eraChanged',
                    oldEraId: transition.oldEraId,
                    newEraId: transition.newEraId,
                });
            }
        }
    }

    for (const milestone of resolveCrossedProducerMilestones(repository.listMilestones(), oldLevel, newLevel)) {
        events.push({
            type: 'producerMilestoneReached',
            producerId,
            milestoneId: milestone.id,
            threshold: milestone.threshold,
            productionMultiplier: milestone.productionMultiplier,
            cumulativeMultiplierAfterCrossing: milestone.cumulativeMultiplierAfterCrossing,
        });
    }

    return commit(command, draft, events);
}

function executePurchaseBreakthrough(
    repository: GameConfigRepository,
    state: GameState,
    command: GameCommand & { type: 'purchaseBreakthrough' },
): InternalCommandExecutionResult {
    const beforeState = cloneGameState(state);
    const result = purchaseBreakthrough(repository, state, command.breakthroughId);

    if (result.status === 'unknown_breakthrough') {
        return reject('unknown_breakthrough', `Unknown breakthrough id "${command.breakthroughId}".`, {
            breakthroughId: command.breakthroughId,
        });
    }

    if (result.status === 'already_owned') {
        return reject('breakthrough_already_owned', `Breakthrough "${command.breakthroughId}" is already owned.`, {
            breakthroughId: command.breakthroughId,
        });
    }

    if (result.status === 'locked') {
        return reject('locked_breakthrough', `Breakthrough "${command.breakthroughId}" is locked.`, {
            breakthroughId: command.breakthroughId,
            lockedRequirements: clonePlainData(result.lockedRequirements),
        });
    }

    if (result.status === 'insufficient_balance') {
        return reject('insufficient_breakthrough_balance', 'Insufficient Industrial Output for breakthrough purchase.', {
            breakthroughId: command.breakthroughId,
            cost: result.cost,
            balance: result.balance,
        });
    }

    const breakthrough = repository.getBreakthrough(command.breakthroughId);
    if (breakthrough === undefined) {
        return reject('unknown_breakthrough', `Unknown breakthrough id "${command.breakthroughId}".`, {
            breakthroughId: command.breakthroughId,
        });
    }

    return commit(command, result.state, [
        industrialOutputChanged(beforeState.run.industrialOutput, result.state.run.industrialOutput, 'breakthrough_purchase'),
        {
            type: 'breakthroughPurchased',
            breakthroughId: command.breakthroughId,
            cost: result.cost,
        },
        ...createBreakthroughEffectEvents(beforeState, result.state, command.breakthroughId, breakthrough.effects),
    ]);
}

function createBreakthroughEffectEvents(
    beforeState: GameState,
    afterState: GameState,
    breakthroughId: string,
    effects: readonly BreakthroughEffect[],
): DomainEvent[] {
    const events: DomainEvent[] = [];

    for (const effect of effects) {
        if (effect.type === 'setProducerAutomation') {
            const before = beforeState.run.automation[effect.producerId];
            const after = afterState.run.automation[effect.producerId];
            if (after !== undefined && !automationStatesEqual(before, after)) {
                events.push({
                    type: 'automationStateChanged',
                    producerId: effect.producerId,
                    isAutomated: after.isAutomated,
                    isOfflineEligible: after.isOfflineEligible,
                    unlockedByBreakthroughId: after.unlockedByBreakthroughId,
                });
            }
            continue;
        }

        if (effect.type === 'constructProducer') {
            const before = beforeState.run.producers[effect.producerId];
            const after = afterState.run.producers[effect.producerId];
            if (after !== undefined && producerWasConstructed(before, after)) {
                events.push({
                    type: 'producerConstructed',
                    producerId: effect.producerId,
                    level: after.level,
                    source: 'breakthrough',
                    breakthroughId,
                });
            }

            const beforeAutomation = beforeState.run.automation[effect.producerId];
            const afterAutomation = afterState.run.automation[effect.producerId];
            if (afterAutomation !== undefined && !automationStatesEqual(beforeAutomation, afterAutomation)) {
                events.push({
                    type: 'automationStateChanged',
                    producerId: effect.producerId,
                    isAutomated: afterAutomation.isAutomated,
                    isOfflineEligible: afterAutomation.isOfflineEligible,
                    unlockedByBreakthroughId: afterAutomation.unlockedByBreakthroughId,
                });
            }
            continue;
        }

        if (effect.type === 'enterEra') {
            if (beforeState.run.currentEraId !== afterState.run.currentEraId && afterState.run.currentEraId !== null) {
                events.push({
                    type: 'eraChanged',
                    oldEraId: beforeState.run.currentEraId,
                    newEraId: afterState.run.currentEraId,
                    breakthroughId,
                });
            }
            continue;
        }

        if (effect.type === 'setProgressionFlag') {
            if (beforeState.run.progressionFlags[effect.flagId] !== afterState.run.progressionFlags[effect.flagId]) {
                events.push({
                    type: 'progressionFlagChanged',
                    flagId: effect.flagId,
                    value: afterState.run.progressionFlags[effect.flagId],
                    breakthroughId,
                });

                if (effect.flagId === 'first_robot' && afterState.run.progressionFlags[effect.flagId] === true) {
                    events.push({
                        type: 'firstRobotProduced',
                        breakthroughId,
                    });
                }
            }
        }
    }

    return events;
}

function parseGameCommand(command: unknown): { ok: true; command: GameCommand } | CommandRejectionResult {
    if (!isPlainRecord(command)) {
        return reject('malformed_command', 'Command must be a plain object.');
    }

    if (command.type === 'manualProduce') {
        return { ok: true, command: { type: 'manualProduce' } };
    }

    if (command.type === 'activateFreeOverclock') {
        return { ok: true, command: { type: 'activateFreeOverclock' } };
    }

    if (command.type === 'advanceAutomation') {
        if (typeof command.elapsedSeconds !== 'number' || !Number.isFinite(command.elapsedSeconds) || command.elapsedSeconds < 0) {
            return reject('invalid_elapsed_seconds', 'elapsedSeconds must be a non-negative finite number.');
        }

        return {
            ok: true,
            command: {
                type: 'advanceAutomation',
                elapsedSeconds: command.elapsedSeconds,
            },
        };
    }

    if (command.type === 'buyProducerLevels') {
        if (typeof command.producerId !== 'string' || command.producerId.length === 0) {
            return reject('invalid_producer_id', 'producerId must be a non-empty string.');
        }

        if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0) {
            return reject('invalid_quantity', 'quantity must be a positive safe integer.');
        }

        return {
            ok: true,
            command: {
                type: 'buyProducerLevels',
                producerId: command.producerId,
                quantity: command.quantity,
            },
        };
    }

    if (command.type === 'buyMaxProducerLevels') {
        if (typeof command.producerId !== 'string' || command.producerId.length === 0) {
            return reject('invalid_producer_id', 'producerId must be a non-empty string.');
        }

        return {
            ok: true,
            command: {
                type: 'buyMaxProducerLevels',
                producerId: command.producerId,
            },
        };
    }

    if (command.type === 'purchaseBreakthrough') {
        if (typeof command.breakthroughId !== 'string' || command.breakthroughId.length === 0) {
            return reject('malformed_command', 'breakthroughId must be a non-empty string.');
        }

        return {
            ok: true,
            command: {
                type: 'purchaseBreakthrough',
                breakthroughId: command.breakthroughId,
            },
        };
    }

    return reject('malformed_command', 'Unsupported command type.', {
        type: typeof command.type === 'string' ? command.type : null,
    });
}

function commit(command: GameCommand, draft: GameState, events: readonly DomainEvent[]): InternalCommandExecutionResult {
    try {
        assertValidGameState(draft);
    }
    catch (error) {
        return reject('invalid_resulting_state', error instanceof Error ? error.message : 'Resulting state failed validation.');
    }

    return {
        ok: true,
        command,
        events: freezeEvents(events),
        state: draft,
    };
}

function reject(
    reason: CommandRejectionReason,
    message: string,
    details?: Readonly<Record<string, unknown>>,
): CommandRejectionResult {
    return freezeResult({
        ok: false,
        reason,
        message,
        events: [],
        details: details === undefined ? undefined : deepFreeze(clonePlainData(details)),
    });
}

function industrialOutputChanged(
    previousAmount: number,
    newAmount: number,
    reason: 'manual_production' | 'automation_production' | 'producer_purchase' | 'breakthrough_purchase',
): DomainEvent {
    return {
        type: 'industrialOutputChanged',
        previousAmount,
        newAmount,
        delta: newAmount - previousAmount,
        reason,
    };
}

function mapBoostActivationStatusToRejectionReason(
    status: Exclude<ReturnType<typeof activateFreeOverclock>['status'], 'activated'>,
): CommandRejectionReason {
    if (status === 'locked') {
        return 'boost_locked';
    }

    if (status === 'already_active') {
        return 'boost_already_active';
    }

    if (status === 'suspended') {
        return 'boost_suspended';
    }

    return 'boost_on_cooldown';
}

function createBoostActivationRejectionMessage(
    status: Exclude<ReturnType<typeof activateFreeOverclock>['status'], 'activated'>,
): string {
    if (status === 'locked') {
        return 'Free Overclock is locked.';
    }

    if (status === 'already_active') {
        return 'Free Overclock is already active.';
    }

    if (status === 'suspended') {
        return 'Free Overclock is suspended.';
    }

    return 'Free Overclock is on cooldown.';
}

function evaluateProducerConstructionLock(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
): Readonly<Record<string, unknown>> | undefined {
    if (producerId === 'fabricator') {
        return undefined;
    }

    if (producerId === 'assembly_station') {
        return isBuilt(state, 'fabricator')
            ? undefined
            : { producerId, missingProducerIds: ['fabricator'] };
    }

    if (producerId === ROBOT_LINE_PRODUCER_ID) {
        const requiredFabricatorLevel = resolveEffectiveMajorRequirement(repository, state.meta, 50);
        const requiredAssemblyLevel = resolveEffectiveMajorRequirement(repository, state.meta, 25);
        const missingBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics']
            .filter((breakthroughId) => !state.run.purchasedBreakthroughIds.includes(breakthroughId));
        const missingProducerLevels = [
            { producerId: 'fabricator', level: requiredFabricatorLevel, currentLevel: state.run.producers.fabricator?.level ?? 0 },
            { producerId: 'assembly_station', level: requiredAssemblyLevel, currentLevel: state.run.producers.assembly_station?.level ?? 0 },
        ].filter((requirement) => requirement.currentLevel < requirement.level);

        if (missingBreakthroughIds.length === 0 && missingProducerLevels.length === 0) {
            return undefined;
        }

        return { producerId, missingBreakthroughIds, missingProducerLevels };
    }

    if (producerId === 'automated_cell') {
        return isBuilt(state, 'automated_cell')
            ? undefined
            : { producerId, requiredBreakthroughId: 'automated_cell_architecture' };
    }

    if (producerId === 'advanced_robotics_complex') {
        return isBuilt(state, 'advanced_robotics_complex')
            ? undefined
            : { producerId, requiredBreakthroughId: 'advanced_robotics' };
    }

    return undefined;
}

function isBuilt(state: GameState, producerId: string): boolean {
    const producer = state.run.producers[producerId];
    return producer !== undefined && producer.isBuilt && producer.level > 0;
}

function getRobotLineLevel(state: GameState): number {
    return state.run.producers[ROBOT_LINE_PRODUCER_ID]?.level ?? 0;
}

function automationStatesEqual(left: AutomationRunState | undefined, right: AutomationRunState | undefined): boolean {
    return left?.isAutomated === right?.isAutomated &&
        left?.isOfflineEligible === right?.isOfflineEligible &&
        left?.unlockedByBreakthroughId === right?.unlockedByBreakthroughId;
}

function producerWasConstructed(before: ProducerRunState | undefined, after: ProducerRunState): boolean {
    return (before?.isBuilt ?? false) === false && after.isBuilt && after.level > 0;
}

function subtractFinite(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} subtraction exceeds JavaScript Number range.`);
    }
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label} addition exceeds JavaScript Number range.`);
    }
    return result;
}

function clampNegativeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

function freezeEvents(events: readonly DomainEvent[]): readonly DomainEvent[] {
    return Object.freeze(events.map((event) => Object.freeze(clonePlainData(event))));
}

function freezeResult<T extends CommandExecutionResult>(result: T): T {
    return deepFreeze(result);
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value) as T;
    }

    if (isPlainRecord(value)) {
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
        return Object.freeze(value) as T;
    }

    return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
