import type { GameConfigRepository, ProducerConfig } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { CommandExecutionResult } from '../runtime/index.ts';
import {
    calculateMaxAffordableProducerProgressionPurchase,
    calculateProducerProgressionPurchase,
    evaluateBreakthroughEligibility,
    evaluateProducerBuildProgression,
    getSecondsUntilNextTemporaryBoostTransition,
    isFreeOverclockUnlocked,
    resolveNextGoal,
    type LockedBreakthroughRequirement,
    type NextGoal,
    type NextGoalBlockingRequirement,
} from '../progression/index.ts';
import { HeadlessSimulator, SimulationGuardError } from './HeadlessSimulator.ts';
import {
    PRESTIGE_FRONTIER_LEVEL,
    PRESTIGE_FRONTIER_PRODUCER_ID,
    REPRESENTATIVE_ACTIVE_BASELINE_SECONDS,
} from './ReferenceActiveScenario.ts';
import type {
    SimulationStrategy,
    SimulationStrategyContext,
    SimulationStrategyFamily,
    SimulationStrategyRunSummary,
} from './SimulationStrategy.ts';

export const ACTIVE_STRATEGY_ID = 'active.v1';
export const NORMAL_STRATEGY_ID = 'normal.v1';
export const PASSIVE_STRATEGY_ID = 'passive.v1';
export const OPTIMIZED_STRATEGY_ID = 'optimized.v1';

const DEFAULT_MAX_SIMULATED_SECONDS = 12 * 60 * 60;
const DEFAULT_NORMAL_MAX_SIMULATED_SECONDS = 48 * 60 * 60;
const DEFAULT_PASSIVE_MAX_SIMULATED_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_POLICY_DECISIONS = 20000;
const BALANCE_TOLERANCE = 1e-9;

export type SimulationStrategyTarget =
    | {
        readonly type: 'producerLevel';
        readonly producerId: string;
        readonly level: number;
    }
    | {
        readonly type: 'breakthroughOwned';
        readonly breakthroughId: string;
    }
    | {
        readonly type: 'eraReached';
        readonly eraId: string;
    };

export interface ProgressionPolicyStrategyConfig extends Readonly<Record<string, unknown>> {
    readonly target: SimulationStrategyTarget;
    readonly maxSimulatedSeconds: number;
    readonly maxPolicyDecisions: number;
    readonly decisionIntervalSeconds: number;
    readonly manualActionSeconds: number;
    readonly maxLevelsPerPurchase: number | null;
    readonly maxPurchaseBatchesPerDecision: number;
    readonly actionDelaySeconds: number;
    readonly useFreeOverclock: boolean;
    readonly reactToBoostTransitions: boolean;
}

export type ActiveStrategyConfig = Partial<ProgressionPolicyStrategyConfig>;
export type NormalStrategyConfig = Partial<ProgressionPolicyStrategyConfig>;
export type PassiveStrategyConfig = Partial<ProgressionPolicyStrategyConfig>;
export type OptimizedStrategyConfig = Partial<ProgressionPolicyStrategyConfig> & {
    readonly target?: SimulationStrategyTarget;
};

interface NormalizedProgressionPolicyStrategyConfig extends ProgressionPolicyStrategyConfig {
    readonly target: SimulationStrategyTarget;
}

interface ProgressionStrategyDefinition {
    readonly id: string;
    readonly family: SimulationStrategyFamily;
    readonly config: NormalizedProgressionPolicyStrategyConfig;
    readonly assumptions: readonly string[];
    readonly representativeBaselineSeconds?: Readonly<Record<string, number>>;
}

export function createActiveSimulationStrategy(config: ActiveStrategyConfig = {}): SimulationStrategy<ProgressionPolicyStrategyConfig> {
    return createProgressionPolicyStrategy({
        id: ACTIVE_STRATEGY_ID,
        family: 'active',
        config: normalizeProgressionConfig(config, {
            target: defaultPrestigeFrontierTarget(),
            maxSimulatedSeconds: DEFAULT_MAX_SIMULATED_SECONDS,
            maxPolicyDecisions: DEFAULT_MAX_POLICY_DECISIONS,
            decisionIntervalSeconds: 60,
            manualActionSeconds: 0.05,
            maxLevelsPerPurchase: null,
            maxPurchaseBatchesPerDecision: 1000,
            actionDelaySeconds: 0,
            useFreeOverclock: true,
            reactToBoostTransitions: true,
        }),
        assumptions: Object.freeze([
            'Checks progression frequently during active play.',
            'Buys legal Next Goal blockers and targets promptly with no purchase batching delay.',
            'Uses Free Overclock immediately whenever it is legally available.',
            'Stops at the configured target rather than executing Reboot.',
        ]),
        representativeBaselineSeconds: REPRESENTATIVE_ACTIVE_BASELINE_SECONDS,
    });
}

export function createNormalSimulationStrategy(config: NormalStrategyConfig = {}): SimulationStrategy<ProgressionPolicyStrategyConfig> {
    return createProgressionPolicyStrategy({
        id: NORMAL_STRATEGY_ID,
        family: 'normal',
        config: normalizeProgressionConfig(config, {
            target: defaultPrestigeFrontierTarget(),
            maxSimulatedSeconds: DEFAULT_NORMAL_MAX_SIMULATED_SECONDS,
            maxPolicyDecisions: DEFAULT_MAX_POLICY_DECISIONS,
            decisionIntervalSeconds: 15 * 60,
            manualActionSeconds: 1,
            maxLevelsPerPurchase: 10,
            maxPurchaseBatchesPerDecision: 1,
            actionDelaySeconds: 30,
            useFreeOverclock: true,
            reactToBoostTransitions: false,
        }),
        assumptions: Object.freeze([
            'Checks progression on a configurable slower active-session cadence.',
            'Uses modest purchase batches and a configurable post-action delay.',
            'Uses Free Overclock only when it is available at a decision check.',
            'Does not receive offline rewards or automatic progression decisions.',
        ]),
    });
}

export function createPassiveSimulationStrategy(config: PassiveStrategyConfig = {}): SimulationStrategy<ProgressionPolicyStrategyConfig> {
    return createProgressionPolicyStrategy({
        id: PASSIVE_STRATEGY_ID,
        family: 'passive',
        config: normalizeProgressionConfig(config, {
            target: defaultPrestigeFrontierTarget(),
            maxSimulatedSeconds: DEFAULT_PASSIVE_MAX_SIMULATED_SECONDS,
            maxPolicyDecisions: DEFAULT_MAX_POLICY_DECISIONS,
            decisionIntervalSeconds: 8 * 60 * 60,
            manualActionSeconds: 2,
            maxLevelsPerPurchase: 10,
            maxPurchaseBatchesPerDecision: 1,
            actionDelaySeconds: 3 * 60,
            useFreeOverclock: false,
            reactToBoostTransitions: false,
        }),
        assumptions: Object.freeze([
            'Represents sparse active-session checks, not AUT-027 offline progress.',
            'Production advances through active-session simulator time only.',
            'Uses small purchase batches with long configurable gaps between decisions.',
            'Does not use Free Overclock by default because availability is easily missed.',
        ]),
    });
}

export function createOptimizedSimulationStrategy(config: OptimizedStrategyConfig = {}): SimulationStrategy<ProgressionPolicyStrategyConfig> {
    return createProgressionPolicyStrategy({
        id: OPTIMIZED_STRATEGY_ID,
        family: 'optimized',
        config: normalizeProgressionConfig(config, {
            target: defaultPrestigeFrontierTarget(),
            maxSimulatedSeconds: DEFAULT_MAX_SIMULATED_SECONDS,
            maxPolicyDecisions: DEFAULT_MAX_POLICY_DECISIONS,
            decisionIntervalSeconds: 30,
            manualActionSeconds: 0.05,
            maxLevelsPerPurchase: null,
            maxPurchaseBatchesPerDecision: 1000,
            actionDelaySeconds: 0,
            useFreeOverclock: true,
            reactToBoostTransitions: true,
        }),
        assumptions: Object.freeze([
            'Targets the configured progression state with legal runtime commands only.',
            'Uses Next Goal and affordability metadata to satisfy blocking requirements before frontier pushes.',
            'Uses maximum legal affordable purchases toward the current target.',
            'Breaks ties by repository order, then stable id order where repository data does not define order.',
        ]),
        representativeBaselineSeconds: REPRESENTATIVE_ACTIVE_BASELINE_SECONDS,
    });
}

function createProgressionPolicyStrategy(
    definition: ProgressionStrategyDefinition,
): SimulationStrategy<ProgressionPolicyStrategyConfig> {
    return Object.freeze({
        id: definition.id,
        family: definition.family,
        config: definition.config,
        assumptions: definition.assumptions,
        representativeBaselineSeconds: definition.representativeBaselineSeconds,
        run(context: SimulationStrategyContext): SimulationStrategyRunSummary {
            return runProgressionPolicy(context.repository, context.simulator, definition.config);
        },
    });
}

function runProgressionPolicy(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
): SimulationStrategyRunSummary {
    recordCivilizationOneCheckpoints(simulator);

    for (let decisionCount = 0; decisionCount < settings.maxPolicyDecisions; decisionCount += 1) {
        if (isTargetReached(repository, simulator, settings.target)) {
            recordCivilizationOneCheckpoints(simulator);
            return {
                completed: true,
                decisionCount,
                terminationReason: `target:${settings.target.type}`,
            };
        }

        if (simulator.simulatedTimeSeconds > settings.maxSimulatedSeconds) {
            throw new SimulationGuardError(
                `Strategy exceeded ${settings.maxSimulatedSeconds} simulated seconds before reaching ${settings.target.type}.`,
            );
        }

        performProgressionDecision(repository, simulator, settings);
        recordCivilizationOneCheckpoints(simulator);
    }

    throw new SimulationGuardError(
        `Strategy exhausted ${settings.maxPolicyDecisions} policy decisions before reaching ${settings.target.type}.`,
    );
}

function performProgressionDecision(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
): void {
    activateFreeOverclockIfConfigured(simulator, settings);

    if (settings.target.type === 'producerLevel' &&
        readProducerLevel(simulator, settings.target.producerId) > 0) {
        buyProducerTowardLevel(repository, simulator, settings.target.producerId, settings.target.level, settings);
        return;
    }

    const goal = resolveNextGoal(repository, simulator.getStateSnapshot());

    if (goal.blocking.state === 'requirement_locked') {
        satisfyBlockingRequirements(repository, simulator, settings, goal.blocking.requirements);
        return;
    }

    if (goal.category === 'producer_build') {
        buyProducerTowardLevel(repository, simulator, goal.producerId, goal.targetLevel, settings);
        return;
    }

    if (goal.category === 'producer_milestone') {
        buyProducerTowardLevel(repository, simulator, goal.producerId, goal.threshold, settings);
        return;
    }

    if (goal.category === 'breakthrough') {
        purchaseBreakthroughWhenReady(repository, simulator, goal.breakthroughId, settings);
        return;
    }

    if (goal.category === 'era') {
        executeEraGoal(repository, simulator, settings, goal);
        return;
    }

    if (goal.category === 'reboot_ai_core' || goal.category === 'none') {
        if (settings.target.type === 'producerLevel' &&
            readProducerLevel(simulator, settings.target.producerId) > 0) {
            buyProducerTowardLevel(repository, simulator, settings.target.producerId, settings.target.level, settings);
            return;
        }
        throw new SimulationGuardError(`Strategy cannot progress from Next Goal "${goal.id}".`);
    }

    assertNeverGoal(goal);
}

function executeEraGoal(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
    goal: Extract<NextGoal, { category: 'era' }>,
): void {
    if (goal.source?.kind === 'producer') {
        const buildProgression = evaluateProducerBuildProgression(repository, simulator.getStateSnapshot(), goal.source.producerId);
        if (buildProgression.targetLevel === null) {
            throw new SimulationGuardError(`Era producer goal "${goal.id}" has no build target.`);
        }
        buyProducerTowardLevel(repository, simulator, goal.source.producerId, buildProgression.targetLevel, settings);
        return;
    }

    if (goal.source?.kind === 'breakthrough') {
        purchaseBreakthroughWhenReady(repository, simulator, goal.source.breakthroughId, settings);
        return;
    }

    throw new SimulationGuardError(`Era goal "${goal.id}" has no executable source.`);
}

function satisfyBlockingRequirements(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
    requirements: readonly NextGoalBlockingRequirement[],
): void {
    for (const requirement of requirements) {
        if (requirement.type === 'producerLevel') {
            buyProducerTowardLevel(repository, simulator, requirement.producerId, requirement.requiredLevel, settings);
            return;
        }

        if (requirement.type === 'producerBuilt') {
            const buildProgression = evaluateProducerBuildProgression(repository, simulator.getStateSnapshot(), requirement.producerId);
            if (buildProgression.targetLevel === null) {
                throw new SimulationGuardError(`Producer "${requirement.producerId}" cannot be built from the current state.`);
            }
            buyProducerTowardLevel(repository, simulator, requirement.producerId, buildProgression.targetLevel, settings);
            return;
        }

        if (requirement.type === 'breakthroughOwned' || requirement.type === 'breakthroughConstruction') {
            purchaseBreakthroughWhenReady(repository, simulator, requirement.breakthroughId, settings);
            return;
        }

        if (requirement.type === 'robotsBuilt') {
            waitUntilCondition(
                simulator,
                settings,
                (snapshot) => snapshot.state.run.robotsBuilt >= requirement.requiredCount,
            );
            return;
        }

        if (requirement.type === 'era' || requirement.type === 'civilization') {
            throw new SimulationGuardError(`Strategy cannot directly satisfy ${requirement.type} blocker.`);
        }

        assertNeverRequirement(requirement);
    }
}

function buyProducerTowardLevel(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    producerId: string,
    targetLevel: number,
    settings: NormalizedProgressionPolicyStrategyConfig,
): void {
    const producer = requireProducer(repository, producerId);
    let batchesThisDecision = 0;

    while (readProducerLevel(simulator, producerId) < targetLevel) {
        const state = simulator.getStateSnapshot();
        const currentLevel = state.run.producers[producerId]?.level ?? 0;
        const maxAffordable = calculateMaxAffordableProducerProgressionPurchase(
            repository,
            state.meta,
            producer,
            currentLevel,
            state.run.industrialOutput,
        );
        const remainingLevels = targetLevel - currentLevel;
        const configuredBatchLimit = settings.maxLevelsPerPurchase ?? Number.MAX_SAFE_INTEGER;
        const affordableQuantity = Math.min(remainingLevels, maxAffordable.quantity, configuredBatchLimit);

        if (affordableQuantity > 0) {
            executeRequired(simulator, {
                type: 'buyProducerLevels',
                producerId,
                quantity: affordableQuantity,
            }, `strategy_buy:${producerId}`);
            recordCivilizationOneCheckpoints(simulator);
            batchesThisDecision += 1;
            advanceAfterAction(simulator, settings);
            if (batchesThisDecision >= settings.maxPurchaseBatchesPerDecision) {
                return;
            }
            continue;
        }

        const nextLevel = calculateProducerProgressionPurchase(repository, state.meta, producer, currentLevel, 1);
        waitForIndustrialOutput(simulator, settings, nextLevel.cost);
    }
}

function purchaseBreakthroughWhenReady(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    breakthroughId: string,
    settings: NormalizedProgressionPolicyStrategyConfig,
): void {
    const eligibility = evaluateBreakthroughEligibility(repository, simulator.getStateSnapshot(), breakthroughId);

    if (eligibility.status === 'already_owned') {
        return;
    }

    if (eligibility.status === 'unknown_breakthrough') {
        throw new SimulationGuardError(`Unknown breakthrough "${breakthroughId}".`);
    }

    if (eligibility.status === 'locked') {
        satisfyLockedBreakthroughRequirements(repository, simulator, settings, eligibility.lockedRequirements);
        return;
    }

    if (eligibility.cost === null) {
        throw new SimulationGuardError(`Breakthrough "${breakthroughId}" has no cost.`);
    }

    waitForIndustrialOutput(simulator, settings, eligibility.cost);
    executeRequired(simulator, {
        type: 'purchaseBreakthrough',
        breakthroughId,
    }, `strategy_breakthrough:${breakthroughId}`);
    advanceAfterAction(simulator, settings);
}

function satisfyLockedBreakthroughRequirements(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
    requirements: readonly LockedBreakthroughRequirement[],
): void {
    for (const item of requirements) {
        const requirement = item.requirement;

        if (requirement.type === 'producerLevel') {
            buyProducerTowardLevel(repository, simulator, requirement.producerId, requirement.level, settings);
            return;
        }

        if (requirement.type === 'breakthroughOwned') {
            purchaseBreakthroughWhenReady(repository, simulator, requirement.breakthroughId, settings);
            return;
        }

        if (requirement.type === 'robotsBuilt') {
            waitUntilCondition(
                simulator,
                settings,
                (snapshot) => snapshot.state.run.robotsBuilt >= requirement.count,
            );
            return;
        }

        if (requirement.type === 'era' || requirement.type === 'civilization') {
            throw new SimulationGuardError(`Strategy cannot directly satisfy ${requirement.type} breakthrough requirement.`);
        }

        assertNeverBreakthroughRequirement(requirement);
    }
}

function waitForIndustrialOutput(
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
    targetIndustrialOutput: number,
): void {
    waitUntilCondition(
        simulator,
        settings,
        (snapshot) => snapshot.state.run.industrialOutput + BALANCE_TOLERANCE >= targetIndustrialOutput,
    );
}

function waitUntilCondition(
    simulator: HeadlessSimulator,
    settings: NormalizedProgressionPolicyStrategyConfig,
    condition: Parameters<HeadlessSimulator['advanceUntil']>[0],
): void {
    simulator.advanceUntil(condition, {
        maxSimulatedSeconds: remainingScenarioSeconds(simulator, settings),
        maxIterations: settings.maxPolicyDecisions,
        stepSeconds: (snapshot) => {
            recordCivilizationOneCheckpoints(simulator);
            activateFreeOverclockIfConfigured(simulator, settings);

            const refreshedSnapshot = simulator.createSnapshot();
            if (condition(refreshedSnapshot)) {
                return Number.MIN_VALUE;
            }

            if (refreshedSnapshot.productionPerSecond <= 0) {
                executeRequired(simulator, { type: 'manualProduce' }, 'strategy_manual_produce');
                return settings.manualActionSeconds;
            }

            const boostTransitionSeconds = getSecondsUntilNextTemporaryBoostTransition(refreshedSnapshot.state.boosts);
            if (settings.reactToBoostTransitions && boostTransitionSeconds !== null && boostTransitionSeconds > 0) {
                return Math.min(settings.decisionIntervalSeconds, boostTransitionSeconds);
            }

            return settings.decisionIntervalSeconds;
        },
    });
    recordCivilizationOneCheckpoints(simulator);
}

function activateFreeOverclockIfConfigured(
    simulator: HeadlessSimulator,
    settings: Pick<NormalizedProgressionPolicyStrategyConfig, 'useFreeOverclock'>,
): void {
    if (!settings.useFreeOverclock) {
        return;
    }

    const state = simulator.getStateSnapshot();
    if (!isFreeOverclockUnlocked(state)) {
        return;
    }

    if (state.boosts.activeBoosts.free_overclock !== undefined ||
        state.boosts.cooldowns.free_overclock !== undefined) {
        return;
    }

    const result = simulator.execute({ type: 'activateFreeOverclock' }, 'strategy_activate_free_overclock');
    if (!result.ok && result.reason !== 'boost_locked' && result.reason !== 'boost_on_cooldown') {
        throw new SimulationGuardError(`Free Overclock command failed unexpectedly: ${result.reason} ${result.message}`);
    }
    if (result.ok) {
        simulator.metrics.recordObservation(simulator.createSnapshot(), 'strategy:boost:free_overclock');
    }
}

function advanceAfterAction(
    simulator: HeadlessSimulator,
    settings: Pick<NormalizedProgressionPolicyStrategyConfig, 'actionDelaySeconds'>,
): void {
    if (settings.actionDelaySeconds <= 0) {
        return;
    }

    const result = simulator.advanceTime(settings.actionDelaySeconds, 'strategy_action_delay');
    if (!result.ok) {
        throw new SimulationGuardError(`Action delay failed: ${result.reason} ${result.message}`);
    }
}

function recordCivilizationOneCheckpoints(simulator: HeadlessSimulator): void {
    const snapshot = simulator.createSnapshot();
    const state = snapshot.state;
    const producerLevels = state.run.producers;
    const breakthroughs = new Set(state.run.purchasedBreakthroughIds);

    if ((producerLevels.fabricator?.level ?? 0) >= 10) {
        simulator.metrics.recordCheckpoint('fabricator_level_10', 'Fabricator Level 10', snapshot);
    }

    if (breakthroughs.has('auto_feeder')) {
        simulator.metrics.recordCheckpoint('auto_feeder', 'Auto Feeder', snapshot);
    }

    if ((producerLevels.assembly_station?.level ?? 0) >= 1) {
        simulator.metrics.recordCheckpoint('assembly_station', 'Assembly Station', snapshot);
    }

    if (breakthroughs.has('worker_bot') || state.run.progressionFlags.first_robot === true) {
        simulator.metrics.recordCheckpoint('worker_bot', 'Worker Bot / First Robot', snapshot);
    }

    if (breakthroughs.has('robotic_logistics')) {
        simulator.metrics.recordCheckpoint('robotic_logistics', 'Robotic Logistics', snapshot);
    }

    if ((producerLevels.robot_line?.level ?? 0) >= 1 && state.run.currentEraId === 'automated_factory') {
        simulator.metrics.recordCheckpoint('robot_line_era_ii', 'Robot Line / Era II', snapshot);
    }

    if (breakthroughs.has('factory_control_system')) {
        simulator.metrics.recordCheckpoint('factory_control_system', 'Factory Control System', snapshot);
    }

    if ((producerLevels.automated_cell?.level ?? 0) >= 1) {
        simulator.metrics.recordCheckpoint('automated_cell', 'Automated Cell', snapshot);
    }

    if (
        breakthroughs.has('advanced_robotics') &&
        (producerLevels.advanced_robotics_complex?.level ?? 0) >= 1 &&
        state.run.currentEraId === 'robotics_complex'
    ) {
        simulator.metrics.recordCheckpoint('robotics_complex_era_iii', 'Advanced Robotics / Robotics Complex Era III', snapshot);
    }

    if ((producerLevels[PRESTIGE_FRONTIER_PRODUCER_ID]?.level ?? 0) >= PRESTIGE_FRONTIER_LEVEL &&
        state.run.currentEraId === 'robotics_complex') {
        simulator.metrics.recordCheckpoint('prestige_frontier', 'First Prestige Frontier', snapshot);
    }
}

function isTargetReached(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    target: SimulationStrategyTarget,
): boolean {
    const state = simulator.getStateSnapshot();

    if (target.type === 'producerLevel') {
        return (state.run.producers[target.producerId]?.level ?? 0) >= target.level;
    }

    if (target.type === 'breakthroughOwned') {
        return state.run.purchasedBreakthroughIds.includes(target.breakthroughId);
    }

    if (target.type === 'eraReached') {
        const currentEra = state.run.currentEraId;
        if (currentEra === target.eraId) {
            return true;
        }
        const eraIds = repository.listEras().map((era) => era.id);
        return eraIds.indexOf(currentEra ?? '') >= eraIds.indexOf(target.eraId) && eraIds.indexOf(target.eraId) >= 0;
    }

    assertNeverTarget(target);
}

function executeRequired(simulator: HeadlessSimulator, command: GameCommand, label?: string): CommandExecutionResult {
    const result = simulator.execute(command, label);
    if (!result.ok) {
        throw new SimulationGuardError(`Command ${command.type} failed: ${result.reason} ${result.message}`);
    }
    return result;
}

function readProducerLevel(simulator: HeadlessSimulator, producerId: string): number {
    return simulator.getStateSnapshot().run.producers[producerId]?.level ?? 0;
}

function requireProducer(repository: GameConfigRepository, producerId: string): ProducerConfig {
    const producer = repository.getProducer(producerId);
    if (producer === undefined) {
        throw new SimulationGuardError(`Unknown producer "${producerId}".`);
    }
    return producer;
}

function remainingScenarioSeconds(
    simulator: HeadlessSimulator,
    settings: Pick<NormalizedProgressionPolicyStrategyConfig, 'maxSimulatedSeconds'>,
): number {
    const remainingSeconds = settings.maxSimulatedSeconds - simulator.simulatedTimeSeconds;
    if (remainingSeconds <= 0) {
        throw new SimulationGuardError(`Strategy exceeded ${settings.maxSimulatedSeconds} simulated seconds.`);
    }
    return remainingSeconds;
}

function normalizeProgressionConfig(
    overrides: Partial<ProgressionPolicyStrategyConfig>,
    defaults: NormalizedProgressionPolicyStrategyConfig,
): NormalizedProgressionPolicyStrategyConfig {
    const config = {
        ...defaults,
        ...overrides,
        target: overrides.target ?? defaults.target,
    };

    validateTarget(config.target);
    readPositiveFiniteNumber(config.maxSimulatedSeconds, 'maxSimulatedSeconds');
    readPositiveSafeInteger(config.maxPolicyDecisions, 'maxPolicyDecisions');
    readPositiveFiniteNumber(config.decisionIntervalSeconds, 'decisionIntervalSeconds');
    readPositiveFiniteNumber(config.manualActionSeconds, 'manualActionSeconds');
    if (config.maxLevelsPerPurchase !== null) {
        readPositiveSafeInteger(config.maxLevelsPerPurchase, 'maxLevelsPerPurchase');
    }
    readPositiveSafeInteger(config.maxPurchaseBatchesPerDecision, 'maxPurchaseBatchesPerDecision');
    readNonNegativeFiniteNumber(config.actionDelaySeconds, 'actionDelaySeconds');

    return Object.freeze(config);
}

function validateTarget(target: SimulationStrategyTarget): void {
    if (target.type === 'producerLevel') {
        readNonEmptyString(target.producerId, 'target.producerId');
        readPositiveSafeInteger(target.level, 'target.level');
        return;
    }

    if (target.type === 'breakthroughOwned') {
        readNonEmptyString(target.breakthroughId, 'target.breakthroughId');
        return;
    }

    if (target.type === 'eraReached') {
        readNonEmptyString(target.eraId, 'target.eraId');
        return;
    }

    throw new SimulationGuardError(`Unknown strategy target type "${String((target as { type?: unknown }).type)}".`);
}

function defaultPrestigeFrontierTarget(): SimulationStrategyTarget {
    return {
        type: 'producerLevel',
        producerId: PRESTIGE_FRONTIER_PRODUCER_ID,
        level: PRESTIGE_FRONTIER_LEVEL,
    };
}

function readPositiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new SimulationGuardError(`${label} must be a positive safe integer.`);
    }
    return value;
}

function readPositiveFiniteNumber(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new SimulationGuardError(`${label} must be a positive finite number.`);
    }
    return value;
}

function readNonNegativeFiniteNumber(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new SimulationGuardError(`${label} must be a non-negative finite number.`);
    }
    return value;
}

function readNonEmptyString(value: string, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new SimulationGuardError(`${label} must be a non-empty string.`);
    }
    return value;
}

function assertNeverGoal(goal: never): never {
    throw new SimulationGuardError(`Unhandled Next Goal category: ${String((goal as NextGoal).category)}`);
}

function assertNeverRequirement(requirement: never): never {
    throw new SimulationGuardError(`Unhandled blocking requirement: ${String((requirement as NextGoalBlockingRequirement).type)}`);
}

function assertNeverBreakthroughRequirement(requirement: never): never {
    throw new SimulationGuardError(`Unhandled breakthrough requirement: ${String((requirement as { type: string }).type)}`);
}

function assertNeverTarget(target: never): never {
    throw new SimulationGuardError(`Unhandled strategy target: ${String((target as SimulationStrategyTarget).type)}`);
}
