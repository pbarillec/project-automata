import { getEmbeddedTextCatalogueSources } from './EmbeddedTextCatalogue.ts';
import { createTextCatalogue, type TextCatalogue } from './TextCatalogue.ts';

export * from './TextCatalogue.ts';
export { getEmbeddedTextCatalogueSources, type EmbeddedTextCatalogueSource } from './EmbeddedTextCatalogue.ts';

/** The only locale shipped by AUT-LOC-001; language selection belongs to AUT-052. */
export const DEFAULT_LOCALE_FILE = 'localization/en.json';

let defaultCatalogue: TextCatalogue | null = null;

/** Shared English catalogue built once from the embedded `localization/en.json`. */
export function getDefaultTextCatalogue(): TextCatalogue {
    if (defaultCatalogue === null) {
        const source = getEmbeddedTextCatalogueSources().find((entry) => entry.filePath === DEFAULT_LOCALE_FILE);
        if (!source) throw new Error(`Embedded text catalogue ${DEFAULT_LOCALE_FILE} is missing; regenerate EmbeddedTextCatalogue.ts.`);
        defaultCatalogue = createTextCatalogue(source.text);
    }
    return defaultCatalogue;
}
