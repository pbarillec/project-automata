const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const listTs = (dirRel) => fs.readdirSync(path.join(repoRoot, dirRel)).filter((name) => name.endsWith('.ts')).map((name) => `${dirRel}/${name}`).sort();

/**
 * Explicit allowlist (AUT-052): files whose literals are NOT player-facing product text.
 *  - Spike / smoke scenes: engineering test scenes (AssetRobotSpike, AppStartup "Runtime OK") never ship in the player flow.
 *    (CameraSpikeBootstrap passes its labels as arguments, so it needs no entry; it is an engineering scene as well.)
 *  - DEBUG logs, `[AUT-DEVICE]` events and Error messages are not player-facing and are excluded by the patterns below, not by file.
 */
const STRING_ASSIGNMENT_ALLOWLIST = Object.freeze({
    'assets/scripts/presentation/AssetRobotSpike.ts': 'AUT-032 engineering spike scene status line',
    'assets/scripts/app/AppStartup.ts': 'AUT-004 runtime smoke label ("Runtime OK") on the baseline scene',
});

const SOURCES = [...listTs('assets/scripts/presentation'), ...listTs('assets/scripts/app')];

/** `x.string = '<literal>'` / `` x.string = `<literal>` `` where the literal holds letters (an empty string or a variable is fine). */
const LITERAL_ASSIGNMENT = /\.string\s*=\s*(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`)/g;
const HAS_LETTERS = /[A-Za-z]{2,}/;
const ENGLISH_PHRASE = /[A-Za-z]{3,}[ ][A-Za-z]{2,}/;
const KEY_LIKE = /^[a-z0-9_.${}/-]+$/;

test('no `.string = "<literal with letters>"` in presentation/*.ts or app/*.ts outside the explicit allowlist', () => {
    const offenders = [];
    for (const rel of SOURCES) {
        if (STRING_ASSIGNMENT_ALLOWLIST[rel]) continue;
        const source = strip(read(rel));
        for (const match of source.matchAll(LITERAL_ASSIGNMENT)) {
            const literal = match[1] ?? match[2] ?? match[3] ?? '';
            if (HAS_LETTERS.test(literal.replace(/\$\{[^}]*\}/g, ''))) offenders.push(`${rel}: ${match[0]}`);
        }
    }
    assert.deepEqual(offenders, []);
});

test('the allowlist is explicit, justified and only lists files that exist and still need it', () => {
    for (const [rel, reason] of Object.entries(STRING_ASSIGNMENT_ALLOWLIST)) {
        assert.ok(fs.existsSync(path.join(repoRoot, rel)), rel);
        assert.ok(reason.length > 10, `${rel}: reason`);
        const source = strip(read(rel));
        assert.ok([...source.matchAll(LITERAL_ASSIGNMENT)].some((match) => HAS_LETTERS.test(match[1] ?? match[2] ?? match[3] ?? '')), `${rel}: no longer needs the allowlist entry`);
    }
});

test('*Text.ts composers and *ViewModel.ts hold no English phrase literals (every word comes from the catalogue)', () => {
    const files = SOURCES.filter((rel) => /(Text|ViewModel)\.ts$/.test(rel));
    assert.ok(files.length >= 8, `scanned ${files.length} files`);
    const offenders = [];
    for (const rel of files) {
        const source = strip(read(rel)).replace(/^\s*import[^;]*;/gm, '');
        for (const match of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
            const literal = match[1] ?? match[2] ?? match[3] ?? '';
            const visible = literal.replace(/\$\{[^}]*\}/g, '');
            if (KEY_LIKE.test(literal) || !HAS_LETTERS.test(visible)) continue;
            if (ENGLISH_PHRASE.test(visible) || /^[A-Z][A-Za-z]{3,}$/.test(visible) || /^[A-Z ]{4,}$/.test(visible)) offenders.push(`${rel}: ${match[0]}`);
        }
    }
    assert.deepEqual(offenders, []);
});

test('MILESTONE_TEXT_TEMPLATES no longer exists and the toast wording is catalogue-driven', () => {
    for (const rel of [...SOURCES, 'assets/scripts/localization/index.ts']) assert.equal(read(rel).includes('MILESTONE_TEXT_TEMPLATES'), false, rel);
    const toast = strip(read('assets/scripts/presentation/MilestoneToastText.ts'));
    assert.match(toast, /catalogue\.resolveText\(`toast\.\$\{key\}`, params\)/);
    const toastLiterals = [...toast.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((match) => match[1] ?? match[2]).join(' | ');
    assert.doesNotMatch(toastLiterals, /REBOOT|AI CORE|CIVILIZATION|Breakthrough|Robots built|Robot output/);
    const era = strip(read('assets/scripts/presentation/EraTransition.ts'));
    assert.doesNotMatch(era, /AUTOMATED FACTORY|ROBOTICS COMPLEX/);
    assert.match(era, /titleKey: 'era\.automated_factory\.title_card'/);
    assert.match(era, /titleKey: 'era\.robotics_complex\.title_card'/);
});

test('controllers and the bootstrap render strings only from view models / the catalogue (no player-facing literal next to a Label)', () => {
    const offenders = [];
    for (const rel of SOURCES.filter((name) => /(Controller|Bootstrap)\.ts$/.test(name))) {
        if (STRING_ASSIGNMENT_ALLOWLIST[rel]) continue;
        const source = strip(read(rel));
        // A Label helper called with a literal text argument, e.g. placeLabel(label, rect, 24, color, 'Text').
        for (const match of source.matchAll(/(?:placeLabel|layoutLabel|setText|createLabel)\([^)\n]*'([^'\n]*[A-Za-z]{3,}[^'\n]*)'\s*\)/g)) {
            if (!KEY_LIKE.test(match[1])) offenders.push(`${rel}: ${match[0]}`);
        }
    }
    assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// AUT-070: wider audit (presentation, app, platform/**, services/**, every depth) for literals that reach the player through a text-like
// property or a Label-like sink, with an explicit, justified exception list.
// ---------------------------------------------------------------------------------------------------------------------------------
const listTsDeep = (dirRel) => fs.readdirSync(path.join(repoRoot, dirRel), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) return listTsDeep(rel);
    return entry.name.endsWith('.ts') ? [rel] : [];
}).sort();

const WIDE_SOURCES = ['presentation', 'app', 'platform', 'services'].flatMap((dir) => listTsDeep(`assets/scripts/${dir}`));

/**
 * Documented exceptions of the AUT-070 audit. None of these is product UI copy:
 *  - in-world brand marks painted on 3D surfaces (decals / plates), not translatable UI;
 *  - engineering scenes that never ship in the player flow;
 *  - DEBUG-only command records.
 */
const WIDE_EXCEPTIONS = Object.freeze({
    'assets/scripts/presentation/AutomataIdentity.ts': 'AUTOMATA wordmark text of the brand identity decal (in-world mark, ART_DIRECTION identity; not UI copy)',
    'assets/scripts/presentation/FounderRobotVariant.ts': 'UNIT 0001 serial plate text on the Founder Robot (in-world decal, ART_DIRECTION 16; not UI copy)',
    'assets/scripts/presentation/AssetRobotSpike.ts': 'AUT-032 engineering spike scene',
    'assets/scripts/presentation/CameraSpikeBootstrap.ts': 'AUT-001 camera spike engineering scene (labels are passed as arguments)',
    'assets/scripts/app/AppStartup.ts': 'AUT-004 runtime smoke label on the baseline scene',
    'assets/scripts/presentation/DebugCommandExecutor.ts': 'DEBUG-only command record reasons (never rendered by a Label)',
});

const TEXT_PROPERTY = /\b(?:label|text|title|caption|tag|subtitle|message|hint|description|displayName|note|tooltip|buttonText|toastText)\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`)/g;

test('AUT-070: no text-like property (label/text/title/caption/tag/message/...) holds an English literal in presentation, app, platform or services', () => {
    const offenders = [];
    for (const rel of WIDE_SOURCES) {
        if (WIDE_EXCEPTIONS[rel]) continue;
        const source = strip(read(rel));
        for (const match of source.matchAll(TEXT_PROPERTY)) {
            const literal = match[1] ?? match[2] ?? match[3] ?? '';
            const visible = literal.replace(/\$\{[^}]*\}/g, '');
            if (!HAS_LETTERS.test(visible) || KEY_LIKE.test(literal)) continue;
            offenders.push(`${rel}: ${match[0]}`);
        }
    }
    assert.deepEqual(offenders, []);
});

test('AUT-070: no `.string = <English literal>` / Label helper call with an English literal anywhere under platform/ and services/ either', () => {
    const offenders = [];
    for (const rel of WIDE_SOURCES.filter((name) => /\/(platform|services)\//.test(name))) {
        const source = strip(read(rel));
        for (const match of source.matchAll(LITERAL_ASSIGNMENT)) offenders.push(`${rel}: ${match[0]}`);
        for (const match of source.matchAll(/(?:placeLabel|layoutLabel|setText|createLabel)\([^)\n]*'([^'\n]*[A-Za-z]{3,}[^'\n]*)'\s*\)/g)) offenders.push(`${rel}: ${match[0]}`);
    }
    assert.deepEqual(offenders, []);
});

test('AUT-070: only the documented non-UI marks keep an English literal; every exception file exists and still needs its entry', () => {
    for (const [rel, reason] of Object.entries(WIDE_EXCEPTIONS)) {
        assert.ok(fs.existsSync(path.join(repoRoot, rel)), rel);
        assert.ok(reason.length > 20, `${rel}: reason`);
    }
    for (const rel of ['assets/scripts/presentation/AutomataIdentity.ts', 'assets/scripts/presentation/FounderRobotVariant.ts']) {
        const source = strip(read(rel));
        assert.ok([...source.matchAll(TEXT_PROPERTY)].some((match) => HAS_LETTERS.test(match[1] ?? match[2] ?? match[3] ?? '')), `${rel}: no longer needs the exception`);
    }
});

test('AUT-070: offline service reasons stay out of player text (presentation never renders OfflineService reasons)', () => {
    const offenders = [];
    for (const rel of listTs('assets/scripts/presentation')) {
        if (/\.reason\b/.test(strip(read(rel))) && /\.string\s*=\s*[^;]*\.reason\b/.test(strip(read(rel)))) offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
});
