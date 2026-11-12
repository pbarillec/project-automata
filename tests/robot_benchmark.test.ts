import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { DEFAULT_FRAME_PERF_OPTIONS, FramePerfSampler } from '../assets/scripts/presentation/FramePerfSampler.ts';
import { resolveVisibleRobotCount, ROBOT_POPULATION_BENCHMARK_SIZES } from '../assets/scripts/presentation/RobotPopulation.ts';
import { RobotPopulationViewModel } from '../assets/scripts/presentation/RobotPopulationViewModel.ts';
import { buildBenchmarkSave, buildBenchmarkSeededState, parseTotalPssKb } from '../tools/device/benchmark_aut041.ts';

test('benchmark seed: Worker Bot owned, the save loads and each benchmark size is reached exactly', () => {
    const loaded = deserializeGameStateFromSaveJson(buildBenchmarkSave(Date.now()));
    assert.deepEqual(loaded.diagnostics, []);
    const state = buildBenchmarkSeededState();
    for (const size of ROBOT_POPULATION_BENCHMARK_SIZES) {
        const vm = new RobotPopulationViewModel();
        vm.setOptions({ maxVisible: size });
        const snapshot = vm.sync(state);
        assert.equal(snapshot.visible, size);
        assert.equal(snapshot.pooled, size - 1);
        assert.equal(resolveVisibleRobotCount(state.run.robotsBuilt, { maxVisible: size }), size);
    }
});

test('frame sampler skips the warm-up, then reports fixed windows with avg/p95/max/fps', () => {
    const sampler = new FramePerfSampler({ warmupSeconds: 1, windowSeconds: 1, maxWindows: 2 });
    for (let i = 0; i < 60; i += 1) assert.equal(sampler.add(1 / 60), null);
    const windows = [];
    for (let i = 0; i < 400; i += 1) {
        const w = sampler.add(i % 50 === 0 ? 0.05 : 0.01);
        if (w) windows.push(w);
    }
    assert.equal(windows.length, 2);
    assert.equal(sampler.done, true);
    assert.ok(windows[0].maxMs >= 50 - 1e-6);
    assert.ok(windows[0].avgMs > 10 && windows[0].p95Ms >= 10 - 1e-6 && windows[0].p95Ms <= windows[0].maxMs);
    assert.ok(windows[0].fps > 0);
    assert.equal(DEFAULT_FRAME_PERF_OPTIONS.maxWindows, 3);
});

test('meminfo TOTAL PSS parsing', () => {
    assert.equal(parseTotalPssKb('           TOTAL PSS:   412345            TOTAL RSS:   500000'), 412345);
    assert.equal(parseTotalPssKb('nothing'), null);
});

test('benchmark is DEBUG-gated and the override never leaks into the model defaults', () => {
    const controller = readFileSync(new URL('../assets/scripts/presentation/RobotPopulationController.ts', import.meta.url), 'utf8');
    assert.match(controller, /if \(DEBUG !== true\) return;/);
    assert.ok(controller.indexOf('if (DEBUG !== true) return;') < controller.indexOf('readText(POPULATION_BENCHMARK_FILE)'));
    assert.equal(resolveVisibleRobotCount(1e6), 14);
});
