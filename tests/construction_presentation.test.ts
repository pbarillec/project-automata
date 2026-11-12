import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFreshGameState } from '../assets/scripts/state/index.ts';
import type { DomainEvent } from '../assets/scripts/domain/Events.ts';
import {
    buildConstructionPlan,
    clampConstructionDuration,
    CONSTRUCTION_DEFAULT_SECONDS,
    CONSTRUCTION_MAX_SECONDS,
    CONSTRUCTION_MIN_SECONDS,
    sampleConstruction,
} from '../assets/scripts/presentation/ConstructionSequence.ts';
import { ConstructionViewModel } from '../assets/scripts/presentation/ConstructionViewModel.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('duration is clamped to 1.5-3 s and defaults inside the range', () => {
    assert.equal(clampConstructionDuration(0.2), CONSTRUCTION_MIN_SECONDS);
    assert.equal(clampConstructionDuration(9), CONSTRUCTION_MAX_SECONDS);
    assert.equal(clampConstructionDuration(Number.NaN), CONSTRUCTION_DEFAULT_SECONDS);
    assert.ok(CONSTRUCTION_DEFAULT_SECONDS >= 1.5 && CONSTRUCTION_DEFAULT_SECONDS <= 3);
});

test('sequence reveals modules in order, is deterministic and ends fully built', () => {
    const plan = buildConstructionPlan(['a', 'b', 'c']);
    const start = sampleConstruction(plan, 0);
    assert.deepEqual(start.modules.map((m) => m.scaleFactor), [0, 0, 0].map((_, i) => start.modules[i].scaleFactor));
    assert.equal(start.complete, false);
    const mid = sampleConstruction(plan, plan.durationSeconds * 0.5);
    assert.ok(mid.modules[0].scaleFactor >= mid.modules[1].scaleFactor);
    assert.ok(mid.modules[1].scaleFactor >= mid.modules[2].scaleFactor);
    assert.deepEqual(sampleConstruction(plan, 1.1), sampleConstruction(plan, 1.1));
    const end = sampleConstruction(plan, plan.durationSeconds);
    assert.equal(end.complete, true);
    assert.ok(end.modules.every((m) => m.phase === 'done' && m.scaleFactor === 1));
    assert.equal(end.sparkIntensity, 0);
    assert.equal(end.lightLevel, 0);
});

test('scale factors are monotonic per module and within 0..1', () => {
    const plan = buildConstructionPlan(['a', 'b']);
    let previous = [0, 0];
    for (let t = 0; t <= plan.durationSeconds; t += 0.05) {
        const sample = sampleConstruction(plan, t);
        sample.modules.forEach((m, i) => {
            assert.ok(m.scaleFactor >= 0 && m.scaleFactor <= 1);
            assert.ok(m.scaleFactor + 1e-9 >= previous[i]);
            previous[i] = m.scaleFactor;
        });
    }
});

function stateWith(built: boolean) {
    const state = createFreshGameState();
    state.run.producers['assembly_station'] = { level: built ? 1 : 0, isUnlocked: true, isBuilt: built };
    return state;
}

const constructed: DomainEvent = { type: 'producerConstructed', producerId: 'assembly_station', level: 1, source: 'producer_purchase' };

test('view model: a save load never plays a sequence; a live event plays once', () => {
    const vm = new ConstructionViewModel(() => ['m1', 'm2']);
    assert.deepEqual(vm.syncFromState(stateWith(true)), []);
    assert.deepEqual(vm.consumeEvents(stateWith(true), [constructed]), []);
    assert.equal(vm.isActive('assembly_station'), false);

    const live = new ConstructionViewModel(() => ['m1', 'm2']);
    live.syncFromState(stateWith(false));
    const started = live.consumeEvents(stateWith(true), [constructed]);
    assert.equal(started.length, 1);
    assert.equal(live.isActive('assembly_station'), true);
});

test('view model: snapshot-before-event ordering plays exactly one sequence', () => {
    const vm = new ConstructionViewModel(() => ['m1']);
    vm.syncFromState(stateWith(false));
    assert.equal(vm.syncFromState(stateWith(true)).length, 1);
    assert.deepEqual(vm.consumeEvents(stateWith(true), [constructed]), []);
});

test('view model: tick completes once (activation hook), then Reboot allows a new sequence', () => {
    const vm = new ConstructionViewModel(() => ['m1']);
    vm.syncFromState(stateWith(false));
    vm.consumeEvents(stateWith(true), [constructed]);
    let completed = 0;
    for (let i = 0; i < 200; i += 1) completed += vm.tick(0.05).completed.length;
    assert.equal(completed, 1);
    assert.equal(vm.isActive('assembly_station'), false);
    vm.syncFromState(stateWith(false));
    assert.equal(vm.consumeEvents(stateWith(true), [constructed]).length, 1);
});

test('view model: producers without modules play no sequence', () => {
    const vm = new ConstructionViewModel(() => []);
    vm.syncFromState(stateWith(false));
    assert.deepEqual(vm.consumeEvents(stateWith(true), [constructed]), []);
});

test('pure construction modules are engine-free and command-free', () => {
    for (const file of ['ConstructionSequence', 'ConstructionViewModel']) {
        const source = read(`assets/scripts/presentation/${file}.ts`);
        assert.doesNotMatch(source, /from 'cc/);
        assert.doesNotMatch(source, /import[^;]*Commands|\.submit\(/);
    }
});

test('wiring: registry feeds construction first, Assembly is a registered target, scale-only visibility', () => {
    const registry = read('assets/scripts/presentation/PresentationController.ts');
    assert.ok(registry.indexOf('constructionPresentation?.sync(') < registry.indexOf('target?.sync('));
    assert.ok(registry.indexOf('constructionPresentation?.consumeDomainEvents') < registry.indexOf('firstAutomationPresentation?.consumeDomainEvents'));
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /registerTarget\('assembly_station', visual\)/);
    assert.match(bootstrap, /controller\.constructionPresentation = /);
    const controller = read('assets/scripts/presentation/ConstructionPresentationController.ts');
    assert.doesNotMatch(controller, /\.active = false/);
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /'construction_state'/);
});
