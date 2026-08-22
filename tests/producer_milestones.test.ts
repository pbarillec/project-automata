const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const economyModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/economy/index.ts')).href;

let repositoryPromise;
let economyModulePromise;

async function economyModule() {
    if (economyModulePromise === undefined) {
        economyModulePromise = import(economyModuleUrl);
    }

    return economyModulePromise;
}

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
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

test('cumulative milestone multipliers match exact boundaries and just-below just-above levels', async () => {
    const { calculateCumulativeMilestoneMultiplier } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();

    for (const level of [0, 1, 9]) {
        assert.equal(calculateCumulativeMilestoneMultiplier(milestones, level), 1);
    }

    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 10), 2);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 11), 2);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 24), 2);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 25), 4);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 26), 4);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 49), 4);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 50), 12);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 51), 12);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 99), 12);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 100), 60);
    assert.equal(calculateCumulativeMilestoneMultiplier(milestones, 101), 60);
});

test('crossed milestones use oldLevel exclusive and newLevel inclusive threshold detection', async () => {
    const { resolveCrossedProducerMilestones } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();

    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 9, 10).map((milestone) => milestone.threshold), [10]);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 10, 25).map((milestone) => milestone.threshold), [25]);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 9, 50).map((milestone) => milestone.threshold), [10, 25, 50]);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 9, 100).map((milestone) => milestone.threshold), [10, 25, 50, 100]);
});

test('crossed milestones include deterministic cumulative multiplier after each crossing', async () => {
    const { resolveCrossedProducerMilestones } = await economyModule();
    const repo = await repository();

    assert.deepEqual(resolveCrossedProducerMilestones(repo.listMilestones(), 9, 100), [
        {
            id: 'level_10',
            threshold: 10,
            productionMultiplier: 2,
            cumulativeMultiplierAfterCrossing: 2,
        },
        {
            id: 'level_25',
            threshold: 25,
            productionMultiplier: 2,
            cumulativeMultiplierAfterCrossing: 4,
        },
        {
            id: 'level_50',
            threshold: 50,
            productionMultiplier: 3,
            cumulativeMultiplierAfterCrossing: 12,
        },
        {
            id: 'level_100',
            threshold: 100,
            productionMultiplier: 5,
            cumulativeMultiplierAfterCrossing: 60,
        },
    ]);
});

test('crossed milestones return empty when no threshold is crossed', async () => {
    const { resolveCrossedProducerMilestones } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();

    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 0, 0), []);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 9, 9), []);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 0, 9), []);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 10, 24), []);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 25, 49), []);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 100, 101), []);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 50, 25), []);
});

test('milestone resolver does not emit already-earned thresholds', async () => {
    const { resolveCrossedProducerMilestones } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();

    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 11, 25).map((milestone) => milestone.threshold), [25]);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 26, 50).map((milestone) => milestone.threshold), [50]);
    assert.deepEqual(resolveCrossedProducerMilestones(milestones, 51, 100).map((milestone) => milestone.threshold), [100]);
});

test('invalid milestone levels fail deterministically', async () => {
    const {
        ProducerMilestoneInputError,
        calculateCumulativeMilestoneMultiplier,
        resolveCrossedProducerMilestones,
    } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();

    assert.throws(() => calculateCumulativeMilestoneMultiplier(milestones, -1), ProducerMilestoneInputError);
    assert.throws(() => calculateCumulativeMilestoneMultiplier(milestones, 1.5), /non-negative safe integer/);
    assert.throws(() => calculateCumulativeMilestoneMultiplier(milestones, Number.POSITIVE_INFINITY), /non-negative safe integer/);
    assert.throws(() => resolveCrossedProducerMilestones(milestones, -1, 10), /oldLevel must be a non-negative safe integer/);
    assert.throws(() => resolveCrossedProducerMilestones(milestones, 0, Number.NaN), /newLevel must be a non-negative safe integer/);
});

test('invalid milestone config inputs fail deterministically', async () => {
    const { calculateCumulativeMilestoneMultiplier } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();

    assert.throws(() => calculateCumulativeMilestoneMultiplier(null, 10), /milestones must be an array/);
    assert.throws(() => calculateCumulativeMilestoneMultiplier([
        { ...milestones[0] },
        { ...milestones[0], id: 'duplicate_level_10' },
    ], 10), /strictly ascending/);
    assert.throws(() => calculateCumulativeMilestoneMultiplier([
        { id: 'bad_threshold', threshold: 0, productionMultiplier: 2 },
    ], 10), /threshold must be a positive safe integer/);
    assert.throws(() => calculateCumulativeMilestoneMultiplier([
        { id: 'bad_multiplier', threshold: 10, productionMultiplier: Number.NaN },
    ], 10), /productionMultiplier must be a positive finite number/);
});

test('milestone-adjusted producer output composes with AUT-009 base output', async () => {
    const {
        calculateMilestoneAdjustedProducerOutput,
        calculateProducerBaseOutput,
        calculateTotalMilestoneAdjustedProductionPerSecond,
    } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();
    const fabricator = repo.getProducer('fabricator');
    const assembly = repo.getProducer('assembly_station');

    assert.equal(calculateProducerBaseOutput(fabricator, 100), 100);
    assert.equal(calculateMilestoneAdjustedProducerOutput(fabricator, 9, milestones), 9);
    assert.equal(calculateMilestoneAdjustedProducerOutput(fabricator, 10, milestones), 20);
    assert.equal(calculateMilestoneAdjustedProducerOutput(fabricator, 25, milestones), 100);
    assert.equal(calculateMilestoneAdjustedProducerOutput(fabricator, 50, milestones), 600);
    assert.equal(calculateMilestoneAdjustedProducerOutput(fabricator, 100, milestones), 6000);

    assert.equal(calculateTotalMilestoneAdjustedProductionPerSecond([
        fabricator,
        assembly,
    ], {
        fabricator: 50,
        assembly_station: 25,
    }, milestones), 600 + 1200);
});

test('milestone functions do not mutate configs or level records', async () => {
    const {
        calculateCumulativeMilestoneMultiplier,
        calculateTotalMilestoneAdjustedProductionPerSecond,
        resolveCrossedProducerMilestones,
    } = await economyModule();
    const repo = await repository();
    const milestones = repo.listMilestones();
    const producers = repo.listProducers();
    const levels = {
        fabricator: 100,
        assembly_station: 25,
    };
    const beforeMilestones = JSON.stringify(milestones);
    const beforeProducers = JSON.stringify(producers);
    const beforeLevels = JSON.stringify(levels);

    calculateCumulativeMilestoneMultiplier(milestones, 100);
    resolveCrossedProducerMilestones(milestones, 9, 100);
    calculateTotalMilestoneAdjustedProductionPerSecond(producers, levels, milestones);

    assert.equal(JSON.stringify(milestones), beforeMilestones);
    assert.equal(JSON.stringify(producers), beforeProducers);
    assert.equal(JSON.stringify(levels), beforeLevels);
});
