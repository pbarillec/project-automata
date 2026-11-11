const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-GP-001: the built-in strategies relaunch the Assembly batch at each decision, and pacing regression
// counts a launch as a manual action.

const repoRoot = path.resolve(path.dirname(__filename), '..');
const imp = (relativePath) => import(pathToFileURL(path.join(repoRoot, relativePath)).href);

async function repository() {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

test('active strategy launches Assembly batches only while Assembly is assisted (before Worker Bot)', async () => {
    const { createActiveSimulationStrategy, runSimulationStrategy } = await imp('assets/scripts/simulation/index.ts');
    const repo = await repository();
    const result = runSimulationStrategy(repo, createActiveSimulationStrategy({
        target: { type: 'breakthroughOwned', breakthroughId: 'robotic_logistics' },
        decisionIntervalSeconds: 10,
    }));
    const commands = result.report.commands;
    const launches = commands.filter((entry) => entry.command.type === 'launchAssemblyBatch');
    const assemblyBuilt = commands.find((entry) => entry.command.type === 'buyProducerLevels' && entry.command.producerId === 'assembly_station');
    const workerBot = commands.find((entry) => entry.command.type === 'purchaseBreakthrough' && entry.command.breakthroughId === 'worker_bot');

    assert.ok(launches.length > 10, `expected repeated relaunches, got ${launches.length}`);
    assert.ok(launches.every((entry) => entry.ok), 'every launch is legal (never queued, never after Worker Bot)');
    assert.ok(launches.every((entry) => entry.label === 'strategy_launch_assembly_batch'));
    assert.ok(launches[0].timeSeconds >= assemblyBuilt.timeSeconds);
    assert.ok(launches.every((entry) => entry.timeSeconds <= workerBot.timeSeconds), 'no launch after Worker Bot');
    assert.deepEqual(result.simulator.getStateSnapshot().run.assistedBatches, {}, 'no batch remains after automation');
    assert.ok(result.report.events.some((entry) => entry.event.type === 'assistedBatchCompleted' && entry.event.payout > 0));
});

test('pacing regression counts launchAssemblyBatch as a meaningful manual action for dead zones', async () => {
    const { detectDeadZones } = await imp('assets/scripts/simulation/index.ts');
    const report = (commandType) => ({
        checkpoints: [],
        observations: [],
        events: [],
        finalSummary: { simulatedActiveSeconds: 3600 },
        commands: [600, 1200, 1800, 2400, 3000].map((timeSeconds) => ({
            timeSeconds,
            label: null,
            command: commandType === 'launchAssemblyBatch' ? { type: 'launchAssemblyBatch' } : { type: 'advanceActiveSession', elapsedSeconds: 600 },
            ok: true,
            reason: null,
        })),
    });
    const scenario = { scenarioId: 'fixture', strategyId: 'active.v1', strategyConfig: { decisionIntervalSeconds: 10 }, baselinePath: 'unused' };
    const config = { enabled: true, minDurationSeconds: 900, intentionalDecisionCadenceMultiplier: 1.5, policy: 'WARNING' };

    assert.equal(detectDeadZones(scenario, report('launchAssemblyBatch'), config).length, 0);
    assert.ok(detectDeadZones(scenario, report('advanceActiveSession'), config).length > 0);
});
