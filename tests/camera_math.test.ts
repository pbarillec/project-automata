const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const cameraMathUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/CameraMath.ts')).href;

async function cameraMathModule() {
    return import(cameraMathUrl);
}

function testTuning() {
    return {
        minPitchDeg: 30,
        maxPitchDeg: 60,
        minDistance: 8,
        maxDistance: 20,
        orbitYawDegPerPixel: 1,
        orbitPitchDegPerPixel: 1,
        zoomScaleMin: 0.25,
        zoomScaleMax: 4,
        panUnitsPerPixelAtDistance: 0.01,
        focusBounds: {
            minX: -5,
            maxX: 5,
            minZ: -3,
            maxZ: 7,
        },
        yawMode: 'wrap',
        minYawDeg: -180,
        maxYawDeg: 180,
    };
}

test('camera pitch, zoom and focus clamp to configured bounds', async () => {
    const { clampCameraState } = await cameraMathModule();
    const tuning = testTuning();
    const clamped = clampCameraState({
        yawDeg: 725,
        pitchDeg: 80,
        distance: 100,
        focus: { x: 50, z: -50 },
    }, tuning);

    assert.equal(clamped.yawDeg, 5);
    assert.equal(clamped.pitchDeg, 60);
    assert.equal(clamped.distance, 20);
    assert.deepEqual(clamped.focus, { x: 5, z: -3 });
});

test('orbit and pinch zoom remain finite and bounded', async () => {
    const { applyOrbitDelta, applyPinchZoom } = await cameraMathModule();
    const tuning = testTuning();
    const state = {
        yawDeg: 10,
        pitchDeg: 45,
        distance: 10,
        focus: { x: 0, z: 0 },
    };

    const orbited = applyOrbitDelta(state, { x: 0, y: 50 }, tuning);
    assert.equal(orbited.pitchDeg, 60);

    const invalidPinch = applyPinchZoom(state, 0, tuning);
    assert.equal(invalidPinch.distance, 10);

    const zoomedIn = applyPinchZoom(state, 999, tuning);
    assert.equal(zoomedIn.distance, 8);

    const zoomedOut = applyPinchZoom(state, 0.001, tuning);
    assert.equal(zoomedOut.distance, 20);
});

test('two-finger pan uses bounded camera-relative focus movement', async () => {
    const { applyCameraRelativePan } = await cameraMathModule();
    const tuning = testTuning();
    const state = {
        yawDeg: 0,
        pitchDeg: 45,
        distance: 10,
        focus: { x: 4.9, z: 6.9 },
    };

    const panned = applyCameraRelativePan(state, { x: -100, y: 100 }, tuning);

    assert.equal(panned.focus.x, 5);
    assert.equal(panned.focus.z, 7);
});

test('focus target and focus transition obey the same focus bounds', async () => {
    const {
        boundedFocusForTarget,
        startFocusTransition,
        stepFocusTransition,
        resolveFocusTransitionAfterUserInput,
    } = await cameraMathModule();
    const tuning = testTuning();
    const state = {
        yawDeg: 0,
        pitchDeg: 45,
        distance: 10,
        focus: { x: 0, z: 0 },
    };

    assert.deepEqual(boundedFocusForTarget({ x: 50, z: -50 }, tuning), { x: 5, z: -3 });

    const transition = startFocusTransition(state, { x: 50, z: -50 }, 1, tuning);
    assert.deepEqual(transition.to, { x: 5, z: -3 });

    const stepped = stepFocusTransition(state, transition, 1, tuning);
    assert.equal(stepped.transition, null);
    assert.deepEqual(stepped.state.focus, { x: 5, z: -3 });
    assert.equal(resolveFocusTransitionAfterUserInput(transition, true), null);
    assert.equal(resolveFocusTransitionAfterUserInput(transition, false), transition);
});
