const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-GP-001: Assembly assisted production (reduced floor plus batch) through GameRuntime only.

const repoRoot = path.resolve(path.dirname(__filename), '..');
const moduleUrl = (relativePath) => pathToFileURL(path.join(repoRoot, relativePath)).href;
const imp = (relativePath) => import(moduleUrl(relativePath));

let repositoryPromise;
async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
            const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
            return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
        })();
    }
    return repositoryPromise;
}

async function freshState() {
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    return createFreshGameState();
}

/** Fabricator Lv15 with Auto Feeder (automated) and Assembly Station at `assemblyLevel`. */
async function assistedState(assemblyLevel = 1) {
    const state = await freshState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    if (assemblyLevel > 0) state.run.producers.assembly_station = { level: assemblyLevel, isUnlocked: true, isBuilt: true };
    return state;
}

async function runtimeFor(state) {
    const { GameRuntime } = await imp('assets/scripts/runtime/index.ts');
    return new GameRuntime(await repository(), state);
}

async function assemblyRates(state, temporaryBoosts = 'include') {
    const { calculateSustainedProducerProductionRateContributions } = await imp('assets/scripts/progression/index.ts');
    const repo = await repository();
    const find = (assistedFloor) => calculateSustainedProducerProductionRateContributions(repo, state, { producerScope: 'all', temporaryBoosts, assistedFloor })
        .find((entry) => entry.producerId === 'assembly_station').productionPerSecond;
    return { floor: find('apply'), full: find('ignore') };
}

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);

test('Assembly assisted production is data-driven: floor 0.5 and a 15 s batch in producers.json', async () => {
    const repo = await repository();
    assert.deepEqual(repo.getProducer('assembly_station').assistedProduction, { floorFraction: 0.5, batchDurationSeconds: 15 });
    assert.equal(repo.getProducer('fabricator').assistedProduction, undefined);
    const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/economy/producers.json'), 'utf8'));
    assert.deepEqual(raw.items.find((item) => item.id === 'assembly_station').assistedProduction, { floorFraction: 0.5, batchDurationSeconds: 15 });
});

test('config validation rejects an out-of-range floor, a non-positive duration and unknown keys', async () => {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const withAssisted = (assistedProduction) => getEmbeddedEconomyConfigSources().map((source) => {
        if (!source.filePath.endsWith('producers.json')) return source;
        const json = JSON.parse(source.text);
        json.items[1].assistedProduction = assistedProduction;
        return { filePath: source.filePath, text: JSON.stringify(json) };
    });
    const codes = (assistedProduction) => {
        try {
            loadGameConfigFromSources(withAssisted(assistedProduction));
            return [];
        }
        catch (error) {
            return error.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.configPath}`);
        }
    };
    assert.ok(codes({ floorFraction: 1, batchDurationSeconds: 15 }).some((line) => line.includes('assistedProduction.floorFraction')));
    assert.ok(codes({ floorFraction: -0.1, batchDurationSeconds: 15 }).some((line) => line.includes('assistedProduction.floorFraction')));
    assert.ok(codes({ floorFraction: 0.5, batchDurationSeconds: 0 }).some((line) => line.includes('assistedProduction.batchDurationSeconds')));
    assert.ok(codes({ floorFraction: 0.5, batchDurationSeconds: 15, queue: 2 }).length > 0);
    assert.deepEqual(codes({ floorFraction: 0, batchDurationSeconds: 10 }), []);
});

test('economy formula: floor = full × floor fraction; payout = full × duration × (1 − floor)', async () => {
    const { calculateAssistedBatchPayout, calculateAssistedFloorProductionPerSecond } = await imp('assets/scripts/economy/index.ts');
    assert.equal(calculateAssistedFloorProductionPerSecond(12, { floorFraction: 0.5, batchDurationSeconds: 15 }), 6);
    assert.equal(calculateAssistedBatchPayout(12, 15, 0.5), 90);
    assert.equal(calculateAssistedBatchPayout(0, 15, 0.5), 0);
    assert.throws(() => calculateAssistedBatchPayout(-1, 15, 0.5), /full productionPerSecond/);
    assert.throws(() => calculateAssistedBatchPayout(12, 15, 1), /floorFraction/);
    assert.throws(() => calculateAssistedBatchPayout(12, 0, 0.5), /batchDurationSeconds/);
});

test('before Worker Bot Assembly runs at the floor rate; its full rate stays the batch payout base', async () => {
    const state = await assistedState(1);
    const rates = await assemblyRates(state);
    assert.equal(rates.full, 12);
    assert.equal(rates.floor, 6);

    const runtime = await runtimeFor(state);
    const fabricatorOnly = 15 * 2 * 1.25; // Lv15: ×2 level-10 milestone, Auto Feeder ×1.25.
    near(runtime.getProductionPerSecond(), fabricatorOnly + 6, 'online production includes the Assembly floor');
});

test('launchAssemblyBatch is illegal at Assembly level 0 and rejected without mutation', async () => {
    const runtime = await runtimeFor(await assistedState(0));
    const before = runtime.getStateSnapshot();
    const result = runtime.execute({ type: 'launchAssemblyBatch' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'assisted_batch_unavailable');
    assert.equal(result.details.status, 'not_built');
    assert.deepEqual(runtime.getStateSnapshot(), before);
});

test('one batch at a time: a second launch is rejected while the batch is in flight (no queue)', async () => {
    const runtime = await runtimeFor(await assistedState(1));
    const launched = runtime.launchAssemblyBatch();
    assert.equal(launched.ok, true);
    assert.deepEqual(launched.events, [{ type: 'assistedBatchLaunched', producerId: 'assembly_station', durationSeconds: 15 }]);
    assert.deepEqual(runtime.getStateSnapshot().run.assistedBatches, { assembly_station: { durationSeconds: 15, remainingSeconds: 15 } });

    runtime.advanceActiveSession(5);
    const second = runtime.execute({ type: 'launchAssemblyBatch' });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'assisted_batch_already_running');
    assert.equal(second.details.remainingSeconds, 10);
    assert.deepEqual(runtime.getStateSnapshot().run.assistedBatches, { assembly_station: { durationSeconds: 15, remainingSeconds: 10 } });
});

test('a batch pays rate × duration × (1 − floor) on completion, once, then can be relaunched', async () => {
    const state = await assistedState(1);
    const runtime = await runtimeFor(state);
    const rate = runtime.getProductionPerSecond();
    runtime.launchAssemblyBatch();

    const result = runtime.advanceActiveSession(20);
    assert.equal(result.ok, true);
    const completed = result.events.filter((event) => event.type === 'assistedBatchCompleted');
    assert.deepEqual(completed, [{ type: 'assistedBatchCompleted', producerId: 'assembly_station', durationSeconds: 15, payout: 90 }]);
    assert.ok(result.events.some((event) => event.type === 'productionGranted' && event.source === 'assisted_batch' && event.amount === 90));
    assert.ok(result.events.some((event) => event.type === 'industrialOutputChanged' && event.reason === 'assisted_batch_production'));
    near(runtime.getStateSnapshot().run.industrialOutput, rate * 20 + 90, 'floor production over 20 s plus one payout');
    assert.deepEqual(runtime.getStateSnapshot().run.assistedBatches, {});

    // Floor plus a back-to-back batch averages the full Assembly rate.
    const next = runtime.getStateSnapshot().run.industrialOutput;
    runtime.launchAssemblyBatch();
    runtime.advanceActiveSession(15);
    near(runtime.getStateSnapshot().run.industrialOutput - next, rate * 15 + 90, 'second batch');
    assert.equal(runtime.advanceActiveSession(60).events.some((event) => event.type === 'assistedBatchCompleted'), false, 'no relaunch without a command');
});

test('the payout uses current multipliers including temporary boosts at completion', async () => {
    const { activateTemporaryProductionBoost } = await imp('assets/scripts/progression/index.ts');
    const state = await assistedState(1);
    const boost = activateTemporaryProductionBoost(state.boosts, { boostId: 'fixture_surge', multiplier: 2, durationSeconds: 600, source: 'test' });
    state.boosts = boost.boosts;
    const runtime = await runtimeFor(state);
    runtime.launchAssemblyBatch();
    const result = runtime.advanceActiveSession(15);
    assert.equal(result.events.find((event) => event.type === 'assistedBatchCompleted').payout, 180);
});

test('after Worker Bot Assembly runs at the full automated rate and batches are unavailable', async () => {
    const state = await assistedState(10);
    state.run.industrialOutput = 75000;
    const runtime = await runtimeFor(state);
    const purchase = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'worker_bot' });
    assert.equal(purchase.ok, true);

    const after = runtime.getStateSnapshot();
    const rates = await assemblyRates(after);
    assert.equal(rates.floor, rates.full, 'no floor once automated');
    assert.equal(rates.full, 10 * 12 * 2 * 1.5);
    const launch = runtime.execute({ type: 'launchAssemblyBatch' });
    assert.equal(launch.ok, false);
    assert.equal(launch.reason, 'assisted_batch_unavailable');
    assert.equal(launch.details.status, 'automated');
});

test('A3 Inherited Automation: Assembly starts automated, with the full rate and no batch', async () => {
    const state = await assistedState(0);
    state.meta.civilizationNumber = 2;
    state.meta.permanentUpgradeRanks = { cached_procedures: 1, worker_templates: 2, inherited_automation: 1 };
    state.run.industrialOutput = 10000;
    const runtime = await runtimeFor(state);
    const build = runtime.execute({ type: 'buyProducerLevels', producerId: 'assembly_station', quantity: 1 });
    assert.equal(build.ok, true);
    assert.equal(runtime.getStateSnapshot().run.automation.assembly_station.isAutomated, true);

    const rates = await assemblyRates(runtime.getStateSnapshot());
    assert.equal(rates.floor, rates.full);
    const launch = runtime.execute({ type: 'launchAssemblyBatch' });
    assert.equal(launch.ok, false);
    assert.equal(launch.details.status, 'automated');
});

test('a batch in flight when Worker Bot is bought still completes and pays once', async () => {
    const state = await assistedState(10);
    state.run.industrialOutput = 75000;
    const runtime = await runtimeFor(state);
    runtime.launchAssemblyBatch();
    assert.equal(runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'worker_bot' }).ok, true);
    const completed = runtime.advanceActiveSession(15).events.filter((event) => event.type === 'assistedBatchCompleted');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payout, 10 * 12 * 2 * 1.5 * 15 * 0.5);
});

test('advanceAutomation (automated-only elapsed production) neither advances nor pays a batch', async () => {
    const runtime = await runtimeFor(await assistedState(1));
    runtime.launchAssemblyBatch();
    const result = runtime.advanceAutomation(30);
    assert.equal(result.events.some((event) => event.type === 'assistedBatchCompleted'), false);
    assert.deepEqual(runtime.getStateSnapshot().run.assistedBatches, { assembly_station: { durationSeconds: 15, remainingSeconds: 15 } });
});

test('Reboot clears an in-flight batch with the rest of the run', async () => {
    const { createFreshRunState } = await imp('assets/scripts/state/index.ts');
    assert.deepEqual(createFreshRunState().assistedBatches, {});
});

async function offlinePreview(state, seconds) {
    const { createOfflineProgressPreviewFromUtc } = await imp('assets/scripts/offline/index.ts');
    const start = Date.parse('2026-11-11T08:00:00.000Z');
    return createOfflineProgressPreviewFromUtc(await repository(), state, {
        persistedAtUtcIso: new Date(start).toISOString(),
        currentUtcIso: new Date(start + seconds * 1000).toISOString(),
    });
}

test('offline: an in-flight batch that fits in the absence is paid once at the durable full rate; no relaunch', async () => {
    const { collectOfflineProgress } = await imp('assets/scripts/offline/index.ts');
    const { activateTemporaryProductionBoost } = await imp('assets/scripts/progression/index.ts');
    const state = await assistedState(1);
    state.run.assistedBatches.assembly_station = { durationSeconds: 15, remainingSeconds: 6 };
    state.boosts = activateTemporaryProductionBoost(state.boosts, { boostId: 'fixture_surge', multiplier: 2, durationSeconds: 600, source: 'test' }).boosts;

    const preview = await offlinePreview(state, 3600);
    assert.equal(preview.status, 'preview_ready');
    assert.equal(preview.assistedBatchReward, 90, 'durable rate (boost excluded), no offline efficiency');
    assert.deepEqual(preview.assistedBatchSettlements.map((settlement) => [settlement.producerId, settlement.completed, settlement.industrialOutputReward]), [['assembly_station', true, 90]]);
    const fabricatorReward = preview.producerContributions.find((entry) => entry.producerId === 'fabricator').industrialOutputReward;
    near(preview.totalIndustrialOutputReward, fabricatorReward + 90, 'total includes the batch');
    assert.equal(preview.producerContributions.find((entry) => entry.producerId === 'assembly_station').industrialOutputReward, 0, 'no assisted floor offline');

    const collect = collectOfflineProgress(await repository(), state, { preview });
    assert.equal(collect.status, 'success');
    near(collect.state.run.industrialOutput, state.run.industrialOutput + fabricatorReward + 90, 'collected');
    assert.deepEqual(collect.state.run.assistedBatches, {}, 'paid once, nothing relaunched');
    const again = await offlinePreview(collect.state, 3600);
    assert.equal(again.assistedBatchReward, 0);
});

test('offline: a batch longer than the absence advances its timer only', async () => {
    const { collectOfflineProgress } = await imp('assets/scripts/offline/index.ts');
    const state = await assistedState(1);
    state.run.assistedBatches.assembly_station = { durationSeconds: 15, remainingSeconds: 12 };
    const preview = await offlinePreview(state, 5);
    assert.equal(preview.assistedBatchReward, 0);
    assert.equal(preview.assistedBatchSettlements[0].remainingSecondsAfter, 7);
    const collect = collectOfflineProgress(await repository(), state, { preview });
    assert.deepEqual(collect.state.run.assistedBatches, { assembly_station: { durationSeconds: 15, remainingSeconds: 7 } });
});

test('offline: a settlement is withheld when the active session already paid the batch (never paid twice)', async () => {
    const { collectOfflineProgress } = await imp('assets/scripts/offline/index.ts');
    const state = await assistedState(1);
    state.run.assistedBatches.assembly_station = { durationSeconds: 15, remainingSeconds: 6 };
    const preview = await offlinePreview(state, 3600);
    const runtime = await runtimeFor(state);
    runtime.advanceActiveSession(6); // the batch completes online before the pending preview is collected
    const online = runtime.getStateSnapshot();
    const collect = collectOfflineProgress(await repository(), online, { preview });
    near(collect.state.run.industrialOutput, online.run.industrialOutput + preview.totalIndustrialOutputReward - 90, 'batch reward withheld');
});
