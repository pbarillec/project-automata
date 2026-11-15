import { createTextCatalogue, type TextCatalogue } from './TextCatalogue.ts';

/**
 * AUT-052 pseudo-locale (engine-free test / DEBUG aid, never shipped as a language): every template keeps its `{param}` placeholders
 * untouched while the surrounding text is accented and padded by about 40%, the usual stand-in for a long translation. It is pure,
 * so the pseudo-long-string smoke test can resolve every composer with it and look for overflow, raw keys or broken placeholders.
 */
export const PSEUDO_LOCALE_EXPANSION = 0.4;

const ACCENTS: Readonly<Record<string, string>> = Object.freeze({
    a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ç', n: 'ñ',
    A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ç', N: 'Ñ',
});

const PLACEHOLDER_SPLIT = /(\{[A-Za-z][A-Za-z0-9_]*\})/;

/** Pseudo-localizes one template: placeholders verbatim, other letters accented, plus a filler of about `expansion` x the visible length. */
export function pseudoLocalizeTemplate(template: string, expansion: number = PSEUDO_LOCALE_EXPANSION): string {
    let visibleLength = 0;
    const body = template.split(PLACEHOLDER_SPLIT).map((part) => {
        if (PLACEHOLDER_SPLIT.test(part)) return part;
        visibleLength += part.length;
        return part.replace(/[A-Za-z]/g, (letter) => ACCENTS[letter] ?? letter);
    }).join('');
    const fillerLength = Math.ceil(visibleLength * expansion);
    return fillerLength > 0 ? `${body}${'·'.repeat(fillerLength)}` : body;
}

/** A catalogue whose every entry is the pseudo-localized English text (same keys, same placeholders). */
export function makePseudoLocaleCatalogue(source: TextCatalogue, expansion: number = PSEUDO_LOCALE_EXPANSION): TextCatalogue {
    const entries: Record<string, string> = {};
    for (const key of source.keys()) entries[key] = pseudoLocalizeTemplate(source.template(key) ?? key, expansion);
    return createTextCatalogue(JSON.stringify({ kind: 'localization', schemaVersion: 1, locale: 'pseudo', entries }));
}

/**
 * AUT-070 wide-glyph variant (a stand-in for CJK / full-width scripts, which are short but one em wide per glyph): every Latin letter becomes
 * its full-width form (U+FF21.. / U+FF41..), placeholders and digits stay verbatim, no expansion. Together with the +40% / +100% expansion
 * variants it stresses the text-fit rules from both directions (many narrow glyphs vs few wide ones). Test / DEBUG aid only, never shipped.
 */
export function wideGlyphLocalizeTemplate(template: string): string {
    return template.split(PLACEHOLDER_SPLIT).map((part) => {
        if (PLACEHOLDER_SPLIT.test(part)) return part;
        return part.replace(/[A-Za-z]/g, (letter) => String.fromCodePoint(letter.codePointAt(0)! + 0xfee0));
    }).join('');
}

export function makeWideGlyphPseudoLocaleCatalogue(source: TextCatalogue): TextCatalogue {
    const entries: Record<string, string> = {};
    for (const key of source.keys()) entries[key] = wideGlyphLocalizeTemplate(source.template(key) ?? key);
    return createTextCatalogue(JSON.stringify({ kind: 'localization', schemaVersion: 1, locale: 'pseudo-wide', entries }));
}
