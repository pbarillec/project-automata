const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;

let configModulePromise;

async function configModule() {
    if (configModulePromise === undefined) {
        configModulePromise = import(configModuleUrl);
    }

    return configModulePromise;
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

async function sourcesWithInvalidFixture(fixtureName, fileName) {
    const validSources = await collectJsonSources(dataRoot);
    const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'config', 'invalid', fixtureName, fileName);
    const fixtureSource = {
        filePath: path.relative(repoRoot, fixturePath).replace(/\\/g, '/'),
        text: await readFile(fixturePath, 'utf8'),
    };
    const sourceSuffix = `data/economy/${fileName}`;
    const replacementSources = [fixtureSource];

    if (fileName === 'producers.json') {
        replacementSources.push(emptyBreakthroughsSource());
    }

    return validSources
        .filter((source) => {
            if (source.filePath === sourceSuffix) {
                return false;
            }
            return fileName !== 'producers.json' || source.filePath !== 'data/economy/breakthroughs.json';
        })
        .concat(replacementSources)
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function sourcesWithProducerItems(items) {
    const validSources = await collectJsonSources(dataRoot);
    const producerSource = {
        filePath: 'data/economy/producers.json',
        text: JSON.stringify({
            kind: 'producers',
            schemaVersion: 1,
            contentVersion: '0.1.0-aut-010',
            items,
        }),
    };

    return validSources
        .filter((source) => source.filePath !== producerSource.filePath && source.filePath !== 'data/economy/breakthroughs.json')
        .concat(producerSource, emptyBreakthroughsSource())
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function emptyBreakthroughsSource() {
    return {
        filePath: 'data/economy/breakthroughs.json',
        text: JSON.stringify({
            kind: 'breakthroughs',
            schemaVersion: 1,
            contentVersion: '0.1.0-aut-010',
            items: [],
        }),
    };
}

async function expectDiagnostic(fixtureName, fileName, expected) {
    const { validateConfigSources, formatConfigDiagnostic } = await configModule();
    const result = validateConfigSources(await sourcesWithInvalidFixture(fixtureName, fileName));

    assert.equal(result.value, undefined);
    assert.ok(result.diagnostics.length > 0, 'expected at least one config diagnostic');
    assert.equal(result.diagnostics[0].stage, expected.stage);
    assert.equal(result.diagnostics[0].code, expected.code);
    assert.match(formatConfigDiagnostic(result.diagnostics[0]), expected.messagePattern);
}

test('valid representative multi-file config loads into typed repository', async () => {
    const { loadGameConfigFromSources } = await configModule();
    const repository = loadGameConfigFromSources(await collectJsonSources(dataRoot));

    assert.equal(repository.schemaVersion, 1);
    assert.equal(repository.contentVersion, '0.1.0-aut-010');
    assert.equal(repository.listEras().length, 3);
    assert.equal(repository.listProducers().length, 5);
    assert.equal(repository.listBreakthroughs().length, 6);
    assert.equal(repository.listMilestones().length, 4);
    assert.equal(repository.getProducer('fabricator')?.baseCost, 10);
});

test('approved MVP producers match order, names, eras and economic baselines', async () => {
    const { loadGameConfigFromSources } = await configModule();
    const repository = loadGameConfigFromSources(await collectJsonSources(dataRoot));

    assert.deepEqual(repository.listProducers().map((producer) => producer.id), [
        'fabricator',
        'assembly_station',
        'robot_line',
        'automated_cell',
        'advanced_robotics_complex',
    ]);

    assert.deepEqual(repository.listProducers().map((producer) => ({
        id: producer.id,
        name: producer.name,
        eraId: producer.eraId,
        baseCost: producer.baseCost,
        costGrowth: producer.costGrowth,
        baseProductionPerLevel: producer.baseProductionPerLevel,
    })), [
        {
            id: 'fabricator',
            name: 'Fabricator',
            eraId: 'manual_workshop',
            baseCost: 10,
            costGrowth: 1.14,
            baseProductionPerLevel: 1,
        },
        {
            id: 'assembly_station',
            name: 'Assembly Station',
            eraId: 'manual_workshop',
            baseCost: 1500,
            costGrowth: 1.15,
            baseProductionPerLevel: 12,
        },
        {
            id: 'robot_line',
            name: 'Robot Line',
            eraId: 'automated_factory',
            baseCost: 50000,
            costGrowth: 1.16,
            baseProductionPerLevel: 150,
        },
        {
            id: 'automated_cell',
            name: 'Automated Cell',
            eraId: 'automated_factory',
            baseCost: 5000000,
            costGrowth: 1.17,
            baseProductionPerLevel: 2500,
        },
        {
            id: 'advanced_robotics_complex',
            name: 'Advanced Robotics Complex',
            eraId: 'robotics_complex',
            baseCost: 500000000,
            costGrowth: 1.18,
            baseProductionPerLevel: 500000,
        },
    ]);
});

test('approved shared MVP milestones match Economy thresholds and production multipliers', async () => {
    const { loadGameConfigFromSources } = await configModule();
    const repository = loadGameConfigFromSources(await collectJsonSources(dataRoot));

    assert.deepEqual(repository.listMilestones(), [
        {
            id: 'level_10',
            threshold: 10,
            productionMultiplier: 2,
        },
        {
            id: 'level_25',
            threshold: 25,
            productionMultiplier: 2,
        },
        {
            id: 'level_50',
            threshold: 50,
            productionMultiplier: 3,
        },
        {
            id: 'level_100',
            threshold: 100,
            productionMultiplier: 5,
        },
    ]);
});

test('approved standard MVP breakthroughs match Economy costs, requirements and typed effects', async () => {
    const { loadGameConfigFromSources } = await configModule();
    const repository = loadGameConfigFromSources(await collectJsonSources(dataRoot));

    assert.deepEqual(repository.listBreakthroughs().map((breakthrough) => breakthrough.id), [
        'auto_feeder',
        'worker_bot',
        'robotic_logistics',
        'factory_control_system',
        'automated_cell_architecture',
        'advanced_robotics',
    ]);

    assert.deepEqual(repository.listBreakthroughs().map((breakthrough) => ({
        id: breakthrough.id,
        cost: breakthrough.cost,
        requirements: breakthrough.requirements,
        effects: breakthrough.effects,
    })), [
        {
            id: 'auto_feeder',
            cost: 1500,
            requirements: [
                { type: 'producerLevel', producerId: 'fabricator', level: 15 },
            ],
            effects: [
                { type: 'setProducerAutomation', producerId: 'fabricator', automated: true, offlineEligible: true },
                { type: 'producerProductionMultiplier', producerId: 'fabricator', multiplier: 1.25 },
            ],
        },
        {
            id: 'worker_bot',
            cost: 75000,
            requirements: [
                { type: 'producerLevel', producerId: 'assembly_station', level: 10 },
            ],
            effects: [
                { type: 'setProducerAutomation', producerId: 'assembly_station', automated: true, offlineEligible: false },
                { type: 'producerProductionMultiplier', producerId: 'assembly_station', multiplier: 1.5 },
                { type: 'setProgressionFlag', flagId: 'first_robot', value: true },
            ],
        },
        {
            id: 'robotic_logistics',
            cost: 250000,
            requirements: [
                { type: 'breakthroughOwned', breakthroughId: 'worker_bot' },
                { type: 'producerLevel', producerId: 'fabricator', level: 25 },
                { type: 'producerLevel', producerId: 'assembly_station', level: 15 },
            ],
            effects: [
                { type: 'producerProductionMultiplier', producerId: 'fabricator', multiplier: 2 },
                { type: 'producerProductionMultiplier', producerId: 'assembly_station', multiplier: 2 },
            ],
        },
        {
            id: 'factory_control_system',
            cost: 3000000,
            requirements: [
                { type: 'producerLevel', producerId: 'robot_line', level: 10 },
                { type: 'robotsBuilt', count: 10 },
            ],
            effects: [
                { type: 'globalProductionMultiplier', multiplier: 2 },
            ],
        },
        {
            id: 'automated_cell_architecture',
            cost: 25000000,
            requirements: [
                { type: 'producerLevel', producerId: 'robot_line', level: 25 },
                { type: 'robotsBuilt', count: 100 },
            ],
            effects: [
                { type: 'constructProducer', producerId: 'automated_cell', level: 1 },
            ],
        },
        {
            id: 'advanced_robotics',
            cost: 1000000000,
            requirements: [
                { type: 'producerLevel', producerId: 'robot_line', level: 50 },
                { type: 'producerLevel', producerId: 'automated_cell', level: 25 },
                { type: 'robotsBuilt', count: 1000 },
            ],
            effects: [
                { type: 'constructProducer', producerId: 'advanced_robotics_complex', level: 1 },
                { type: 'enterEra', eraId: 'robotics_complex' },
            ],
        },
    ]);
});

test('standard MVP breakthroughs intentionally exclude Robot Line construction and Reboot Civilization', async () => {
    const { loadGameConfigFromSources } = await configModule();
    const repository = loadGameConfigFromSources(await collectJsonSources(dataRoot));
    const ids = repository.listBreakthroughs().map((breakthrough) => breakthrough.id);

    assert.equal(ids.includes('robot_line'), false);
    assert.equal(ids.includes('reboot_civilization'), false);
});

test('validation stages are callable separately', async () => {
    const {
        parseConfigSources,
        validateConfigStructure,
        validateConfigReferences,
        validateConfigSemantics,
        buildGameConfigRepository,
    } = await configModule();

    const parseResult = parseConfigSources(await collectJsonSources(dataRoot));
    assert.deepEqual(parseResult.diagnostics, []);

    const structuralResult = validateConfigStructure(parseResult.value);
    assert.deepEqual(structuralResult.diagnostics, []);

    assert.deepEqual(validateConfigReferences(structuralResult.value), []);
    assert.deepEqual(validateConfigSemantics(structuralResult.value), []);

    const repositoryResult = buildGameConfigRepository(structuralResult.value);
    assert.deepEqual(repositoryResult.diagnostics, []);
    assert.equal(repositoryResult.value?.getEra('manual_workshop')?.order, 0);
    assert.equal(repositoryResult.value?.getMilestone('level_100')?.productionMultiplier, 5);
});

test('malformed JSON fails deterministically at parse stage', async () => {
    await expectDiagnostic('malformed-json', 'producers.json', {
        stage: 'parse',
        code: 'CONFIG_PARSE_JSON',
        messagePattern: /Malformed JSON/,
    });
});

test('missing required fields fail deterministically at structural stage', async () => {
    await expectDiagnostic('missing-required-field', 'producers.json', {
        stage: 'structural',
        code: 'CONFIG_REQUIRED_FIELD',
        messagePattern: /baseCost is required/,
    });
});

test('duplicate IDs fail deterministically at structural stage', async () => {
    await expectDiagnostic('duplicate-id', 'producers.json', {
        stage: 'structural',
        code: 'CONFIG_DUPLICATE_ID',
        messagePattern: /Duplicate producers id "fabricator"/,
    });
});

test('unknown referenced IDs fail deterministically at cross-reference stage', async () => {
    await expectDiagnostic('unknown-reference', 'producers.json', {
        stage: 'cross-reference',
        code: 'CONFIG_UNKNOWN_REFERENCE',
        messagePattern: /Unknown era id "missing_era"/,
    });
});

test('invalid semantic numeric values fail deterministically', async () => {
    await expectDiagnostic('invalid-numeric', 'producers.json', {
        stage: 'semantic',
        code: 'CONFIG_INVALID_NUMBER',
        messagePattern: /baseCost must be greater than 0/,
    });
});

test('producer cost growth must be greater than 1', async () => {
    const { validateConfigSources, formatConfigDiagnostic } = await configModule();
    const result = validateConfigSources(await sourcesWithProducerItems([
        {
            id: 'fabricator',
            name: 'Fabricator',
            displayNameKey: 'producer.fabricator.name',
            eraId: 'manual_workshop',
            baseCost: 10,
            costGrowth: 1,
            baseProductionPerLevel: 1,
            prerequisiteProducerIds: [],
        },
    ]));

    assert.equal(result.value, undefined);
    assert.equal(result.diagnostics[0].stage, 'semantic');
    assert.equal(result.diagnostics[0].code, 'CONFIG_INVALID_NUMBER');
    assert.match(formatConfigDiagnostic(result.diagnostics[0]), /costGrowth must be greater than 1/);
});

test('producer economic values must be finite and positive', async () => {
    const { validateConfigSources, formatConfigDiagnostic } = await configModule();
    const result = validateConfigSources(await sourcesWithProducerItems([
        {
            id: 'fabricator',
            name: 'Fabricator',
            displayNameKey: 'producer.fabricator.name',
            eraId: 'manual_workshop',
            baseCost: 10,
            costGrowth: 1.14,
            baseProductionPerLevel: 1e999,
            prerequisiteProducerIds: [],
        },
    ]));

    assert.equal(result.value, undefined);
    assert.equal(result.diagnostics[0].stage, 'structural');
    assert.equal(result.diagnostics[0].code, 'CONFIG_INVALID_TYPE');
    assert.match(formatConfigDiagnostic(result.diagnostics[0]), /baseProductionPerLevel must be a finite number/);
});

test('representative prerequisite cycles fail deterministically', async () => {
    await expectDiagnostic('reference-cycle', 'producers.json', {
        stage: 'semantic',
        code: 'CONFIG_REFERENCE_CYCLE',
        messagePattern: /Producer prerequisite cycle detected/,
    });
});

test('unknown effect types fail deterministically', async () => {
    await expectDiagnostic('unknown-effect-type', 'breakthroughs.json', {
        stage: 'semantic',
        code: 'CONFIG_UNKNOWN_EFFECT_TYPE',
        messagePattern: /Unsupported effect type "grantCurrency"/,
    });
});

test('unknown requirement types fail deterministically', async () => {
    await expectDiagnostic('unknown-requirement-type', 'breakthroughs.json', {
        stage: 'semantic',
        code: 'CONFIG_UNKNOWN_REQUIREMENT_TYPE',
        messagePattern: /Unsupported requirement type "secretHandshake"/,
    });
});

test('duplicate milestone thresholds fail deterministically', async () => {
    await expectDiagnostic('duplicate-milestone-threshold', 'milestones.json', {
        stage: 'semantic',
        code: 'CONFIG_DUPLICATE_MILESTONE_THRESHOLD',
        messagePattern: /Duplicate milestone threshold 10/,
    });
});

test('invalid milestone multipliers fail deterministically', async () => {
    await expectDiagnostic('invalid-milestone-multiplier', 'milestones.json', {
        stage: 'semantic',
        code: 'CONFIG_INVALID_NUMBER',
        messagePattern: /productionMultiplier must be greater than 0/,
    });
});

test('invalid milestone ordering fails deterministically', async () => {
    await expectDiagnostic('invalid-milestone-order', 'milestones.json', {
        stage: 'semantic',
        code: 'CONFIG_INVALID_ORDER',
        messagePattern: /strictly ascending/,
    });
});

test('malformed milestone records fail deterministically at structural stage', async () => {
    await expectDiagnostic('malformed-milestone-record', 'milestones.json', {
        stage: 'structural',
        code: 'CONFIG_REQUIRED_FIELD',
        messagePattern: /threshold is required/,
    });
});

test('config validation runs without importing the Cocos runtime module', async () => {
    const { validateConfigSources } = await configModule();
    const result = validateConfigSources(await collectJsonSources(dataRoot));
    assert.deepEqual(result.diagnostics, []);

    const configSourceFiles = await collectTypeScriptSources(path.join(repoRoot, 'assets', 'scripts', 'config'));
    assert.ok(configSourceFiles.length > 0, 'expected config TypeScript sources');

    for (const sourceFile of configSourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const importsCocosRuntime =
            /from\s+['"]cc['"]/.test(source) ||
            /require\(\s*['"]cc['"]\s*\)/.test(source);

        assert.equal(importsCocosRuntime, false, `${path.relative(repoRoot, sourceFile)} imports cc`);
    }
});
