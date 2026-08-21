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

async function collectTypeScriptSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectTypeScriptSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.ts')) {
            return [];
        }

        return [entryPath];
    }));

    return nestedSources.flat().sort();
}

function geometricBulkCost(producer, currentLevel, quantity) {
    return producer.baseCost *
        Math.pow(producer.costGrowth, currentLevel) *
        ((Math.pow(producer.costGrowth, quantity) - 1) / (producer.costGrowth - 1));
}

function assertApproxEqual(actual, expected, message) {
    const tolerance = Math.max(1e-10, Math.abs(expected) * 1e-12);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

test('buying Level 1 from Level 0 costs exactly baseCost for every AUT-007 producer', async () => {
    const { calculateNextProducerLevelCost, calculateProducerBulkPurchaseCost } = await economyModule();
    const repo = await repository();

    for (const producer of repo.listProducers()) {
        assert.equal(calculateNextProducerLevelCost(producer, 0), producer.baseCost);
        assert.equal(calculateProducerBulkPurchaseCost(producer, 0, 1), producer.baseCost);
    }
});

test('next-level and x1 bulk cost share the same result across representative levels', async () => {
    const { calculateNextProducerLevelCost, calculateProducerBulkPurchaseCost } = await economyModule();
    const repo = await repository();
    const levels = [0, 1, 10, 25, 100];

    for (const producer of [repo.getProducer('fabricator'), repo.getProducer('robot_line'), repo.getProducer('advanced_robotics_complex')]) {
        assert.ok(producer !== undefined);
        for (const level of levels) {
            const expected = producer.baseCost * Math.pow(producer.costGrowth, level);
            assert.equal(calculateProducerBulkPurchaseCost(producer, level, 1), calculateNextProducerLevelCost(producer, level));
            assertApproxEqual(calculateNextProducerLevelCost(producer, level), expected, `${producer.id} level ${level}`);
        }
    }
});

test('x10 and arbitrary bulk costs match the approved geometric series formula', async () => {
    const { calculateProducerBulkPurchaseCost, calculateProducerPurchaseCost } = await economyModule();
    const repo = await repository();
    const cases = [
        ['fabricator', 0, 10],
        ['fabricator', 8, 17],
        ['assembly_station', 10, 10],
        ['robot_line', 25, 37],
        ['automated_cell', 50, 10],
    ];

    for (const [producerId, currentLevel, quantity] of cases) {
        const producer = repo.getProducer(producerId);
        assert.ok(producer !== undefined);
        const expected = geometricBulkCost(producer, currentLevel, quantity);
        assertApproxEqual(calculateProducerBulkPurchaseCost(producer, currentLevel, quantity), expected, `${producerId} bulk`);

        const purchase = calculateProducerPurchaseCost(producer, currentLevel, quantity);
        assert.equal(purchase.producerId, producerId);
        assert.equal(purchase.currentLevel, currentLevel);
        assert.equal(purchase.quantity, quantity);
        assert.equal(purchase.nextLevel, currentLevel + quantity);
        assertApproxEqual(purchase.cost, expected, `${producerId} purchase object`);
    }
});

test('MAX returns zero when balance cannot afford the next level', async () => {
    const { calculateMaxAffordableProducerPurchase } = await economyModule();
    const repo = await repository();
    const producer = repo.getProducer('assembly_station');

    const result = calculateMaxAffordableProducerPurchase(producer, 0, producer.baseCost - 1);

    assert.deepEqual(result, {
        producerId: 'assembly_station',
        currentLevel: 0,
        quantity: 0,
        nextLevel: 0,
        cost: 0,
    });
});

test('MAX accepts exact geometric affordability boundaries and rejects just below', async () => {
    const {
        PRODUCER_COST_RELATIVE_TOLERANCE,
        calculateMaxAffordableProducerPurchase,
        calculateProducerBulkPurchaseCost,
    } = await economyModule();
    const repo = await repository();
    const producer = repo.getProducer('fabricator');
    const currentLevel = 12;
    const quantity = 25;
    const exactCost = calculateProducerBulkPurchaseCost(producer, currentLevel, quantity);

    const exact = calculateMaxAffordableProducerPurchase(producer, currentLevel, exactCost);
    assert.equal(exact.quantity, quantity);
    assert.equal(exact.nextLevel, currentLevel + quantity);
    assert.equal(exact.cost, exactCost);

    const justBelow = exactCost - Math.max(1e-6, exactCost * PRODUCER_COST_RELATIVE_TOLERANCE * 8);
    const below = calculateMaxAffordableProducerPurchase(producer, currentLevel, justBelow);
    assert.equal(below.quantity, quantity - 1);
    assert.ok(below.cost <= justBelow);
});

test('MAX finds the largest affordable quantity without per-level stepping assumptions', async () => {
    const { calculateMaxAffordableProducerPurchase, calculateProducerBulkPurchaseCost } = await economyModule();
    const repo = await repository();
    const producer = repo.getProducer('robot_line');
    const currentLevel = 1000;
    const quantity = 400;
    const balance = calculateProducerBulkPurchaseCost(producer, currentLevel, quantity);

    const result = calculateMaxAffordableProducerPurchase(producer, currentLevel, balance);
    assert.equal(result.quantity, quantity);
    assert.equal(result.nextLevel, currentLevel + quantity);
    assert.equal(Number.isFinite(result.cost), true);

    const nextCost = calculateProducerBulkPurchaseCost(producer, currentLevel, quantity + 1);
    assert.ok(nextCost > balance);
});

test('invalid inputs fail deterministically with actionable ProducerCostInputError messages', async () => {
    const {
        ProducerCostInputError,
        calculateMaxAffordableProducerPurchase,
        calculateProducerBulkPurchaseCost,
        calculateProducerPurchaseCost,
    } = await economyModule();
    const repo = await repository();
    const producer = repo.getProducer('fabricator');

    assert.throws(() => calculateProducerBulkPurchaseCost(producer, -1, 1), {
        name: 'ProducerCostInputError',
        message: /currentLevel must be a non-negative safe integer/,
    });
    assert.throws(() => calculateProducerBulkPurchaseCost(producer, 1.5, 1), ProducerCostInputError);
    assert.throws(() => calculateProducerBulkPurchaseCost(producer, 0, 0), /quantity must be a positive safe integer/);
    assert.throws(() => calculateProducerBulkPurchaseCost(producer, 0, 2.5), /quantity must be a positive safe integer/);
    assert.throws(() => calculateMaxAffordableProducerPurchase(producer, 0, -1), /balance must be a non-negative finite number/);
    assert.throws(() => calculateMaxAffordableProducerPurchase(producer, 0, Number.NaN), /balance must be a non-negative finite number/);
    assert.throws(() => calculateProducerPurchaseCost({ ...producer, baseCost: 0 }, 0, 1), /baseCost must be a positive finite number/);
    assert.throws(() => calculateProducerPurchaseCost({ ...producer, costGrowth: 1 }, 0, 1), /costGrowth must be a finite number greater than 1/);
});

test('overflowing large calculations fail explicitly instead of returning NaN or Infinity', async () => {
    const { calculateProducerBulkPurchaseCost } = await economyModule();
    const repo = await repository();
    const producer = repo.getProducer('advanced_robotics_complex');

    assert.throws(() => calculateProducerBulkPurchaseCost(producer, 100000, 10), {
        name: 'ProducerCostInputError',
        message: /overflows JavaScript Number range/,
    });
});

test('producer cost functions do not mutate producer config objects', async () => {
    const { calculateMaxAffordableProducerPurchase, calculateProducerBulkPurchaseCost } = await economyModule();
    const repo = await repository();
    const producer = repo.getProducer('fabricator');
    const before = JSON.stringify(producer);

    calculateProducerBulkPurchaseCost(producer, 5, 10);
    calculateMaxAffordableProducerPurchase(producer, 5, 10000);

    assert.equal(JSON.stringify(producer), before);
});

test('economy modules stay pure TypeScript without Cocos, scene, state, platform or native imports', async () => {
    const sourceFiles = await collectTypeScriptSources(path.join(repoRoot, 'assets', 'scripts', 'economy'));

    assert.ok(sourceFiles.length > 0, 'expected economy TypeScript sources');

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);

        assert.equal(/from\s+['"]cc['"]/.test(source), false, `${relativePath} imports Cocos runtime`);
        assert.equal(/assets[\\/]scenes|assets[\\/]ui/.test(source), false, `${relativePath} imports scene or UI code`);
        assert.equal(/state|domain|progression|services|platform|native\.reflection|AutomataPlatformBridge|com\.google|BillingClient|MobileAds/.test(source), false, `${relativePath} imports out-of-scope runtime code`);
    }
});
