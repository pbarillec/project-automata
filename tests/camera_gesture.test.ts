const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const gestureUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/TouchGestureModel.ts')).href;

async function gestureModule() {
    return import(gestureUrl);
}

function createTracker(TouchGestureTracker) {
    return new TouchGestureTracker({
        dragThresholdPixels: 10,
        pinchMinDistancePixels: 4,
    });
}

test('movement below the drag threshold emits a tap on end', async () => {
    const { TouchGestureTracker } = await gestureModule();
    const tracker = createTracker(TouchGestureTracker);

    assert.deepEqual(tracker.begin({ id: 1, x: 100, y: 100 }), []);
    assert.deepEqual(tracker.move({ id: 1, x: 106, y: 103 }), []);

    const outputs = tracker.end({ id: 1, x: 106, y: 103 });
    assert.deepEqual(outputs, [{ type: 'tap', id: 1, x: 106, y: 103 }]);
});

test('drag beyond threshold emits orbit and cannot later emit tap', async () => {
    const { TouchGestureTracker } = await gestureModule();
    const tracker = createTracker(TouchGestureTracker);

    tracker.begin({ id: 1, x: 0, y: 0 });
    const moveOutputs = tracker.move({ id: 1, x: 11, y: 0 });

    assert.equal(moveOutputs.length, 1);
    assert.equal(moveOutputs[0].type, 'orbit');
    assert.deepEqual(tracker.end({ id: 1, x: 11, y: 0 }), []);
});

test('multi-touch transition prevents stale one-finger tap or drag state', async () => {
    const { TouchGestureTracker } = await gestureModule();
    const tracker = createTracker(TouchGestureTracker);

    tracker.begin({ id: 1, x: 0, y: 0 });
    tracker.begin({ id: 2, x: 40, y: 0 });

    const panZoom = tracker.move({ id: 2, x: 50, y: 0 });
    assert.equal(panZoom[0].type, 'panZoom');
    assert.equal(panZoom[0].zoomScale, 1.25);

    assert.deepEqual(tracker.end({ id: 2, x: 50, y: 0 }), []);
    assert.equal(tracker.isLockedUntilAllReleased(), true);
    assert.deepEqual(tracker.move({ id: 1, x: 30, y: 0 }), []);
    assert.deepEqual(tracker.end({ id: 1, x: 30, y: 0 }), []);
    assert.equal(tracker.isLockedUntilAllReleased(), false);
});

test('pinch avoids division by zero and invalid zoom distances', async () => {
    const { TouchGestureTracker } = await gestureModule();
    const tracker = createTracker(TouchGestureTracker);

    tracker.begin({ id: 1, x: 10, y: 10 });
    tracker.begin({ id: 2, x: 10, y: 10 });
    const outputs = tracker.move({ id: 2, x: 11, y: 10 });

    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].type, 'panZoom');
    assert.equal(outputs[0].zoomScale, null);
});

test('touches beginning on UI are consumed and do not manipulate camera or emit taps', async () => {
    const { TouchGestureTracker } = await gestureModule();
    const tracker = createTracker(TouchGestureTracker);

    assert.deepEqual(tracker.begin({ id: 1, x: 50, y: 50, consumedByUi: true }), []);
    assert.deepEqual(tracker.move({ id: 1, x: 90, y: 50 }), []);
    assert.deepEqual(tracker.end({ id: 1, x: 90, y: 50 }), []);
});
