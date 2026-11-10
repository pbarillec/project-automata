const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const selectionInputUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/presentation/SelectionInput.ts')).href;
const gestureUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/TouchGestureModel.ts')).href;

async function modules() {
    const [selectionInput, gesture] = await Promise.all([import(selectionInputUrl), import(gestureUrl)]);
    return { ...selectionInput, ...gesture };
}

function tapsAfterMove(TouchGestureTracker, slop, movePixels) {
    const tracker = new TouchGestureTracker({ dragThresholdPixels: slop, pinchMinDistancePixels: 4 });
    tracker.begin({ id: 1, x: 500, y: 500 });
    tracker.move({ id: 1, x: 500 + movePixels, y: 500 });
    return tracker.end({ id: 1, x: 500 + movePixels, y: 500 }).filter((output) => output.type === 'tap');
}

test('high-DPR slop absorbs finger jitter but still rejects real drags', async () => {
    const { selectionTapSlopPixels, TouchGestureTracker } = await modules();
    const slop = selectionTapSlopPixels(12, 3, 1272);
    assert.ok(slop >= 36, `slop ${slop} should be >= 36`);
    assert.equal(tapsAfterMove(TouchGestureTracker, slop, 30).length, 1);
    assert.equal(tapsAfterMove(TouchGestureTracker, slop, 100).length, 0);
});

test('Android DPR 1 still gets a screen-relative slop (3% of the short side)', async () => {
    const { selectionTapSlopPixels, SELECTION_TAP_SLOP_SHORT_SIDE_RATIO, TouchGestureTracker } = await modules();
    assert.equal(SELECTION_TAP_SLOP_SHORT_SIDE_RATIO, 0.03);
    const slop = selectionTapSlopPixels(12, 1, 1272);
    assert.ok(Math.abs(slop - 38.16) < 1e-9, `slop ${slop} should be ~38.16`);
    assert.equal(tapsAfterMove(TouchGestureTracker, slop, 30).length, 1);
    assert.equal(tapsAfterMove(TouchGestureTracker, slop, 100).length, 0);
});

test('slop falls back safely on degenerate inputs', async () => {
    const { selectionTapSlopPixels } = await modules();
    assert.equal(selectionTapSlopPixels(12, 1, 0), 12);
    for (const value of [
        selectionTapSlopPixels(12, Number.NaN, 1272),
        selectionTapSlopPixels(12, 1, Number.NaN),
        selectionTapSlopPixels(12, Number.NaN, Number.NaN),
        selectionTapSlopPixels(Number.NaN, 1, 0),
        selectionTapSlopPixels(12, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
    ]) {
        assert.ok(Number.isFinite(value) && value >= 12, `slop ${value} should be finite and >= 12`);
    }
});

test('ProducerSelectionController derives its tracker threshold from the screen-relative slop in start()', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerSelectionController.ts'), 'utf8');
    const start = source.match(/public start\(\): void \{([\s\S]*?)\n    \}/);
    assert.ok(start, 'start() body not found');
    assert.match(start[1], /selectionTapSlopPixels\(/);
    assert.match(start[1], /screen\.windowSize/);
    assert.match(start[1], /dragThresholdPixels: this\.tapSlopPixels/);
});
