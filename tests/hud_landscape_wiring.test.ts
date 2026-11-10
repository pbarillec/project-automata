const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const BOOTSTRAP = 'assets/scripts/presentation/FactoryWorldBootstrap.ts';
const HUD = 'assets/scripts/presentation/CoreHudController.ts';
const PANEL = 'assets/scripts/presentation/ProducerPanelController.ts';

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

test('AUT-R-036: a dedicated orthographic UI camera renders UI_2D only, above the WorldCamera, with a depth-only clear', async () => {
    const source = await read(BOOTSTRAP);
    const root = methodBody(source, 'private createUiRoot(site: Node): void {');
    assert.match(root, /const cameraNode = canvas\.getChildByName\('UICamera'\) \?\? new Node\('UICamera'\);\s*cameraNode\.parent = canvas;\s*cameraNode\.layer = Layers\.Enum\.UI_2D;/);
    assert.match(root, /const uiCamera = cameraNode\.getComponent\(Camera\) \?\? cameraNode\.addComponent\(Camera\);/);
    assert.match(root, /uiCamera\.projection = Camera\.ProjectionType\.ORTHO;/);
    // Exactly UI_2D: nothing ORed in.
    assert.match(root, /uiCamera\.visibility = Layers\.Enum\.UI_2D;/);
    assert.equal((root.match(/uiCamera\.visibility\s*=/g) ?? []).length, 1);
    assert.match(root, /uiCamera\.clearFlags = Camera\.ClearFlag\.DEPTH_ONLY;/);
    assert.match(root, /const worldCamera = site\.getChildByName\('CameraRig'\)\?\.getChildByName\('WorldCamera'\)\?\.getComponent\(Camera\) \?\? null;/);
    assert.match(root, /uiCamera\.priority = \(worldCamera\?\.priority \?\? 0\) \+ 1;/);
    assert.match(root, /canvasComponent\.cameraComponent = uiCamera;/);
    assert.match(root, /canvasComponent\.alignCanvasWithScreen = true;/);
    // The WorldCamera mask is unchanged and the UI root is built after the camera rig.
    assert.match(source, /camera\.visibility = \(Layers\.Enum\.ALL & ~Layers\.Enum\.UI_2D\) >>> 0;/);
    const start = methodBody(source, 'public start(): void {');
    assert.ok(start.indexOf('this.createCameraRig(site);') < start.indexOf('this.createUiRoot(site);'));
    assert.ok(start.indexOf('this.createUiRoot(site);') < start.indexOf('this.createCoreHud();'));
});

test('AUT-R-036: the Canvas aligns with the screen (no fixed content size) and a full-screen UiSafeArea hosts the cards', async () => {
    const source = await read(BOOTSTRAP);
    assert.doesNotMatch(source, /setContentSize\(720,\s*1280\)/);
    assert.doesNotMatch(source, /canvasTransform/);
    const root = methodBody(source, 'private createUiRoot(site: Node): void {');
    assert.match(root, /const canvasWidget = canvas\.getComponent\(Widget\) \?\? canvas\.addComponent\(Widget\);\s*this\.stretchWidget\(canvasWidget\);/);
    assert.match(root, /const container = canvas\.getChildByName\('UiSafeArea'\) \?\? new Node\('UiSafeArea'\);/);
    assert.match(root, /container\.layer = Layers\.Enum\.UI_2D;/);
    assert.match(root, /this\.stretchWidget\(container\.getComponent\(Widget\) \?\? container\.addComponent\(Widget\)\);/);
    assert.match(root, /container\.getComponent\(SafeArea\) \?\? container\.addComponent\(SafeArea\);/);
    assert.match(methodBody(source, 'private stretchWidget(widget: Widget): void {'), /widget\.isAlignTop = widget\.isAlignBottom = widget\.isAlignLeft = widget\.isAlignRight = true;\s*widget\.top = widget\.bottom = widget\.left = widget\.right = 0;/);
    for (const name of ['CoreHUD', 'ProducerPanel']) {
        assert.match(source, new RegExp(`container\\.getChildByName\\('${name}'\\) \\?\\? new Node\\('${name}'\\)`));
    }
    assert.match(methodBody(source, 'private createCoreHud(): CoreHudController {'), /hud\.layer = Layers\.Enum\.UI_2D;/);
    assert.match(methodBody(source, 'private createProducerPanel(): ProducerPanelController {'), /panel\.layer = Layers\.Enum\.UI_2D;/);
});

test('AUT-R-036: every UI node the bootstrap and the controllers create is UI_2D', async () => {
    const [bootstrap, hud, panel] = await Promise.all([read(BOOTSTRAP), read(HUD), read(PANEL)]);
    const uiBuilders = ['private createUiRoot(site: Node): void {', 'private createCoreHud(): CoreHudController {', 'private createProducerPanel(): ProducerPanelController {']
        .map((signature) => methodBody(bootstrap, signature));
    const sources = [...uiBuilders.map((body, i) => [`bootstrap#${i}`, body]), ['CoreHudController', hud], ['ProducerPanelController', panel]];
    for (const [name, text] of sources) {
        for (const match of text.matchAll(/const (\w+) = (?:[^;]*\?\? )?new Node\(/g)) {
            assert.match(text, new RegExp(`\\b${match[1]}\\.layer = Layers\\.Enum\\.UI_2D;`), `${name}: ${match[1]} is not UI_2D`);
        }
        assert.doesNotMatch(text, /\.layer\s*=\s*Layers\.Enum\.(?!UI_2D\b)/, `${name} assigns a non-UI_2D layer`);
    }
    // Rows: the controllers set the layer before parenting the row under the card.
    assert.match(hud, /const panel = new Node\(key\);\s*panel\.layer = Layers\.Enum\.UI_2D;\s*panel\.parent = this\.node;/);
    assert.match(panel, /const node = new Node\(key\); node\.layer = Layers\.Enum\.UI_2D; node\.parent = this\.node;/);
});

test('AUT-R-036 invariants: root-only touch swallowing, Buttons on children, no UI blockers populated', async () => {
    const [bootstrap, hud, panel] = await Promise.all([read(BOOTSTRAP), read(HUD), read(PANEL)]);
    for (const [name, text] of [['CoreHudController', hud], ['ProducerPanelController', panel]]) {
        const calls = text.match(/[\w.]+\.on\(Node\.EventType\.TOUCH_[A-Z]+, this\.swallowTouch, this\)/g) ?? [];
        assert.equal(calls.length, 4, name);
        for (const call of calls) assert.match(call, /^this\.node\.on\(/);
        assert.match(text, /private swallowTouch\(event: EventTouch\): void \{ event\.propagationStopped = true; \}/);
    }
    assert.equal((panel.match(/addComponent\(Button\)/g) ?? []).length, 1);
    assert.match(panel, /const button = node\.addComponent\(Button\);/);
    // AUT-UI-001: the HUD's Manual Produce / Next Goal Buttons also live on child nodes, never on the root.
    assert.equal((hud.match(/addComponent\(Button\)/g) ?? []).length, 1);
    assert.match(hud, /const button = node\.addComponent\(Button\);/);
    assert.doesNotMatch(hud, /this\.node\.addComponent\(Button\)/);
    // uiBlockerNodes stay empty: the only mention is the pre-existing pass-through of the camera controller's list.
    assert.deepEqual(bootstrap.match(/.*uiBlockerNodes.*/g).map((line) => line.trim()), ['controller.uiBlockerNodes = controller.cameraController?.uiBlockerNodes ?? [];']);
    assert.doesNotMatch(bootstrap, /uiBlockerNodes\.(push|splice|unshift)|uiBlockerNodes = \[[^\]]/);
    assert.doesNotMatch(bootstrap, /\b(canvas|container|cameraNode)\.on\(/);
});

test('AUT-R-036: the DEBUG ui_layout diagnostic is scheduled after session activation and on canvas resize', async () => {
    const source = await read(BOOTSTRAP);
    const update = methodBody(source, 'public update(deltaTime: number): void {');
    assert.match(update, /^\s*this\.tickUiLayoutDiagnostics\(\);/);
    assert.match(update, /this\.pendingBinding = null;\s*this\.scheduleUiLayoutDiagnostics\('session_ready'\);\s*return;/);
    assert.match(source, /view\.on\('canvas-resize', this\.onUiResize, this\);/);
    assert.match(source, /view\.off\('canvas-resize', this\.onUiResize, this\);/);
    const schedule = methodBody(source, 'private scheduleUiLayoutDiagnostics(reason: string): void {');
    assert.match(schedule, /if \(!isDeviceDiagnosticsEnabled\(\)\) return;/);
    assert.match(schedule, /this\.uiLayoutFrames = 2;/);
    const emit = methodBody(source, 'private emitUiLayout(reason: string): void {');
    assert.match(emit, /uiCamera\.worldToScreen\(new Vec3\(box\.xMin, box\.yMin, 0\), new Vec3\(\)\)/);
    assert.match(emit, /uiCamera\.worldToScreen\(new Vec3\(box\.xMax, box\.yMax, 0\), new Vec3\(\)\)/);
    assert.match(emit, /for \(const key of PANEL_ACTION_KEYS\) rects\[key\] = rectOf\(panel\?\.getChildByName\(key\)\);/);
    // AUT-UI-001: the HUD action Buttons, effective (post-SHRINK) font sizes and HUD action states are reported too.
    assert.match(emit, /for \(const key of HUD_ACTION_KEYS\) rects\[key\] = rectOf\(hud\?\.getChildByName\(key\)\);/);
    assert.match(emit, /label\.actualFontSize/);
    assert.match(emit, /hudActions,/);
    assert.match(emit, /emitDeviceEvent\('ui_layout', \{/);
    assert.doesNotMatch(emit, /setPosition|setContentSize|\.layer =|alignMode|commandEmitter|selectProducer/);
    const { DEVICE_EVENT_TYPES } = await import(require('node:url').pathToFileURL(path.join(repoRoot, 'assets/scripts/presentation/DeviceDiagnostics.ts')).href);
    assert.ok(DEVICE_EVENT_TYPES.includes('ui_layout'));
});

test('AUT-R-036: FactoryWorld.scene keeps no UI nodes (the UI root is runtime-built) and the settings change only the design resolution', async () => {
    const scene = await read('assets/scenes/factory/FactoryWorld.scene');
    for (const token of ['cc.Camera', 'cc.Canvas', 'cc.Widget', 'cc.SafeArea', 'CoreHudCanvas', 'UICamera', 'UiSafeArea']) {
        assert.ok(!scene.includes(token), `FactoryWorld.scene contains ${token}`);
    }
    const settings = JSON.parse(await read('settings/v2/packages/project.json'));
    assert.deepEqual(settings, {
        __version__: '1.0.6',
        general: { designResolution: { width: 1280, height: 720, fitWidth: false, fitHeight: true } },
    });
});

test('AUT-R-036 retry 1: every HUD and panel label shrinks inside its fixed row instead of resizing it (no NONE overflow)', async () => {
    for (const rel of [HUD, PANEL]) {
        const source = await read(rel);
        const labels = [...source.matchAll(/const (\w+) = \w+\.addComponent\(Label\);/g)].map((m) => m[1]);
        assert.ok(labels.length >= 1, `${rel} creates labels`);
        for (const label of labels) {
            assert.match(source, new RegExp(`\\b${label}\\.overflow = Label\\.Overflow\\.SHRINK;`), `${rel}: ${label} is not SHRINK`);
            assert.match(source, new RegExp(`\\b${label}\\.enableWrapText = false;`), `${rel}: ${label} wraps`);
            // Overflow is set before the first string so the row never takes the text's size.
            assert.ok(source.indexOf(`${label}.overflow =`) < source.indexOf(`${label}.string =`), `${rel}: overflow after string`);
        }
        assert.equal((source.match(/addComponent\(Label\)/g) ?? []).length, labels.length, `${rel}: every Label is covered`);
        assert.doesNotMatch(source, /Overflow\.(NONE|CLAMP|RESIZE_HEIGHT)/, `${rel} relies on another overflow mode`);
    }
});

test('AUT-R-036 retry 1: ui_layout is re-emitted (DEBUG, debounced) after the panel refresh a selection change causes, with row rects', async () => {
    const source = await read(BOOTSTRAP);
    const start = methodBody(source, 'public start(): void {');
    assert.ok(start.indexOf('selection.onSelectionChanged = (producerId) => {') < start.indexOf('this.reportUiLayoutAfterSelection(selection);'));
    const wrap = methodBody(source, 'private reportUiLayoutAfterSelection(selection: ProducerSelectionController): void {');
    assert.match(wrap, /if \(!isDeviceDiagnosticsEnabled\(\)\) return;/);
    assert.match(wrap, /const refreshPanel = selection\.onSelectionChanged;\s*selection\.onSelectionChanged = \(producerId\) => \{\s*refreshPanel\?\.\(producerId\);\s*this\.scheduleUiLayoutDiagnostics\('selection_refresh'\);\s*\};/);
    const emit = methodBody(source, 'private emitUiLayout(reason: string): void {');
    assert.match(emit, /rows: \{ CoreHUD: rowsOf\(hud, CORE_HUD_LAYOUT\), ProducerPanel: rowsOf\(panel, PRODUCER_PANEL_LAYOUT\) \}|const rows = \{ CoreHUD: rowsOf\(hud, CORE_HUD_LAYOUT\), ProducerPanel: rowsOf\(panel, PRODUCER_PANEL_LAYOUT\) \};/);
});
