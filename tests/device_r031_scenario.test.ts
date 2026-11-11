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
const SAFE = { x: 96, y: 0, w: W - 192, h: H };
const BOUNDS = { minX: -9, maxX: -2.5, minZ: -6, maxZ: 0 };
const BASELINE = { yawDeg: 135, pitchDeg: 48, distance: 12.5, focus: { x: -3.8, z: -1.8 } };

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

async function uiLayoutPayload() {
    const L = await imp('assets/scripts/presentation/UiLayout.ts');
    const layout = L.computeUiLayout({ w: W, h: H }, SAFE);
    return { reason: 'session_ready', screen: { w: W, h: H }, safeArea: layout.safeArea, rects: { CoreHUD: layout.hud, ProducerPanel: layout.panel, ...layout.buttons }, rows: {} };
}

/** Simulated FactoryWorld DEBUG build: swipes pan through the real CameraMath; taps run the C3 chain. `unclamped` reports the zone bounds but clamps to the global ones. */
async function simulatedDevice(mode) {
    const { EventStream } = await imp('tools/device/events.ts');
    const { formatDeviceEvent } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    const { adbToCocos } = await imp('tools/device/classification.ts');
    const M = await imp('assets/scripts/camera/CameraMath.ts');
    const payload = await uiLayoutPayload();
    const tuning = { ...M.DEFAULT_CAMERA_TUNING, focusBounds: mode === 'unclamped' ? M.DEFAULT_CAMERA_TUNING.focusBounds : BOUNDS };
    const flags = mode === 'orbit' ? M.DEFAULT_CAMERA_INPUT_FLAGS : { oneFingerMode: 'pan', multiTouchEnabled: false };
    let camera = M.cloneCameraState(BASELINE);
    const log = [];
    let seq = 0;
    let stream = null;
    let selected = null;
    const emit = (evt, body) => stream.pushLine(`11-10 10:00:00.000 1 2 D Cocos   : JS: ${formatDeviceEvent(evt, ++seq, body)}`);
    const toCocos = (x, y) => adbToCocos({ x, y }, { w: W, h: H }, { width: W, height: H });
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
            emit('scene_ready', { reason: 'scene_ready', screen: { w: W, h: H }, targets: 5, selected: null, cameraState: BASELINE, zones: ZONES });
            emit('session_state', { phase: 'ready', status: 'fresh_game', saveOk: null, autoFeederOwned: false, writablePath: `${WRITABLE_PARENT}/files/` });
            emit('reveal_state', { phase: 'synced', source: 'session', automated: false, focusRequested: false });
            emit('ui_layout', payload);
        },
        async swipe(x1, y1, x2, y2, durationMs) {
            log.push(['swipe', x1, y1, x2, y2, durationMs]);
            const a = toCocos(x1, y1);
            const b = toCocos(x2, y2);
            emit('touch_start', { touchId: 0, x: a.x, y: a.y, uiBlocked: false });
            const result = M.applyCameraGestureInput(camera, null, { type: 'orbit', deltaX: b.x - a.x, deltaY: b.y - a.y }, flags, tuning);
            camera = result.state;
            const tap = mode === 'tap_on_swipe';
            emit('touch_end', { touchId: 0, x: b.x, y: b.y, startX: a.x, startY: a.y, moved: Math.hypot(b.x - a.x, b.y - a.y), slop: 12, tap, uiBlocked: false });
            if (tap) {
                emit('selection_raycast', { x: b.x, y: b.y, hit: 'Fabricator', targets: 5 });
                emit('selection_state', { requested: 'Fabricator', prev: null, next: 'Fabricator', changed: true });
            }
            if (mode !== 'no_camera_state') {
                emit('camera_state', { reason: 'gesture_end', yaw: camera.yawDeg, pitch: camera.pitchDeg, distance: camera.distance, focus: camera.focus, bounds: BOUNDS, input: flags, screen: { w: W, h: H }, zones: ZONES });
            }
        },
        async tap(x, y) {
            log.push(['tap', x, y]);
            const p = toCocos(x, y);
            emit('touch_start', { touchId: 0, x: p.x, y: p.y, uiBlocked: false });
            emit('touch_end', { touchId: 0, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: 0, slop: 12, tap: true, uiBlocked: false });
            const hit = ZONES.find((z) => z.onScreen && Math.hypot(z.sx - p.x, z.sy - p.y) < 60)?.id ?? null;
            emit('selection_raycast', { x: p.x, y: p.y, hit, targets: 5 });
            if (!hit) return;
            const prev = selected;
            selected = hit;
            emit('selection_state', { requested: hit, prev, next: hit, changed: prev !== hit });
            emit('marker_state', { id: hit, exists: true, active: true, activeInHierarchy: true, hasMesh: true });
            emit('camera_focus', { phase: 'requested', source: 'selection', id: hit });
            const distance = mode === 'zoom_on_select' ? 9.5 : 12.5;
            emit('camera_focus', { phase: 'started', kind: 'selection', target: { x: -6, y: 0.2, z: -2.85 }, distance, fromDistance: 12.5, defaultDistance: 12.5, seconds: 0.45 });
            emit('camera_focus', { phase: 'settled', focus: { x: -6, z: -2.85 }, distance });
        },
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
    const { runR031Scenario } = await imp('tools/device/scenarios/r031_tap_first_camera.ts');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-r031-'));
    const apk = path.join(root, 'fake.apk');
    fs.writeFileSync(apk, 'not really an apk');
    const driver = await simulatedDevice(mode);
    const output = await runR031Scenario(driver, {
        apkPath: apk, artifactRoot: root, runId: `sim-${mode}`, sleep: async () => {},
        now: () => new Date('2026-11-10T10:00:00Z'),
        timeouts: { sceneReadyMs: 200, sessionMs: 200, uiLayoutMs: 200, revealMs: 200, cameraStateMs: 200, chainMs: 200, swipeSettleMs: 1 },
    });
    return { ...output, driver, root };
}

test('AUT-R-031-02 (simulated): pan swipe → four clamped long swipes → Fabricator tap at the default distance → PASS', async () => {
    const { result, schemaErrors, driver } = await run('pass');
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.status, 'PASS', JSON.stringify({ first: result.first_failed_assertion, actual: result.actual }));
    assert.equal(result.scenario_id, 'R031-tap-first-camera');
    assert.equal(result.task_id, 'AUT-R-031-02');
    const ids = result.assertions.filter((a) => a.ok).map((a) => a.id);
    for (const id of ['saves_cleared', 'session_ready', 'ui_layout_reported', 'baseline_camera_reported', 'swipe_not_classified_tap', 'swipe_no_selection_raycast',
        'camera_state_reported', 'camera_pose_unchanged', 'camera_focus_inside_bounds', 'camera_focus_moved', 'camera_focus_clamped_at_edge',
        'selection_state_next', 'camera_focus_started', 'selection_focus_kind', 'selection_focus_default_distance', 'no_errors_after_scene_ready']) {
        assert.ok(ids.includes(id), id);
    }
    assert.deepEqual(result.steps.map((s) => s.id), ['clear_saves', 'launch', 'pan_swipe', 'long_swipe_left', 'long_swipe_right', 'long_swipe_up', 'long_swipe_down', 'tap_fabricator']);
    const swipes = driver.log.filter((entry) => entry[0] === 'swipe');
    assert.equal(swipes.length, 5);
    for (const step of result.steps.filter((s) => s.id.startsWith('long_swipe_'))) assert.ok(step.edges.length > 0, step.id);
    assert.equal(driver.log.filter((entry) => entry[0] === 'tap').length, 1);
});

test('AUT-R-031-02 (simulated): pm clear refused falls back to run-as rm of the save files', async () => {
    const { result, driver } = await run('pm_clear_refused');
    assert.equal(result.status, 'PASS', JSON.stringify(result.first_failed_assertion));
    assert.equal(result.steps[0].method, 'run-as rm');
    assert.ok(driver.log.some((entry) => entry[0] === 'removeAppFiles' && entry.includes(`${WRITABLE_PARENT}/files/save_main.json`)));
});

for (const [mode, assertion, failureClass] of [
    ['orbit', 'camera_pose_unchanged', 'CAMERA_FOCUS'],
    ['unclamped', 'camera_focus_inside_bounds', 'CAMERA_FOCUS'],
    ['tap_on_swipe', 'swipe_not_classified_tap', 'TAP_CLASSIFICATION'],
    ['no_camera_state', 'camera_state_reported', 'INPUT_NOT_RECEIVED'],
    ['zoom_on_select', 'selection_focus_default_distance', 'CAMERA_FOCUS'],
]) {
    test(`AUT-R-031-02 (simulated): ${mode} → FAIL ${failureClass} at ${assertion}`, async () => {
        const { result, schemaErrors } = await run(mode);
        assert.deepEqual(schemaErrors, []);
        assert.equal(result.status, 'FAIL');
        assert.equal(result.failure_class, failureClass);
        assert.equal(result.first_failed_assertion.id, assertion);
    });
}

test('AUT-R-031-02 scenario helpers: camera_state parsing, bounds checks and swipe picking', async () => {
    const S = await imp('tools/device/scenarios/r031_tap_first_camera.ts');
    const G = await imp('tools/device/ui_geometry.ts');
    const { adbToCocos } = await imp('tools/device/classification.ts');
    assert.equal(S.parseCameraState({ v: 1, seq: 1, evt: 'zones_projected' }), null);
    assert.equal(S.parseCameraState({ v: 1, seq: 1, evt: 'camera_state', yaw: 1, pitch: 2, distance: 3, focus: { x: 0, z: 0 } }), null, 'bounds are required');
    const state = S.parseCameraState({ v: 1, seq: 1, evt: 'camera_state', yaw: 135, pitch: 48, distance: 12.5, focus: { x: -2.5, z: -3 }, bounds: BOUNDS, zones: ZONES });
    assert.ok(state);
    assert.equal(S.focusInsideBounds(state), true);
    assert.deepEqual(S.boundsEdgesTouched(state), ['maxX']);
    assert.equal(S.focusInsideBounds({ ...state, focus: { x: -2.4, z: -3 } }), false);
    assert.deepEqual(S.parseBaselinePose({ v: 1, seq: 1, evt: 'scene_ready', cameraState: BASELINE }), { yaw: 135, pitch: 48, distance: 12.5, focus: { x: -3.8, z: -1.8 } });

    const layout = G.parseUiLayout({ v: 1, seq: 1, evt: 'ui_layout', ...(await uiLayoutPayload()) });
    const toCocos = (adb) => adbToCocos(adb, { w: W, h: H }, { width: W, height: H });
    for (const direction of S.R031_LONG_SWIPE_DIRECTIONS) {
        const length = Math.round((direction === 'left' || direction === 'right' ? W : H) * 0.6);
        const swipe = S.pickSwipe(layout, { width: W, height: H }, toCocos, S.swipeVector(direction, length));
        assert.ok(swipe, direction);
        assert.equal(G.uiRectsAt(layout, toCocos(swipe.from)).length, 0, `${direction} starts clear of the UI`);
        assert.ok(swipe.to.x >= 0 && swipe.to.x <= W && swipe.to.y >= 0 && swipe.to.y <= H, `${direction} ends on screen`);
    }
    const blocked = { ...layout, rects: { ...layout.rects, CoreHUD: { x: 0, y: 0, w: W, h: H } } };
    assert.equal(S.pickSwipe(blocked, { width: W, height: H }, toCocos, { x: 100, y: 0 }), null);
});

test('AUT-R-031-02 CLI exposes the r031 scenario without touching the other scenario entries', async () => {
    const cli = fs.readFileSync(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8');
    assert.match(cli, /import \{ runR031Scenario \} from '\.\/scenarios\/r031_tap_first_camera\.ts';/);
    assert.match(cli, /command === 'c3' \|\| command === 'int001' \|\| command === 'r036' \|\| command === 'ui001' \|\| command === 'r031'/);
    const scenario = fs.readFileSync(path.join(repoRoot, 'tools/device/scenarios/r031_tap_first_camera.ts'), 'utf8');
    assert.doesNotMatch(scenario, /from\s+['"]cc(\/env)?['"]/);
});
