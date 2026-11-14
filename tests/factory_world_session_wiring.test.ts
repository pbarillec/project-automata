const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const CC_IMPORT = /from\s+['"]cc['"]|from\s+['"]cc\/env['"]/;

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

test('FactoryWorldBootstrap starts the persistent session through GameSessionBootstrap and the binding', async () => {
    const source = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(source, /import \{ bootstrapGameSession \} from '\.\.\/lifecycle\/GameSessionBootstrap\.ts';/);
    assert.match(source, /import \{ FileSaveStorage \} from '\.\.\/persistence\/FileSaveStorage\.ts';/);
    assert.match(source, /import \{ CocosFileSystemPort \} from '\.\.\/app\/CocosFileSystemPort';/);
    assert.match(source, /bootstrapGameSession\(\{ storage, timeService: new DefaultTimeService\(\) \}\)/);
    assert.match(source, /new FactoryWorldStateBinding\(/);
    assert.match(source, /syncAutomationState: \(snapshot\) => presentation\.syncAutomationState\(snapshot\)/);
    assert.match(source, /consumeDomainEvents: \(snapshot, events\) => presentation\.consumeDomainEvents\(snapshot, events\)/);
});

test('FactoryWorldBootstrap never builds or mutates game state itself', async () => {
    const source = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.doesNotMatch(source, /GameRuntime|createFreshGameState|executeGameCommand|LifecycleSessionCoordinator\.startup|AtomicSaveRepository|PersistenceCoordinator/);
    assert.doesNotMatch(source, /import[^;]*['"]\.\.\/runtime/);
    assert.doesNotMatch(source, /import[^;]*['"]\.\.\/state/);
});

test('inputs stay inert until the session is ready; then both command emitters route to binding.submit', async () => {
    const source = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const emitters = [...source.matchAll(/(\w+)\.commandEmitter = \(command\) => \{ void binding\.submit\(command\); \};/g)].map((m) => m[1]);
    // AUT-GP-001: the Assembly batch Button is the third emitter.
    assert.deepEqual(emitters, ['hud', 'panel', 'batch']);
    // AUT-050: the AI Upgrades panel is the fourth emitter (it needs the submit result, so it returns the promise instead of `void`).
    assert.equal((source.match(/commandEmitter =/g) || []).length, 5);
    const activate = methodBody(source, 'private activateSessionBinding(');
    assert.match(activate, /wiring\.hud\.commandEmitter = /);
    assert.match(activate, /wiring\.panel\.commandEmitter = /);
    assert.match(activate, /wiring\.batch\.commandEmitter = /);
    assert.match(activate, /wiring\.permanentUpgrades\.commandEmitter = /);
    assert.match(activate, /binding\.init\(\);/);
    const start = methodBody(source, 'public start(): void {');
    assert.doesNotMatch(start, /commandEmitter/);
});

test('selection keeps panel.replaceSelection and also refreshes the binding selection', async () => {
    const source = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(source, /selection\.onSelectionChanged = \(producerId\) => \{\s*panel\.replaceSelection\(producerId\);\s*this\.binding\?\.onSelectionChanged\(producerId\);\s*\};/);
});

test('update ticks the binding and lifecycle hide/show are wired to suspend/resume', async () => {
    const source = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const update = methodBody(source, 'public update(deltaTime: number): void {');
    assert.match(update, /this\.binding\?\.tick\(deltaTime\)/);
    assert.match(source, /game\.on\(Game\.EVENT_HIDE, this\.onGameHide, this\);/);
    assert.match(source, /game\.on\(Game\.EVENT_SHOW, this\.onGameShow, this\);/);
    assert.match(source, /game\.off\(Game\.EVENT_HIDE, this\.onGameHide, this\);/);
    assert.match(source, /game\.off\(Game\.EVENT_SHOW, this\.onGameShow, this\);/);
    assert.match(methodBody(source, 'private onGameHide(): void {'), /binding\.suspend\(\)/);
    assert.match(methodBody(source, 'private onGameShow(): void {'), /binding\.resume\(\)/);
});

test('load_failed keeps FactoryWorld inert and reports a DEBUG session_state diagnostic', async () => {
    const source = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const startSession = methodBody(source, 'private startPersistentSession(');
    assert.match(startSession, /if \(!result\.startup\.ok\) \{\s*this\.emitSessionState\('load_failed', result\.startup\.status, null, false\);\s*return;\s*\}/);
    assert.match(source, /emitDeviceEvent\('session_state', \{ phase, status, saveOk, autoFeederOwned, writablePath: this\.saveRootPath \}\)/);
    assert.match(source, /configureDeviceDiagnostics\(\{ enabled: DEBUG === true \}\)/);
});

test('AUT-R-036: HUD and panel are anchored by Widgets inside the UiSafeArea from UiLayout', async () => {
    const [bootstrap, hud, panel] = await Promise.all([
        read('assets/scripts/presentation/FactoryWorldBootstrap.ts'),
        read('assets/scripts/presentation/CoreHudController.ts'),
        read('assets/scripts/presentation/ProducerPanelController.ts'),
    ]);
    assert.doesNotMatch(bootstrap, /canvasTransform\.setContentSize\(/);
    assert.doesNotMatch(bootstrap, /(hud|panel)\.setPosition\(/);
    const createHud = methodBody(bootstrap, 'private createCoreHud(): CoreHudController {');
    const createPanel = methodBody(bootstrap, 'private createProducerPanel(): ProducerPanelController {');
    assert.match(createHud, /hud\.parent = container;/);
    assert.match(createHud, /this\.anchorCard\(hud, CORE_HUD_LAYOUT\);/);
    assert.match(createPanel, /panel\.parent = container;/);
    assert.match(createPanel, /this\.anchorCard\(panel, PRODUCER_PANEL_LAYOUT\);/);
    const anchor = methodBody(bootstrap, 'private anchorCard(node: Node, card: UiCardSpec): void {');
    assert.match(anchor, /const align = widgetAlignment\(card\.corner\);/);
    assert.match(anchor, /widget\.top = widget\.bottom = widget\.left = widget\.right = UI_EDGE_MARGIN;/);
    // AUT-R-036-02: full-width bands centred horizontally in the safe area.
    assert.match(anchor, /widget\.isAlignHorizontalCenter = align\.horizontalCenter;\s*widget\.horizontalCenter = 0;/);
    assert.match(anchor, /widget\.alignMode = Widget\.AlignMode\.ALWAYS;/);
    assert.match(hud, /transform\.setContentSize\(layout\.width, cardHeight\(layout\)\);/);
    assert.match(panel, /transform\.setContentSize\(layout\.width, cardHeight\(layout\)\);/);
});

test('session core modules are engine-free; only the app port touches cc file APIs', async () => {
    for (const rel of [
        'assets/scripts/presentation/FactoryWorldStateBinding.ts',
        'assets/scripts/lifecycle/GameSessionBootstrap.ts',
        'assets/scripts/persistence/FileSaveStorage.ts',
        'assets/scripts/config/EmbeddedEconomyConfig.ts',
    ]) {
        assert.doesNotMatch(await read(rel), CC_IMPORT, `${rel} imports cc`);
    }
    const port = await read('assets/scripts/app/CocosFileSystemPort.ts');
    assert.match(port, /native\.fileUtils\.getWritablePath\(\)/);
    assert.match(port, /sys\.localStorage/);
    assert.match(port, /sys\.isNative/);
});

test('every new AUT-INT-001 script has a Cocos .ts.meta with a unique uuid', async () => {
    const { readdir } = require('node:fs/promises');
    const files = [
        'assets/scripts/app/CocosFileSystemPort.ts',
        'assets/scripts/config/EmbeddedEconomyConfig.ts',
        'assets/scripts/lifecycle/GameSessionBootstrap.ts',
        'assets/scripts/persistence/FileSaveStorage.ts',
        'assets/scripts/presentation/FactoryWorldStateBinding.ts',
    ];
    const allUuids = [];
    const collect = async (dir) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await collect(full);
            else if (entry.name.endsWith('.meta')) allUuids.push(JSON.parse(await readFile(full, 'utf8')).uuid);
        }
    };
    await collect(path.join(repoRoot, 'assets/scripts'));
    for (const rel of files) {
        const meta = JSON.parse(await read(`${rel}.meta`));
        assert.equal(meta.importer, 'typescript', rel);
        assert.equal(meta.ver, '4.0.24', rel);
        assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, rel);
        assert.equal(allUuids.filter((uuid) => uuid === meta.uuid).length, 1, `${rel} uuid is not unique`);
    }
});
