import { getEmbeddedTextCatalogueSources } from './EmbeddedTextCatalogue.ts';
import { createTextCatalogue, type MissingTextSink, type TextCatalogue } from './TextCatalogue.ts';

export * from './TextCatalogue.ts';
export { getEmbeddedTextCatalogueSources, type EmbeddedTextCatalogueSource } from './EmbeddedTextCatalogue.ts';

/** The fallback locale; also the only locale shipped so far (AUT-LOC-001, AUT-052). */
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_LOCALE_FILE = 'localization/en.json';

const LOCALE_FILE_PATTERN = /^localization\/([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\.json$/;

const catalogues = new Map<string, TextCatalogue>();

function sourceFor(language: string) {
    return getEmbeddedTextCatalogueSources().find((entry) => entry.filePath === `localization/${language}.json`);
}

/** Languages that ship a catalogue (from the embedded `localization/<language>.json` files), English first. */
export function listAvailableLanguages(): string[] {
    const languages: string[] = [];
    for (const source of getEmbeddedTextCatalogueSources()) {
        const match = LOCALE_FILE_PATTERN.exec(source.filePath);
        if (match) languages.push(match[1]);
    }
    return languages.sort((a, b) => (a === DEFAULT_LANGUAGE ? -1 : b === DEFAULT_LANGUAGE ? 1 : a.localeCompare(b)));
}

/**
 * Shared catalogue of a language. An unknown language falls back to English and reports `unknown_language` to the optional sink
 * (never throws, so a corrupt setting can never blank the UI). One catalogue per language is built once from the embedded files.
 */
export function getTextCatalogue(language: string = DEFAULT_LANGUAGE, sink: MissingTextSink | null = null): TextCatalogue {
    let source = sourceFor(language);
    let resolved = language;
    if (!source) {
        if (sink) {
            try { sink({ kind: 'unknown_language', locale: DEFAULT_LANGUAGE, language: String(language) }); } catch { /* a faulty sink never breaks text */ }
        }
        resolved = DEFAULT_LANGUAGE;
        source = sourceFor(DEFAULT_LANGUAGE);
    }
    if (!source) throw new Error(`Embedded text catalogue ${DEFAULT_LOCALE_FILE} is missing; regenerate EmbeddedTextCatalogue.ts.`);
    let catalogue = catalogues.get(resolved);
    if (!catalogue) {
        catalogue = createTextCatalogue(source.text);
        catalogues.set(resolved, catalogue);
    }
    return catalogue;
}

/** Shared English catalogue built once from the embedded `localization/en.json` (kept for existing callers). */
export function getDefaultTextCatalogue(): TextCatalogue {
    return getTextCatalogue(DEFAULT_LANGUAGE);
}
