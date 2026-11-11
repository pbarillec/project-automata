const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const cameraMathUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/CameraMath.ts')).href;
const gestureUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/TouchGestureModel.ts')).href;
const controllerPath = path.join(repoRoot, 'assets/scripts/camera/MobileCameraController.ts');

const PAN = { oneFingerMode: 'pan', multiTouchEnabled: false };
const NONE = { oneFingerMode: 'none', multiTouchEnabled: false };
const orbit = (deltaX, deltaY) => ({ type: 'orbit', id: 1, deltaX, deltaY });
const panZoom = (centerDeltaX, centerDeltaY, zoomScale) => ({ type: 'panZoom', centerDeltaX, centerDeltaY, zoomScale });

function runningBeat(M, state) {
    const transition = M.startFocusTransition(state, { x: 4, z: 3 }, 0.45);
    return M.stepFocusTransition(state, transition, 0.1).transition;
}

test('AUT-R-031-02: default flags reproduce the AUT-031 orbit and pan/zoom behaviour exactly', async () => {
    const M = await import(cameraMathUrl);
    assert.deepEqual({ ...M.DEFAULT_CAMERA_INPUT_FLAGS }, { oneFingerMode: 'orbit', multiTouchEnabled: true });
    const state = M.cloneCameraState(M.DEFAULT_CAMERA_STATE);

    const orbited = M.applyCameraGestureInput(state, null, orbit(40, -20));
    assert.deepEqual(orbited.state, M.applyOrbitDelta(state, { x: 40, y: -20 }));
    assert.equal(orbited.applied, true);
    assert.equal(orbited.action, 'orbit');

    const zoomed = M.applyCameraGestureInput(state, null, panZoom(30, 10, 1.25), M.DEFAULT_CAMERA_INPUT_FLAGS);
    assert.deepEqual(zoomed.state, M.applyCameraRelativePan(M.applyPinchZoom(state, 1.25), { x: 30, y: 10 }));
    assert.equal(zoomed.action, 'panZoom');

    const panOnly = M.applyCameraGestureInput(state, null, panZoom(30, 10, null));
    assert.deepEqual(panOnly.state, M.applyCameraRelativePan(state, { x: 30, y: 10 }));
});

test('AUT-R-031-02: pan mode turns a one-finger drag into a camera-relative pan that changes only the focus, clamped to the bounds', async () => {
    const M = await import(cameraMathUrl);
    const state = M.cloneCameraState(M.DEFAULT_CAMERA_STATE);
    const result = M.applyCameraGestureInput(state, null, orbit(120, 80), PAN);
    assert.equal(result.applied, true);
    assert.equal(result.action, 'pan');
    assert.deepEqual(result.state, M.applyCameraRelativePan(state, { x: 120, y: 80 }));
    assert.equal(result.state.yawDeg, state.yawDeg);
    assert.equal(result.state.pitchDeg, state.pitchDeg);
    assert.equal(result.state.distance, state.distance);
    assert.notDeepEqual(result.state.focus, state.focus);

    const bounds = { minX: -9, maxX: -2.5, minZ: -6, maxZ: 0 };
    const tuning = { ...M.DEFAULT_CAMERA_TUNING, focusBounds: bounds };
    for (const [dx, dy] of [[5000, 0], [-5000, 0], [0, 5000], [0, -5000], [3000, -4000]]) {
        const clamped = M.applyCameraGestureInput({ ...state, focus: { x: -3.8, z: -1.8 } }, null, orbit(dx, dy), PAN, tuning).state;
        assert.ok(clamped.focus.x >= bounds.minX && clamped.focus.x <= bounds.maxX, `x ${clamped.focus.x}`);
        assert.ok(clamped.focus.z >= bounds.minZ && clamped.focus.z <= bounds.maxZ, `z ${clamped.focus.z}`);
        const gaps = [clamped.focus.x - bounds.minX, bounds.maxX - clamped.focus.x, clamped.focus.z - bounds.minZ, bounds.maxZ - clamped.focus.z];
        assert.ok(gaps.some((gap) => Math.abs(gap) < 1e-9), `long drag ${dx},${dy} stops on the bounds edge`);
        assert.equal(clamped.distance, state.distance);
        assert.equal(clamped.yawDeg, state.yawDeg);
        assert.equal(clamped.pitchDeg, state.pitchDeg);
    }
});

test('AUT-R-031-02: none mode makes a one-finger drag a no-op; multi-touch off makes pan/zoom a no-op', async () => {
    const M = await import(cameraMathUrl);
    const state = M.cloneCameraState(M.DEFAULT_CAMERA_STATE);
    const none = M.applyCameraGestureInput(state, null, orbit(200, 100), NONE);
    assert.equal(none.applied, false);
    assert.equal(none.action, 'ignored');
    assert.deepEqual(none.state, state);

    for (const flags of [PAN, NONE, { oneFingerMode: 'orbit', multiTouchEnabled: false }]) {
        const ignored = M.applyCameraGestureInput(state, null, panZoom(80, -60, 2), flags);
        assert.equal(ignored.applied, false);
        assert.deepEqual(ignored.state, state, 'no pinch zoom, no two-finger pan');
    }
});

test('AUT-R-031-02: a switched-off gesture leaves a running focus beat running; an enabled pan interrupts it', async () => {
    const M = await import(cameraMathUrl);
    const state = M.cloneCameraState(M.DEFAULT_CAMERA_STATE);
    const beat = runningBeat(M, state);
    assert.ok(beat);

    const disabledDrag = M.applyCameraGestureInput(state, beat, orbit(200, 0), NONE);
    assert.equal(disabledDrag.transition, beat, 'disabled one-finger drag keeps the beat');
    const disabledPinch = M.applyCameraGestureInput(state, beat, panZoom(50, 50, 1.5), PAN);
    assert.equal(disabledPinch.transition, beat, 'disabled multi-touch keeps the beat');

    const pan = M.applyCameraGestureInput(state, beat, orbit(200, 0), PAN);
    assert.equal(pan.applied, true);
    assert.equal(pan.transition, null, 'an enabled pan interrupts the beat');
    const legacyOrbit = M.applyCameraGestureInput(state, beat, orbit(200, 0));
    assert.equal(legacyOrbit.transition, null, 'the spike orbit still interrupts the beat');
});

test('AUT-R-031-02: with the tracker, a drag beyond the threshold pans in FactoryWorld mode and never emits a tap', async () => {
    const M = await import(cameraMathUrl);
    const { TouchGestureTracker } = await import(gestureUrl);
    const tracker = new TouchGestureTracker({ dragThresholdPixels: 12, pinchMinDistancePixels: 4 });
    let state = M.cloneCameraState(M.DEFAULT_CAMERA_STATE);
    const outputs = [...tracker.begin({ id: 1, x: 100, y: 100 }), ...tracker.move({ id: 1, x: 160, y: 120 }), ...tracker.end({ id: 1, x: 160, y: 120 })];
    assert.equal(outputs.some((o) => o.type === 'tap'), false);
    for (const output of outputs) state = M.applyCameraGestureInput(state, null, output, PAN).state;
    assert.equal(state.yawDeg, M.DEFAULT_CAMERA_STATE.yawDeg);
    assert.equal(state.pitchDeg, M.DEFAULT_CAMERA_STATE.pitchDeg);
    assert.equal(state.distance, M.DEFAULT_CAMERA_STATE.distance);
    assert.notDeepEqual(state.focus, M.DEFAULT_CAMERA_STATE.focus);
});

test('AUT-R-031-02: MobileCameraController defaults keep the CameraSpike gesture set and route every gesture through the flags', async () => {
    const source = await readFile(controllerPath, 'utf8');
    assert.match(source, /public oneFingerMode: CameraOneFingerMode = DEFAULT_CAMERA_INPUT_FLAGS\.oneFingerMode;/);
    assert.match(source, /public multiTouchEnabled = DEFAULT_CAMERA_INPUT_FLAGS\.multiTouchEnabled;/);
    assert.match(source, /applyCameraGestureInput\(this\.state, this\.focusTransition, output, this\.getInputFlags\(\), this\.gestureTuning\(\)\)/);
    // Pan bounds clamp player gestures only; focus beats keep the global bounds and setFocusBounds never moves the camera.
    assert.match(source, /focusBounds: expandCameraBoundsToInclude\(this\.panBounds, this\.state\.focus\)/);
    assert.match(source, /public setFocusBounds\(bounds: CameraBounds \| null\): void \{\s*this\.panBounds = [^;]+;\s*\}/);
    assert.doesNotMatch(source, /startFocusTransition\([^)]*gestureTuning/);
    assert.match(source, /if \(!result\.applied\) \{\s*continue;\s*\}/);
    // Gestures no longer call the math directly, so a disabled gesture cannot move or cancel anything.
    assert.doesNotMatch(source, /applyOrbitDelta\(|applyPinchZoom\(|applyCameraRelativePan\(|resolveFocusTransitionAfterUserInput\(/);
    assert.match(source, /public setFocusBounds\(bounds: CameraBounds \| null\): void/);
});

test('AUT-R-031-02: a pan that starts outside the pan bounds (after a focus beat) never snaps and never moves further out', async () => {
    const M = await import(cameraMathUrl);
    const bounds = { minX: -9, maxX: -2.5, minZ: -6, maxZ: 0 };
    const outside = { yawDeg: 135, pitchDeg: 48, distance: 12.5, focus: { x: 3.5, z: -1.2 } };
    const tuningFor = (state) => ({ ...M.DEFAULT_CAMERA_TUNING, focusBounds: M.expandCameraBoundsToInclude(bounds, state.focus) });
    assert.deepEqual(M.expandCameraBoundsToInclude(bounds, outside.focus), { minX: -9, maxX: 3.5, minZ: -6, maxZ: 0 });
    assert.deepEqual(M.expandCameraBoundsToInclude(bounds, { x: -4, z: -2 }), bounds, 'inside: unchanged');

    const tiny = M.applyCameraGestureInput(outside, null, orbit(1, 0), PAN, tuningFor(outside)).state;
    assert.ok(Math.hypot(tiny.focus.x - outside.focus.x, tiny.focus.z - outside.focus.z) < 0.05, 'a 1 px pan moves the focus by about 1 px, no snap');
    let state = outside;
    for (let i = 0; i < 40; i += 1) {
        const next = M.applyCameraGestureInput(state, null, orbit(25, -25), PAN, tuningFor(state)).state;
        assert.ok(next.focus.x <= Math.max(state.focus.x, bounds.maxX) + 1e-9, 'never further out in x');
        assert.ok(next.focus.z <= Math.max(state.focus.z, bounds.maxZ) + 1e-9 && next.focus.z >= Math.min(state.focus.z, bounds.minZ) - 1e-9, 'never further out in z');
        state = next;
    }
    const back = M.applyCameraGestureInput(outside, null, orbit(-2000, 0), PAN, tuningFor(outside)).state;
    assert.ok(back.focus.x < outside.focus.x, 'panning back towards the unlocked zones works');
});
