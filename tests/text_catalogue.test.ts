const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const catalogueModule = () => imp('assets/scripts/localization/TextCatalogue.ts');
const doc = (entries) => JSON.stringify({ kind: 'localization', schemaVersion: 1, locale: 'en', entries });

test('resolveText substitutes {param} placeholders', async () => {
    const { createTextCatalogue } = await catalogueModule();
    const catalogue = createTextCatalogue(doc({ greeting: 'Build {name} Lv {level}', plain: 'Ready' }));
    assert.equal(catalogue.resolveText('greeting', { name: 'Fabricator', level: 10 }), 'Build Fabricator Lv 10');
    assert.equal(catalogue.resolveText('plain'), 'Ready');
    assert.equal(catalogue.locale, 'en');
});

test('a missing key returns the key, never throws, and is reported to the sink', async () => {
    const { createTextCatalogue } = await catalogueModule();
    const reports = [];
    const catalogue = createTextCatalogue(doc({ a: 'A' }), (report) => reports.push(report));
    assert.equal(catalogue.resolveText('does.not_exist'), 'does.not_exist');
    assert.deepEqual(reports, [{ kind: 'missing_key', locale: 'en', key: 'does.not_exist' }]);
});

test('a missing param keeps its placeholder and is reported; a throwing sink is contained', async () => {
    const { createTextCatalogue } = await catalogueModule();
    const reports = [];
    const catalogue = createTextCatalogue(doc({ t: '{label} {cost}' }), (report) => reports.push(report));
    assert.equal(catalogue.resolveText('t', { label: 'Buy ×1' }), 'Buy ×1 {cost}');
    assert.deepEqual(reports, [{ kind: 'missing_param', locale: 'en', key: 't', param: 'cost' }]);
    const throwing = createTextCatalogue(doc({}), () => { throw new Error('sink failure'); });
    assert.equal(throwing.resolveText('x.y'), 'x.y');
});

test('the sink can be injected after construction and cleared', async () => {
    const { createTextCatalogue } = await catalogueModule();
    const reports = [];
    const catalogue = createTextCatalogue(doc({}));
    assert.equal(catalogue.resolveText('a.b'), 'a.b');
    catalogue.setMissingTextSink((report) => reports.push(report));
    catalogue.resolveText('c.d');
    catalogue.setMissingTextSink(null);
    catalogue.resolveText('e.f');
    assert.deepEqual(reports.map((report) => report.key), ['c.d']);
});

test('parse rejects malformed catalogues', async () => {
    const { parseTextCatalogueDocument, TextCatalogueFormatError } = await catalogueModule();
    for (const bad of [
        'not json',
        JSON.stringify([]),
        JSON.stringify({ kind: 'producers', schemaVersion: 1, locale: 'en', entries: {} }),
        JSON.stringify({ kind: 'localization', schemaVersion: 2, locale: 'en', entries: {} }),
        JSON.stringify({ kind: 'localization', schemaVersion: 1, locale: '', entries: {} }),
        JSON.stringify({ kind: 'localization', schemaVersion: 1, locale: 'en', entries: [] }),
        doc({ empty: '' }),
        doc({ number: 3 }),
        doc({ broken: 'Build {name' }),
        doc({ broken: 'Build {1x}' }),
    ]) {
        assert.throws(() => parseTextCatalogueDocument(bad), TextCatalogueFormatError, bad);
    }
});

test('placeholder helpers', async () => {
    const { extractPlaceholders, hasWellFormedPlaceholders } = await catalogueModule();
    assert.deepEqual(extractPlaceholders('{label} {cost} • {label}'), ['label', 'cost']);
    assert.deepEqual(extractPlaceholders('Ready'), []);
    assert.equal(hasWellFormedPlaceholders('{a} and {b_c}'), true);
    assert.equal(hasWellFormedPlaceholders('{a} and }'), false);
    assert.equal(hasWellFormedPlaceholders('{}'), false);
});

test('localization/en.json structure: unique non-empty keys, non-empty values, well-formed placeholders', async () => {
    const text = await readFile(path.join(repoRoot, 'localization/en.json'), 'utf8');
    const { parseTextCatalogueDocument, hasWellFormedPlaceholders } = await catalogueModule();
    const parsed = parseTextCatalogueDocument(text);
    assert.equal(parsed.locale, 'en');
    // JSON.parse silently keeps the last duplicate: count raw key occurrences instead.
    const rawKeys = [...text.matchAll(/^\s{4}"([^"]+)":/gm)].map((match) => match[1]);
    assert.equal(rawKeys.length, Object.keys(parsed.entries).length);
    assert.equal(new Set(rawKeys).size, rawKeys.length, 'duplicate catalogue keys');
    for (const [key, value] of Object.entries(parsed.entries)) {
        assert.match(key, /^[a-z_]+(\.[a-z0-9_]+)+$/, key);
        assert.ok(value.trim().length > 0, key);
        assert.ok(hasWellFormedPlaceholders(value), key);
        assert.doesNotMatch(value, /\b[a-z_]+(\.[a-z0-9_]+)+\b/, `${key} value looks like a key`);
    }
});

test('TextCatalogue.ts and localization/index.ts are engine-free', async () => {
    for (const rel of ['assets/scripts/localization/TextCatalogue.ts', 'assets/scripts/localization/index.ts']) {
        assert.doesNotMatch(await readFile(path.join(repoRoot, rel), 'utf8'), /from\s+['"]cc(\/env)?['"]/, rel);
    }
});
