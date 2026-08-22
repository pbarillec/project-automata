import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ConfigValidationError,
    formatConfigDiagnostic,
    loadGameConfigFromSources,
    type ConfigFileSource,
} from '../../assets/scripts/config/ConfigLoader.ts';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDirectory, '..', '..');
const configRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, 'data'));

try {
    const sources = await collectJsonSources(configRoot);
    const repository = loadGameConfigFromSources(sources);
    console.log(`Config validation passed: contentVersion=${repository.contentVersion} eras=${repository.listEras().length} producers=${repository.listProducers().length} breakthroughs=${repository.listBreakthroughs().length} milestones=${repository.listMilestones().length} permanentUpgrades=${repository.listPermanentUpgrades().length} prestige=${repository.getPrestigeConfig().id}`);
}
catch (error) {
    if (error instanceof ConfigValidationError) {
        for (const diagnostic of error.diagnostics) {
            console.error(formatConfigDiagnostic(diagnostic));
        }
        process.exitCode = 1;
    }
    else {
        throw error;
    }
}

async function collectJsonSources(directoryPath: string): Promise<ConfigFileSource[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectJsonSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            return [];
        }

        const text = await readFile(entryPath, 'utf8');
        return [{
            filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'),
            text,
        }];
    }));

    return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}
