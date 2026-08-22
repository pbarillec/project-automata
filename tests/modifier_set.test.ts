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

test('empty modifier set resolves to identity production multipliers', async () => {
    const {
        ModifierSet,
        applyProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
        resolveEffectiveProductionModifiers,
    } = await economyModule();

    const modifierSet = ModifierSet.empty();
    const effective = resolveEffectiveProductionModifiers(modifierSet);

    assert.equal(effective.globalMultiplier, 1);
    assert.deepEqual(effective.producerMultipliers, {});
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'fabricator'), 1);
    assert.equal(applyProductionMultiplier(123, effective.globalMultiplier), 123);
});

test('one global multiplicative production modifier resolves to its exact multiplier', async () => {
    const {
        ModifierSet,
        createGlobalProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
        resolveEffectiveProductionModifiers,
    } = await economyModule();

    const modifierSet = new ModifierSet({
        productionMultipliers: [
            createGlobalProductionMultiplier(1.25),
        ],
    });

    assert.equal(resolveEffectiveProductionModifiers(modifierSet).globalMultiplier, 1.25);
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'fabricator'), 1.25);
});

test('producer and global production modifiers compose by multiplication', async () => {
    const {
        ModifierSet,
        createGlobalProductionMultiplier,
        createProducerProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
        resolveEffectiveProductionModifiers,
    } = await economyModule();

    const modifierSet = new ModifierSet({
        productionMultipliers: [
            createGlobalProductionMultiplier(2),
            createProducerProductionMultiplier('fabricator', 1.25),
            createProducerProductionMultiplier('fabricator', 3),
            createProducerProductionMultiplier('assembly_station', 1.5),
        ],
    });
    const effective = resolveEffectiveProductionModifiers(modifierSet);

    assert.equal(effective.globalMultiplier, 2);
    assert.equal(effective.producerMultipliers.fabricator, 3.75);
    assert.equal(effective.producerMultipliers.assembly_station, 1.5);
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'fabricator'), 7.5);
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'assembly_station'), 3);
    assert.equal(resolveEffectiveProducerProductionMultiplier(modifierSet, 'robot_line'), 2);
});

test('modifier composition is deterministic regardless of equivalent input order', async () => {
    const {
        ModifierSet,
        combineModifierSets,
        createGlobalProductionMultiplier,
        createProducerProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
        resolveEffectiveProductionModifiers,
    } = await economyModule();
    const first = new ModifierSet({
        productionMultipliers: [
            createProducerProductionMultiplier('fabricator', 3),
            createGlobalProductionMultiplier(2),
            createProducerProductionMultiplier('fabricator', 1.25),
        ],
    });
    const second = new ModifierSet({
        productionMultipliers: [
            createProducerProductionMultiplier('fabricator', 1.25),
            createProducerProductionMultiplier('fabricator', 3),
            createGlobalProductionMultiplier(2),
        ],
    });
    const combinedOne = combineModifierSets([first, second]);
    const combinedTwo = combineModifierSets([second, first]);

    assert.deepEqual(resolveEffectiveProductionModifiers(first), resolveEffectiveProductionModifiers(second));
    assert.deepEqual(resolveEffectiveProductionModifiers(combinedOne), resolveEffectiveProductionModifiers(combinedTwo));
    assert.equal(resolveEffectiveProducerProductionMultiplier(combinedOne, 'fabricator'), 56.25);
    assert.deepEqual(first.getProductionMultipliers(), [
        { type: 'globalProductionMultiplier', multiplier: 2 },
        { type: 'producerProductionMultiplier', producerId: 'fabricator', multiplier: 1.25 },
        { type: 'producerProductionMultiplier', producerId: 'fabricator', multiplier: 3 },
    ]);
});

test('invalid production modifiers are rejected deterministically', async () => {
    const {
        ModifierSet,
        ModifierSetInputError,
        applyProductionMultiplier,
        combineModifierSets,
        createGlobalProductionMultiplier,
        createProducerProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
    } = await economyModule();

    for (const invalidMultiplier of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
        assert.throws(() => createGlobalProductionMultiplier(invalidMultiplier), ModifierSetInputError);
        assert.throws(() => createProducerProductionMultiplier('fabricator', invalidMultiplier), /positive finite number/);
    }

    assert.throws(() => new ModifierSet(null), /plain object/);
    assert.throws(() => new ModifierSet({ productionMultipliers: null }), /must be an array/);
    assert.throws(() => new ModifierSet({
        productionMultipliers: [{ type: 'unknownModifier', multiplier: 2 }],
    }), /unsupported production multiplier modifier type/);
    assert.throws(() => createProducerProductionMultiplier('', 2), /non-empty string/);
    assert.throws(() => resolveEffectiveProducerProductionMultiplier(ModifierSet.empty(), ''), /non-empty string/);
    assert.throws(() => applyProductionMultiplier(Number.NaN, 2), /baseProduction must be a non-negative finite number/);
    assert.throws(() => applyProductionMultiplier(-1, 2), /baseProduction must be a non-negative finite number/);
    assert.throws(() => combineModifierSets([ModifierSet.empty(), {}]), /ModifierSet instances/);
});

test('combining modifier sets and reading modifiers does not mutate or share inputs', async () => {
    const {
        ModifierSet,
        combineModifierSets,
        createGlobalProductionMultiplier,
        createProducerProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
    } = await economyModule();
    const inputModifiers = [
        createProducerProductionMultiplier('fabricator', 2),
    ];
    const first = new ModifierSet({ productionMultipliers: inputModifiers });
    const second = ModifierSet.empty().withProductionMultiplier(createGlobalProductionMultiplier(3));
    const firstBefore = first.getProductionMultipliers();
    const secondBefore = second.getProductionMultipliers();

    inputModifiers.push(createGlobalProductionMultiplier(100));
    const exposed = first.getProductionMultipliers();
    exposed.push(createGlobalProductionMultiplier(1000));
    exposed[0].multiplier = 99;

    const combined = combineModifierSets([first, second]);

    assert.deepEqual(first.getProductionMultipliers(), firstBefore);
    assert.deepEqual(second.getProductionMultipliers(), secondBefore);
    assert.equal(resolveEffectiveProducerProductionMultiplier(first, 'fabricator'), 2);
    assert.equal(resolveEffectiveProducerProductionMultiplier(combined, 'fabricator'), 6);
});

test('applying an effective production multiplier is pure and handles zero base production', async () => {
    const {
        ModifierSet,
        applyProductionMultiplier,
        calculateModifiedProducerOutput,
        createGlobalProductionMultiplier,
    } = await economyModule();
    const repo = await repository();
    const fabricator = repo.getProducer('fabricator');
    const modifierSet = new ModifierSet({
        productionMultipliers: [createGlobalProductionMultiplier(10)],
    });

    assert.equal(applyProductionMultiplier(0, 10), 0);
    assert.equal(applyProductionMultiplier(12, 10), 120);
    assert.equal(calculateModifiedProducerOutput(fabricator, 0, modifierSet), 0);
    assert.equal(calculateModifiedProducerOutput(fabricator, 12, modifierSet), 120);
});

test('non-finite modifier arithmetic fails explicitly instead of propagating silently', async () => {
    const {
        ModifierSet,
        applyProductionMultiplier,
        createGlobalProductionMultiplier,
        createProducerProductionMultiplier,
        resolveEffectiveProducerProductionMultiplier,
    } = await economyModule();

    assert.throws(() => resolveEffectiveProducerProductionMultiplier(new ModifierSet({
        productionMultipliers: [
            createGlobalProductionMultiplier(Number.MAX_VALUE),
            createProducerProductionMultiplier('fabricator', 2),
        ],
    }), 'fabricator'), /exceeds JavaScript Number range/);

    assert.throws(() => applyProductionMultiplier(Number.MAX_VALUE, 2), /modified production exceeds JavaScript Number range/);
});

test('AUT-010 cumulative milestone multiplier feeds the generic modifier path without duplicated thresholds', async () => {
    const {
        ModifierSet,
        calculateCumulativeMilestoneMultiplier,
        calculateModifiedProducerOutput,
        calculateProducerBaseOutput,
        createProducerProductionMultiplier,
    } = await economyModule();
    const repo = await repository();
    const fabricator = repo.getProducer('fabricator');
    const milestones = repo.listMilestones();
    const level = 100;
    const baseOutput = calculateProducerBaseOutput(fabricator, level);
    const milestoneMultiplier = calculateCumulativeMilestoneMultiplier(milestones, level);
    const modifierSet = new ModifierSet({
        productionMultipliers: [
            createProducerProductionMultiplier(fabricator.id, milestoneMultiplier),
        ],
    });

    assert.equal(baseOutput, 100);
    assert.equal(milestoneMultiplier, 60);
    assert.equal(calculateModifiedProducerOutput(fabricator, level, modifierSet), 6000);
});
