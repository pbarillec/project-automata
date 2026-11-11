const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const cameraMathUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/CameraMath.ts')).href;
const controllerPath = path.join(repoRoot, 'assets/scripts/camera/MobileCameraController.ts');

// FactoryWorld framing (FactoryWorldBootstrap.createCameraRig; unchanged by AUT-R-031-02).
const DEFAULT_DISTANCE = 12.5;
const REVEAL_DISTANCE = 9.5;

/** Mirrors MobileCameraController.startFocusBeat + update(): focus transition plus the eased distance. */
function runBeat(M, state, target, kind, focusDistance, seconds = 0.45, frame = 1 / 60) {
    const fromDistance = state.distance;
    const toDistance = M.clampCameraState({ ...state, distance: M.resolveFocusBeatDistance(kind, DEFAULT_DISTANCE, focusDistance) }).distance;
    let transition = M.startFocusTransition(state, target, seconds);
    let current = state;
    const distances = [];
    while (transition) {
        const result = M.stepFocusTransition(current, transition, frame);
        const progress = result.transition ? result.transition.elapsedSeconds / result.transition.durationSeconds : 1;
        current = M.clampCameraState({ ...result.state, distance: M.easeFocusDistance(fromDistance, toDistance, progress) });
        transition = result.transition;
        distances.push(current.distance);
    }
    return { state: current, distances };
}

test('AUT-R-031-02: the reveal pushes in to focusDistance; the default distance is used when focusDistance is 0', async () => {
    const M = await import(cameraMathUrl);
    assert.equal(M.resolveFocusBeatDistance('reveal', DEFAULT_DISTANCE, REVEAL_DISTANCE), REVEAL_DISTANCE);
    assert.equal(M.resolveFocusBeatDistance('reveal', DEFAULT_DISTANCE, 0), DEFAULT_DISTANCE);
    assert.equal(M.resolveFocusBeatDistance('reveal', DEFAULT_DISTANCE, Number.NaN), DEFAULT_DISTANCE);
    assert.equal(M.resolveFocusBeatDistance('selection', DEFAULT_DISTANCE, REVEAL_DISTANCE), DEFAULT_DISTANCE);
    assert.equal(M.resolveFocusBeatDistance('selection', DEFAULT_DISTANCE, 0), DEFAULT_DISTANCE);
});

test('AUT-R-031-02: a selection focus after a reveal eases back to the default distance', async () => {
    const M = await import(cameraMathUrl);
    const initial = M.clampCameraState({ yawDeg: 135, pitchDeg: 48, distance: DEFAULT_DISTANCE, focus: { x: -3.8, z: -1.8 } });
    const reveal = runBeat(M, initial, { x: -6, z: -2.85 }, 'reveal', REVEAL_DISTANCE);
    assert.equal(reveal.state.distance, REVEAL_DISTANCE);
    for (let i = 1; i < reveal.distances.length; i += 1) assert.ok(reveal.distances[i] <= reveal.distances[i - 1] + 1e-12, 'monotonic push-in');
    assert.ok(reveal.distances[0] > REVEAL_DISTANCE, 'eased, not snapped');

    const selection = runBeat(M, reveal.state, { x: -2, z: -1.8 }, 'selection', REVEAL_DISTANCE);
    assert.equal(selection.state.distance, DEFAULT_DISTANCE);
    assert.ok(selection.distances[0] < DEFAULT_DISTANCE, 'eased back, not snapped');
    assert.equal(selection.state.yawDeg, 135);
    assert.equal(selection.state.pitchDeg, 48);

    const again = runBeat(M, selection.state, { x: -6, z: -3 }, 'selection', REVEAL_DISTANCE);
    assert.deepEqual(new Set(again.distances), new Set([DEFAULT_DISTANCE]), 'a selection at the default distance keeps it');
});

test('AUT-R-031-02: easing helpers clamp progress and match the focus smoothstep', async () => {
    const M = await import(cameraMathUrl);
    assert.equal(M.easeFocusDistance(12.5, 9.5, 0), 12.5);
    assert.equal(M.easeFocusDistance(12.5, 9.5, 1), 9.5);
    assert.equal(M.easeFocusDistance(12.5, 9.5, 2), 9.5);
    assert.equal(M.easeFocusDistance(12.5, 9.5, -1), 12.5);
    assert.equal(M.easeFocusDistance(10, 20, 0.5), 15);
    // Same curve as the focus position of stepFocusTransition.
    const state = M.clampCameraState({ yawDeg: 0, pitchDeg: 45, distance: 10, focus: { x: 0, z: 0 } });
    const step = M.stepFocusTransition(state, M.startFocusTransition(state, { x: 4, z: 0 }, 1), 0.3);
    assert.ok(Math.abs(step.state.focus.x - 4 * M.easeFocusProgress(0.3)) < 1e-12);
});

test('AUT-R-031-02: the controller applies the distance policy per focus kind and reports the distance used', async () => {
    const source = await readFile(controllerPath, 'utf8');
    assert.match(source, /public focusOnWorldTarget\(target: Vec3\): void \{\s*this\.startFocusBeat\(target, 'selection'\);\s*\}/);
    assert.match(source, /public focusOnRevealTarget\(target: Vec3\): void \{\s*this\.startFocusBeat\(target, 'reveal'\);\s*\}/);
    assert.match(source, /resolveFocusBeatDistance\(kind, this\.defaultDistance, this\.focusDistance\)/);
    assert.match(source, /emitDeviceEvent\('camera_focus', \{ phase: 'started', kind, target: [^}]+\}, distance, fromDistance, defaultDistance: this\.defaultDistance/);
    assert.match(source, /emitDeviceEvent\('camera_focus', \{ phase: 'settled'/);
    // The old snap of every focus to focusDistance is gone.
    assert.doesNotMatch(source, /distance: this\.focusDistance/);
});
