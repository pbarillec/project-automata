const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const HUD = 'assets/scripts/presentation/CoreHudController.ts';
const PANEL = 'assets/scripts/presentation/ProducerPanelController.ts';
const BOOTSTRAP = 'assets/scripts/presentation/FactoryWorldBootstrap.ts';
const CC_IMPORT = /from\s+['"]cc(\/env)?['"]/;

function methodBody(source, signature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} not found`);
    const open = source.indexOf('{', start + signature.length - 1);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`unterminated ${signature}`);
}

const setTextCalls = (source) => source.match(/this\.setText\([^;]*\);/g) ?? [];

test('CoreHudController renders every label through PresentationText', async () => {
    const source = await read(HUD);
    assert.match(source, /import \{ defaultHudTexts, formatHudTexts, type DisplayNameSource \} from '\.\/PresentationText\.ts';/);
    const refresh = methodBody(source, 'public refresh(viewModel: HudViewModel): void {');
    assert.match(refresh, /const texts = formatHudTexts\(viewModel, this\.displayNames\);/);
    for (const call of setTextCalls(source)) assert.match(call, /^this\.setText\('\w+', texts\.\w+\);$/, call);
    assert.match(methodBody(source, 'private ensureLayout(): void {'), /const defaults = defaultHudTexts\(\);/);
    assert.match(source, /public set displayNames\(source: DisplayNameSource \| null\) \{\s*this\.nameSource = source;\s*if \(this\.latest\) this\.refresh\(this\.latest\);\s*\}/);
});

test('ProducerPanelController renders every label through PresentationText', async () => {
    const source = await read(PANEL);
    assert.match(source, /import \{ defaultPanelTexts, formatPanelTexts, pendingSelectionPanelTexts, type DisplayNameSource, type PanelTexts \} from '\.\/PresentationText\.ts';/);
    assert.match(methodBody(source, 'public refresh(viewModel: ProducerPanelViewModel): void {'), /this\.applyTexts\(formatPanelTexts\(viewModel\)\);/);
    assert.match(methodBody(source, 'public replaceSelection(selectedProducerId: string | null): void {'), /this\.applyTexts\(pendingSelectionPanelTexts\(selectedProducerId\)\);/);
    assert.match(methodBody(source, 'private ensureLayout(): void {'), /const defaults = defaultPanelTexts\(\);/);
    assert.match(source, /public displayNames: DisplayNameSource \| null = null;/);
    for (const call of setTextCalls(source)) assert.match(call, /^this\.setText\(('\w+'|`Action_\$\{id\}`), texts\.[\w.]+(\[id\])?\);$/, call);
});

test('controllers no longer pass keys or hard-coded English to labels', async () => {
    for (const rel of [HUD, PANEL]) {
        const source = await read(rel);
        for (const call of setTextCalls(source)) assert.doesNotMatch(call, /semanticKey|displayNameKey|labelKey|descriptorKey|\.state\b|remainingFormatted|Formatted/, `${rel}: ${call}`);
        assert.doesNotMatch(source, /['"`][a-z_]+(\.[a-z0-9_]+)+['"`]/, `${rel} contains a key literal`);
        assert.doesNotMatch(source, /\/s`|`Lv |unavailable|'locked'|'0s'|'—\/s'/, `${rel} contains hard-coded English`);
    }
});

test('layout constants are unchanged (node names, positions, content sizes, font sizes)', async () => {
    const hud = await read(HUD);
    const hudEntries = hud.match(/const entries = \[(.*?)\] as const/);
    assert.deepEqual([...hudEntries[1].matchAll(/\['(\w+)'/g)].map((m) => m[1]), ['IndustrialOutputValue', 'ProductionPerSecondValue', 'NextGoalValue', 'NextGoalContext', 'FreeOverclockValue', 'FreeOverclockTimer']);
    assert.match(hud, /panel\.setPosition\(new Vec3\(0, 120 - index \* 48, 0\)\);/);
    assert.match(hud, /transform\.setContentSize\(600, 54\);/);
    assert.match(hud, /label\.fontSize = key === 'IndustrialOutputValue' \? 42 : 22;/);
    assert.match(hud, /transform\.setContentSize\(640, 310\);/);
    assert.equal((hud.match(/setContentSize\(/g) ?? []).length, 2);
    assert.equal((hud.match(/fontSize/g) ?? []).length, 1);

    const panel = await read(PANEL);
    const panelEntries = panel.match(/const entries = \[(.*?)\] as const/);
    assert.deepEqual([...panelEntries[1].matchAll(/\['(\w+)'/g)].map((m) => m[1]), ['ProducerName', 'ProducerLevel', 'ProducerProduction', 'ProducerMilestone', 'Action_x1', 'Action_x10', 'Action_xMax']);
    assert.match(panel, /node\.setPosition\(new Vec3\(0, 138 - index \* 38, 0\)\);/);
    assert.match(panel, /transform\.setContentSize\(560, 36\);/);
    assert.match(panel, /label\.fontSize = index === 0 \? 28 : 18;/);
    assert.match(panel, /transform\.setContentSize\(600, 330\);/);
    assert.equal((panel.match(/setContentSize\(/g) ?? []).length, 2);
    assert.equal((panel.match(/addComponent\(Button\)/g) ?? []).length, 1);
});

test('FactoryWorldBootstrap assigns displayNames only in activateSessionBinding, from the session config repository', async () => {
    const source = await read(BOOTSTRAP);
    assert.match(source, /this\.pendingBinding = \{ binding, status: result\.startup\.status, displayNames: result\.configRepository \};/);
    const activate = methodBody(source, 'private activateSessionBinding(');
    assert.match(activate, /wiring\.hud\.displayNames = displayNames;\s*wiring\.panel\.displayNames = displayNames;\s*wiring\.hud\.commandEmitter = /);
    assert.equal((source.match(/\.displayNames = /g) ?? []).length, 2);
    assert.doesNotMatch(methodBody(source, 'public start(): void {'), /displayNames/);
    assert.equal((source.match(/commandEmitter =/g) ?? []).length, 2);
});

test('localization/ and PresentationText.ts are engine-free', async () => {
    const files = (await readdir(path.join(repoRoot, 'assets/scripts/localization'))).filter((name) => name.endsWith('.ts'));
    assert.deepEqual(files.sort(), ['EmbeddedTextCatalogue.ts', 'TextCatalogue.ts', 'index.ts']);
    for (const name of files) assert.doesNotMatch(await read(`assets/scripts/localization/${name}`), CC_IMPORT, name);
    assert.doesNotMatch(await read('assets/scripts/presentation/PresentationText.ts'), CC_IMPORT);
});

test('every new AUT-LOC-001 script and folder has a Cocos .meta with a unique uuid', async () => {
    const allUuids = [];
    const collect = async (dir) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await collect(full);
            else if (entry.name.endsWith('.meta')) allUuids.push(JSON.parse(await readFile(full, 'utf8')).uuid);
        }
    };
    await collect(path.join(repoRoot, 'assets/scripts'));
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const folder = JSON.parse(await read('assets/scripts/localization.meta'));
    assert.equal(folder.importer, 'directory');
    assert.equal(folder.ver, '1.2.0');
    assert.match(folder.uuid, uuidPattern);
    assert.equal(allUuids.filter((uuid) => uuid === folder.uuid).length, 1);
    for (const rel of [
        'assets/scripts/localization/TextCatalogue.ts',
        'assets/scripts/localization/EmbeddedTextCatalogue.ts',
        'assets/scripts/localization/index.ts',
        'assets/scripts/presentation/PresentationText.ts',
    ]) {
        const meta = JSON.parse(await read(`${rel}.meta`));
        assert.equal(meta.importer, 'typescript', rel);
        assert.equal(meta.ver, '4.0.24', rel);
        assert.match(meta.uuid, uuidPattern, rel);
        assert.equal(allUuids.filter((uuid) => uuid === meta.uuid).length, 1, `${rel} uuid is not unique`);
    }
});
