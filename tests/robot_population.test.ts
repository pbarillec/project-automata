import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFreshGameState } from '../assets/scripts/state/index.ts';
import { WORKER_BOT_LOOP_ROUTE } from '../assets/scripts/presentation/WorkerBotRoute.ts';
import {
    ROBOT_LATERAL_MAX,
    ROBOT_POPULATION_BASELINE_MAX,
    ROBOT_POPULATION_BENCHMARK_SIZES,
    ROBOT_POPULATION_POOL_LIMIT,
    RobotPopulationPool,
    resolvePooledRobotCount,
    resolveVisibleRobotCount,
    robotSlotVariation,
    sampleRobotPoolPose,
} from '../assets/scripts/presentation/RobotPopulation.ts';
import { RobotPopulationViewModel } from '../assets/scripts/presentation/RobotPopulationViewModel.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('milestones map to the approved visible counts (ART_DIRECTION 15.2)', () => {
    assert.equal(resolveVisibleRobotCount(0), 0);
    assert.equal(resolveVisibleRobotCount(1), 1);
    assert.equal(resolveVisibleRobotCount(10), 3);
    const at100 = resolveVisibleRobotCount(100);
    assert.ok(at100 >= 6 && at100 <= 8, `100 -> ${at100}`);
    const at1000 = resolveVisibleRobotCount(1000);
    assert.ok(at1000 >= 10 && at1000 <= 14, `1000 -> ${at1000}`);
});

test('mapping is monotone, saturates at the cap and never maps 1:1', () => {
    let previous = 0;
    for (const built of [0, 1, 2, 3, 5, 10, 20, 50, 100, 300, 1000, 5000, 10000, 1e6, 1e12]) {
        const visible = resolveVisibleRobotCount(built);
        assert.ok(visible >= previous, `monotone at ${built}`);
        assert.ok(visible <= ROBOT_POPULATION_BASELINE_MAX);
        previous = visible;
    }
    assert.equal(resolveVisibleRobotCount(1e12), ROBOT_POPULATION_BASELINE_MAX);
    assert.ok(resolveVisibleRobotCount(1000) < 100);
});

test('the benchmark cap raises the ceiling up to the pool limit and no further', () => {
    for (const size of ROBOT_POPULATION_BENCHMARK_SIZES) {
        assert.equal(resolveVisibleRobotCount(1e12, { maxVisible: size }), size);
    }
    assert.equal(resolveVisibleRobotCount(1e12, { maxVisible: 99 }) <= ROBOT_POPULATION_POOL_LIMIT, true);
    assert.equal(resolveVisibleRobotCount(1, { maxVisible: 0 }), 0);
});

test('pooled count excludes the first Worker Bot and is zero without it', () => {
    assert.equal(resolvePooledRobotCount(5, true), 4);
    assert.equal(resolvePooledRobotCount(1, true), 0);
    assert.equal(resolvePooledRobotCount(5, false), 0);
});

test('slot variation is deterministic, bounded and spreads robots around the loop', () => {
    const phases = new Set<number>();
    for (let slot = 0; slot < ROBOT_POPULATION_POOL_LIMIT; slot += 1) {
        const a = robotSlotVariation(slot);
        assert.deepEqual(a, robotSlotVariation(slot));
        assert.ok(a.speedFactor >= 0.92 && a.speedFactor <= 1.08);
        assert.ok(Math.abs(a.lateralOffset) <= ROBOT_LATERAL_MAX + 1e-9);
        assert.ok(a.scaleFactor >= 0.96 && a.scaleFactor <= 1.04);
        phases.add(Math.round(a.phaseSeconds * 100));
    }
    assert.equal(phases.size, ROBOT_POPULATION_POOL_LIMIT);
});

test('pooled poses stay near the predefined loop and use only allowed clips', () => {
    const xs = WORKER_BOT_LOOP_ROUTE.map((s) => s.x);
    const zs = WORKER_BOT_LOOP_ROUTE.map((s) => s.z);
    const margin = ROBOT_LATERAL_MAX + 0.01;
    for (let slot = 0; slot < 13; slot += 1) {
        const variation = robotSlotVariation(slot);
        for (let t = 0; t < 60; t += 0.5) {
            const pose = sampleRobotPoolPose(variation, t);
            assert.ok(pose.x >= Math.min(...xs) - margin && pose.x <= Math.max(...xs) + margin);
            assert.ok(pose.z >= Math.min(...zs) - margin && pose.z <= Math.max(...zs) + margin);
            assert.ok(['Robot_Walking', 'Robot_Idle'].includes(pose.clip), pose.clip);
        }
    }
});

test('pool grows by instantiating once, shrinks by hiding, and reuses instances', () => {
    const pool = new RobotPopulationPool();
    assert.deepEqual(pool.resize(3), { visibleSlots: 3, shown: [0, 1, 2], hidden: [], instantiate: 3 });
    assert.deepEqual(pool.resize(1), { visibleSlots: 1, shown: [], hidden: [2, 1], instantiate: 3 });
    const regrow = pool.resize(2);
    assert.deepEqual(regrow.shown, [1]);
    assert.equal(regrow.instantiate, 3);
    assert.equal(pool.resize(999).visibleSlots, ROBOT_POPULATION_POOL_LIMIT - 1);
});

function stateWith(robotsBuilt: number, firstRobot: boolean) {
    const state = createFreshGameState();
    state.run.robotsBuilt = robotsBuilt;
    state.run.progressionFlags['first_robot'] = firstRobot;
    return state;
}

test('view model: no population without the first Worker Bot; load is instant; live growth animates', () => {
    const vm = new RobotPopulationViewModel();
    const none = vm.sync(stateWith(50, false));
    assert.equal(none.visible, 0);
    assert.equal(none.pooled, 0);
    const loaded = vm.sync(stateWith(10, true));
    assert.equal(loaded.visible, 3);
    assert.equal(loaded.pooled, 2);
    assert.equal(loaded.animateGrowth, true);

    const fresh = new RobotPopulationViewModel();
    const first = fresh.sync(stateWith(10, true));
    assert.equal(first.animateGrowth, false, 'the first snapshot (save load) never animates');
    const grown = fresh.sync(stateWith(100, true));
    assert.equal(grown.changed, true);
    assert.equal(grown.animateGrowth, true);
    const same = fresh.sync(stateWith(100, true));
    assert.equal(same.changed, false);
    const shrunk = fresh.sync(stateWith(0, false));
    assert.equal(shrunk.pooled, 0);
    assert.equal(shrunk.animateGrowth, false);
});

test('view model leaves the state untouched', () => {
    const state = stateWith(100, true);
    const before = JSON.stringify(state);
    new RobotPopulationViewModel().sync(state);
    assert.equal(JSON.stringify(state), before);
});

test('pure population modules are engine-free and command-free; wiring and pooling rules hold', () => {
    for (const file of ['RobotPopulation', 'RobotPopulationViewModel']) {
        const source = read(`assets/scripts/presentation/${file}.ts`);
        assert.doesNotMatch(source, /from 'cc/);
        assert.doesNotMatch(source, /import[^;]*Commands|\.submit\(/);
    }
    const controller = read('assets/scripts/presentation/RobotPopulationController.ts');
    assert.doesNotMatch(controller, /\.active = false|\.destroy\(/);
    assert.doesNotMatch(controller, /Navigation|PathFollow|findPath/);
    const registry = read('assets/scripts/presentation/PresentationController.ts');
    assert.match(registry, /this\.robotPopulation\?\.sync\(/);
    assert.match(registry, /this\.robotPopulation\?\.consumeDomainEvents\(state, events\)/);
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /population\.robotPrefab = this\.robotPrefab/);
    assert.match(bootstrap, /controller\.robotPopulation = /);
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /'robot_population'/);
});
