const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');

type PackageJson = {
    creator?: {
        version?: string;
    };
};

const repoRoot = path.resolve(path.dirname(__filename), '..');

async function readPackageJson(): Promise<PackageJson> {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    const rawPackageJson = await readFile(packageJsonPath, 'utf8');
    return JSON.parse(rawPackageJson) as PackageJson;
}

async function collectTypeScriptTestFiles(directoryPath: string): Promise<string[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectTypeScriptTestFiles(entryPath);
        }

        if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            return [entryPath];
        }

        return [];
    }));

    return files.flat().sort();
}

test('project metadata remains locked to Cocos Creator 3.8.8', async () => {
    const packageJson = await readPackageJson();

    assert.equal(packageJson.creator?.version, '3.8.8');
});

test('pure TypeScript tests do not import the Cocos runtime module', async () => {
    const testFiles = await collectTypeScriptTestFiles(path.join(repoRoot, 'tests'));

    assert.ok(testFiles.length > 0, 'expected at least one TypeScript test file');

    for (const testFile of testFiles) {
        const source = await readFile(testFile, 'utf8');
        const importsCocosRuntime =
            /from\s+['"]cc['"]/.test(source) ||
            /require\(\s*['"]cc['"]\s*\)/.test(source);

        assert.equal(importsCocosRuntime, false, `${path.relative(repoRoot, testFile)} imports cc`);
    }
});
