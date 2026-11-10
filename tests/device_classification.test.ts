const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(repoRoot, 'tools/device/classification.ts')).href);

const TOUCH = { x: 1386, y: 636 };
let seq = 0;
const ev = (evt, payload = {}) => ({ v: 1, seq: ++seq, evt, ...payload });

/** A complete, correct chain for tapping `zone` with `prev` selected. */
function goodChain(zone = 'AssemblyStation', prev = 'Fabricator') {
    return [
        ev('touch_start', { x: TOUCH.x, y: TOUCH.y, uiBlocked: false }),
        ev('touch_end', { x: TOUCH.x, y: TOUCH.y, moved: 0, slop: 38.16, tap: true, uiBlocked: false }),
        ev('selection_raycast', { hit: zone, targets: 5, zones: [{ id: zone, inside: true }] }),
        ev('selection_state', { requested: zone, prev, next: zone, changed: prev !== zone }),
        ...(prev && prev !== zone ? [ev('marker_state', { id: prev, exists: true, active: false, activeInHierarchy: false, hasMesh: true })] : []),
        ev('marker_state', { id: zone, exists: true, active: true, activeInHierarchy: true, hasMesh: true }),
        ev('camera_focus', { phase: 'requested', source: 'selection', id: zone }),
        ev('camera_focus', { phase: 'started' }),
        ev('camera_focus', { phase: 'settled' }),
        ev('zones_projected', { reason: 'camera_settled' }),
    ];
}

function tapInput(events, overrides = {}) {
    return { step: 'tap_2_AssemblyStation', zoneId: 'AssemblyStation', previousSelection: 'Fabricator', expectedTouch: TOUCH, touchTolerancePx: 3, events, runtimeErrorLines: [], appAlive: true, ...overrides };
}

const mutate = (events, evt, patch, where = () => true) => events.map((e) => (e.evt === evt && where(e) ? { ...e, ...patch } : e));
const drop = (events, evt, where = () => true) => events.filter((e) => !(e.evt === evt && where(e)));

test('AUT-INFRA-001: complete chain passes', async () => {
    const { evaluateTapStep } = await load();
    const r = evaluateTapStep(tapInput(goodChain()));
    assert.equal(r.ok, true, JSON.stringify(r.failure));
    assert.ok(r.assertions.length >= 12);
    assert.ok(r.assertions.every((a) => a.ok));
});

test('AUT-INFRA-001: first failed assertion decides each functional class', async () => {
    const { evaluateTapStep } = await load();
    const cases = [
        ['INPUT_NOT_RECEIVED', 'touch_end_received', []],
        ['INPUT_NOT_RECEIVED', 'touch_end_received', drop(goodChain(), 'touch_end')],
        ['TAP_CLASSIFICATION', 'touch_classified_tap', mutate(goodChain(), 'touch_end', { tap: false, moved: 40 })],
        ['TAP_CLASSIFICATION', 'touch_not_ui_blocked', mutate(goodChain(), 'touch_end', { uiBlocked: true })],
        ['RAYCAST_MISS', 'selection_raycast_emitted', drop(goodChain(), 'selection_raycast')],
        ['RAYCAST_MISS', 'raycast_hit_zone', mutate(goodChain(), 'selection_raycast', { hit: null })],
        ['RAYCAST_MISS', 'raycast_hit_zone', mutate(goodChain(), 'selection_raycast', { hit: 'RobotLine' })],
        ['SELECTION_STATE', 'selection_state_emitted', drop(goodChain(), 'selection_state')],
        ['SELECTION_STATE', 'selection_state_next', mutate(goodChain(), 'selection_state', { next: 'Fabricator', changed: false })],
        ['MARKER_PRESENTATION', 'marker_state_emitted', drop(goodChain(), 'marker_state', (e) => e.id === 'AssemblyStation')],
        ['MARKER_PRESENTATION', 'marker_active', mutate(goodChain(), 'marker_state', { activeInHierarchy: false }, (e) => e.id === 'AssemblyStation')],
        ['MARKER_PRESENTATION', 'marker_active', mutate(goodChain(), 'marker_state', { hasMesh: false }, (e) => e.id === 'AssemblyStation')],
        ['MARKER_PRESENTATION', 'previous_marker_cleared', mutate(goodChain(), 'marker_state', { active: true }, (e) => e.id === 'Fabricator')],
        ['CAMERA_FOCUS', 'camera_focus_requested', drop(goodChain(), 'camera_focus', (e) => e.phase === 'requested')],
        ['CAMERA_FOCUS', 'camera_focus_requested', mutate(goodChain(), 'camera_focus', { phase: 'skipped', reason: 'no_focus_anchor' }, (e) => e.phase === 'requested')],
        ['CAMERA_FOCUS', 'camera_focus_started', drop(goodChain(), 'camera_focus', (e) => e.phase === 'started')],
        ['CAMERA_FOCUS', 'camera_focus_settled', mutate(goodChain(), 'camera_focus', { phase: 'cancelled' }, (e) => e.phase === 'settled')],
    ];
    for (const [expectedClass, assertion, events] of cases) {
        const r = evaluateTapStep(tapInput(events));
        assert.equal(r.ok, false, assertion);
        assert.equal(r.failure.failureClass, expectedClass, `${assertion}: ${JSON.stringify(r.failure)}`);
        assert.equal(r.failure.assertion, assertion);
        assert.equal(r.assertions.at(-1).ok, false);
        assert.equal(r.assertions.filter((a) => !a.ok).length, 1, 'evaluation stops at the first failure');
    }
});

test('AUT-INFRA-001: earlier failure wins when several links are broken', async () => {
    const { evaluateTapStep } = await load();
    let events = mutate(goodChain(), 'selection_raycast', { hit: null });
    events = drop(events, 'marker_state');
    events = drop(events, 'camera_focus');
    const r = evaluateTapStep(tapInput(events));
    assert.equal(r.failure.failureClass, 'RAYCAST_MISS');
});

test('AUT-INFRA-001: a runtime error in the window explains a broken chain (RUNTIME_ERROR)', async () => {
    const { evaluateTapStep } = await load();
    const errorLine = "E Cocos   : JS: TypeError: Cannot read properties of null (reading 'worldPosition')";
    const broken = evaluateTapStep(tapInput(drop(goodChain(), 'selection_state'), { runtimeErrorLines: [errorLine] }));
    assert.equal(broken.failure.failureClass, 'RUNTIME_ERROR');
    assert.equal(broken.failure.assertion, 'selection_state_emitted');
    assert.ok(broken.failure.evidenceLines.includes(errorLine));
    const intact = evaluateTapStep(tapInput(goodChain(), { runtimeErrorLines: [errorLine] }));
    assert.equal(intact.failure.failureClass, 'RUNTIME_ERROR');
    assert.equal(intact.failure.assertion, 'no_runtime_error');
    const crashed = evaluateTapStep(tapInput([], { appAlive: false }));
    assert.equal(crashed.failure.failureClass, 'RUNTIME_ERROR');
});

test('AUT-INFRA-001: touch arriving elsewhere than injected is an ENVIRONMENT (harness) problem', async () => {
    const { evaluateTapStep } = await load();
    const r = evaluateTapStep(tapInput(mutate(goodChain(), 'touch_end', { y: TOUCH.y + 120 })));
    assert.equal(r.failure.failureClass, 'ENVIRONMENT');
    assert.equal(r.failure.assertion, 'touch_position_matches_injection');
});

test('AUT-INFRA-001: re-tapping the selected zone expects changed=false', async () => {
    const { evaluateTapStep } = await load();
    const r = evaluateTapStep(tapInput(goodChain('AssemblyStation', 'AssemblyStation'), { previousSelection: 'AssemblyStation' }));
    assert.equal(r.ok, true, JSON.stringify(r.failure));
});

test('AUT-INFRA-001: swipe must be a drag that leaves the selection unchanged', async () => {
    const { evaluateSwipeStep } = await load();
    const base = { step: 'swipe', selectionBefore: 'RobotLine', runtimeErrorLines: [], appAlive: true };
    const drag = [ev('touch_start', {}), ev('touch_end', { tap: false, moved: 693 })];
    assert.equal(evaluateSwipeStep({ ...base, events: drag }).ok, true);
    assert.equal(evaluateSwipeStep({ ...base, events: [] }).failure.failureClass, 'INPUT_NOT_RECEIVED');
    assert.equal(evaluateSwipeStep({ ...base, events: [ev('touch_end', { tap: true, moved: 20 })] }).failure.failureClass, 'TAP_CLASSIFICATION');
    assert.equal(evaluateSwipeStep({ ...base, events: [...drag, ev('selection_raycast', { hit: 'Fabricator' })] }).failure.failureClass, 'TAP_CLASSIFICATION');
    assert.equal(evaluateSwipeStep({ ...base, events: [...drag, ev('selection_state', { next: 'Fabricator', changed: true })] }).failure.failureClass, 'SELECTION_STATE');
    assert.equal(evaluateSwipeStep({ ...base, events: drag, runtimeErrorLines: ['Uncaught Exception'] }).failure.failureClass, 'RUNTIME_ERROR');
});

test('AUT-INFRA-001: calibration self-check catches flipped or scaled coordinates', async () => {
    const { evaluateCalibration, adbToCocos, cocosToAdb } = await load();
    const win = { w: 2772, h: 1272 };
    const display = { width: 2772, height: 1272 };
    const expected = adbToCocos({ x: 111, y: 102 }, win, display);
    assert.deepEqual(expected, { x: 111, y: 1170 });
    assert.deepEqual(cocosToAdb(expected, win, display), { x: 111, y: 102 });
    const good = [ev('touch_start', { x: 111, y: 1170 }), ev('touch_end', { x: 111, y: 1170 })];
    const base = { step: 'calibration', expectedTouch: expected, tolerancePx: 3, windowSize: win, displaySize: display };
    assert.equal(evaluateCalibration({ ...base, events: good }).ok, true);
    const flipped = [ev('touch_start', { x: 111, y: 102 }), ev('touch_end', { x: 111, y: 102 })];
    const f = evaluateCalibration({ ...base, events: flipped });
    assert.equal(f.failure.failureClass, 'ENVIRONMENT');
    assert.equal(f.failure.assertion, 'calibration_position');
    assert.equal(evaluateCalibration({ ...base, events: [] }).failure.failureClass, 'INPUT_NOT_RECEIVED');
    assert.equal(evaluateCalibration({ ...base, events: good, displaySize: { width: 1272, height: 2772 } }).failure.assertion, 'calibration_orientation_matches');
    // Scaled window (e.g. render resolution != display) converts proportionally.
    assert.deepEqual(cocosToAdb({ x: 693, y: 318 }, { w: 1386, h: 636 }, display), { x: 1386, y: 636 });
});

test('AUT-INFRA-001: routing — only ENVIRONMENT may retry without a code change; marker goes to Scene Presentation', async () => {
    const { FAILURE_CLASSES, FAILURE_ROUTING } = await load();
    assert.deepEqual([...FAILURE_CLASSES], ['INPUT_NOT_RECEIVED', 'TAP_CLASSIFICATION', 'RAYCAST_MISS', 'SELECTION_STATE', 'MARKER_PRESENTATION', 'CAMERA_FOCUS', 'RUNTIME_ERROR', 'ENVIRONMENT']);
    for (const cls of FAILURE_CLASSES) assert.equal(FAILURE_ROUTING[cls].retryWithoutCodeChange, cls === 'ENVIRONMENT', cls);
    assert.equal(FAILURE_ROUTING.MARKER_PRESENTATION.nextOwner, 'scene-presentation');
    assert.equal(FAILURE_ROUTING.RAYCAST_MISS.nextOwner, 'implementer');
});
