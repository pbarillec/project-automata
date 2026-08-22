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

function assertApproxEqual(actual, expected, message) {
    const tolerance = Math.max(1e-10, Math.abs(expected) * 1e-12);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

test('base producer output uses AUT-007 baseProductionPerLevel linearly before modifiers', async () => {
    const { calculateProducerBaseOutput } = await economyModule();
    const repo = await repository();
    const fabricator = repo.getProducer('fabricator');
    const robotLine = repo.getProducer('robot_line');

    assert.equal(calculateProducerBaseOutput(fabricator, 0), 0);
    assert.equal(calculateProducerBaseOutput(fabricator, 1), fabricator.baseProductionPerLevel);
    assert.equal(calculateProducerBaseOutput(fabricator, 12), 12);
    assert.equal(calculateProducerBaseOutput(robotLine, 25), 3750);
});

test('base output does not include milestone or advanced modifier behavior', async () => {
    const { calculateProducerBaseOutput } = await economyModule();
    const repo = await repository();
    const fabricator = repo.getProducer('fabricator');

    assert.equal(calculateProducerBaseOutput(fabricator, 10), 10);
    assert.equal(calculateProducerBaseOutput(fabricator, 25), 25);
    assert.equal(calculateProducerBaseOutput(fabricator, 50), 50);
    assert.equal(calculateProducerBaseOutput(fabricator, 100), 100);
});

test('total productionPerSecond sums supplied producer configs and treats missing levels as zero', async () => {
    const { calculateTotalProductionPerSecond } = await economyModule();
    const repo = await repository();
    const producers = repo.listProducers();

    const total = calculateTotalProductionPerSecond(producers, {
        fabricator: 10,
        robot_line: 2,
        advanced_robotics_complex: 1,
    });

    assert.equal(total, 10 + 300 + 500000);
});

test('total productionPerSecond uses actual AUT-007 producer configuration for representative coverage', async () => {
    const { calculateProducerBaseOutput, calculateTotalProductionPerSecond } = await economyModule();
    const repo = await repository();
    const producers = repo.listProducers();
    const levels = {
        fabricator: 12,
        assembly_station: 8,
        robot_line: 5,
        automated_cell: 3,
        advanced_robotics_complex: 2,
    };

    const expected = producers.reduce((sum, producer) => (
        sum + calculateProducerBaseOutput(producer, levels[producer.id])
    ), 0);

    assert.equal(calculateTotalProductionPerSecond(producers, levels), expected);
    assert.equal(expected, 1008358);
});

test('unknown level-map producer ids are rejected deterministically', async () => {
    const { calculateTotalProductionPerSecond } = await economyModule();
    const repo = await repository();

    assert.throws(() => calculateTotalProductionPerSecond(repo.listProducers(), {
        fabricator: 1,
        missing_producer: 1,
    }), {
        name: 'ProducerProductionInputError',
        message: /unknown producer id "missing_producer"/,
    });
});

test('elapsed production is productionPerSecond multiplied by elapsedSeconds', async () => {
    const { calculateElapsedProduction, calculateElapsedProductionFromProducers } = await economyModule();
    const repo = await repository();
    const producers = repo.listProducers();
    const levels = {
        fabricator: 10,
        assembly_station: 10,
    };

    assert.equal(calculateElapsedProduction(130, 0), 0);
    assert.equal(calculateElapsedProduction(130, 2.5), 325);
    assert.equal(calculateElapsedProductionFromProducers(producers, levels, 2.5), 325);
});

test('different tick partitions over the same elapsed time produce equivalent output within tolerance', async () => {
    const { calculateElapsedProduction, isProductionApproximatelyEqual } = await economyModule();
    const productionPerSecond = 12345.6789;

    const singleStep = calculateElapsedProduction(productionPerSecond, 60);
    const tenSteps = Array.from({ length: 10 }, () => calculateElapsedProduction(productionPerSecond, 6))
        .reduce((sum, produced) => sum + produced, 0);
    const unevenSteps = [0.1, 0.2, 1.7, 13, 45]
        .map((seconds) => calculateElapsedProduction(productionPerSecond, seconds))
        .reduce((sum, produced) => sum + produced, 0);

    assert.equal(isProductionApproximatelyEqual(singleStep, tenSteps), true);
    assert.equal(isProductionApproximatelyEqual(singleStep, unevenSteps), true);
});

test('invalid production inputs fail deterministically with ProducerProductionInputError', async () => {
    const {
        ProducerProductionInputError,
        calculateElapsedProduction,
        calculateProducerBaseOutput,
        calculateTotalProductionPerSecond,
    } = await economyModule();
    const repo = await repository();
    const fabricator = repo.getProducer('fabricator');

    assert.throws(() => calculateProducerBaseOutput(fabricator, -1), ProducerProductionInputError);
    assert.throws(() => calculateProducerBaseOutput(fabricator, 1.5), /non-negative safe integer/);
    assert.throws(() => calculateProducerBaseOutput({ ...fabricator, baseProductionPerLevel: Number.NaN }, 1), /positive finite number/);
    assert.throws(() => calculateProducerBaseOutput({ ...fabricator, baseProductionPerLevel: -1 }, 1), /positive finite number/);
    assert.throws(() => calculateTotalProductionPerSecond(repo.listProducers(), null), /plain producer id to level record/);
    assert.throws(() => calculateTotalProductionPerSecond(repo.listProducers(), []), /plain producer id to level record/);
    assert.throws(() => calculateTotalProductionPerSecond(repo.listProducers(), { fabricator: Number.POSITIVE_INFINITY }), /non-negative safe integer/);
    assert.throws(() => calculateElapsedProduction(-1, 1), /productionPerSecond must be a non-negative finite number/);
    assert.throws(() => calculateElapsedProduction(Number.NaN, 1), /productionPerSecond must be a non-negative finite number/);
    assert.throws(() => calculateElapsedProduction(1, -1), /elapsedSeconds must be a non-negative finite number/);
    assert.throws(() => calculateElapsedProduction(1, Number.POSITIVE_INFINITY), /elapsedSeconds must be a non-negative finite number/);
});

test('overflowing production calculations fail explicitly instead of returning NaN or Infinity', async () => {
    const { calculateElapsedProduction, calculateProducerBaseOutput, calculateTotalProductionPerSecond } = await economyModule();
    const repo = await repository();
    const fabricator = repo.getProducer('fabricator');

    assert.throws(() => calculateProducerBaseOutput({
        ...fabricator,
        baseProductionPerLevel: Number.MAX_VALUE,
    }, 2), /exceeds JavaScript Number range/);

    assert.throws(() => calculateTotalProductionPerSecond([
        { ...fabricator, id: 'one', baseProductionPerLevel: Number.MAX_VALUE },
        { ...fabricator, id: 'two', baseProductionPerLevel: Number.MAX_VALUE },
    ], {
        one: 1,
        two: 1,
    }), /exceeds JavaScript Number range/);

    assert.throws(() => calculateElapsedProduction(Number.MAX_VALUE, 2), /exceeds JavaScript Number range/);
});

test('production functions do not mutate producer configs or level maps', async () => {
    const { calculateElapsedProductionFromProducers, calculateTotalProductionPerSecond } = await economyModule();
    const repo = await repository();
    const producers = repo.listProducers();
    const levels = {
        fabricator: 10,
        assembly_station: 4,
    };
    const beforeProducers = JSON.stringify(producers);
    const beforeLevels = JSON.stringify(levels);

    calculateTotalProductionPerSecond(producers, levels);
    calculateElapsedProductionFromProducers(producers, levels, 5);

    assert.equal(JSON.stringify(producers), beforeProducers);
    assert.equal(JSON.stringify(levels), beforeLevels);
});
