const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const simulationModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/simulation/index.ts')).href;

let repositoryPromise;
let simulationModulePromise;

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
}

async function simulationModule() {
    if (simulationModulePromise === undefined) {
        simulationModulePromise = import(simulationModuleUrl);
    }

    return simulationModulePromise;
}

async function collectJsonSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectJsonSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            return [];
        }

        return [{
            filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'),
            text: await readFile(entryPath, 'utf8'),
        }];
    }));

    return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function summarizeStrategyResult(result) {
    return {
        strategyId: result.strategyId,
        strategyFamily: result.strategyFamily,
        finalSummary: result.report.finalSummary,
        checkpoints: result.report.checkpoints.map((checkpoint) => ({
            id: checkpoint.id,
            timeSeconds: checkpoint.observation.timeSeconds,
            producerLevels: checkpoint.observation.producerLevels,
            eraId: checkpoint.observation.eraId,
        })),
        commands: result.report.commands.map((command) => ({
            timeSeconds: command.timeSeconds,
            label: command.label,
            command: command.command,
            ok: command.ok,
            reason: command.reason,
        })),
    };
}

test('built-in strategies expose stable ids and explicit default assumptions', async () => {
    const {
        ACTIVE_STRATEGY_ID,
        NORMAL_STRATEGY_ID,
        OPTIMIZED_STRATEGY_ID,
        PASSIVE_STRATEGY_ID,
        createActiveSimulationStrategy,
        createNormalSimulationStrategy,
        createOptimizedSimulationStrategy,
        createPassiveSimulationStrategy,
    } = await simulationModule();

    const strategies = [
        createActiveSimulationStrategy(),
        createNormalSimulationStrategy(),
        createPassiveSimulationStrategy(),
        createOptimizedSimulationStrategy(),
    ];

    assert.deepEqual(strategies.map((strategy) => strategy.id), [
        ACTIVE_STRATEGY_ID,
        NORMAL_STRATEGY_ID,
        PASSIVE_STRATEGY_ID,
        OPTIMIZED_STRATEGY_ID,
    ]);
    assert.equal(new Set(strategies.map((strategy) => strategy.id)).size, strategies.length);
    for (const strategy of strategies) {
        assert.ok(strategy.assumptions.length > 0, `${strategy.id} should document assumptions`);
        assert.equal(typeof strategy.config.decisionIntervalSeconds, 'number');
        assert.equal(typeof strategy.config.maxSimulatedSeconds, 'number');
    }
});

test('active strategy reaches the default Civilization #1 frontier and uses Free Overclock legally', async () => {
    const repo = await repository();
    const {
        PRESTIGE_FRONTIER_LEVEL,
        createActiveSimulationStrategy,
        runSimulationStrategy,
    } = await simulationModule();

    const result = runSimulationStrategy(repo, createActiveSimulationStrategy());

    assert.equal(result.report.finalSummary.eraId, 'robotics_complex');
    assert.equal(result.report.finalSummary.producerLevels.advanced_robotics_complex, PRESTIGE_FRONTIER_LEVEL);
    assert.equal(
        result.report.events.some((entry) => entry.event.type === 'temporaryBoostActivated' && entry.event.boostId === 'free_overclock'),
        true,
    );
});

test('normal strategy deterministically reaches the same target later than active with slower cadence', async () => {
    const repo = await repository();
    const {
        createActiveSimulationStrategy,
        createNormalSimulationStrategy,
        runSimulationStrategy,
    } = await simulationModule();
    const target = { type: 'breakthroughOwned', breakthroughId: 'worker_bot' };

    const active = runSimulationStrategy(repo, createActiveSimulationStrategy({ target }));
    const firstNormal = runSimulationStrategy(repo, createNormalSimulationStrategy({ target }));
    const secondNormal = runSimulationStrategy(repo, createNormalSimulationStrategy({ target }));

    assert.equal(firstNormal.report.finalSummary.purchasedBreakthroughIds.includes('worker_bot'), true);
    assert.equal(secondNormal.report.finalSummary.purchasedBreakthroughIds.includes('worker_bot'), true);
    assert.deepEqual(summarizeStrategyResult(secondNormal), summarizeStrategyResult(firstNormal));
    assert.ok(
        firstNormal.report.finalSummary.simulatedActiveSeconds > active.report.finalSummary.simulatedActiveSeconds,
        'normal cadence should reach Worker Bot later than active cadence',
    );
    assert.ok(
        firstNormal.report.commands.some((entry) => entry.label === 'strategy_action_delay'),
        'normal strategy should expose configurable action delay in the trace',
    );
});

test('passive strategy uses sparse active-session decisions without offline automation commands', async () => {
    const repo = await repository();
    const {
        createPassiveSimulationStrategy,
        runSimulationStrategy,
    } = await simulationModule();
    const target = { type: 'breakthroughOwned', breakthroughId: 'auto_feeder' };

    const result = runSimulationStrategy(repo, createPassiveSimulationStrategy({
        target,
        decisionIntervalSeconds: 30 * 60,
        maxSimulatedSeconds: 8 * 60 * 60,
    }));

    assert.equal(result.report.finalSummary.purchasedBreakthroughIds.includes('auto_feeder'), true);
    assert.equal(
        result.report.commands.some((entry) => entry.command.type === 'advanceAutomation'),
        false,
        'passive AUT-021 strategy must not simulate future offline rewards',
    );
});

test('scripted strategy executes commands, time advancement and guarded advance-until actions', async () => {
    const repo = await repository();
    const {
        createScriptedSimulationStrategy,
        runSimulationStrategy,
    } = await simulationModule();
    const manualProduceActions = Array.from({ length: 10 }, () => ({
        type: 'executeCommand',
        command: { type: 'manualProduce' },
    }));

    const result = runSimulationStrategy(repo, createScriptedSimulationStrategy({
        scriptId: 'fabricator_level_1',
        actions: [
            ...manualProduceActions,
            {
                type: 'executeCommand',
                command: { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 },
            },
            {
                type: 'advanceUntil',
                condition: { type: 'industrialOutputAtLeast', amount: 5 },
                maxSimulatedSeconds: 10,
                maxIterations: 10,
                stepSeconds: 1,
            },
            {
                type: 'advanceTime',
                seconds: 1,
            },
        ],
    }));

    assert.equal(result.strategyId, 'scripted.v1:fabricator_level_1');
    assert.equal(result.report.finalSummary.producerLevels.fabricator, 1);
    assert.ok(result.report.finalSummary.industrialOutput >= 6);
});

test('scripted strategy fails explicitly for invalid commands and unreachable conditions', async () => {
    const repo = await repository();
    const {
        SimulationGuardError,
        createScriptedSimulationStrategy,
        runSimulationStrategy,
    } = await simulationModule();

    assert.throws(() => runSimulationStrategy(repo, createScriptedSimulationStrategy({
        scriptId: 'invalid_command',
        actions: [{
            type: 'executeCommand',
            command: { type: 'purchaseBreakthrough', breakthroughId: 'missing_breakthrough' },
        }],
    })), SimulationGuardError);

    assert.throws(() => runSimulationStrategy(repo, createScriptedSimulationStrategy({
        scriptId: 'unreachable_condition',
        actions: [{
            type: 'advanceUntil',
            condition: { type: 'industrialOutputAtLeast', amount: 1 },
            maxSimulatedSeconds: 1,
            maxIterations: 1,
            stepSeconds: 1,
        }],
    })), SimulationGuardError);
});

test('strategy source stays deterministic and independent of wall-clock APIs', async () => {
    const strategyFiles = [
        'assets/scripts/simulation/SimulationStrategy.ts',
        'assets/scripts/simulation/BuiltInStrategies.ts',
        'assets/scripts/simulation/ScriptedStrategy.ts',
    ];

    for (const relativePath of strategyFiles) {
        const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
        assert.equal(source.includes('Math.random'), false, `${relativePath} uses Math.random`);
        assert.equal(source.includes('Date.now'), false, `${relativePath} uses Date.now`);
        assert.equal(source.includes('setTimeout'), false, `${relativePath} uses setTimeout`);
        assert.equal(source.includes('requestAnimationFrame'), false, `${relativePath} uses requestAnimationFrame`);
    }
});
