const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const simulationModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/simulation/index.ts')).href;
const pacingTargetsPath = path.join(repoRoot, 'data/simulation/pacing_targets.json.sim');

let repositoryPromise;
let simulationModulePromise;
let targetConfigPromise;

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

async function targetConfig() {
    if (targetConfigPromise === undefined) {
        targetConfigPromise = (async () => {
            const { parsePacingTargetConfig } = await simulationModule();
            return parsePacingTargetConfig(JSON.parse(await readFile(pacingTargetsPath, 'utf8')));
        })();
    }
    return targetConfigPromise;
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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

async function readBaseline(relativePath) {
    return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function baselineMapFor(config) {
    return Promise.all(config.scenarios.map(async (scenario) => [
        scenario.scenarioId,
        await readBaseline(scenario.baselinePath),
    ])).then((entries) => Object.fromEntries(entries));
}

function fakeSimulationReport(finalSeconds = 1000) {
    const observation = {
        timeSeconds: 0,
        label: 'initial',
        industrialOutput: 0,
        productionPerSecond: 1,
        automatedProductionPerSecond: 0,
        robotsBuilt: 0,
        robotsBuiltPerSecond: 0,
        eraId: 'manual_workshop',
        prestigePower: 1,
        projectedAiCoreReward: 0,
        p0PrestigePower: 100000000,
        producerLevels: {},
    };

    return {
        schemaVersion: 1,
        scenarioId: 'fixture',
        contentVersion: 'fixture',
        status: 'success',
        finalSummary: {
            simulatedActiveSeconds: finalSeconds,
            industrialOutput: 0,
            productionPerSecond: 1,
            automatedProductionPerSecond: 0,
            robotsBuilt: 0,
            robotsBuiltPerSecond: 0,
            eraId: 'manual_workshop',
            prestigePower: 1,
            projectedAiCoreReward: 0,
            p0PrestigePower: 100000000,
            producerLevels: {},
            purchasedBreakthroughIds: [],
        },
        checkpoints: [],
        observations: [
            observation,
            { ...observation, timeSeconds: finalSeconds, label: 'final' },
        ],
        commands: [
            {
                timeSeconds: finalSeconds,
                label: 'advance_time',
                command: { type: 'advanceActiveSession', elapsedSeconds: finalSeconds },
                ok: true,
                reason: null,
            },
        ],
        events: [],
        representativeBaselineSeconds: {},
    };
}

test('pacing target validation rejects non-finite values and inverted windows deterministically', async () => {
    const { PacingTargetValidationError, parsePacingTargetConfig } = await simulationModule();
    const invalid = clone(await targetConfig());
    invalid.targets[0].windows.pass.min = 100;
    invalid.targets[0].windows.pass.max = 50;
    invalid.targets[1].windows.warning.max = Infinity;

    assert.throws(() => parsePacingTargetConfig(invalid), (error) => {
        assert.ok(error instanceof PacingTargetValidationError);
        assert.ok(error.diagnostics.some((diagnostic) => diagnostic.code === 'PACING_INVALID_WINDOW'));
        assert.ok(error.diagnostics.some((diagnostic) => diagnostic.code === 'PACING_INVALID_TYPE'));
        return true;
    });
});

test('baseline diffs are warnings when current pacing remains inside target windows', async () => {
    const repo = await repository();
    const { runPacingRegression } = await simulationModule();
    const config = await targetConfig();
    const baselines = await baselineMapFor(config);
    const activeScenario = config.scenarios[0];
    const perturbed = clone(baselines[activeScenario.scenarioId]);
    const autoFeeder = perturbed.checkpoints.find((checkpoint) => checkpoint.id === 'auto_feeder');
    autoFeeder.timeSeconds -= 60;
    baselines[activeScenario.scenarioId] = perturbed;

    const report = runPacingRegression(repo, {
        ...config,
        scenarios: [activeScenario],
    }, {
        baselinesByScenarioId: baselines,
    });

    assert.equal(report.status, 'WARNING');
    assert.equal(report.scenarios[0].targetEvaluations.every((evaluation) => evaluation.status === 'PASS'), true);
    assert.ok(report.scenarios[0].baselineDiffs.some((diff) => diff.direction === 'later'));
    assert.ok(report.scenarios[0].humanSummary.some((line) => /became later/.test(line)));
});

test('target failure is reported even when the stored baseline matches current output', async () => {
    const repo = await repository();
    const { runPacingRegression } = await simulationModule();
    const config = clone(await targetConfig());
    const activeScenario = config.scenarios[0];
    const baselines = await baselineMapFor(config);
    config.scenarios = [activeScenario];
    config.targets = [{
        id: 'fixture.active.auto_feeder.too_fast',
        description: 'Fixture failure target.',
        source: 'AUT-022 test fixture.',
        metric: {
            metricId: 'checkpoint.time_seconds',
            checkpointId: 'auto_feeder',
        },
        scope: {
            scenarioIds: [activeScenario.scenarioId],
        },
        windows: {
            pass: { min: 0, max: 1 },
            warning: { min: 0, max: 2 },
        },
        violationPolicy: 'FAILURE',
    }];

    const report = runPacingRegression(repo, config, {
        baselinesByScenarioId: baselines,
    });

    assert.equal(report.status, 'FAILURE');
    assert.equal(report.scenarios[0].baselineDiffs.length, 0);
    assert.equal(report.scenarios[0].targetEvaluations[0].status, 'FAILURE');
});

test('dead-zone detection accounts for intentional passive decision cadence', async () => {
    const { detectDeadZones } = await simulationModule();
    const report = fakeSimulationReport(8 * 60 * 60);
    const deadZoneConfig = {
        enabled: true,
        minDurationSeconds: 900,
        intentionalDecisionCadenceMultiplier: 1.5,
        policy: 'WARNING',
    };

    const activeDeadZones = detectDeadZones({
        scenarioId: 'active_fixture',
        strategyId: 'active.v1',
        strategyConfig: { decisionIntervalSeconds: 60 },
        baselinePath: 'unused',
    }, report, deadZoneConfig);
    const passiveDeadZones = detectDeadZones({
        scenarioId: 'passive_fixture',
        strategyId: 'passive.v1',
        strategyConfig: { decisionIntervalSeconds: 8 * 60 * 60 },
        baselinePath: 'unused',
    }, report, deadZoneConfig);

    assert.equal(activeDeadZones.length, 1);
    assert.equal(passiveDeadZones.length, 0);
});

test('default pacing regression report exposes required schema fields and is reproducible', async () => {
    const repo = await repository();
    const { runPacingRegression } = await simulationModule();
    const config = await targetConfig();
    const baselines = await baselineMapFor(config);

    const first = runPacingRegression(repo, config, { baselinesByScenarioId: baselines });
    const second = runPacingRegression(repo, config, { baselinesByScenarioId: baselines });

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, 1);
    assert.equal(first.status, 'PASS');
    assert.deepEqual(first.scenarios.map((scenario) => scenario.strategyId), [
        'active.v1',
        'normal.v1',
        'passive.v1',
        'optimized.v1',
    ]);

    for (const scenario of first.scenarios) {
        assert.equal(typeof scenario.scenarioId, 'string');
        assert.ok(Array.isArray(scenario.checkpointTimings));
        assert.ok(Array.isArray(scenario.targetEvaluations));
        assert.ok(Array.isArray(scenario.baselineDiffs));
        assert.ok(Array.isArray(scenario.deadZones));
        assert.equal(typeof scenario.status, 'string');
    }
});
