const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * AUT-070 localization key integrity: every key the code (or the economy data) references exists in localization/en.json, nothing in
 * en.json is dead beyond a documented allow-list, call sites supply every placeholder, plural paths pick the right key and the
 * missing-key fallback never crashes and never shows a raw key on the release path.
 */
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const readLf = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const english = JSON.parse(readLf('localization/en.json')).entries;
const KEYS = Object.keys(english);
const NAMESPACES = new Set(KEYS.map((key) => key.split('.')[0]));

function walk(dirRel, extension, out = []) {
    for (const entry of fs.readdirSync(path.join(repoRoot, dirRel), { withFileTypes: true })) {
        const rel = `${dirRel}/${entry.name}`;
        if (entry.isDirectory()) walk(rel, extension, out);
        else if (entry.name.endsWith(extension)) out.push(rel);
    }
    return out;
}

/** Dotted literals that look like a key of a known namespace but are NOT catalogue keys (documented). */
const NOT_A_KEY = Object.freeze({
    'settings.json': 'the user settings file name (SettingsStore)',
    'hud.free_overclock': 'HudViewModel.labelKey: the PREFIX of the hud.free_overclock.<state> keys (PresentationText appends the state)',
});

/** en.json keys with no literal reference: they are resolved through a computed key (documented, pinned below). */
const COMPUTED_KEY_ALLOWLIST = Object.freeze({
    'next_goal.producer_build.generic': 'PresentationText: `${semanticKey}.generic` when the display-name lookup fails',
    'next_goal.producer_milestone.generic': 'PresentationText: `${semanticKey}.generic` when the display-name lookup fails',
    'next_goal.breakthrough.generic': 'PresentationText: `${semanticKey}.generic` when the display-name lookup fails',
    'next_goal.era.generic': 'PresentationText: `${semanticKey}.generic` when the display-name lookup fails',
});

function referencedLiterals() {
    const literals = new Map(); // literal -> first file
    const add = (literal, file) => { if (!literals.has(literal)) literals.set(literal, file); };
    for (const rel of walk('assets/scripts', '.ts')) {
        if (rel.endsWith('EmbeddedTextCatalogue.ts')) continue;
        const source = readLf(rel);
        for (const match of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
            const literal = match[1] ?? match[2] ?? match[3] ?? '';
            if (literal.includes('.') && /^[a-z0-9_.${}]+$/.test(literal) && NAMESPACES.has(literal.split('.')[0])) add(literal, rel);
        }
    }
    for (const rel of walk('data', '.json')) {
        for (const match of readLf(rel).matchAll(/"([a-z0-9_.]+)"/g)) {
            if (match[1].includes('.') && NAMESPACES.has(match[1].split('.')[0])) add(match[1], rel);
        }
    }
    return literals;
}

function classify() {
    const exact = new Map();
    const patterns = [];
    for (const [literal, file] of referencedLiterals()) {
        if (NOT_A_KEY[literal]) continue;
        if (literal.includes('${')) patterns.push({ literal, file, regex: new RegExp(`^${literal.replace(/\./g, '\\.').replace(/\$\{[^}]*\}/g, '[a-z0-9_.]+')}$`) });
        else exact.set(literal, file);
    }
    return { exact, patterns };
}

test('every key referenced by the code or the economy data exists in en.json', () => {
    const { exact, patterns } = classify();
    assert.ok(exact.size > 100, `scanned ${exact.size} literal keys`);
    const missing = [...exact].filter(([key]) => !(key in english)).map(([key, file]) => `${key} (${file})`);
    assert.deepEqual(missing, []);
    // A computed key must match at least one real entry (otherwise the whole family is missing).
    for (const pattern of patterns) assert.ok(KEYS.some((key) => pattern.regex.test(key)), `computed key ${pattern.literal} (${pattern.file}) matches no en.json entry`);
});

test('no en.json entry is dead beyond the documented computed-key allow-list', () => {
    const { exact, patterns } = classify();
    const dead = KEYS.filter((key) => !exact.has(key) && !patterns.some((pattern) => pattern.regex.test(key)));
    assert.deepEqual(dead.sort(), Object.keys(COMPUTED_KEY_ALLOWLIST).sort());
    assert.match(readLf('assets/scripts/presentation/PresentationText.ts'), /`\$\{semanticKey\}\.generic`/);
    for (const [key, reason] of Object.entries(COMPUTED_KEY_ALLOWLIST)) assert.ok(key in english && reason.length > 10, key);
    for (const [literal, reason] of Object.entries(NOT_A_KEY)) assert.ok(reason.length > 10 && literal.length > 0);
});

/** Top-level property names of an object literal body that starts right after `{` at `from`. */
function topLevelNames(source, from) {
    let depth = 1;
    let nested = 0;
    let top = '';
    for (let index = from; index < source.length && depth > 0; index += 1) {
        const ch = source[index];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        else if (ch === '(' || ch === '[') nested += 1;
        else if (ch === ')' || ch === ']') nested -= 1;
        if (depth === 1 && nested === 0 && !(ch === '}' && depth === 0)) top += ch;
    }
    const names = [];
    for (const part of top.split(',')) {
        const name = part.trim().split(/[:\s]/)[0];
        const spread = /^\.\.\.([A-Za-z]\w*)$/.exec(name);
        if (spread) {
            // `...params`: the names come from `const params = { ... }` in the same file.
            const declaration = new RegExp(`const ${spread[1]} = \\{`).exec(source);
            if (declaration) names.push(...topLevelNames(source, declaration.index + declaration[0].length));
        } else if (/^[A-Za-z]\w*$/.test(name)) {
            names.push(name);
        }
    }
    return names;
}

test('call sites with a literal key and a literal params object supply exactly the placeholders of that key', async () => {
    const { extractPlaceholders } = await imp('assets/scripts/localization/TextCatalogue.ts');
    let checked = 0;
    const offenders = [];
    const call = /(?:resolveText|fill)\(\s*(?:catalogue\s*,\s*)?'([a-z0-9_.]+)'(\s*,\s*\{)?/g;
    for (const rel of walk('assets/scripts/presentation', '.ts')) {
        const source = readLf(rel);
        for (const match of source.matchAll(call)) {
            const key = match[1];
            const template = english[key] ?? english[`toast.${key}`];
            if (template === undefined) continue;
            const expected = extractPlaceholders(template).sort();
            const after = match.index + match[0].length;
            checked += 1;
            if (match[2]) {
                const supplied = [...new Set(topLevelNames(source, after))].sort();
                if (JSON.stringify(supplied) !== JSON.stringify(expected)) offenders.push(`${rel}: ${key} supplies [${supplied}] expects [${expected}]`);
            } else if (expected.length > 0 && !/^\s*,\s*[a-zA-Z(]/.test(source.slice(after, after + 40))) {
                offenders.push(`${rel}: ${key} has no params but expects [${expected}]`);
            }
        }
    }
    assert.ok(checked >= 60, `checked ${checked} call sites`);
    assert.deepEqual(offenders, []);
});

test('plural / number paths: singular keys at count 1, plural keys otherwise, compact numbers stay short', async () => {
    const [localization, config, embedded, state, offlineText, offlineVm, rebootVm, formatter] = await Promise.all([
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('assets/scripts/presentation/OfflineReportText.ts'),
        imp('assets/scripts/presentation/OfflineReportViewModel.ts'),
        imp('assets/scripts/presentation/RebootPanelViewModel.ts'),
        imp('assets/scripts/presentation/NumberFormatter.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    const catalogue = localization.getDefaultTextCatalogue();
    const offline = (robotsDelta) => offlineText.formatOfflineReportTexts({ ...offlineVm.HIDDEN_OFFLINE_REPORT_VIEW_MODEL, visible: true, effectiveSeconds: 600, reward: 1500, robotsDelta, showRobotsRow: true }, repository, catalogue).robots;
    assert.equal(offline(1), catalogue.resolveText('offline.robot_single'));
    assert.equal(offline(2), '+2 Robots Built');
    const peakFor = (multiplier) => {
        const s = state.createFreshGameState();
        s.run.prestigePowerPeak = repository.getPrestigeConfig().p0PrestigePower * multiplier;
        return s;
    };
    assert.equal(rebootVm.createRebootPanelViewModel(repository, peakFor(0.05), catalogue).texts.reward, catalogue.resolveText('reboot.reward_single'));
    const many = rebootVm.createRebootPanelViewModel(repository, peakFor(1), catalogue);
    assert.ok(many.aiCoresToGain > 1);
    assert.equal(many.texts.reward, `+${many.aiCoresToGain} AI CORES`);
    // Compact number formatting stays short for the widest values the labels are sized for.
    for (const value of [0, 1, 999, 1000, 12_345, 1.5e6, 999.5e12]) assert.ok(formatter.formatCompactNumber(value).length <= 6, String(value));
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) assert.doesNotMatch(formatter.formatCompactNumber(value), /NaN|Infinity|undefined/, String(value));
});

const emptyDocument = (locale) => JSON.stringify({ kind: 'localization', schemaVersion: 1, locale, entries: {} });

test('missing-key policy: a bare catalogue shows the key, blank mode shows nothing, a fallback catalogue shows its text; none ever throws', async () => {
    const { createTextCatalogue } = await imp('assets/scripts/localization/TextCatalogue.ts');
    const reports = [];
    const bare = createTextCatalogue(emptyDocument('xx'), (report) => reports.push(report));
    assert.equal(bare.resolveText('settings.title'), 'settings.title', 'default / DEBUG: the key is visible');
    bare.setMissingKeyDisplay('blank');
    assert.equal(bare.resolveText('settings.title'), '', 'release: never a raw key');
    const base = createTextCatalogue(JSON.stringify({ kind: 'localization', schemaVersion: 1, locale: 'en', entries: { 'a.b': 'Hello {name}' } }));
    bare.setFallback(base);
    assert.equal(bare.resolveText('a.b', { name: 'Ada' }), 'Hello Ada', 'the fallback language fills the gap');
    assert.deepEqual(reports.map((report) => report.kind), ['missing_key', 'missing_key', 'missing_key'], 'every miss is still reported');
    bare.setFallback(bare);
    assert.equal(bare.resolveText('a.b'), '', 'a self-fallback is ignored');
    assert.doesNotThrow(() => bare.resolveText(''));
    assert.doesNotThrow(() => bare.resolveText('x', { y: Number.NaN }));
});

test('release path: the shared catalogues render no raw key; DEBUG opts in; unknown languages fall back to English', async () => {
    const localization = await imp('assets/scripts/localization/index.ts');
    try {
        localization.setShowMissingKeys(false);
        const shared = localization.getDefaultTextCatalogue();
        assert.equal(shared.resolveText('does.not_exist'), '', 'blank, not the key');
        assert.equal(shared.resolveText('settings.title'), 'Settings');
        localization.setShowMissingKeys(true);
        assert.equal(shared.resolveText('does.not_exist'), 'does.not_exist', 'DEBUG shows the key');
        const unknown = localization.getTextCatalogue('zz');
        assert.equal(unknown.resolveText('settings.title'), 'Settings', 'English, never the key');
    } finally {
        localization.setShowMissingKeys(false);
    }
});

test('release path: every composer survives a catalogue with NO entries (blank mode) and shows no raw key or placeholder', async () => {
    const [localization, text, hud, panel, config, embedded, state, toast, settingsVm, userSettings, offlineText, offlineVm, upgrades] = await Promise.all([
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/presentation/PresentationText.ts'),
        imp('assets/scripts/presentation/HudViewModel.ts'),
        imp('assets/scripts/presentation/ProducerPanelViewModel.ts'),
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('assets/scripts/presentation/MilestoneToastText.ts'),
        imp('assets/scripts/presentation/SettingsViewModel.ts'),
        imp('assets/scripts/settings/UserSettings.ts'),
        imp('assets/scripts/presentation/OfflineReportText.ts'),
        imp('assets/scripts/presentation/OfflineReportViewModel.ts'),
        imp('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    const empty = localization.createTextCatalogue(emptyDocument('empty'));
    empty.setMissingKeyDisplay('blank');
    const rendered = [];
    const addAll = (value) => {
        if (typeof value === 'string') rendered.push(value);
        else if (Array.isArray(value)) value.forEach(addAll);
        else if (value && typeof value === 'object') Object.values(value).forEach(addAll);
    };
    const fresh = state.createFreshGameState();
    addAll(text.formatHudTexts(hud.createHudViewModel(repository, fresh), repository, empty));
    for (const producer of repository.listProducers()) addAll(text.formatPanelTexts(panel.createProducerPanelViewModel(repository, fresh, producer.id), empty));
    addAll(text.defaultHudTexts(empty));
    addAll(text.defaultPanelTexts(empty));
    addAll(toast.formatMilestoneToast({ key: 'k', tier: 'major', kind: 'breakthrough', accent: 'amber', producerId: 'fabricator', breakthroughId: 'auto_feeder', milestoneId: null, threshold: 25, focusProducerId: null, sparks: false, pulse: false, eraId: null, focusSuppressed: false }, repository, 0, empty));
    addAll(settingsVm.createSettingsViewModel(userSettings.DEFAULT_USER_SETTINGS, empty));
    addAll(offlineText.formatOfflineReportTexts({ ...offlineVm.HIDDEN_OFFLINE_REPORT_VIEW_MODEL, visible: true, effectiveSeconds: 600, reward: 1500 }, repository, empty));
    const meta = state.createFreshGameState();
    meta.meta.civilizationNumber = 2;
    meta.meta.aiCores = 3;
    const model = upgrades.createPermanentUpgradePanelViewModel(repository, meta, empty);
    addAll([model.texts, model.rows.map((row) => [row.name, row.rankText, row.effectText, row.buyText])]);
    assert.ok(rendered.length > 30);
    for (const value of rendered) assert.doesNotMatch(value, /\b[a-z_]+(\.[a-z0-9_]+)+\b/, `raw key in "${value}"`);
});
