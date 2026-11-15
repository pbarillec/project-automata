/**
 * AUT-070 engine-free text-fit rules shared by every UI label (design units, no `cc`).
 *
 * The Cocos Label shrinks an over-long line (Overflow.SHRINK) but never below what it needs, so a very long translation can still end up
 * smaller than the readable minimum or spill out of its rect. The rule, applied before the string reaches the Label:
 *   1. wrap (greedy, on spaces; a single over-long word is broken by characters) at the nominal font; fits when it needs <= `maxLines` lines;
 *   2. otherwise shrink the font one unit at a time down to `minFontSize` until it fits;
 *   3. otherwise truncate at the minimum font and end the last line with an ellipsis (so text is never clipped mid-glyph or silently lost).
 * Text that fits at its nominal font is returned untouched (every shipped English string; pinned by tests), so device-proven geometry and
 * wording do not change. Width is an estimate (the same 0.48 x font-size per Latin glyph used by the UiLayout tests; 1.0 for wide
 * East-Asian / full-width glyphs), deliberately slightly generous.
 */
export const TEXT_GLYPH_WIDTH_PER_FONT_UNIT = 0.48;
export const TEXT_WIDE_GLYPH_WIDTH_PER_FONT_UNIT = 1.0;
export const TEXT_ELLIPSIS = '…';
/** Readable minimums: body text, and primary button captions (the layouts' *_MIN_BODY_FONT_SIZE / *_MIN_CLOSE_FONT_SIZE are pinned equal to these by tests). */
export const TEXT_MIN_BODY_FONT_SIZE = 20;
export const TEXT_MIN_BUTTON_FONT_SIZE = 28;

export interface TextFitOptions {
    /** Rect width in design units. */
    readonly width: number;
    /** Nominal font size. */
    readonly fontSize: number;
    /** Smallest allowed font size (readable minimum of the surface: 20 body, 28 for primary buttons). */
    readonly minFontSize: number;
    /** Lines the rect holds (default 1). */
    readonly maxLines?: number;
}

export interface TextFitResult {
    /** The string to assign to the Label (the input when nothing had to be cut). */
    readonly text: string;
    /** Font size the text fits at (nominal unless `shrunk`). */
    readonly fontSize: number;
    readonly lines: number;
    readonly shrunk: boolean;
    readonly truncated: boolean;
}

function isWideGlyph(codePoint: number): boolean {
    return (codePoint >= 0x1100 && codePoint <= 0x115f)
        || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
        || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xff00 && codePoint <= 0xff60)
        || (codePoint >= 0xffe0 && codePoint <= 0xffe6);
}

/** Estimated rendered width of `text` at `fontSize`. */
export function measureTextWidth(text: string, fontSize: number): number {
    let units = 0;
    for (const char of text) units += isWideGlyph(char.codePointAt(0) ?? 0) ? TEXT_WIDE_GLYPH_WIDTH_PER_FONT_UNIT : TEXT_GLYPH_WIDTH_PER_FONT_UNIT;
    return units * fontSize;
}

function breakWord(word: string, fontSize: number, width: number): string[] {
    const pieces: string[] = [];
    let current = '';
    for (const char of word) {
        if (current !== '' && measureTextWidth(current + char, fontSize) > width) {
            pieces.push(current);
            current = char;
        } else {
            current += char;
        }
    }
    if (current !== '') pieces.push(current);
    return pieces;
}

/** Greedy word wrap into lines no wider than `width` (an over-long word is broken by characters). */
export function wrapText(text: string, fontSize: number, width: number): string[] {
    const lines: string[] = [];
    for (const word of text.split(' ')) {
        if (word === '') continue;
        const last = lines.length - 1;
        if (last >= 0 && measureTextWidth(`${lines[last]} ${word}`, fontSize) <= width) {
            lines[last] = `${lines[last]} ${word}`;
        } else if (measureTextWidth(word, fontSize) <= width) {
            lines.push(word);
        } else {
            const pieces = breakWord(word, fontSize, width);
            if (last >= 0 && pieces.length > 0 && lines[last] === '') lines.pop();
            lines.push(...pieces);
        }
    }
    return lines.length > 0 ? lines : [''];
}

/** Longest prefix of `line` that, followed by an ellipsis, fits `width` at `fontSize` (`force`: end with an ellipsis even when the whole line fits, because more text was cut after it). */
export function ellipsizeLine(line: string, fontSize: number, width: number, force: boolean = false): string {
    if (!force && measureTextWidth(line, fontSize) <= width) return line;
    const chars = [...line];
    while (chars.length > 0 && measureTextWidth(chars.join('').trimEnd() + TEXT_ELLIPSIS, fontSize) > width) chars.pop();
    return chars.join('').trimEnd() + TEXT_ELLIPSIS;
}

export function fitText(text: string, options: TextFitOptions): TextFitResult {
    const maxLines = Math.max(1, Math.floor(options.maxLines ?? 1));
    const nominal = Math.max(options.fontSize, options.minFontSize);
    const minimum = Math.min(options.minFontSize, nominal);
    for (let font = nominal; font >= minimum - 1e-9; font -= 1) {
        const size = Math.max(font, minimum);
        const lines = wrapText(text, size, options.width);
        if (lines.length <= maxLines) return Object.freeze({ text, fontSize: size, lines: lines.length, shrunk: size < nominal, truncated: false });
        if (size === minimum) break;
    }
    const lines = wrapText(text, minimum, options.width);
    const kept = lines.slice(0, maxLines - 1);
    const tail = lines.slice(maxLines - 1).join(' ');
    const result = [...kept, ellipsizeLine(tail, minimum, options.width, true)];
    return Object.freeze({ text: result.join(' '), fontSize: minimum, lines: maxLines, shrunk: minimum < nominal, truncated: true });
}

/** The string a Label should show for `text` in a rect (see `fitText`); unchanged when it fits the nominal font. */
export function fitLabelText(text: string, options: TextFitOptions): string {
    return fitText(text, options).text;
}
