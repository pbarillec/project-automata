import type { GameConfigRepository, ProducerConfig } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { CommandExecutionResult } from '../runtime/index.ts';
import { createFreshGameState } from '../state/index.ts';
import {
    calculateMaxAffordableProducerProgressionPurchase,
    calculateProducerProgressionPurchase,
    evaluateBreakthroughEligibility,
    evaluateProducerBuildProgression,
    getSecondsUntilNextTemporaryBoostTransition,
    isFreeOverclockUnlocked,
    resolveNextGoal,
    type NextGoal,
    type NextGoalBlockingRequirement,
} from '../progression/index.ts';
import { HeadlessSimulator, SimulationGuardError } from './HeadlessSimulator.ts';
import { type SimulationReport } from './Metrics.ts';

export const REFERENCE_ACTIVE_SCENARIO_ID = 'civilization_1_active_reference';
export const PRESTIGE_FRONTIER_PRODUCER_ID = 'advanced_robotics_complex';
export const PRESTIGE_FRONTIER_LEVEL = 25;

const DEFAULT_MAX_SIMULATED_SECONDS = 12 * 60 * 60;
const DEFAULT_MAX_POLICY_ITERATIONS = 20000;
const DEFAULT_MAX_WAIT_STEP_SECONDS = 60;
const DEFAULT_MANUAL_ACTION_SECONDS = 0.05;
const BALANCE_TOLERANCE = 1e-9;

export interface ReferenceActiveScenarioOptions {
    readonly maxSimulatedSeconds?: number;
    readonly maxPolicyIterations?: number;
    readonly maxWaitStepSeconds?: number;
    readonly manualActionSeconds?: number;
}

export interface ReferenceActiveScenarioResult {
    readonly simulator: HeadlessSimulator;
    readonly report: SimulationReport;
}

export const REPRESENTATIVE_ACTIVE_BASELINE_SECONDS: Readonly<Record<string, number>> = Object.freeze({
    fabricator_level_10: 38,
    auto_feeder: 88,
    assembly_station: 191,
    worker_bot: 489,
    robotic_logistics: 863,
    robot_line_era_ii: 1076,
    factory_control_system: 1526,
    automated_cell: 2483,
    robotics_complex_era_iii: 10680,
    prestige_frontier: 15840,
});

export function runCivilizationOneActiveReferenceScenario(
    repository: GameConfigRepository,
    options: ReferenceActiveScenarioOptions = {},
): ReferenceActiveScenarioResult {
    const settings = normalizeOptions(options);
    const simulator = new HeadlessSimulator(repository, {
        initialState: createFreshGameState(),
    });

    recordReferenceCheckpoints(simulator);

    for (let iteration = 0; iteration < settings.maxPolicyIterations; iteration += 1) {
        if (isPrestigeFrontierReached(simulator)) {
            recordReferenceCheckpoints(simulator);
            const report = simulator.metrics.createReport(
                REFERENCE_ACTIVE_SCENARIO_ID,
                simulator.createSnapshot(),
                REPRESENTATIVE_ACTIVE_BASELINE_SECONDS,
            );
            return {
                simulator,
                report,
            };
        }

        if (simulator.simulatedTimeSeconds > settings.maxSimulatedSeconds) {
            throw new SimulationGuardError(
                `Reference scenario exceeded ${settings.maxSimulatedSeconds} simulated seconds before reaching prestige frontier.`,
            );
        }

        performReferencePolicyStep(repository, simulator, settings);
        recordReferenceCheckpoints(simulator);
    }

    throw new SimulationGuardError(
        `Reference scenario exhausted ${settings.maxPolicyIterations} policy iterations before reaching prestige frontier.`,
    );
}

function performReferencePolicyStep(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: Required<ReferenceActiveScenarioOptions>,
): void {
    if (pushPrestigeFrontierIfAvailable(repository, simulator, settings)) {
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
        if (!pushPrestigeFrontierIfAvailable(repository, simulator, settings)) {
            throw new SimulationGuardError(`Reference scenario cannot progress from Next Goal "${goal.id}".`);
        }
        return;
    }

    assertNeverGoal(goal);
}

function executeEraGoal(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: Required<ReferenceActiveScenarioOptions>,
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
    settings: Required<ReferenceActiveScenarioOptions>,
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
                `robotsBuilt:${requirement.requiredCount}`,
            );
            return;
        }

        if (requirement.type === 'era' || requirement.type === 'civilization') {
            throw new SimulationGuardError(`Reference policy cannot directly satisfy ${requirement.type} blocker.`);
        }

        assertNeverRequirement(requirement);
    }
}

function buyProducerTowardLevel(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    producerId: string,
    targetLevel: number,
    settings: Required<ReferenceActiveScenarioOptions>,
): void {
    const producer = requireProducer(repository, producerId);

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
        const affordableQuantity = Math.min(remainingLevels, maxAffordable.quantity);

        if (affordableQuantity > 0) {
            executeRequired(simulator, {
                type: 'buyProducerLevels',
                producerId,
                quantity: affordableQuantity,
            }, `buy:${producerId}`);
            recordReferenceCheckpoints(simulator);
            continue;
        }

        const nextLevel = calculateProducerProgressionPurchase(repository, state.meta, producer, currentLevel, 1);
        waitForIndustrialOutput(simulator, settings, nextLevel.cost, `cost:${producerId}:level_${currentLevel + 1}`);
    }
}

function purchaseBreakthroughWhenReady(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    breakthroughId: string,
    settings: Required<ReferenceActiveScenarioOptions>,
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

    waitForIndustrialOutput(simulator, settings, eligibility.cost, `cost:${breakthroughId}`);
    executeRequired(simulator, {
        type: 'purchaseBreakthrough',
        breakthroughId,
    }, `breakthrough:${breakthroughId}`);
}

function satisfyLockedBreakthroughRequirements(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: Required<ReferenceActiveScenarioOptions>,
    requirements: ReturnType<typeof evaluateBreakthroughEligibility>['lockedRequirements'],
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
                `robotsBuilt:${requirement.count}`,
            );
            return;
        }

        if (requirement.type === 'era' || requirement.type === 'civilization') {
            throw new SimulationGuardError(`Reference policy cannot directly satisfy ${requirement.type} breakthrough requirement.`);
        }

        assertNeverBreakthroughRequirement(requirement);
    }
}

function pushPrestigeFrontierIfAvailable(
    repository: GameConfigRepository,
    simulator: HeadlessSimulator,
    settings: Required<ReferenceActiveScenarioOptions>,
): boolean {
    const state = simulator.getStateSnapshot();
    if ((state.run.producers[PRESTIGE_FRONTIER_PRODUCER_ID]?.level ?? 0) <= 0) {
        return false;
    }

    buyProducerTowardLevel(repository, simulator, PRESTIGE_FRONTIER_PRODUCER_ID, PRESTIGE_FRONTIER_LEVEL, settings);
    return true;
}

function waitForIndustrialOutput(
    simulator: HeadlessSimulator,
    settings: Required<ReferenceActiveScenarioOptions>,
    targetIndustrialOutput: number,
    label: string,
): void {
    waitUntilCondition(
        simulator,
        settings,
        (snapshot) => snapshot.state.run.industrialOutput + BALANCE_TOLERANCE >= targetIndustrialOutput,
        label,
    );
}

function waitUntilCondition(
    simulator: HeadlessSimulator,
    settings: Required<ReferenceActiveScenarioOptions>,
    condition: Parameters<HeadlessSimulator['advanceUntil']>[0],
    label: string,
): void {
    simulator.advanceUntil(condition, {
        maxSimulatedSeconds: remainingScenarioSeconds(simulator, settings),
        maxIterations: settings.maxPolicyIterations,
        stepSeconds: (snapshot) => {
            recordReferenceCheckpoints(simulator);
            activateFreeOverclockIfAvailable(simulator);

            const refreshedSnapshot = simulator.createSnapshot();
            if (condition(refreshedSnapshot)) {
                return Number.MIN_VALUE;
            }

            if (refreshedSnapshot.productionPerSecond <= 0) {
                executeRequired(simulator, { type: 'manualProduce' }, `manual:${label}`);
                return settings.manualActionSeconds;
            }

            const transitionSeconds = getSecondsUntilNextTemporaryBoostTransition(refreshedSnapshot.state.boosts);
            if (transitionSeconds !== null && transitionSeconds > 0) {
                return Math.min(settings.maxWaitStepSeconds, transitionSeconds);
            }

            return settings.maxWaitStepSeconds;
        },
    });
    recordReferenceCheckpoints(simulator);
}

function activateFreeOverclockIfAvailable(simulator: HeadlessSimulator): void {
    const state = simulator.getStateSnapshot();
    if (!isFreeOverclockUnlocked(state)) {
        return;
    }

    if (state.boosts.activeBoosts.free_overclock !== undefined ||
        state.boosts.cooldowns.free_overclock !== undefined) {
        return;
    }

    const result = simulator.execute({ type: 'activateFreeOverclock' }, 'activate_free_overclock');
    if (!result.ok && result.reason !== 'boost_locked' && result.reason !== 'boost_on_cooldown') {
        throw new SimulationGuardError(`Free Overclock command failed unexpectedly: ${result.reason} ${result.message}`);
    }
    if (result.ok) {
        simulator.metrics.recordObservation(simulator.createSnapshot(), 'boost:free_overclock');
    }
}

function recordReferenceCheckpoints(simulator: HeadlessSimulator): void {
    const snapshot = simulator.createSnapshot();
    const state = snapshot.state;
    const producerLevels = snapshot.state.run.producers;
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

    if (isPrestigeFrontierReached(simulator)) {
        simulator.metrics.recordCheckpoint('prestige_frontier', 'First Prestige Frontier', snapshot);
    }
}

function isPrestigeFrontierReached(simulator: HeadlessSimulator): boolean {
    const state = simulator.getStateSnapshot();
    return state.run.currentEraId === 'robotics_complex' &&
        (state.run.producers[PRESTIGE_FRONTIER_PRODUCER_ID]?.level ?? 0) >= PRESTIGE_FRONTIER_LEVEL;
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
    settings: Required<ReferenceActiveScenarioOptions>,
): number {
    const remainingSeconds = settings.maxSimulatedSeconds - simulator.simulatedTimeSeconds;
    if (remainingSeconds <= 0) {
        throw new SimulationGuardError(`Reference scenario exceeded ${settings.maxSimulatedSeconds} simulated seconds.`);
    }
    return remainingSeconds;
}

function normalizeOptions(options: ReferenceActiveScenarioOptions): Required<ReferenceActiveScenarioOptions> {
    return {
        maxSimulatedSeconds: options.maxSimulatedSeconds ?? DEFAULT_MAX_SIMULATED_SECONDS,
        maxPolicyIterations: options.maxPolicyIterations ?? DEFAULT_MAX_POLICY_ITERATIONS,
        maxWaitStepSeconds: options.maxWaitStepSeconds ?? DEFAULT_MAX_WAIT_STEP_SECONDS,
        manualActionSeconds: options.manualActionSeconds ?? DEFAULT_MANUAL_ACTION_SECONDS,
    };
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
