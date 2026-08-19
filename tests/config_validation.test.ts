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

    return validSources
        .filter((source) => source.filePath !== sourceSuffix)
        .concat(fixtureSource)
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
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
    assert.equal(repository.contentVersion, '0.1.0-config-fixture');
    assert.equal(repository.listEras().length, 2);
    assert.equal(repository.listProducers().length, 2);
    assert.equal(repository.listBreakthroughs().length, 1);
    assert.equal(repository.getProducer('fixture_fabricator')?.baseCost, 10);
    assert.equal(repository.getBreakthrough('fixture_basic_automation')?.effects[0].type, 'productionMultiplier');
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
    assert.equal(repositoryResult.value?.getEra('fixture_manual_workshop')?.order, 0);
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
        messagePattern: /Duplicate producers id "fixture_fabricator"/,
    });
});

test('unknown referenced IDs fail deterministically at cross-reference stage', async () => {
    await expectDiagnostic('unknown-reference', 'producers.json', {
        stage: 'cross-reference',
        code: 'CONFIG_UNKNOWN_REFERENCE',
        messagePattern: /Unknown era id "fixture_missing_era"/,
    });
});

test('invalid semantic numeric values fail deterministically', async () => {
    await expectDiagnostic('invalid-numeric', 'producers.json', {
        stage: 'semantic',
        code: 'CONFIG_INVALID_NUMBER',
        messagePattern: /baseCost must be greater than 0/,
    });
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
