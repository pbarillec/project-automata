import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import type { DomainEvent } from '../assets/scripts/domain/Events.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { GameRuntime } from '../assets/scripts/runtime/GameRuntime.ts';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { createHudViewModel } from '../assets/scripts/presentation/HudViewModel.ts';
import { formatFreeOverclockState, formatFreeOverclockTimer } from '../assets/scripts/presentation/PresentationText.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { classifyMilestoneEvent } from '../assets/scripts/presentation/MilestoneTier.ts';
import { MilestonePresentationViewModel } from '../assets/scripts/presentation/MilestonePresentationViewModel.ts';
import * as B from '../assets/scripts/presentation/BoostPresentation.ts';
import * as P from '../assets/scripts/presentation/BoostHudPill.ts';
import * as S from '../assets/scripts/presentation/PresentationTimeScale.ts';
import { milestoneRingBars, producerFootprint } from '../assets/scripts/presentation/MilestoneFeedback.ts';
import { AUT047_ACTIVE_REMAINING_SECONDS, AUT047_SEED_VARIANTS, buildAut047SeededSave, buildAut047SeededState, isAut047SeedVariant } from '../tools/device/seed_aut047.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateRevealTimeline, type TimelineEvent } from '../tools/device/reveal_capture.ts';

/*
 * AUT-047 Overclock presentation: state -> presentation mapping (locked / ready / active / cooldown / suspended), ramp envelopes, silent
 * load, spark limits, no toast, HUD text / pill mapping, shared time scale, wiring and the device seed. Presentation only: no economy,
 * runtime, save or data change.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const presentation = (file: string): string => read(`assets/scripts/presentation/${file}`);
const code = (file: string): string => presentation(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

const activated: DomainEvent = { type: 'temporaryBoostActivated', boostId: 'free_overclock', source: 'free', multiplier: 2, durationSeconds: 60, cooldownSeconds: 240, requestId: null };
const expired: DomainEvent = { type: 'temporaryBoostExpired', boostId: 'free_overclock', source: 'free' };

function readyState(): GameState {
    const state = createFreshGameState();
    state.run.progressionFlags['first_robot'] = true;
    state.run.producers.fabricator = { level: 10, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 10, isUnlocked: true, isBuilt: true };
    return state;
}

function runtimeWith(state: GameState): GameRuntime { return new GameRuntime(repository, state); }

function activate(runtime: GameRuntime, model: B.BoostPresentationModel): B.BoostTransition | null {
    const result = runtime.execute({ type: 'activateFreeOverclock' });
    return model.consumeEvents(runtime.getStateSnapshot(), result.events);
}

function runFrames(model: B.BoostPresentationModel, seconds: number, step = 1 / 60): B.BoostFrame {
    let frame = model.tick(0);
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) frame = model.tick(step);
    return frame;
}

test('AUT-047 state -> presentation mapping: locked / ready / cooldown are baseline, active and suspended are keyed on the boost', () => {
    const locked = createFreshGameState();
    assert.equal(createHudViewModel(repository, locked).freeOverclock.state, 'locked');
    assert.equal(B.resolveBoostSnapshot(locked).mode, 'inactive');

    const runtime = runtimeWith(readyState());
    const ready = runtime.getStateSnapshot();
    assert.equal(createHudViewModel(repository, ready).freeOverclock.state, 'ready');
    assert.equal(B.resolveBoostSnapshot(ready).mode, 'inactive');

    const result = runtime.execute({ type: 'activateFreeOverclock' });
    assert.equal(result.ok, true);
    const active = runtime.getStateSnapshot();
    assert.equal(createHudViewModel(repository, active).freeOverclock.state, 'active');
    const snapshot = B.resolveBoostSnapshot(active);
    assert.deepEqual([snapshot.mode, snapshot.multiplier, snapshot.remainingSeconds, snapshot.boostIds], ['active', 2, 60, ['free_overclock']]);

    runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 60 });
    const cooldown = runtime.getStateSnapshot();
    assert.equal(createHudViewModel(repository, cooldown).freeOverclock.state, 'cooldown');
    assert.equal(B.resolveBoostSnapshot(cooldown).mode, 'inactive');

    const suspended = runtimeWith(readyState());
    suspended.execute({ type: 'activateFreeOverclock' });
    const suspendedState = suspended.getStateSnapshot();
    suspendedState.boosts.activeBoosts.free_overclock.isSuspended = true;
    suspendedState.boosts.activeBoosts.free_overclock.suspendedByBoostId = 'other_boost';
    assert.equal(createHudViewModel(repository, suspendedState).freeOverclock.state, 'suspended');
    assert.equal(B.resolveBoostSnapshot(suspendedState).mode, 'suspended');

    for (const [view, mode] of [['locked', 'inactive'], ['ready', 'inactive'], ['active', 'active'], ['cooldown', 'inactive'], ['suspended', 'suspended']] as const) assert.equal(B.boostModeForViewState(view), mode);
});

test('AUT-047 the look is keyed on any temporary production boost, not on free_overclock alone', () => {
    const state = readyState();
    state.boosts.activeBoosts.extended_overclock = { boostId: 'extended_overclock', remainingSeconds: 120, cooldownSeconds: 0, source: 'rewarded', requestId: 'r1', effect: { type: 'productionMultiplier', multiplier: 2 }, isSuspended: false, suspendedByBoostId: null };
    const snapshot = B.resolveBoostSnapshot(state);
    assert.equal(snapshot.mode, 'active');
    assert.deepEqual(snapshot.boostIds, ['extended_overclock']);
    const model = new B.BoostPresentationModel();
    assert.equal(model.syncFromState(state).mode, 'active');
    // One boost suspended while another runs: still active; all suspended: suspended.
    state.boosts.activeBoosts.free_overclock = { boostId: 'free_overclock', remainingSeconds: 30, cooldownSeconds: 240, source: 'free', requestId: null, effect: { type: 'productionMultiplier', multiplier: 2 }, isSuspended: true, suspendedByBoostId: 'extended_overclock' };
    assert.equal(B.resolveBoostSnapshot(state).mode, 'active');
    state.boosts.activeBoosts.extended_overclock.isSuspended = true;
    assert.equal(B.resolveBoostSnapshot(state).mode, 'suspended');
});

test('AUT-047 activation: one ~0.35 s impulse, speed ramps up over ~0.4 s to ~1.3x (inside 1.25-1.4)', () => {
    assert.ok(B.BOOST_VISUAL_SPEED >= B.BOOST_VISUAL_SPEED_RANGE.min && B.BOOST_VISUAL_SPEED <= B.BOOST_VISUAL_SPEED_RANGE.max);
    assert.equal(B.BOOST_VISUAL_SPEED_RANGE.min, 1.25);
    assert.equal(B.BOOST_VISUAL_SPEED_RANGE.max, 1.4);
    assert.ok(B.BOOST_IMPULSE_SECONDS >= 0.3 && B.BOOST_IMPULSE_SECONDS <= 0.4);
    assert.ok(B.BOOST_RAMP_IN_SECONDS >= 0.35 && B.BOOST_RAMP_IN_SECONDS <= 0.45);

    const runtime = runtimeWith(readyState());
    const model = new B.BoostPresentationModel();
    assert.equal(model.syncFromState(runtime.getStateSnapshot()).impulse, false);
    assert.equal(model.isIdle(), true);
    assert.equal(model.tick(1 / 60).idle, true, 'idle before activation: nothing to render');
    const result = runtime.execute({ type: 'activateFreeOverclock' });
    const transition = model.consumeEvents(runtime.getStateSnapshot(), result.events);
    assert.deepEqual([transition?.phase, transition?.impulse, transition?.source, transition?.mode], ['started', true, 'events', 'active']);
    assert.equal(model.isIdle(), false);

    // Impulse envelope: rises, peaks near the middle, ends by 0.35 s.
    const early = model.tick(0.05);
    assert.ok(early.impulseActive && early.ring > 0 && early.ring < 1.0001);
    assert.ok(early.level > 0 && early.level < 0.5);
    const mid = model.tick(0.125);
    assert.ok(mid.ring >= 0.99, 'ring plateau around the middle of the impulse');
    assert.ok(mid.impulseSparks > 0.9);
    const late = runFrames(model, 0.2);
    assert.equal(late.impulseActive, false, 'impulse over after ~0.35 s');
    assert.equal(late.ring, 0);
    assert.equal(late.impulseSparks, 0);
    const ramped = runFrames(model, 0.2);
    assert.equal(ramped.level, 1);
    assert.ok(Math.abs(ramped.timeScale - B.BOOST_VISUAL_SPEED) < 1e-9);
    assert.ok(ramped.timeScale >= 1.25 && ramped.timeScale <= 1.4);

    // Monotonic ramp, never above the cap, never below baseline.
    const ramp = new B.BoostPresentationModel();
    const rampRuntime = runtimeWith(readyState());
    ramp.syncFromState(rampRuntime.getStateSnapshot());
    activate(rampRuntime, ramp);
    let previous = 1;
    for (let index = 0; index < 40; index += 1) {
        const frame = ramp.tick(1 / 60);
        assert.ok(frame.timeScale >= previous - 1e-12 && frame.timeScale <= B.BOOST_VISUAL_SPEED + 1e-12);
        previous = frame.timeScale;
    }
    // Only ONE impulse per activation.
    assert.equal(ramp.consumeEvents(rampRuntime.getStateSnapshot(), []), null);
    assert.equal(ramp.tick(1 / 60).impulseActive, false);
});

test('AUT-047 expiry: ease out over ~0.6 s to baseline, then idle (zero cost), no residual', () => {
    const runtime = runtimeWith(readyState());
    const model = new B.BoostPresentationModel();
    model.syncFromState(runtime.getStateSnapshot());
    activate(runtime, model);
    runFrames(model, 1);
    const result = runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 60 });
    assert.ok(result.events.some((event) => event.type === 'temporaryBoostExpired'));
    const transition = model.consumeEvents(runtime.getStateSnapshot(), result.events);
    assert.deepEqual([transition?.phase, transition?.impulse, transition?.mode], ['ended', false, 'inactive']);
    assert.equal(model.isIdle(), false, 'still easing out');
    const half = runFrames(model, 0.3);
    assert.ok(half.timeScale > 1 && half.timeScale < B.BOOST_VISUAL_SPEED);
    assert.equal(half.impulseActive, false);
    const done = runFrames(model, 0.4);
    assert.equal(done.timeScale, 1);
    assert.equal(done.level, 0);
    assert.equal(done.idle, true);
    assert.equal(model.isIdle(), true);
    assert.equal(done.clock, 0);
    assert.ok(B.BOOST_RAMP_OUT_SECONDS >= 0.55 && B.BOOST_RAMP_OUT_SECONDS <= 0.65);
});

test('AUT-047 suspended is a paused baseline (eases out, frozen seconds), resume re-enters ACTIVE through the same ramp without an impulse', () => {
    const runtime = runtimeWith(readyState());
    const model = new B.BoostPresentationModel();
    model.syncFromState(runtime.getStateSnapshot());
    activate(runtime, model);
    runFrames(model, 1);

    const state = runtime.getStateSnapshot();
    state.boosts.activeBoosts.free_overclock.isSuspended = true;
    state.boosts.activeBoosts.free_overclock.suspendedByBoostId = 'other_boost';
    const suspendEvent: DomainEvent = { type: 'temporaryBoostSuspended', boostId: 'free_overclock', suspendedByBoostId: 'other_boost', remainingSeconds: 60 };
    const paused = model.consumeEvents(state, [suspendEvent]);
    assert.deepEqual([paused?.phase, paused?.mode, paused?.impulse], ['suspended', 'suspended', false]);
    assert.equal(runFrames(model, 0.7).timeScale, 1, 'baseline visuals while suspended');
    assert.equal(model.isIdle(), true);
    const hud = createHudViewModel(repository, state).freeOverclock;
    assert.equal(hud.state, 'suspended');
    assert.equal(hud.remainingSeconds, 60, 'seconds are frozen');
    assert.equal(formatFreeOverclockState('suspended', 2), 'Free Overclock: Paused');
    assert.equal(formatFreeOverclockTimer(hud.remainingSeconds), '60s');

    state.boosts.activeBoosts.free_overclock.isSuspended = false;
    state.boosts.activeBoosts.free_overclock.suspendedByBoostId = null;
    const resumed = model.consumeEvents(state, [{ type: 'temporaryBoostResumed', boostId: 'free_overclock', remainingSeconds: 60 }]);
    assert.deepEqual([resumed?.phase, resumed?.mode, resumed?.impulse], ['resumed', 'active', false]);
    const first = model.tick(0.1);
    assert.equal(first.impulseActive, false, 'resume never replays the impulse');
    assert.ok(first.level > 0 && first.level < 1);
    assert.equal(runFrames(model, 0.5).timeScale, B.BOOST_VISUAL_SPEED);
});

test('AUT-047 sync from saved state: an active boost shows the sustained look at once with no activation impulse; the load is silent otherwise', () => {
    const state = buildAut047SeededState('active');
    const model = new B.BoostPresentationModel();
    const transition = model.syncFromState(state);
    assert.deepEqual([transition.phase, transition.source, transition.impulse, transition.mode, transition.remainingSeconds], ['synced', 'session', false, 'active', AUT047_ACTIVE_REMAINING_SECONDS]);
    const frame = model.tick(1 / 60);
    assert.equal(frame.impulseActive, false);
    assert.equal(frame.ring, 0);
    assert.equal(frame.level, 1, 'sustained look immediately (no ramp replay)');
    assert.equal(frame.timeScale, B.BOOST_VISUAL_SPEED);
    assert.equal(frame.idle, false);
    // A later "state shows active, no activation event" (e.g. offline-advanced reload) also never fires the impulse.
    const late = new B.BoostPresentationModel();
    late.syncFromState(readyState());
    const caught = late.consumeEvents(state, []);
    assert.deepEqual([caught?.phase, caught?.source, caught?.impulse], ['started', 'state', false]);
    assert.equal(late.tick(1 / 60).impulseActive, false);
    // Events before a baseline sync silently.
    const early = new B.BoostPresentationModel();
    assert.equal(early.consumeEvents(state, [activated])?.impulse, false);
    // The ready seed is a baseline.
    const ready = new B.BoostPresentationModel();
    assert.equal(ready.syncFromState(buildAut047SeededState('ready')).mode, 'inactive');
    assert.equal(ready.isIdle(), true);
});

test('AUT-047 background / reset stops at once; sustained sparks respect the 2-machine limit and low rate', () => {
    const model = new B.BoostPresentationModel();
    model.syncFromState(buildAut047SeededState('active'));
    model.tick(1 / 60);
    model.reset();
    assert.equal(model.isIdle(), true);
    const frame = model.tick(1 / 60);
    assert.equal(frame.timeScale, 1);
    assert.equal(frame.idle, true);

    // Machines: Assembly first, then Robot Line (else Fabricator), never more than 2.
    const full = readyState();
    full.run.producers.robot_line = { level: 1, isUnlocked: true, isBuilt: true };
    full.run.producers.automated_cell = { level: 1, isUnlocked: true, isBuilt: true };
    assert.deepEqual(B.selectBoostSparkMachines(full), ['assembly_station', 'robot_line']);
    assert.deepEqual(B.selectBoostSparkMachines(readyState()), ['assembly_station', 'fabricator']);
    const noAssembly = readyState();
    noAssembly.run.producers.assembly_station.isBuilt = false;
    assert.deepEqual(B.selectBoostSparkMachines(noAssembly), ['fabricator']);
    assert.ok(B.BOOST_SPARK_MACHINE_LIMIT === 2);
    assert.ok(B.selectBoostSparkMachines(full).length <= B.BOOST_SPARK_MACHINE_LIMIT);
    // Pool slots: at most 3 sparks, on machine 0 / 1 only, on the already amber (odd) AUT-040 pool nodes.
    assert.ok(B.BOOST_SPARK_SLOTS.length <= 3);
    assert.ok(B.BOOST_SPARK_SLOTS.every((slot) => slot.machine < B.BOOST_SPARK_MACHINE_LIMIT && slot.poolIndex % 2 === 1));
    assert.equal(new Set(B.BOOST_SPARK_SLOTS.map((slot) => slot.poolIndex)).size, B.BOOST_SPARK_SLOTS.length);
    assert.ok(B.BOOST_IMPULSE_SPARK_COUNT <= 3);

    // Low rate: each spark flashes for a fraction of every period, and the placement is deterministic and finite.
    const out = { intensity: 0, angle: 0, height: 0 };
    for (let slot = 0; slot < B.BOOST_SPARK_SLOTS.length; slot += 1) {
        let lit = 0;
        const samples = 1300;
        for (let index = 0; index < samples; index += 1) {
            B.sampleBoostSustainedSpark((index / samples) * 10 * B.BOOST_SPARK_PERIOD_SECONDS, slot, out);
            assert.ok(out.intensity >= 0 && out.intensity <= 1 && Number.isFinite(out.angle) && out.height > 0 && out.height < 1.2);
            if (out.intensity > 0.01) lit += 1;
        }
        assert.ok(lit / samples <= B.BOOST_SPARK_DUTY + 0.02, `slot ${slot} is lit ${lit / samples} of the time`);
        assert.ok(lit > 0);
    }
    assert.equal(B.sampleBoostSustainedSpark(3.1, 1, { intensity: 0, angle: 0, height: 0 }).angle, B.sampleBoostSustainedSpark(3.1, 1, out).angle);
    assert.equal(B.boostImpulseRing(-1), 0);
    assert.equal(B.boostImpulseRing(B.BOOST_IMPULSE_SECONDS), 0);
});

test('AUT-047 the tick writes into one reused frame (no per-frame allocation) and the shared time scale is clamped', () => {
    const model = new B.BoostPresentationModel();
    model.syncFromState(buildAut047SeededState('active'));
    assert.equal(model.tick(0.016), model.tick(0.016), 'same frame object every call');
    assert.equal(model.tick(Number.NaN).level, 1);
    S.resetPresentationTimeScale();
    assert.equal(S.getPresentationTimeScale(), 1);
    S.setPresentationTimeScale(1.3);
    assert.equal(S.getPresentationTimeScale(), 1.3);
    S.setPresentationTimeScale(5);
    assert.equal(S.getPresentationTimeScale(), S.PRESENTATION_TIME_SCALE_MAX);
    S.setPresentationTimeScale(0.2);
    assert.equal(S.getPresentationTimeScale(), 1);
    S.setPresentationTimeScale(Number.NaN);
    assert.equal(S.getPresentationTimeScale(), 1);
    S.resetPresentationTimeScale();
    assert.equal(S.PRESENTATION_TIME_SCALE_MAX, 1.4);
});

test('AUT-047 no toast: temporaryBoost* stays tier none and the milestone view model stays silent', () => {
    for (const event of [activated, expired, { type: 'temporaryBoostSuspended', boostId: 'free_overclock', suspendedByBoostId: 'x', remainingSeconds: 10 }, { type: 'temporaryBoostResumed', boostId: 'free_overclock', remainingSeconds: 10 }] as DomainEvent[]) {
        assert.equal(classifyMilestoneEvent(event).tier, 'none', event.type);
    }
    const milestone = new MilestonePresentationViewModel();
    const state = readyState();
    milestone.syncFromState(state);
    const update = milestone.consumeEvents(state, [activated, expired]);
    assert.deepEqual(update.accepted, []);
    assert.equal(update.outcome?.started?.length ?? 0, 0);
});

test('AUT-047 HUD mapping: active = amber-filled pill with the existing x2 / seconds texts, suspended = amber outline + paused, others = no pill', () => {
    const runtime = runtimeWith(readyState());
    const states: Record<string, ReturnType<typeof createHudViewModel>> = { ready: createHudViewModel(repository, runtime.getStateSnapshot()) };
    runtime.execute({ type: 'activateFreeOverclock' });
    runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 14.2 });
    states.active = createHudViewModel(repository, runtime.getStateSnapshot());
    assert.equal(states.active.freeOverclock.state, 'active');
    assert.equal(formatFreeOverclockState('active', states.active.freeOverclock.multiplier), 'Free Overclock: ×2');
    assert.equal(formatFreeOverclockTimer(states.active.freeOverclock.remainingSeconds), '46s', 'seconds countdown reuses hud.free_overclock.timer');
    runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 60 });
    states.cooldown = createHudViewModel(repository, runtime.getStateSnapshot());

    const active = P.resolveBoostHudPill('active');
    assert.deepEqual([active.visible, active.key, active.outline], [true, 'active', null]);
    assert.deepEqual(active.fill, P.BOOST_HUD_AMBER);
    assert.notDeepEqual(active.text, P.BOOST_HUD_DEFAULT_TEXT, 'dark text on the amber fill');
    const paused = P.resolveBoostHudPill('suspended');
    assert.deepEqual([paused.visible, paused.key, paused.fill], [true, 'suspended', null]);
    assert.ok(paused.outline && paused.outline.a < 255 && paused.outline.r === P.BOOST_HUD_AMBER.r, 'amber outline, dimmed');
    for (const state of ['locked', 'cooldown'] as const) {
        const style = P.resolveBoostHudPill(state);
        assert.deepEqual([style.visible, style.key, style.fill, style.outline], [false, 'none', null, null], `${state}: existing HUD only, no amber`);
        assert.deepEqual(style.text, P.BOOST_HUD_DEFAULT_TEXT);
    }
    const readyPill = P.resolveBoostHudPill('ready');
    assert.deepEqual([readyPill.visible, readyPill.key, readyPill.fill], [true, 'ready', null], 'AUT-UI-003: ready = outline only, fill stays reserved for active');
    assert.deepEqual(readyPill.outline, P.BOOST_HUD_AMBER);
    assert.equal(states.cooldown.freeOverclock.state, 'cooldown');
    assert.equal(P.resolveBoostHudPill(states.cooldown.freeOverclock.state).visible, false);
    assert.equal(P.resolveBoostHudPill(states.ready.freeOverclock.state).key, 'ready');
});

test('AUT-047 effects stay inside the zone footprint: the activation ring reuses the AUT-046 outline layout on the Assembly zone', () => {
    const rect = producerFootprint('assembly_station');
    assert.ok(rect, 'the Assembly zone footprint exists');
    for (const bar of milestoneRingBars(rect!)) {
        assert.ok(bar.x - bar.sizeX / 2 >= rect!.x - rect!.width / 2 - 1e-9 && bar.x + bar.sizeX / 2 <= rect!.x + rect!.width / 2 + 1e-9);
        assert.ok(bar.z - bar.sizeZ / 2 >= rect!.z - rect!.depth / 2 - 1e-9 && bar.z + bar.sizeZ / 2 <= rect!.z + rect!.depth / 2 + 1e-9);
    }
});

test('AUT-047 controller / bootstrap / loop-controller wiring is pinned', () => {
    const controller = code('BoostPresentationController.ts');
    assert.match(controller, /@ccclass\('BoostPresentationController'\)/);
    assert.match(controller, /new BoostPresentationModel\(\)/);
    assert.match(controller, /setPresentationTimeScale\(frame\.timeScale\)/);
    assert.match(controller, /emitDeviceEvent\('boost_presentation'/);
    assert.match(controller, /if \(!this\.running\) return;/, 'zero cost while inactive');
    assert.doesNotMatch(controller, /\.active\s*=/, 'scale-based visibility only');
    assert.doesNotMatch(controller, /\bnew (Vec3|Color)\b/, 'no per-frame allocation');
    assert.doesNotMatch(controller, /commandEmitter|GameCommand|submit\(|state\.[a-zA-Z.]+\s*=[^=]/, 'never writes state or submits commands');
    assert.doesNotMatch(controller, /MobileCameraController|focusOnRevealTarget|shake|flash/i, 'no camera focus, shake or flash');
    assert.doesNotMatch(controller, /Sprite\b/, 'Graphics / box primitives only (a spriteFrame-less Sprite renders nothing on Android)');
    assert.doesNotMatch(controller, /_FocusAnchor/, 'anchors come from the bootstrap zone resolver');
    for (const file of ['BoostPresentation.ts', 'BoostHudPill.ts', 'PresentationTimeScale.ts']) {
        const source = code(file);
        assert.doesNotMatch(source, /from\s+['"]c{2}['"]/, `${file} is engine-free`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|protected|readonly)\s/, `${file}: no constructor parameter properties`);
        assert.match(source, /from '\.\/[A-Za-z]+\.ts'|^export /m, `${file} uses explicit .ts imports`);
    }
    assert.doesNotMatch(code('BoostPresentationController.ts'), /constructor\s*\(/);

    const bootstrap = code('FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /this\.createBoostPresentation\(site\);/);
    assert.match(bootstrap, /presentation\.boostPresentation = controller;/);
    assert.match(bootstrap, /producerZoneName\(producerId\)[\s\S]{0,200}`\$\{zone\}_FocusAnchor`/, 'zone-based anchor lookup (Zone_X/X_FocusAnchor)');
    assert.match(bootstrap, /BoostPulse_amber/);
    assert.match(bootstrap, /boostPresentation\?\.onBackground\(\)/);
    assert.match(bootstrap, /boostPresentation\?\.resume\(resumedState\)/);
    const registry = code('PresentationController.ts');
    assert.match(registry, /this\.boostPresentation\?\.sync\(/);
    assert.match(registry, /this\.boostPresentation\?\.consumeDomainEvents\(state, events\)/);

    // The animated work-loop controllers read the shared time scale (presentation clocks only).
    for (const file of ['AssemblyVisualController.ts', 'FirstAutomationPresentationController.ts', 'RobotLineVisualController.ts', 'AutomatedCellVisualController.ts', 'AdvancedRoboticsComplexVisualController.ts', 'FirstRobotPresentationController.ts', 'RobotPopulationController.ts']) {
        assert.match(code(file), /getPresentationTimeScale\(\)/, `${file} honours the presentation time scale`);
    }
    // The simulation never reads it.
    for (const dir of ['runtime', 'economy', 'progression', 'state', 'simulation', 'offline', 'persistence', 'domain']) {
        for (const file of ['GameRuntime.ts', 'TemporaryBoosts.ts']) void file;
        assert.doesNotMatch(read(`assets/scripts/${dir}/index.ts`), /PresentationTimeScale/);
    }
    // Robot clips follow the scale (speed), the Worker Bot loop only (never the reveal beat).
    assert.match(code('FirstRobotPresentationController.ts'), /this\.player\.mode === 'loop' \? getPresentationTimeScale\(\) : 1/);
    assert.match(code('RobotPopulationController.ts'), /state\.speed = this\.clipSpeed/);

    const hud = code('CoreHudController.ts');
    assert.match(hud, /resolveBoostHudPill\(state\)/);
    assert.match(hud, /FreeOverclockPill/);
    assert.match(hud, /if \(style\.key === this\.pillKey\) return;/, 'the pill redraws only when the style changes');
    assert.doesNotMatch(hud, /'FreeOverclockPill'[\s\S]{0,200}addComponent\(Sprite\)/);

    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('boost_presentation'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('boost_presentation'));
    for (const phase of ['synced', 'started', 'ended', 'suspended', 'resumed', 'effect_applied']) assert.match(`${controller}${code('BoostPresentation.ts')}`, new RegExp(`'${phase}'`), `${phase} is declared and used`);
    assert.match(controller, /anchorResolved/);
    assert.match(controller, /plateWorldPos/);
    assert.match(controller, /sparkWorldPos/);
    assert.match(controller, /timeScale: frame\.timeScale/);

    // Metas: unique a0470000 uuids for every new script.
    const uuids = new Set<string>();
    for (const file of ['BoostPresentation', 'BoostHudPill', 'PresentationTimeScale', 'BoostPresentationController']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${file}.ts.meta`));
        assert.match(meta.uuid, /^a0470000-0000-4000-8000-0000000000(0[1-9])$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 4);
});

test('AUT-047 device seed, command, scenario and event timeline', () => {
    assert.deepEqual([...AUT047_SEED_VARIANTS], ['active', 'ready']);
    assert.equal(isAut047SeedVariant('active'), true);
    assert.equal(isAut047SeedVariant('x'), false);
    const active = buildAut047SeededState('active');
    assert.equal(createHudViewModel(repository, active).freeOverclock.state, 'active');
    const ready = buildAut047SeededState('ready');
    assert.equal(createHudViewModel(repository, ready).freeOverclock.state, 'ready');
    for (const state of [active, ready]) {
        assert.equal(state.run.producers.assembly_station.isBuilt, true);
        assert.equal(state.run.producers.fabricator.isBuilt, true);
        assert.ok(state.run.purchasedBreakthroughIds.includes('worker_bot'));
    }
    // Round-trips through the save; the loaded boost is still active.
    const save = buildAut047SeededSave('active', Date.UTC(2026, 10, 13, 12, 0, 0));
    const loaded = deserializeGameStateFromSaveJson(save, repository.contentVersion);
    assert.equal(loaded.state.boosts.activeBoosts.free_overclock.remainingSeconds, AUT047_ACTIVE_REMAINING_SECONDS);
    assert.equal(B.resolveBoostSnapshot(loaded.state).mode, 'active');

    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['device:seed-aut047'], /tools\/device\/cli\.ts seed-aut047$/);
    assert.match(pkg.scripts['device:seed-aut046'], /seed-aut046$/, 'the AUT-046 seed command is untouched');
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut047'/);
    assert.match(cli, /seed-aut047 \[--variant active\|ready\]/);
    assert.match(cli, /aut046\|aut047\|ui003\|aut048\|aut048-era3\|aut048-era3-live\|aut049\|aut049-post\|aut051\|aut051-reload\|aut051-short\]/);

    const scenario = REVEAL_SCENARIOS.aut047;
    assert.deepEqual([scenario.id, scenario.label, scenario.expectConstruction, scenario.expectFocus, scenario.trigger], ['aut047', 'aut047-overclock', null, false, 'none']);
    assert.ok(scenario.durationMs! > AUT047_ACTIVE_REMAINING_SECONDS * 1000, 'the capture outlasts the seeded countdown (expiry ease-out is observed)');
    const event = (tMs: number, evt: string, extra: Record<string, unknown>): TimelineEvent => ({ tMs, event: { v: 1, seq: tMs, evt, ...extra } as TimelineEvent['event'] });
    const timeline = [event(100, 'boost_presentation', { phase: 'synced', mode: 'active' }), event(400, 'boost_presentation', { phase: 'effect_applied', timeScale: 1.3, anchorResolved: true }), event(22000, 'boost_presentation', { phase: 'ended' }), event(22700, 'boost_presentation', { phase: 'settled' })];
    const options = { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 20, expectBoostPhases: scenario.expectBoostPhases };
    assert.ok(evaluateRevealTimeline(timeline, options).every((check) => check.ok));
    assert.equal(evaluateRevealTimeline(timeline.slice(0, 2), options).filter((check) => !check.ok).map((check) => check.id).join(), 'boost_ended,boost_settled');
});
