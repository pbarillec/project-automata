const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-GP-001 device scenario: pure helpers (seeded save, expected payout, ui_layout parsing / evaluation).
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const W = 1080;
const H = 2412;
const SAFE = { x: 0, y: 96, w: W, h: H - 192 };

async function layoutEvent(batch) {
    const L = await imp('assets/scripts/presentation/UiLayout.ts');
    const layout = L.computeUiLayout({ w: W, h: H }, SAFE);
    const split = L.computePanelPrimarySplitRects({ w: W, h: H }, SAFE);
    const rects = { CoreHUD: layout.hud, ProducerPanel: layout.panel, ...layout.buttons, ...layout.hudButtons };
    if (batch) { rects.ManualProduceAction = split.primary; rects.AssemblyBatchAction = split.secondary; }
    else rects.AssemblyBatchAction = null;
    return { evt: 'ui_layout', reason: 'selection_refresh', screen: { w: W, h: H }, safeArea: layout.safeArea, rects, assemblyBatch: batch };
}

test('gp001 seeded save is a valid current-version save with a ready Assembly batch', async () => {
    const scenario = await imp('tools/device/scenarios/gp001_assembly_batch.ts');
    const { deserializeGameStateFromSaveJson, CURRENT_SAVE_VERSION } = await imp('assets/scripts/persistence/index.ts');
    const json = scenario.buildGp001SeededSave(Date.parse('2026-11-11T08:00:00Z'));
    const envelope = JSON.parse(json);
    assert.equal(envelope.saveVersion, CURRENT_SAVE_VERSION);
    const parsed = deserializeGameStateFromSaveJson(json);
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(parsed.state.run.producers.assembly_station.level, 1);
    const state = scenario.buildGp001SeededState();
    assert.equal(state.run.producers.assembly_station.level, 1);
    assert.equal(state.run.purchasedBreakthroughIds.includes('worker_bot'), false);
    const expected = scenario.expectedGp001Batch();
    assert.deepEqual(expected, { payout: 90, durationSeconds: 15 });
});

test('gp001 parses and evaluates the batch Button from ui_layout', async () => {
    const scenario = await imp('tools/device/scenarios/gp001_assembly_batch.ts');
    const { parseUiLayout } = await imp('tools/device/ui_geometry.ts');
    const ready = await layoutEvent({ visible: true, enabled: true, state: 'ready', caption: 'Launch batch +90' });
    const parsed = scenario.parseAssemblyBatchUi(ready);
    assert.equal(parsed.state, 'ready');
    assert.ok(parsed.rect && parsed.rect.w > 0);
    const ok = scenario.evaluateAssemblyBatchReady('s', parseUiLayout(ready), ready);
    assert.equal(ok.ok, true, JSON.stringify(ok.failure));

    const hidden = await layoutEvent(null);
    assert.deepEqual(scenario.parseAssemblyBatchUi(hidden), { rect: null, state: null, enabled: null, caption: null });
    assert.equal(scenario.evaluateAssemblyBatchReady('s', parseUiLayout(hidden), hidden).failure.assertion, 'batch_action_rect_present');

    const running = await layoutEvent({ visible: true, enabled: false, state: 'running', caption: 'Batch 40% • 9s' });
    assert.equal(scenario.evaluateAssemblyBatchReady('s', parseUiLayout(running), running).failure.assertion, 'batch_action_ready');

    const overlapping = await layoutEvent({ visible: true, enabled: true, state: 'ready', caption: 'Launch batch +90' });
    overlapping.rects.ManualProduceAction = { ...overlapping.rects.AssemblyBatchAction };
    const overlap = scenario.evaluateAssemblyBatchReady('s', parseUiLayout(overlapping), overlapping);
    assert.equal(overlap.failure.assertion, 'batch_action_disjoint_from_manual_produce');
    assert.equal(overlap.failure.failureClass, 'MARKER_PRESENTATION');
});

test('gp001 is registered in the device CLI', async () => {
    const fs = require('node:fs');
    const cli = fs.readFileSync(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8');
    assert.match(cli, /runGp001Scenario/);
    assert.match(cli, /command === 'gp001'/);
});
