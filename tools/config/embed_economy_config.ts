/**
 * AUT-INT-001 generator for `assets/scripts/config/EmbeddedEconomyConfig.ts`.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_economy_config.ts
 *
 * Embeds the exact text of `data/economy/*.json` (line endings normalized to LF) so the
 * app loads the same balancing data as Node tools and tests. `tests/embedded_economy_config.test.ts`
 * fails when the committed module drifts from `data/economy`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EmbeddedSource {
    filePath: string;
    text: string;
}

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(toolDirectory, '..', '..');
export const ECONOMY_DATA_DIRECTORY = path.join(REPO_ROOT, 'data', 'economy');
export const EMBEDDED_ECONOMY_CONFIG_PATH = path.join(REPO_ROOT, 'assets', 'scripts', 'config', 'EmbeddedEconomyConfig.ts');

/** Reads `data/economy/*.json`, sorted by repo-relative path, with LF line endings. */
export function collectEconomySources(directory: string = ECONOMY_DATA_DIRECTORY): EmbeddedSource[] {
    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => {
            const filePath = path.join(directory, entry.name);
            return {
                filePath: path.relative(REPO_ROOT, filePath).replace(/\\/g, '/'),
                text: readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'),
            };
        })
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

export function renderEmbeddedEconomyConfigModule(sources: readonly EmbeddedSource[]): string {
    const entries = sources.map((source) => [
        '    {',
        `        filePath: ${JSON.stringify(source.filePath)},`,
        `        text: ${JSON.stringify(source.text)},`,
        '    },',
    ].join('\n'));

    return [
        '// GENERATED FILE - do not edit by hand.',
        '// Source: data/economy/*.json (line endings normalized to LF).',
        '// Regenerate: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_economy_config.ts',
        "import type { ConfigFileSource } from './ConfigLoader.ts';",
        '',
        'const EMBEDDED_SOURCES: readonly ConfigFileSource[] = [',
        ...entries,
        '];',
        '',
        '/** Fresh copies of the embedded economy config sources, ready for `loadGameConfigFromSources`. */',
        'export function getEmbeddedEconomyConfigSources(): ConfigFileSource[] {',
        '    return EMBEDDED_SOURCES.map((source) => ({ filePath: source.filePath, text: source.text }));',
        '}',
        '',
    ].join('\n');
}

function isMainModule(): boolean {
    const entry = process.argv[1];
    return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
    const sources = collectEconomySources();
    writeFileSync(EMBEDDED_ECONOMY_CONFIG_PATH, renderEmbeddedEconomyConfigModule(sources), 'utf8');
    console.log(`Embedded ${sources.length} economy config files into ${path.relative(REPO_ROOT, EMBEDDED_ECONOMY_CONFIG_PATH).replace(/\\/g, '/')}`);
}
