const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const offlineModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/offline/index.ts')).href;
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;
const timeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/time/index.ts')).href;

let repositoryPromise;
let offlineModulePromise;
let stateModulePromise;
let timeModulePromise;

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
}

async function offlineModule() {
    if (offlineModulePromise === undefined) {
        offlineModulePromise = import(offlineModuleUrl);
    }

    return offlineModulePromise;
}

async function freshState() {
    if (stateModulePromise === undefined) {
        stateModulePromise = import(stateModuleUrl);
    }

    const { createFreshGameState } = await stateModulePromise;
    return createFreshGameState();
}

async function timeModule() {
    if (timeModulePromise === undefined) {
        timeModulePromise = import(timeModuleUrl);
    }

    return timeModulePromise;
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

function setProducerLevel(state, producerId, level) {
    state.run.producers[producerId] = {
        level,
        isUnlocked: level > 0,
        isBuilt: level > 0,
    };
}

async function addAutoFeeder(state) {
    const repo = await repository();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    state.run.industrialOutput = 1500;
    setProducerLevel(state, 'fabricator', 15);
    const result = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(result.status, 'success');
    return result.state;
}

function contributionById(preview, producerId) {
    return preview.producerContributions.find((contribution) => contribution.producerId === producerId);
}

function assertApproxEqual(actual, expected, message) {
    const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-12);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

test('offline preview uses injected UTC clock, exposes raw and effective absence, and applies under-cap reward', async () => {
    const repo = await repository();
    const { createOfflineProgressPreview } = await offlineModule();
    const { ManualTimeService } = await timeModule();
    const state = await addAutoFeeder(await freshState());
    const before = JSON.stringify(state);
    const clock = new ManualTimeService({ utcIso: '2026-08-22T01:00:00.000Z' });

    const preview = createOfflineProgressPreview(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        timeService: clock,
    });

    assert.equal(preview.status, 'preview_ready');
    assert.equal(preview.rawAbsenceSeconds, 3600);
    assert.equal(preview.effectiveOfflineSeconds, 3600);
    assert.equal(preview.capApplied, false);
    assert.equal(preview.capSeconds, 8 * 60 * 60);
    assert.equal(preview.efficiency, 0.75);
    assert.equal(preview.totalEligibleProductionPerSecond, 37.5);
    assert.equal(preview.totalIndustrialOutputReward, 37.5 * 3600 * 0.75);
    assert.equal(contributionById(preview, 'fabricator').reason, 'eligible');
    assert.equal(contributionById(preview, 'fabricator').industrialOutputReward, 101250);
    assert.equal(JSON.stringify(state), before);
});

test('offline cap is applied exactly at and above eight hours', async () => {
    const repo = await repository();
    const { createOfflineProgressPreviewFromUtc } = await offlineModule();
    const state = await addAutoFeeder(await freshState());

    const exact = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T08:00:00.000Z',
    });
    const over = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T12:00:00.000Z',
    });

    assert.equal(exact.effectiveOfflineSeconds, 28800);
    assert.equal(exact.capApplied, false);
    assert.equal(over.rawAbsenceSeconds, 43200);
    assert.equal(over.effectiveOfflineSeconds, 28800);
    assert.equal(over.capApplied, true);
    assert.equal(over.totalIndustrialOutputReward, exact.totalIndustrialOutputReward);
});

test('zero, negative clock skew and malformed UTC inputs resolve deterministically', async () => {
    const repo = await repository();
    const { createOfflineProgressPreviewFromUtc } = await offlineModule();
    const state = await addAutoFeeder(await freshState());

    const zero = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T00:00:00.000Z',
    });
    const backwards = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:01:00.000Z',
        currentUtcIso: '2026-08-22T00:00:00.000Z',
    });
    const malformed = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: 'not-a-date',
        currentUtcIso: '2026-08-22T00:00:00.000Z',
    });

    assert.equal(zero.status, 'no_reward');
    assert.equal(zero.totalIndustrialOutputReward, 0);
    assert.equal(backwards.status, 'no_reward');
    assert.equal(backwards.utcElapsedStatus, 'backwards');
    assert.equal(backwards.rawAbsenceSeconds, -60);
    assert.equal(backwards.effectiveOfflineSeconds, 0);
    assert.equal(backwards.totalIndustrialOutputReward, 0);
    assert.equal(malformed.status, 'invalid_time');
    assert.equal(malformed.totalIndustrialOutputReward, 0);
});

test('offline producer contributions respect source offline eligibility', async () => {
    const repo = await repository();
    const { createOfflineProgressPreviewFromUtc } = await offlineModule();
    const { purchaseBreakthrough } = await import(progressionModuleUrl);
    const state = await freshState();

    setProducerLevel(state, 'assembly_station', 10);
    state.run.industrialOutput = 75000;
    const workerBot = purchaseBreakthrough(repo, state, 'worker_bot');
    assert.equal(workerBot.status, 'success');

    const preview = createOfflineProgressPreviewFromUtc(repo, workerBot.state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    });

    assert.equal(preview.status, 'no_reward');
    assert.equal(contributionById(preview, 'assembly_station').isEligible, false);
    assert.equal(contributionById(preview, 'assembly_station').reason, 'not_offline_eligible');
    assert.equal(contributionById(preview, 'assembly_station').productionPerSecond, 0);
    assert.equal(preview.totalIndustrialOutputReward, 0);
});

test('default automated Robot Line earns offline IO and Robots Built while manual Robot Line does not', async () => {
    const repo = await repository();
    const { createOfflineProgressPreviewFromUtc } = await offlineModule();
    const automated = await freshState();
    const manual = await freshState();
    setProducerLevel(automated, 'robot_line', 10);
    setProducerLevel(manual, 'robot_line', 10);
    manual.run.automation.robot_line = {
        isAutomated: false,
        isOfflineEligible: false,
        unlockedByBreakthroughId: 'fixture',
    };

    const input = {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    };
    const automatedPreview = createOfflineProgressPreviewFromUtc(repo, automated, input);
    const manualPreview = createOfflineProgressPreviewFromUtc(repo, manual, input);

    assert.equal(contributionById(automatedPreview, 'robot_line').reason, 'eligible');
    assert.equal(automatedPreview.totalIndustrialOutputReward, 3000 * 3600 * 0.75);
    assert.equal(automatedPreview.robotsBuiltDelta, 0.005 * 10 * 3600 * 0.75);
    assert.equal(contributionById(manualPreview, 'robot_line').reason, 'not_automated');
    assert.equal(manualPreview.totalIndustrialOutputReward, 0);
    assert.equal(manualPreview.robotsBuiltDelta, 0);
});

test('Free Overclock active and inactive states produce identical baseline offline rewards and preserve boost timers', async () => {
    const repo = await repository();
    const { createOfflineProgressPreviewFromUtc, collectOfflineProgress } = await offlineModule();
    const { activateFreeOverclock } = await import(progressionModuleUrl);
    const inactive = await addAutoFeeder(await freshState());
    const active = JSON.parse(JSON.stringify(inactive));
    active.run.progressionFlags.first_robot = true;
    const activation = activateFreeOverclock(active);
    assert.equal(activation.status, 'activated');
    active.boosts = activation.boosts;

    const input = {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    };
    const inactivePreview = createOfflineProgressPreviewFromUtc(repo, inactive, input);
    const activeBefore = JSON.stringify(active);
    const activePreview = createOfflineProgressPreviewFromUtc(repo, active, input);
    const collection = collectOfflineProgress(repo, active, { preview: activePreview });

    assert.equal(activePreview.totalIndustrialOutputReward, inactivePreview.totalIndustrialOutputReward);
    assert.equal(JSON.stringify(active), activeBefore);
    assert.equal(collection.status, 'success');
    assert.equal(collection.state.boosts.activeBoosts.free_overclock.remainingSeconds, 60);
});

test('permanent durable production upgrades influence offline reward', async () => {
    const repo = await repository();
    const { createOfflineProgressPreviewFromUtc } = await offlineModule();
    const base = await addAutoFeeder(await freshState());
    const upgraded = JSON.parse(JSON.stringify(base));
    upgraded.meta.permanentUpgradeRanks.optimized_fabrication = 1;

    const input = {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    };
    const basePreview = createOfflineProgressPreviewFromUtc(repo, base, input);
    const upgradedPreview = createOfflineProgressPreviewFromUtc(repo, upgraded, input);

    assert.equal(upgradedPreview.totalIndustrialOutputReward, basePreview.totalIndustrialOutputReward * 1.25);
});

test('offline collect grants the preview exactly once and advances the collection cursor', async () => {
    const repo = await repository();
    const { collectOfflineProgress, createOfflineProgressPreviewFromUtc } = await offlineModule();
    const state = await addAutoFeeder(await freshState());
    state.run.industrialOutput = 1000;
    const preview = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    });

    const first = collectOfflineProgress(repo, state, { preview });
    assert.equal(first.status, 'success');
    assert.equal(first.state.run.industrialOutput, 1000 + preview.totalIndustrialOutputReward);
    assert.equal(first.state.run.statistics.industrialOutputEarned, preview.totalIndustrialOutputReward);
    assert.equal(first.state.lifetime.industrialOutputEarned, preview.totalIndustrialOutputReward);
    assert.deepEqual(first.criticalSaveRequest, {
        reason: 'offline_collect',
        collectedThroughUtcIso: '2026-08-22T01:00:00.000Z',
        industrialOutputReward: preview.totalIndustrialOutputReward,
        robotsBuiltDelta: preview.robotsBuiltDelta,
    });

    const second = collectOfflineProgress(repo, first.state, {
        persistedAtUtcIso: first.criticalSaveRequest.collectedThroughUtcIso,
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    });

    assert.equal(second.status, 'no_reward');
    assert.equal(second.preview.rawAbsenceSeconds, 0);
    assert.equal(second.state.run.industrialOutput, first.state.run.industrialOutput);
});

test('failed offline collection leaves state and timestamp semantics unchanged', async () => {
    const repo = await repository();
    const { collectOfflineProgress, createOfflineProgressPreviewFromUtc } = await offlineModule();
    const state = await addAutoFeeder(await freshState());
    state.run.industrialOutput = Number.MAX_VALUE;
    const before = JSON.stringify(state);
    const preview = createOfflineProgressPreviewFromUtc(repo, state, {
        persistedAtUtcIso: '2026-08-22T00:00:00.000Z',
        currentUtcIso: '2026-08-22T01:00:00.000Z',
    });
    const oversizedPreview = {
        ...preview,
        totalIndustrialOutputReward: Number.MAX_VALUE,
    };

    const result = collectOfflineProgress(repo, state, { preview: oversizedPreview });

    assert.equal(result.status, 'failure');
    assert.equal('criticalSaveRequest' in result, false);
    assert.equal(JSON.stringify(state), before);
});

test('offline module stays headless and isolated from UI, platform and services', async () => {
    const offlineRoot = path.join(repoRoot, 'assets', 'scripts', 'offline');
    const entries = await readdir(offlineRoot);
    const sourceFiles = entries
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => path.join(offlineRoot, entry));

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);

        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${relativePath} imports Cocos runtime`);
        assert.equal(/assets[\\/]scenes|assets[\\/]ui/.test(source), false, `${relativePath} imports scene or UI code`);
        assert.equal(/platform|services|native\.reflection|AutomataPlatformBridge|com\.google|BillingClient|MobileAds/.test(source), false, `${relativePath} imports platform/native code`);
        assert.equal(/Date\.now/.test(source), false, `${relativePath} calls Date.now`);
    }
});
