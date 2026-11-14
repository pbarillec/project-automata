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
