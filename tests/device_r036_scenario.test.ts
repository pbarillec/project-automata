const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const W = 2412;
const H = 1080;
const WRITABLE_PARENT = '/data/user/0/com.projectautomata.androidbaseline';

function png(width, height) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
}

// Projection observed on the NE2215 (C3 run, 2412×1080, bottom-left origin).
const ZONES = [
    { id: 'Fabricator', sx: 1450.4, sy: 607.02, onScreen: true },
    { id: 'AssemblyStation', sx: 1061.71, sy: 447.94, onScreen: true },
    { id: 'RobotLine', sx: 412.81, sy: 59.08, onScreen: true },
    { id: 'AutomatedCell', sx: -178.74, sy: 214.45, onScreen: false },
    { id: 'AdvancedRoboticsComplex', sx: 263.2, sy: 656.15, onScreen: true },
];

// NE2215 reports a symmetric 96 px horizontal safe-area inset.
const SAFE = { x: 96, y: 0, w: W - 192, h: H };

/** `ui_layout` payload as FactoryWorldBootstrap emits it; `phase` is 'launch' or 'selection'. */
async function uiLayoutPayload(mode, phase = 'launch') {
    const L = await imp('assets/scripts/presentation/UiLayout.ts');
    const layout = L.computeUiLayout({ w: W, h: H }, SAFE);
    const rects = { CoreHUD: layout.hud, ProducerPanel: layout.panel, ...layout.buttons };
    const rows = { CoreHUD: { ...layout.rows.hud }, ProducerPanel: { ...layout.rows.panel } };
    if (mode === 'overlap') rects.ProducerPanel = { ...rects.CoreHUD, x: rects.CoreHUD.x + 10 };
    if (mode === 'button_outside') rects.Action_xMax = { ...rects.Action_xMax, y: rects.ProducerPanel.y + rects.ProducerPanel.h + 10 };
    if (phase === 'selection') {
        // Text-sized hit boxes (the pre-retry NONE overflow) no longer match the model.
        if (mode === 'button_mismatch') rects.Action_x10 = { ...rects.Action_x10, x: rects.Action_x10.x + 200, w: 40 };
        // Within the ±2 px model tolerance but overlapping its neighbour by 2 px.
        if (mode === 'button_overlap') rects.Action_x10 = { ...rects.Action_x10, y: rects.Action_x10.y + 2 };
        if (mode === 'row_outside') rows.CoreHUD.NextGoalValue = { ...rows.CoreHUD.NextGoalValue, x: rects.CoreHUD.x - 50 };
    }
    return { reason: phase === 'selection' ? 'selection_refresh' : 'session_ready', screen: { w: W, h: H }, safeArea: layout.safeArea, corners: { CoreHUD: 'top-left', ProducerPanel: 'bottom-right' }, rects, rows };
}

/** Simulated FactoryWorld DEBUG build: UI rects swallow touches unless `leak`; world taps run the C3 chain. */
async function simulatedDevice(mode) {
    const { EventStream } = await imp('tools/device/events.ts');
    const { formatDeviceEvent } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    const { adbToCocos } = await imp('tools/device/classification.ts');
    const { pointInRect } = await imp('tools/device/ui_geometry.ts');
    const payload = await uiLayoutPayload(mode);
    const selectionPayload = await uiLayoutPayload(mode, 'selection');
    const zones = mode === 'zone_under_ui'
        ? ZONES.map((z) => (z.id === 'AssemblyStation' ? { ...z, sx: payload.rects.ProducerPanel.x + 20, sy: payload.rects.ProducerPanel.y + 20 } : z))
        : ZONES;
    const log = [];
    let seq = 0;
    let stream = null;
    let selected = null;
    const emit = (evt, body) => stream.pushLine(`11-10 10:00:00.000 1 2 D Cocos   : JS: ${formatDeviceEvent(evt, ++seq, body)}`);
    const uiHit = (p) => ['CoreHUD', 'ProducerPanel'].some((name) => pointInRect(payload.rects[name], p));
    return {
        log,
        async devices() { return [{ serial: 'SIM', state: 'device', model: 'NE2215' }]; },
        useSerial(serial) { log.push(['serial', serial]); },
        async getProp(name) { return name.endsWith('release') ? '15' : '35'; },
        async install() { log.push(['install']); },
        async forceStop() { log.push(['forceStop']); },
        async clearAppData() {
            log.push(['clearAppData']);
            if (mode === 'pm_clear_refused') throw new Error('SecurityException: CLEAR_APP_USER_DATA');
        },
        async appDataDirectory() { return WRITABLE_PARENT; },
        async removeAppFiles(_pkg, paths) { log.push(['removeAppFiles', ...paths]); },
        async listAppFiles() { return []; },
        async writeAppFile() {},
        async pressHome() {},
        async launch() {
            log.push(['launch']);
            emit('scene_ready', { reason: 'bootstrap_loaded', scene: 'FactoryWorld' });
            emit('scene_ready', { reason: 'scene_ready', screen: { w: W, h: H }, targets: 5, selected: null, zones });
            emit('reveal_state', { phase: 'idle', source: 'none', automated: false });
            emit('session_state', { phase: 'ready', status: 'fresh_game', saveOk: null, autoFeederOwned: false, writablePath: `${WRITABLE_PARENT}/files/` });
            emit('reveal_state', { phase: 'synced', source: 'session', automated: false, focusRequested: false });
            if (mode !== 'no_ui_layout') emit('ui_layout', payload);
        },
        async tap(x, y) {
            log.push(['tap', x, y]);
            const p = adbToCocos({ x, y }, { w: W, h: H }, { width: W, height: H });
            if (uiHit(p) && mode !== 'leak') {
                if (mode === 'error_on_ui_tap') emit('error', { source: 'window_error', message: 'TypeError: boom' });
                return;
            }
            emit('touch_start', { touchId: 0, x: p.x, y: p.y, uiBlocked: false });
            emit('touch_end', { touchId: 0, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: 0, slop: 12, tap: true, uiBlocked: false });
            const hit = zones.find((z) => z.onScreen && Math.hypot(z.sx - p.x, z.sy - p.y) < 60)?.id ?? null;
            emit('selection_raycast', { x: p.x, y: p.y, hit, targets: 5 });
            if (!hit) return;
            const prev = selected;
            selected = hit;
            emit('selection_state', { requested: hit, prev, next: hit, changed: prev !== hit });
            if (prev && prev !== hit) emit('marker_state', { id: prev, exists: true, active: false, activeInHierarchy: false, hasMesh: true });
            emit('marker_state', { id: hit, exists: true, active: true, activeInHierarchy: true, hasMesh: true });
            emit('camera_focus', { phase: 'requested', source: 'selection', id: hit });
            emit('camera_focus', { phase: 'started', source: 'selection', id: hit });
            // Two frames after the selection refresh, while the camera is still moving (debounced: once).
            if (mode !== 'no_selection_layout') emit('ui_layout', selectionPayload);
            emit('camera_focus', { phase: 'settled', source: 'selection', id: hit });
            emit('zones_projected', { reason: 'camera_settled', screen: { w: W, h: H }, zones });
        },
        async swipe() {},
        async pidOf() { return 1234; },
        async screencap() { return png(W, H); },
        async logcatClear() {},
        startLogcat(rawPath) { stream = new EventStream(); fs.writeFileSync(rawPath, ''); return stream; },
        async stopLogcat() {},
        async meminfo() { return ''; },
        async gfxinfo() { return ''; },
        commandLog() { return []; },
    };
}

async function run(mode) {
    const { runR036Scenario } = await imp('tools/device/scenarios/r036_ui_layout.ts');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-r036-'));
    const apk = path.join(root, 'fake.apk');
    fs.writeFileSync(apk, 'not really an apk');
    const driver = await simulatedDevice(mode);
    const output = await runR036Scenario(driver, {
        apkPath: apk, artifactRoot: root, runId: `sim-${mode}`, sleep: async () => {},
        now: () => new Date('2026-11-10T10:00:00Z'),
        timeouts: { sceneReadyMs: 200, sessionMs: 200, uiLayoutMs: 200, revealMs: 200, chainMs: 200, projectionMs: 50, uiTapWindowMs: 1 },
    });
    return { ...output, driver, root };
}

test('AUT-R-036 (simulated): launch → ui_layout geometry → calibration → Fabricator → UI taps stay in the UI → PASS', async () => {
    const { result, schemaErrors, driver } = await run('pass');
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.status, 'PASS', JSON.stringify({ first: result.first_failed_assertion, actual: result.actual }));
    assert.equal(result.scenario_id, 'R036-ui-layout');
    assert.equal(result.task_id, 'AUT-R-036');
    const ids = result.assertions.filter((a) => a.ok).map((a) => a.id);
    for (const id of ['saves_cleared', 'session_ready', 'ui_layout_reported', 'ui_rects_present', 'ui_rects_inside_screen', 'ui_rects_inside_safe_area', 'hud_panel_no_overlap', 'ui_coverage_within_budget', 'buttons_inside_panel', 'no_zone_centre_under_ui', 'calibration_position', 'selection_state_next', 'ui_tap_no_selection_raycast', 'ui_tap_no_selection_state', 'ui_tap_no_camera_focus', 'ui_layout_after_selection', 'buttons_match_ui_layout', 'buttons_do_not_overlap', 'rows_inside_card', 'selection_still_fabricator', 'no_errors_after_scene_ready']) {
        assert.ok(ids.includes(id), id);
    }
    assert.deepEqual(result.steps.map((s) => s.id), ['clear_saves', 'ui_layout', 'screenshot', 'calibration', 'tap_fabricator', 'ui_tap_CoreHUD', 'ui_tap_Action_x1', 'ui_tap_Action_x10', 'ui_tap_Action_xMax']);
    // The calibration point avoids the top-left HUD; one Fabricator tap plus four UI taps follow.
    const taps = driver.log.filter((entry) => entry[0] === 'tap');
    assert.equal(taps.length, 6);
    assert.deepEqual(taps[0].slice(1), [1206, 86]);
    assert.ok(result.evidence.screenshots[0].endsWith('01-ui_layout.png'));
    assert.ok(result.steps.find((s) => s.id === 'screenshot').screenshot.endsWith('01-ui_layout.png'));
});

test('AUT-R-036 (simulated): pm clear refused falls back to run-as rm of the save files', async () => {
    const { result, driver } = await run('pm_clear_refused');
    assert.equal(result.status, 'PASS', JSON.stringify(result.first_failed_assertion));
    assert.equal(result.steps[0].method, 'run-as rm');
    assert.ok(driver.log.some((entry) => entry[0] === 'removeAppFiles' && entry.includes(`${WRITABLE_PARENT}/files/save_main.json`)));
});

for (const [mode, assertion, failureClass] of [
    ['leak', 'ui_tap_no_selection_raycast', 'SELECTION_STATE'],
    ['overlap', 'hud_panel_no_overlap', 'MARKER_PRESENTATION'],
    ['button_outside', 'buttons_inside_panel', 'MARKER_PRESENTATION'],
    ['zone_under_ui', 'no_zone_centre_under_ui', 'MARKER_PRESENTATION'],
    ['no_ui_layout', 'ui_layout_reported', 'RUNTIME_ERROR'],
    ['error_on_ui_tap', 'no_runtime_error', 'RUNTIME_ERROR'],
    ['button_mismatch', 'buttons_match_ui_layout', 'MARKER_PRESENTATION'],
    ['button_overlap', 'buttons_do_not_overlap', 'MARKER_PRESENTATION'],
    ['row_outside', 'rows_inside_card', 'MARKER_PRESENTATION'],
    ['no_selection_layout', 'ui_layout_after_selection', 'RUNTIME_ERROR'],
]) {
    test(`AUT-R-036 (simulated): ${mode} → FAIL ${failureClass} at ${assertion}`, async () => {
        const { result, schemaErrors } = await run(mode);
        assert.deepEqual(schemaErrors, []);
        assert.equal(result.status, 'FAIL');
        assert.equal(result.failure_class, failureClass);
        assert.equal(result.first_failed_assertion.id, assertion);
    });
}

test('ui_geometry: parse, containment, overlap, coverage, safe area and UI taps', async () => {
    const G = await imp('tools/device/ui_geometry.ts');
    const payload = await uiLayoutPayload('pass');
    const layout = G.parseUiLayout({ v: 1, seq: 1, evt: 'ui_layout', ...payload });
    assert.ok(layout);
    assert.equal(G.parseUiLayout({ v: 1, seq: 1, evt: 'zones_projected' }), null);
    assert.equal(G.parseUiLayout({ v: 1, seq: 1, evt: 'ui_layout', rects: {} }), null);
    assert.equal(G.evaluateUiGeometry({ step: 'g', layout, zones: ZONES }).ok, true);

    const shifted = { ...layout, rects: { ...layout.rects, CoreHUD: { ...layout.rects.CoreHUD, x: -5 } } };
    assert.equal(G.evaluateUiGeometry({ step: 'g', layout: shifted, zones: [] }).failure.assertion, 'ui_rects_inside_screen');
    const inset = { ...layout, safeArea: { x: 200, y: 0, w: W - 200, h: H } };
    assert.equal(G.evaluateUiGeometry({ step: 'g', layout: inset, zones: [] }).failure.assertion, 'ui_rects_inside_safe_area');
    const noSafe = { ...layout, safeArea: null };
    assert.equal(G.evaluateUiGeometry({ step: 'g', layout: noSafe, zones: [] }).failure.assertion, 'safe_area_reported');
    const big = { ...layout, rects: { ...layout.rects, ProducerPanel: { x: 1000, y: 20, w: 1300, h: 1000 }, Action_x1: { x: 1100, y: 100, w: 10, h: 10 }, Action_x10: { x: 1100, y: 200, w: 10, h: 10 }, Action_xMax: { x: 1100, y: 300, w: 10, h: 10 } } };
    assert.equal(G.evaluateUiGeometry({ step: 'g', layout: big, zones: [] }).failure.assertion, 'ui_coverage_within_budget');
    const missing = { ...layout, rects: { ...layout.rects, Action_x10: null } };
    const missingEval = G.evaluateUiGeometry({ step: 'g', layout: missing, zones: [] });
    assert.equal(missingEval.failure.assertion, 'ui_rects_present');
    assert.equal(missingEval.failure.failureClass, 'MARKER_PRESENTATION');
    // Off-screen zone centres never count as occluded.
    const hud = layout.rects.CoreHUD;
    assert.equal(G.evaluateUiGeometry({ step: 'g', layout, zones: [{ id: 'X', sx: hud.x + 5, sy: hud.y + 5, onScreen: false }] }).ok, true);
    assert.deepEqual(G.uiRectsAt(layout, G.rectCentre(layout.rects.Action_x10)), ['ProducerPanel', 'Action_x10']);

    const clean = G.evaluateUiTap({ step: 't', target: 'CoreHUD', selectionBefore: 'Fabricator', events: [], runtimeErrorLines: [], appAlive: true });
    assert.equal(clean.ok, true);
    const focus = G.evaluateUiTap({ step: 't', target: 'Action_x1', selectionBefore: 'Fabricator', events: [{ v: 1, seq: 1, evt: 'camera_focus', phase: 'requested' }], runtimeErrorLines: [], appAlive: true });
    assert.equal(focus.failure.assertion, 'ui_tap_no_camera_focus');
    assert.equal(focus.failure.failureClass, 'SELECTION_STATE');
    const dead = G.evaluateUiTap({ step: 't', target: 'Action_x1', selectionBefore: 'Fabricator', events: [], runtimeErrorLines: [], appAlive: false });
    assert.equal(dead.failure.failureClass, 'RUNTIME_ERROR');

    const { adbToCocos } = await imp('tools/device/classification.ts');
    const toCocos = (adb) => adbToCocos(adb, { w: W, h: H }, { width: W, height: H });
    assert.deepEqual(G.pickCalibrationPoint(layout, { width: W, height: H }, toCocos).adb, { x: 1206, y: 86 });
    const blocked = { ...layout, rects: { ...layout.rects, CoreHUD: { x: 0, y: 0, w: W, h: H } } };
    assert.equal(G.pickCalibrationPoint(blocked, { width: W, height: H }, toCocos), null);
});

test('AUT-R-036 CLI exposes the r036 scenario; the C3 and INT-001 scenarios are untouched by it', async () => {
    const cli = fs.readFileSync(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8');
    assert.match(cli, /import \{ runR036Scenario \} from '\.\/scenarios\/r036_ui_layout\.ts';/);
    assert.match(cli, /command === 'c3' \|\| command === 'int001' \|\| command === 'r036'/);
    const scenario = fs.readFileSync(path.join(repoRoot, 'tools/device/scenarios/r036_ui_layout.ts'), 'utf8');
    assert.doesNotMatch(scenario, /from\s+['"]cc(\/env)?['"]/);
});
