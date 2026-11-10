/**
 * AUT-LOC-001 generator for `assets/scripts/localization/EmbeddedTextCatalogue.ts`.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_text_catalogue.ts
 *
 * Embeds the exact text of `localization/*.json` (line endings normalized to LF) so the app
 * resolves the same strings as Node tests. `tests/embedded_text_catalogue.test.ts` fails when
 * the committed module drifts from `localization/`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EmbeddedTextSource {
    filePath: string;
    text: string;
}

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(toolDirectory, '..', '..');
export const LOCALIZATION_DIRECTORY = path.join(REPO_ROOT, 'localization');
export const EMBEDDED_TEXT_CATALOGUE_PATH = path.join(REPO_ROOT, 'assets', 'scripts', 'localization', 'EmbeddedTextCatalogue.ts');

/** Reads `localization/*.json`, sorted by repo-relative path, with LF line endings. */
export function collectTextCatalogueSources(directory: string = LOCALIZATION_DIRECTORY): EmbeddedTextSource[] {
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

export function renderEmbeddedTextCatalogueModule(sources: readonly EmbeddedTextSource[]): string {
    const entries = sources.map((source) => [
        '    {',
        `        filePath: ${JSON.stringify(source.filePath)},`,
        `        text: ${JSON.stringify(source.text)},`,
        '    },',
    ].join('\n'));

    return [
        '// GENERATED FILE - do not edit by hand.',
        '// Source: localization/*.json (line endings normalized to LF).',
        '// Regenerate: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_text_catalogue.ts',
        '',
        'export interface EmbeddedTextCatalogueSource {',
        '    readonly filePath: string;',
        '    readonly text: string;',
        '}',
        '',
        'const EMBEDDED_SOURCES: readonly EmbeddedTextCatalogueSource[] = [',
        ...entries,
        '];',
        '',
        '/** Fresh copies of the embedded text catalogue sources. */',
        'export function getEmbeddedTextCatalogueSources(): EmbeddedTextCatalogueSource[] {',
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
    const sources = collectTextCatalogueSources();
    writeFileSync(EMBEDDED_TEXT_CATALOGUE_PATH, renderEmbeddedTextCatalogueModule(sources), 'utf8');
    console.log(`Embedded ${sources.length} text catalogue files into ${path.relative(REPO_ROOT, EMBEDDED_TEXT_CATALOGUE_PATH).replace(/\\/g, '/')}`);
}
