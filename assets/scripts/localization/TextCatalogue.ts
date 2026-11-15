/**
 * AUT-LOC-001 engine-free text catalogue: key → string with simple `{param}` placeholders.
 * Lookups never throw; a missing parameter leaves its `{param}` in place and every miss is reported to the injectable sink.
 * AUT-070 missing-key policy (what a missing key renders as):
 *   1. the `fallback` catalogue (English for any future language) when it has the key;
 *   2. otherwise, `missingKeyDisplay: 'key'` (the default of a bare catalogue: tests, DEBUG builds) returns the key itself so the gap is visible;
 *      `'blank'` (the release path, see `setShowMissingKeys` in index.ts) returns an empty string: a raw dotted key is never shown to a player.
 */

export type TextParamValue = string | number;
export type TextParams = Readonly<Record<string, TextParamValue>>;

export type MissingTextReport =
    | { readonly kind: 'missing_key'; readonly locale: string; readonly key: string }
    | { readonly kind: 'missing_param'; readonly locale: string; readonly key: string; readonly param: string }
    /** AUT-052: a requested language has no catalogue; English was used instead. */
    | { readonly kind: 'unknown_language'; readonly locale: string; readonly language: string };

export type MissingTextSink = (report: MissingTextReport) => void;

export interface TextCatalogueDocument {
    readonly kind: 'localization';
    readonly schemaVersion: 1;
    readonly locale: string;
    readonly entries: Readonly<Record<string, string>>;
}

export class TextCatalogueFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TextCatalogueFormatError';
    }
}

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Placeholder names used by a template, in order of first appearance (no duplicates). */
export function extractPlaceholders(template: string): string[] {
    const names: string[] = [];
    for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
        if (!names.includes(match[1])) names.push(match[1]);
    }
    return names;
}

/** True when every `{`/`}` in the template belongs to a well-formed `{name}` placeholder. */
export function hasWellFormedPlaceholders(template: string): boolean {
    return !/[{}]/.test(template.replace(PLACEHOLDER_PATTERN, ''));
}

/** Parses and validates a `localization/*.json` document. Throws only for a malformed catalogue. */
export function parseTextCatalogueDocument(text: string): TextCatalogueDocument {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new TextCatalogueFormatError(`Text catalogue is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TextCatalogueFormatError('Text catalogue must be an object.');
    const record = value as Record<string, unknown>;
    if (record.kind !== 'localization') throw new TextCatalogueFormatError('Text catalogue kind must be "localization".');
    if (record.schemaVersion !== 1) throw new TextCatalogueFormatError('Text catalogue schemaVersion must be 1.');
    if (typeof record.locale !== 'string' || record.locale.length === 0) throw new TextCatalogueFormatError('Text catalogue locale must be a non-empty string.');
    const entries = record.entries;
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) throw new TextCatalogueFormatError('Text catalogue entries must be an object.');
    const copy: Record<string, string> = {};
    for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
        if (key.length === 0) throw new TextCatalogueFormatError('Text catalogue keys must be non-empty.');
        if (typeof entry !== 'string' || entry.length === 0) throw new TextCatalogueFormatError(`Text catalogue entry "${key}" must be a non-empty string.`);
        if (!hasWellFormedPlaceholders(entry)) throw new TextCatalogueFormatError(`Text catalogue entry "${key}" has a malformed placeholder.`);
        copy[key] = entry;
    }
    return Object.freeze({ kind: 'localization', schemaVersion: 1, locale: record.locale, entries: Object.freeze(copy) });
}

export type MissingKeyDisplay = 'key' | 'blank';

export class TextCatalogue {
    public readonly locale: string;
    private readonly entries: ReadonlyMap<string, string>;
    private sink: MissingTextSink | null;
    private fallback: TextCatalogue | null;
    private missingKeyDisplay: MissingKeyDisplay = 'key';

    constructor(document: TextCatalogueDocument, sink: MissingTextSink | null = null, fallback: TextCatalogue | null = null) {
        this.locale = document.locale;
        this.entries = new Map(Object.entries(document.entries));
        this.sink = sink;
        this.fallback = fallback;
    }

    /** AUT-070: catalogue to use for keys this one lacks (English for a translation); null for none. */
    public setFallback(fallback: TextCatalogue | null): void {
        this.fallback = fallback === this ? null : fallback;
    }

    /** AUT-070: what a key missing everywhere renders as (see the policy in the file header). */
    public setMissingKeyDisplay(display: MissingKeyDisplay): void {
        this.missingKeyDisplay = display;
    }

    public setMissingTextSink(sink: MissingTextSink | null): void {
        this.sink = sink;
    }

    public has(key: string): boolean {
        return this.entries.has(key);
    }

    public keys(): string[] {
        return Array.from(this.entries.keys());
    }

    /** Template text for a key, without substitution; undefined when the key is absent. */
    public template(key: string): string | undefined {
        return this.entries.get(key);
    }

    /** Resolves a key. Never throws: a missing key follows the AUT-070 policy, a missing param keeps `{param}`. */
    public resolveText(key: string, params?: TextParams): string {
        const template = this.entries.get(key);
        if (template === undefined) {
            this.report({ kind: 'missing_key', locale: this.locale, key });
            if (this.fallback?.has(key)) return this.fallback.resolveText(key, params);
            return this.missingKeyDisplay === 'key' ? key : '';
        }
        return template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) => {
            const value = params !== undefined && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
            if (value === undefined) {
                this.report({ kind: 'missing_param', locale: this.locale, key, param: name });
                return placeholder;
            }
            return String(value);
        });
    }

    private report(report: MissingTextReport): void {
        if (!this.sink) return;
        try {
            this.sink(report);
        } catch {
            // A faulty sink must never break text resolution.
        }
    }
}

export function createTextCatalogue(text: string, sink: MissingTextSink | null = null): TextCatalogue {
    return new TextCatalogue(parseTextCatalogueDocument(text), sink);
}
