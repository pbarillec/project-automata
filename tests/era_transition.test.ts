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
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { computeUiLayout, rectsOverlap, rectContains } from '../assets/scripts/presentation/UiLayout.ts';
import * as E from '../assets/scripts/presentation/EraTransition.ts';
import * as Q from '../assets/scripts/presentation/MilestoneToastQueue.ts';
import * as X from '../assets/scripts/presentation/MilestoneToastText.ts';
import * as L from '../assets/scripts/presentation/MilestoneToastLayout.ts';
import * as T from '../assets/scripts/presentation/MilestoneTier.ts';
import { MilestonePresentationViewModel } from '../assets/scripts/presentation/MilestonePresentationViewModel.ts';
import { EraEnvironmentViewModel } from '../assets/scripts/presentation/EraEnvironmentViewModel.ts';
import { ERA_ENV_CYAN } from '../assets/scripts/presentation/EraEnvironmentLayout.ts';
import * as D from '../assets/scripts/presentation/DebugCommandFile.ts';
import { AUT048_LIVE_COMMAND_DELAY_MS, AUT048_SEED_VARIANTS, buildAut048LiveCommandFile, buildAut048SeededSave, buildAut048SeededState, isAut048SeedVariant, seedAut048, seedAut048Era3Live } from '../tools/device/seed_aut048.ts';
import { ROBOT_LINE_CONSTRUCTION_COST } from '../tools/device/seed_aut042.ts';
import { ARC_CONSTRUCTION_COST } from '../tools/device/seed_aut044.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateEraTransition, evaluateRevealTimeline, type TimelineEvent } from '../tools/device/reveal_capture.ts';

/*
 * AUT-048 era transition presentation: title card tier (timing / layout / text), ordering offsets, subsumption, replay / dedupe in
 * both orders, silent load, Reboot cancel, focus gating, no-state / no-command pins, wiring and the device seed / capture tooling.
 * The AUT-045 environment is not re-implemented; no new asset; no economy / runtime change.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const presentation = (file: string): string => read(`assets/scripts/presentation/${file}`);
const code = (file: string): string => presentation(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

const eraEvent = (newEraId: string, oldEraId: string | null = 'manual_workshop'): DomainEvent => ({ type: 'eraChanged', oldEraId, newEraId });
const constructedEvent = (producerId: string, source: 'producer_purchase' | 'breakthrough' = 'producer_purchase', breakthroughId?: string): DomainEvent => ({ type: 'producerConstructed', producerId, level: 1, source, ...(breakthroughId ? { breakthroughId } : {}) });
const breakthroughEvent = (breakthroughId: string): DomainEvent => ({ type: 'breakthroughPurchased', breakthroughId, cost: 1 });
const automationEvent = (producerId: string): DomainEvent => ({ type: 'automationStateChanged', producerId, isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null });
const rebootEvent = (): DomainEvent => ({ type: 'rebootCompleted', oldCivilization: 1, newCivilization: 2, aiCoresGranted: 1, prestigePower: 1 });

const workshop = (): GameState => buildAut048SeededState('era2');
const era2State = (): GameState => {
    const state = buildAut048SeededState('era2');
    state.run.currentEraId = 'automated_factory';
    state.run.producers.robot_line = { level: 1, isUnlocked: true, isBuilt: true };
    state.run.automation.robot_line = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
    return state;
};
const era3State = (): GameState => {
    const state = buildAut048SeededState('era3');
    state.run.currentEraId = 'robotics_complex';
    state.run.purchasedBreakthroughIds.push('advanced_robotics');
    state.run.producers.advanced_robotics_complex = { level: 1, isUnlocked: true, isBuilt: true };
    return state;
};

/** Ticks the view model for `seconds` (16 ms steps) and returns the titles that started / finished and their start time. */
function run(viewModel: MilestonePresentationViewModel, seconds: number): { started: Array<{ key: string; at: number }>; finished: Array<{ key: string; at: number; elapsed: number }>; frames: number } {
    const started: Array<{ key: string; at: number }> = [];
    const finished: Array<{ key: string; at: number; elapsed: number }> = [];
    let frames = 0;
    for (let t = 0; t < seconds; t += 0.016) {
        const tick = viewModel.tick(0.016);
        for (const item of tick.started) started.push({ key: item.trigger.key, at: t });
        for (const item of tick.finished) finished.push({ key: item.trigger.key, at: t, elapsed: item.elapsed });
        if (tick.frame) frames += 1;
    }
    return { started, finished, frames };
}

// ---------------------------------------------------------------------------------------------------------------
// Tier / timing / layout / text

test('AUT-048 tier: the era title is a new Exceptional toast tier with 0.3 s in / 2.2 s hold / 0.5 s out = 3.0 s hard cap and an underline wipe', () => {
    assert.deepEqual(Q.MILESTONE_TOAST_TIMING.exceptional, { fadeIn: 0.3, hold: 2.2, fadeOut: 0.5 });
    assert.ok(Math.abs(Q.milestoneToastDuration('exceptional') - 3.0) < 1e-9);
    assert.deepEqual(Q.MILESTONE_TOAST_TIMING.major, { fadeIn: 0.25, hold: 1.9, fadeOut: 0.35 }, 'Major untouched');
    const at = (t: number) => Q.sampleMilestoneToast('exceptional', t);
    assert.deepEqual([at(0).phase, at(0).alpha], ['in', 0]);
    assert.ok(Math.abs(at(0.15).alpha - 0.5) < 1e-9);
    assert.deepEqual([at(0.3).phase, at(0.3).alpha, at(2.49).phase, at(2.49).alpha], ['hold', 1, 'hold', 1]);
    assert.deepEqual([at(2.75).phase, Math.round(at(2.75).alpha * 100) / 100], ['out', 0.5]);
    assert.equal(at(2.999).complete, false);
    assert.deepEqual([at(3.0).complete, at(3.0).alpha, at(60).complete], [true, 0, true], 'hard cap: nothing is ever visible after 3.0 s');
    assert.equal(at(0.3).wipe, 0);
    assert.ok(Math.abs(at(0.6).wipe - 0.5) < 1e-9, 'the underline wipes across 0.6 s after the fade-in');
    assert.equal(at(1.0).wipe, 1);
    assert.equal(Q.sampleMilestoneToast('minor', 1).wipe, 0, 'Minor never wipes');
});

test('AUT-048 layout: larger than Major, one all-caps line, no subtitle, in the AUT-046 band below the HUD and never over Next Goal / buttons / panel', () => {
    const card = L.MILESTONE_TOAST_LAYOUT.exceptional;
    assert.ok(card.width > L.MILESTONE_TOAST_LAYOUT.major.width && card.height > L.MILESTONE_TOAST_LAYOUT.major.height);
    assert.deepEqual([card.width, card.height], [680, 112], '~680x112 design units');
    assert.ok(card.width <= 720, 'inside the 720 design width');
    assert.equal(card.subtitleFontSize, 0, 'no subtitle');
    assert.ok(card.titleFontSize >= 24, 'fonts >= 24');
    assert.equal(L.milestoneToastFontsReadable(), true);
    assert.ok(card.underlineCenterY - card.underlineHeight / 2 >= -card.height, 'underline inside the pill');
    assert.ok(card.titleCenterY - card.titleLineHeight / 2 >= card.underlineCenterY + card.underlineHeight / 2 - 1, 'title above the underline');
    for (const screen of [{ w: 720, h: 1280 }, { w: 1080, h: 1920 }, { w: 1080, h: 2412 }, { w: 1080, h: 2340 }, { w: 1440, h: 3120 }]) {
        const ui = computeUiLayout(screen);
        const rect = L.computeMilestoneToastRect(screen, undefined, 'exceptional');
        const label = `${screen.w}x${screen.h}`;
        assert.equal(rectsOverlap(rect, ui.hud), false, `${label}: never over the HUD / Next Goal`);
        assert.equal(rectsOverlap(rect, ui.panel), false, `${label}: not over the panel`);
        assert.equal(rectsOverlap(rect, ui.hudButtons.NextGoalAction), false);
        assert.equal(rectsOverlap(rect, ui.hudButtons.ManualProduceAction), false);
        for (const button of Object.values(ui.buttons)) assert.equal(rectsOverlap(rect, button), false);
        assert.equal(rectContains(ui.safeArea, rect), true);
        assert.equal(L.milestoneToastFitsFactoryBand(screen, undefined, 'exceptional'), true, `${label}: inside the factory band`);
    }
});

test('AUT-048 text and accent per era: all-caps single line, Era II amber, Era III environment cyan never brighter than the lamps; no Era IV / teaser text', () => {
    assert.deepEqual(Object.keys(E.ERA_TRANSITION_SPECS), ['automated_factory', 'robotics_complex'], 'Era I has no card, Era IV does not exist');
    const two = E.buildEraTrigger('automated_factory')!;
    const three = E.buildEraTrigger('robotics_complex')!;
    assert.deepEqual(X.formatMilestoneToast(two, repository), { title: 'AUTOMATED FACTORY', subtitle: null });
    assert.deepEqual(X.formatMilestoneToast(three, repository), { title: 'ROBOTICS COMPLEX ONLINE', subtitle: null });
    for (const spec of Object.values(E.ERA_TRANSITION_SPECS)) assert.equal(spec.title, spec.title.toUpperCase());
    assert.deepEqual([two.accent, three.accent], ['amber', 'cyan']);
    assert.deepEqual([two.tier, two.kind, two.key, three.key], ['exceptional', 'era_title', 'e:automated_factory', 'e:robotics_complex']);
    assert.deepEqual([two.pulse, two.sparks, three.pulse, three.sparks], [false, false, false, false], 'no new light / spark effect');
    const cyan = L.MILESTONE_TOAST_COLORS.eraUnderline.cyan;
    assert.deepEqual([cyan.r, cyan.g, cyan.b], [ERA_ENV_CYAN.r, ERA_ENV_CYAN.g, ERA_ENV_CYAN.b], 'AUT-045 environment cyan (59,112,121)');
    assert.ok(cyan.r <= 82 && cyan.g <= 206 && cyan.b <= 224, 'never brighter than the lamps 82,206,224');
    const amber = L.MILESTONE_TOAST_COLORS.eraUnderline.amber;
    assert.ok(amber.r > amber.b && amber.g > amber.b, 'amber');
    for (const rgb of [cyan, amber]) assert.ok(!(rgb.r > rgb.g * 1.5 && rgb.r > rgb.b * 1.5 && rgb.g < 80), 'red is never used');
    assert.equal(E.buildEraTrigger('manual_workshop'), null);
    assert.equal(E.buildEraTrigger('ai_megafactory'), null);
    assert.equal(E.buildEraTrigger(null), null);
    assert.doesNotMatch(code('EraTransition.ts') + code('MilestoneToastText.ts'), /megafactory|era_iv|era iv/i, 'the teaser stays sealed and unlabelled');
});

// ---------------------------------------------------------------------------------------------------------------
// Queue: pre-emption

test('AUT-048 queue: the card pre-empts every visible and waiting Minor / Major; Minors are dropped while it shows; a Major waits behind it', () => {
    const queue = new Q.MilestoneToastQueue();
    const major = T.classifyMilestoneEvent(breakthroughEvent('worker_bot')).trigger!;
    const minor = T.classifyMilestoneEvent(automationEvent('assembly_station')).trigger!;
    queue.enqueueBurst([major]);
    queue.enqueueBurst([{ ...major, key: 'b:other' }]);
    assert.equal(queue.getWaiting().length, 1);
    const outcome = queue.enqueueBurst([E.buildEraTrigger('automated_factory')!]);
    assert.deepEqual(outcome.started.map((i) => i.trigger.key), ['e:automated_factory']);
    assert.deepEqual(outcome.dropped.map((d) => [d.key, d.reason]), [['b:worker_bot', 'preempted'], ['b:other', 'preempted']]);
    assert.equal(queue.getWaiting().length, 0);
    assert.equal(queue.enqueueBurst([minor]).dropped[0].reason, 'exceptional_active');
    const waits = queue.enqueueBurst([{ ...major, key: 'b:late' }]);
    assert.deepEqual(waits.queued, ['b:late'], 'a Major arriving during the card waits (it is not subsumed: another batch)');
    // Minor visible, then the card.
    const second = new Q.MilestoneToastQueue();
    second.enqueueBurst([minor]);
    assert.deepEqual(second.enqueueBurst([E.buildEraTrigger('robotics_complex')!]).dropped.map((d) => d.reason), ['preempted']);
    assert.equal(second.getActive()?.trigger.kind, 'era_title');
});

// ---------------------------------------------------------------------------------------------------------------
// View model: ordering offsets on the shared clock, subsumption

test('AUT-048 offsets: t0 = eraChanged observed; Era II card at t0 + 0.6 s, Era III card at t0 + 0.4 s; the environment fade starts at t0 and never waits for the card', () => {
    assert.deepEqual([E.ERA_TRANSITION_SPECS.automated_factory.cardDelaySeconds, E.ERA_TRANSITION_SPECS.robotics_complex.cardDelaySeconds], [0.6, 0.4]);
    for (const [eraId, delay, state] of [['automated_factory', 0.6, era2State()], ['robotics_complex', 0.4, era3State()]] as const) {
        const viewModel = new MilestonePresentationViewModel();
        viewModel.syncFromState(workshop());
        const update = viewModel.consumeEvents(state, [eraEvent(eraId)]);
        assert.equal(update.eraScheduled?.eraId, eraId);
        assert.equal(update.outcome, null, 'nothing is offered to the queue before the card delay');
        assert.equal(viewModel.getFrame(), null, 'the card never shows at t0');
        assert.equal(viewModel.getPendingEra()?.eraId, eraId);
        const result = run(viewModel, 4);
        assert.equal(result.started.length, 1);
        assert.ok(Math.abs(result.started[0].at - delay) <= 0.02, `${eraId}: card starts at ${delay} s (got ${result.started[0].at})`);
        assert.equal(result.finished.length, 1);
        assert.ok(result.finished[0].elapsed >= 3.0 && result.finished[0].elapsed <= 3.02, `hard cap 3.0 s (got ${result.finished[0].elapsed})`);
        assert.equal(viewModel.getFrame(), null);
        assert.equal(viewModel.getPendingEra(), null);
    }
    // The AUT-045 environment (a separate view model) starts its fade at the same observation, with no dependency on the card.
    const env = new EraEnvironmentViewModel();
    env.syncFromState(workshop());
    const snapshot = env.consumeEvents(era2State(), [eraEvent('automated_factory')]);
    assert.equal(snapshot.transitionStarted, true, 'the fade starts at t0');
    assert.equal(new MilestonePresentationViewModel().getPendingEra(), null);
    assert.doesNotMatch(code('MilestonePresentationViewModel.ts') + code('EraTransition.ts'), /EraEnvironment/, 'the card never waits for the fade and vice versa (no coupling)');
});

test('AUT-048 subsumption: same-batch Major / Minor toasts (Robot Line built, Advanced Robotics, automation chips) become subsumed so ONE card shows', () => {
    const one = new MilestonePresentationViewModel();
    one.syncFromState(workshop());
    const update = one.consumeEvents(era2State(), [constructedEvent('robot_line'), automationEvent('robot_line'), eraEvent('automated_factory')]);
    assert.deepEqual(update.accepted, []);
    assert.deepEqual(update.skipped.map((s) => [s.key, s.reason]), [['c:robot_line', 'subsumed'], ['a:robot_line', 'subsumed']]);
    assert.equal(update.eraScheduled?.key, 'e:automated_factory');
    const shown = run(one, 4);
    assert.deepEqual(shown.started.map((s) => s.key), ['e:automated_factory'], 'only the card ever shows');

    const two = new MilestonePresentationViewModel();
    two.syncFromState(era2State());
    const burst = two.consumeEvents(era3State(), [breakthroughEvent('advanced_robotics'), constructedEvent('advanced_robotics_complex', 'breakthrough', 'advanced_robotics'), eraEvent('robotics_complex', 'automated_factory')]);
    assert.deepEqual(burst.accepted, []);
    assert.deepEqual(burst.skipped.map((s) => [s.key, s.reason]), [['c:advanced_robotics_complex', 'subsumed'], ['b:advanced_robotics', 'subsumed']]);
    assert.deepEqual(run(two, 4).started.map((s) => s.key), ['e:robotics_complex']);

    // A later, separate batch still toasts normally (nothing global is suppressed).
    const later = two.consumeEvents(era3State(), [{ type: 'robotsBuiltThresholdReached', threshold: 1000, previousAmount: 999, newAmount: 1000 }]);
    assert.equal(later.accepted.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Replay / dedupe in both orders, silent load, workshop -> III, Reboot

test('AUT-048 replay: snapshot-before-event and event-before-snapshot each show the card exactly once', () => {
    const snapshotFirst = new MilestonePresentationViewModel();
    snapshotFirst.syncFromState(workshop());
    const discovered = snapshotFirst.syncFromState(era2State());
    assert.equal(discovered.eraScheduled?.key, 'e:automated_factory', 'a later snapshot reveals the era change');
    const replayed = snapshotFirst.consumeEvents(era2State(), [constructedEvent('robot_line'), eraEvent('automated_factory')]);
    assert.equal(replayed.eraScheduled, null);
    assert.ok(replayed.skipped.some((s) => s.key === 'e:automated_factory' && s.reason === 'duplicate'));
    assert.deepEqual(run(snapshotFirst, 5).started.map((s) => s.key), ['e:automated_factory']);

    const eventFirst = new MilestonePresentationViewModel();
    eventFirst.syncFromState(workshop());
    assert.equal(eventFirst.consumeEvents(era2State(), [eraEvent('automated_factory')]).eraScheduled?.key, 'e:automated_factory');
    const late = eventFirst.syncFromState(era2State());
    assert.equal(late.eraScheduled, null, 'the late snapshot never double-fires');
    assert.equal(eventFirst.consumeEvents(era2State(), [eraEvent('automated_factory')]).eraScheduled, null, 'the same event again never double-fires');
    assert.deepEqual(run(eventFirst, 5).started.map((s) => s.key), ['e:automated_factory']);
});

test('AUT-048 replay safety: replayEra shows the card again from the era id alone and never touches GameState or the save', () => {
    const state = era2State();
    const before = JSON.stringify(state);
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(state);
    assert.equal(run(viewModel, 2).started.length, 0, 'load is silent');
    const update = viewModel.replayEra('automated_factory');
    assert.equal(update.eraScheduled?.key, 'e:automated_factory');
    assert.deepEqual(run(viewModel, 4).started.map((s) => s.key), ['e:automated_factory']);
    assert.equal(viewModel.replayEra('manual_workshop').eraScheduled, null, 'no card for Era I');
    assert.equal(new MilestonePresentationViewModel().replayEra('automated_factory').eraScheduled, null, 'no replay before the load baseline');
    assert.equal(JSON.stringify(state), before, 'the state is untouched');
    const controller = code('MilestonePresentationController.ts');
    assert.match(controller, /public replayEraTransition\(eraId: string\)/);
    assert.doesNotMatch(controller + code('EraTransition.ts') + code('MilestonePresentationViewModel.ts'), /save|Storage|persist|writeFile|localStorage/i, 'a replay never writes the save');
});

test('AUT-048 silent load: the first sync of an Era II / Era III save shows no card; events before the baseline never present', () => {
    for (const state of [era2State(), era3State()]) {
        const viewModel = new MilestonePresentationViewModel();
        const first = viewModel.syncFromState(state);
        assert.deepEqual([first.eraScheduled, first.outcome, first.accepted.length], [null, null, 0]);
        assert.equal(run(viewModel, 4).frames, 0);
        assert.equal(viewModel.syncFromState(state).eraScheduled, null, 'a repeated snapshot is silent');
        assert.equal(viewModel.consumeEvents(state, [eraEvent(state.run.currentEraId!)]).eraScheduled, null, 'a replayed event for the loaded era is a duplicate');
    }
    const early = new MilestonePresentationViewModel();
    assert.equal(early.consumeEvents(era2State(), [eraEvent('automated_factory')]).eraScheduled, null);
    assert.equal(run(early, 2).frames, 0);
});

test('AUT-048 Workshop to Era III skip shows ONE card (Era III), by event and by snapshot', () => {
    const byEvent = new MilestonePresentationViewModel();
    byEvent.syncFromState(workshop());
    const update = byEvent.consumeEvents(era3State(), [eraEvent('robotics_complex', 'manual_workshop')]);
    assert.equal(update.eraScheduled?.eraId, 'robotics_complex');
    const shown = run(byEvent, 5);
    assert.deepEqual(shown.started.map((s) => s.key), ['e:robotics_complex']);
    assert.equal(byEvent.syncFromState(era3State()).eraScheduled, null);

    const bySnapshot = new MilestonePresentationViewModel();
    bySnapshot.syncFromState(workshop());
    assert.equal(bySnapshot.syncFromState(era3State()).eraScheduled?.eraId, 'robotics_complex');
    assert.deepEqual(run(bySnapshot, 5).started.map((s) => s.key), ['e:robotics_complex']);

    // II then III: the era key of the previous era vanishing from the snapshot is NOT a Reboot.
    const progressive = new MilestonePresentationViewModel();
    progressive.syncFromState(era2State());
    const next = progressive.syncFromState(era3State());
    assert.deepEqual([next.rebooted, next.eraScheduled?.eraId], [false, 'robotics_complex']);
});

test('AUT-048 Reboot: cancels a pending or visible card, re-baselines silently, shows no card back in the Workshop and lets the eras present again', () => {
    for (const via of ['event', 'snapshot'] as const) {
        for (const stage of ['pending', 'visible'] as const) {
            const viewModel = new MilestonePresentationViewModel();
            viewModel.syncFromState(workshop());
            viewModel.consumeEvents(era2State(), [eraEvent('automated_factory')]);
            if (stage === 'visible') {
                run(viewModel, 1.0);
                assert.equal(viewModel.getFrame()?.item.trigger.kind, 'era_title');
            }
            const fresh = createFreshGameState();
            const update = via === 'event' ? viewModel.consumeEvents(fresh, [rebootEvent()]) : viewModel.syncFromState(fresh);
            assert.equal(update.rebooted, true, `${via}/${stage}`);
            assert.equal(update.eraCancelled, true, `${via}/${stage}: the card in flight is cancelled`);
            assert.equal(update.eraScheduled, null, 'no card on return to Workshop');
            // AUT-049: a Reboot EVENT now presents its own reboot_title card (never an era card); a snapshot return to Workshop shows nothing.
            assert.equal(viewModel.getFrame()?.item.trigger.kind ?? null, via === 'event' ? 'reboot_title' : null);
            assert.equal(viewModel.getPendingEra(), null);
            const after = run(viewModel, 4.2);
            assert.deepEqual(after.finished.map((f) => f.key), via === 'event' ? ['x:2'] : [], 'no era card ever shows after the cancel');
            assert.equal(after.started.length, 0);
            // Era fact keys were cleared: the next run's Era II presents again.
            assert.equal(viewModel.consumeEvents(era2State(), [eraEvent('automated_factory')]).eraScheduled?.key, 'e:automated_factory');
        }
    }
    const idle = new MilestonePresentationViewModel();
    idle.syncFromState(workshop());
    assert.equal(idle.consumeEvents(createFreshGameState(), [rebootEvent()]).eraCancelled, false, 'nothing to cancel');
    const cc = code('MilestonePresentationController.ts');
    assert.match(cc, /update\.eraCancelled/);
    assert.match(cc, /'cancelled'/);
});

// ---------------------------------------------------------------------------------------------------------------
// Real runtime

test('AUT-048 real GameRuntime: building the Robot Line yields one Era II card; progression and state are untouched by the presentation', () => {
    const runtime = new GameRuntime(repository, buildAut048SeededState('era2'));
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(runtime.getStateSnapshot());
    const result = runtime.execute({ type: 'buyProducerLevels', producerId: 'robot_line', quantity: 1 });
    assert.equal(result.ok, true);
    assert.ok(result.events.some((e) => e.type === 'eraChanged'));
    const state = runtime.getStateSnapshot();
    const before = JSON.stringify(state);
    const update = viewModel.consumeEvents(state, result.events);
    assert.equal(update.eraScheduled?.key, 'e:automated_factory');
    assert.deepEqual(update.accepted, [], 'the construction / automation toasts of the batch are subsumed');
    assert.deepEqual(run(viewModel, 4).started.map((s) => s.key), ['e:automated_factory']);
    assert.equal(viewModel.consumeEvents(state, result.events).eraScheduled, null, 'the same events delivered again never double-fire');
    assert.equal(JSON.stringify(runtime.getStateSnapshot()), before, 'presentation never alters the state');
    assert.equal(state.run.currentEraId, 'automated_factory');
});

// ---------------------------------------------------------------------------------------------------------------
// Focus gating

test('AUT-048 focus: Era II skips while construction / any camera focus is active, else the Robot Line; Era III skips within 2.5 world units, never the teaser', () => {
    const base2 = { eraId: 'automated_factory', cameraFocus: { x: -2.5, z: 0 }, target: { x: 3.5, z: -1.2 }, constructionActive: false, cameraFocusActive: false };
    assert.deepEqual(E.resolveEraFocus(base2), { focus: true, reason: 'requested' });
    assert.equal(E.resolveEraFocus({ ...base2, constructionActive: true }).reason, 'reveal_active', 'construction owns the camera');
    assert.equal(E.resolveEraFocus({ ...base2, cameraFocusActive: true }).reason, 'camera_busy');
    assert.equal(E.resolveEraFocus({ ...base2, cameraFocus: null }).reason, 'no_camera');
    assert.equal(E.resolveEraFocus({ ...base2, target: null }).reason, 'no_target');
    const base3 = { eraId: 'robotics_complex', cameraFocus: { x: -2.5, z: 0 }, target: { x: 9, z: 4 }, constructionActive: false, cameraFocusActive: false };
    assert.deepEqual(E.resolveEraFocus(base3), { focus: true, reason: 'requested' });
    assert.equal(E.resolveEraFocus({ ...base3, cameraFocus: { x: 9, z: 4 } }).reason, 'on_centre');
    assert.equal(E.resolveEraFocus({ ...base3, cameraFocus: { x: 9 - 2.49, z: 4 } }).reason, 'on_centre');
    assert.equal(E.resolveEraFocus({ ...base3, cameraFocus: { x: 9 - 2.5, z: 4 } }).focus, true, '2.5 units away is off-centre');
    assert.equal(E.resolveEraFocus({ ...base3, constructionActive: true }).focus, true, 'Era III is gated by the on-centre rule only');
    assert.equal(E.resolveEraFocus({ ...base2, eraId: 'manual_workshop' }).reason, 'no_era');
    assert.equal(E.ERA_TRANSITION_SPECS.automated_factory.focusProducerId, 'robot_line');
    assert.equal(E.ERA_TRANSITION_SPECS.robotics_complex.focusProducerId, 'advanced_robotics_complex', 'the Robotics Complex, never the teaser');
    assert.equal(E.ERA_TRANSITION_SPECS.automated_factory.focusRule, 'construction_gated');
    assert.equal(E.ERA_TRANSITION_SPECS.robotics_complex.focusRule, 'on_centre');
    // Era focus wins over a Major-milestone focus: the era batch's Majors are subsumed (no second focus) and the era focus is independent of them.
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(era2State());
    const update = viewModel.consumeEvents(era3State(), [breakthroughEvent('advanced_robotics'), eraEvent('robotics_complex', 'automated_factory')]);
    assert.deepEqual(update.accepted.filter((t) => t.focusProducerId !== null), [], 'no Major focus competes with the era focus');
});

// ---------------------------------------------------------------------------------------------------------------
// Controller / wiring pins

test('AUT-048 controller and wiring: thin cc wrapper on the AUT-046 band, no state / command / save, scale-based visibility, existing camera API, DEBUG events', () => {
    const controller = code('MilestonePresentationController.ts');
    assert.match(controller, /resolveEraFocus\(/);
    assert.match(controller, /camera\.focusOnRevealTarget\(anchor\.worldPosition\)/, 'the existing reveal focus API only');
    assert.doesNotMatch(controller, /focusOnWorldTarget|snapToWorldTarget|applyConfiguredInitialView|setFocusBounds/);
    assert.doesNotMatch(controller, /\.on\(\s*(Node\.EventType|Input)|input\.on|TOUCH_|swallowTouch|Button|BlockInputEvents/, 'inert: no touch listener (touch / pan cancel the focus in the camera, no re-snap)');
    assert.doesNotMatch(controller, /commandEmitter|submit\(|execute\(|state\.run\.\w+\s*=[^=]|\.node\.active|\.active\s*=/, 'no state write, no command, no node.active');
    assert.match(controller, /setScale\(0, 0, 0\)/);
    assert.doesNotMatch(controller, /addComponent\(Sprite\)|Tween|tween\(|screenFlash|shake|vignette|letterbox|Light\b|ParticleSystem|instantiate\(/, 'no tint / flash / shake / vignette / letterbox / light / particle / new object');
    for (const phase of ['synced', 'scheduled', 'title_started', 'title_applied', 'title_finished', 'focus_requested', 'focus_skipped', 'cancelled']) assert.match(controller, new RegExp(`'${phase}'`), `era_transition ${phase}`);
    assert.match(controller, /for \(const item of tick\.started\) this\.onToastStarted\(item\)/, 'tick path (card offered when the delay elapsed)');
    assert.match(controller, /for \(const item of update\.outcome\?\.started \?\? \[\]\) this\.onToastStarted\(item\)/, 'offer path');
    assert.match(controller, /kind === 'era_title'/);
    const registry = presentation('PresentationController.ts');
    assert.ok(registry.indexOf('this.eraEnvironmentVisual?.consumeDomainEvents') < registry.indexOf('this.milestonePresentation?.consumeDomainEvents'), 'the environment observes the era change first; the card runs on the shared clock');
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('era_transition'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('era_transition'));
    assert.match(presentation('DeviceDiagnostics.ts'), /AUT-048: era transition/);
    for (const file of ['EraTransition', 'MilestoneTier', 'MilestoneToastQueue', 'MilestoneToastText', 'MilestoneToastLayout', 'MilestonePresentationViewModel']) {
        assert.doesNotMatch(presentation(`${file}.ts`), /from '\x63c'/, `${file} is engine-free`);
        assert.doesNotMatch(code(`${file}.ts`), /constructor\s*\(\s*(public|private|protected|readonly)\s/, `${file}: no constructor parameter properties`);
        assert.doesNotMatch(code(`${file}.ts`), /GameCommand|commandEmitter/, `${file} submits no command`);
    }
    assert.doesNotMatch(code('EraTransition.ts'), /^import .*'\.\/(?!MilestoneFeedback|MilestoneTier)/m, 'EraTransition imports only the milestone modules');
    const meta = JSON.parse(presentation('EraTransition.ts.meta'));
    assert.equal(meta.importer, 'typescript');
    assert.match(meta.uuid, /^a0480000-0000-4000-8000-\d{12}$/);
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    assert.equal((bootstrap.match(/addComponent\(MilestonePresentationController\)/g) ?? []).length, 1, 'the existing band / controller is reused: no parallel UI');
    assert.doesNotMatch(bootstrap, /EraTitle|EraTransitionController/);
    assert.doesNotMatch(read('assets/scenes/factory/FactoryWorld.scene'), /EraTransition|EraTitle/, 'no scene churn');
});

test('AUT-048 per-frame budget: no work outside the 3 s window (no pending era and no card means an empty tick)', () => {
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(era2State());
    const tick = viewModel.tick(0.016);
    assert.deepEqual([tick.frame, tick.finished.length, tick.started.length, tick.eraOffer], [null, 0, 0, null]);
});

// ---------------------------------------------------------------------------------------------------------------
// Device tooling

test('AUT-048 seed: era2 is the AUT-042 one-step-before state, era3 the natural-era one-step-before state; both round-trip through the save and load silently', () => {
    assert.deepEqual([...AUT048_SEED_VARIANTS], ['era2', 'era3']);
    assert.equal(isAut048SeedVariant('era2'), true);
    assert.equal(isAut048SeedVariant('era4'), false);
    const two = buildAut048SeededState('era2');
    assert.deepEqual([two.run.currentEraId, two.run.producers.robot_line.isBuilt, two.run.producers.robot_line.level], ['manual_workshop', false, 0]);
    assert.ok(two.run.industrialOutput >= ROBOT_LINE_CONSTRUCTION_COST);
    const three = buildAut048SeededState('era3');
    assert.deepEqual([three.run.currentEraId, three.run.producers.advanced_robotics_complex.isBuilt, three.run.purchasedBreakthroughIds.includes('advanced_robotics')], ['automated_factory', false, false]);
    assert.ok(three.run.industrialOutput >= ARC_CONSTRUCTION_COST);
    for (const variant of AUT048_SEED_VARIANTS) {
        const loaded = deserializeGameStateFromSaveJson(buildAut048SeededSave(variant, Date.now()));
        assert.deepEqual(loaded.diagnostics, [], `${variant} loads`);
        const viewModel = new MilestonePresentationViewModel();
        assert.equal(viewModel.syncFromState(loaded.state).eraScheduled, null, `${variant}: loading the seed is silent`);
    }
    // One step: the era II seed's Robot Line purchase leads to the card; the era III seed's breakthrough does through the runtime.
    const runtime = new GameRuntime(repository, buildAut048SeededState('era3'));
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(runtime.getStateSnapshot());
    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' });
    assert.equal(result.ok, true);
    const update = viewModel.consumeEvents(runtime.getStateSnapshot(), result.events);
    assert.equal(update.eraScheduled?.key, 'e:robotics_complex');
    assert.deepEqual(update.accepted, []);
});

test('AUT-048 device tooling: npm script, cli usage, scenarios, capture checks (card started / finished / focus / silent load)', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['device:seed-aut048'], /tools\/device\/cli\.ts seed-aut048$/);
    assert.match(pkg.scripts['device:seed-aut047'], /seed-aut047$/, 'earlier seed commands untouched');
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut048'/);
    assert.match(cli, /seed-aut048 \[--variant era2\|era3\]/);
    assert.match(cli, /aut048\|aut048-era3\|aut048-era3-live\|aut049\|aut049-post\|aut051\|aut051-reload\|aut051-short\]/);
    assert.match(cli, /robot-line-build/);
    assert.match(cli, /expectEraTitle: scenario\.expectEraTitle/);
    const two = REVEAL_SCENARIOS.aut048;
    assert.deepEqual([two.id, two.trigger, two.expectConstruction, two.expectEraTitle], ['aut048', 'robot-line-build', 'robot_line', 'automated_factory']);
    const three = REVEAL_SCENARIOS['aut048-era3'];
    assert.deepEqual([three.trigger, three.expectEraTitle], ['none', 'none'], 'no existing tap path triggers Era III: the capture proves the silent load only');
    const capture = read('tools/device/reveal_capture.ts');
    assert.doesNotMatch(capture, /DEBUG trigger|debugTrigger|replayEraTransition/, 'no DEBUG trigger or HUD action added');

    const ev = (tMs: number, fields: Record<string, unknown>): TimelineEvent => ({ tMs, event: { evt: 'era_transition', ...fields } as TimelineEvent['event'] });
    const good: TimelineEvent[] = [
        ev(-3000, { phase: 'synced', eraId: 'manual_workshop' }),
        { tMs: 50, event: { evt: 'era_environment_state', phase: 'transition_started', eraId: 'automated_factory' } as TimelineEvent['event'] },
        ev(700, { phase: 'title_started', eraId: 'automated_factory', title: 'AUTOMATED FACTORY' }),
        ev(700, { phase: 'focus_skipped', eraId: 'automated_factory', reason: 'reveal_active' }),
        ev(3800, { phase: 'title_finished', eraId: 'automated_factory', elapsedSeconds: 3.0 }),
    ];
    assert.ok(evaluateEraTransition(good, 'automated_factory').every((c) => c.ok), JSON.stringify(evaluateEraTransition(good, 'automated_factory').filter((c) => !c.ok)));
    const failed = (events: TimelineEvent[], expect: string) => evaluateEraTransition(events, expect).filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failed(good.filter((e) => e.event.phase !== 'title_started'), 'automated_factory').includes('era_title_started'), true);
    assert.deepEqual(failed(good.map((e) => (e.event.phase === 'title_started' ? { ...e, event: { ...e.event, eraId: 'robotics_complex' } } : e)), 'automated_factory').includes('era_title_started'), true, 'wrong era');
    assert.ok(failed(good.map((e) => (e.event.phase === 'title_finished' ? { ...e, event: { ...e.event, elapsedSeconds: 4.2 } } : e)), 'automated_factory').includes('era_title_finished'), 'finished within ~3.5 s');
    assert.ok(failed(good.filter((e) => !String(e.event.phase).startsWith('focus_')), 'automated_factory').includes('era_focus_decision'));
    assert.ok(failed([ev(-500, { phase: 'title_started', eraId: 'automated_factory' }), ...good], 'automated_factory').includes('era_no_title_before_trigger'), 'a title on load / before the trigger fails');
    assert.deepEqual(failed([ev(-3000, { phase: 'synced' })], 'none'), []);
    assert.deepEqual(failed([ev(-3000, { phase: 'synced' }), ev(100, { phase: 'title_started', eraId: 'robotics_complex' })], 'none'), ['era_no_title_on_load']);
    const timeline = evaluateRevealTimeline(good, { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 10, expectEraTitle: 'automated_factory' });
    assert.ok(timeline.some((c) => c.id === 'era_title_started'), 'wired into the timeline evaluation');
    assert.equal(evaluateRevealTimeline(good, { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 10 }).some((c) => c.id.startsWith('era_')), false, 'other scenarios are unaffected');
});

// ---------------------------------------------------------------------------------------------------------------
// DEBUG-only Era III capture trigger (debug_command.json)

test('AUT-048 DEBUG command file: allow-listed purchaseBreakthrough only, bounded delay, anything else ignored', () => {
    assert.equal(D.DEBUG_COMMAND_FILE, 'debug_command.json');
    assert.deepEqual(D.parseDebugCommandFile(buildAut048LiveCommandFile()), { command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' }, delayMs: AUT048_LIVE_COMMAND_DELAY_MS });
    assert.equal(D.parseDebugCommandFile(undefined), null);
    assert.equal(D.parseDebugCommandFile('not json'), null);
    for (const bad of [
        { command: { type: 'rebootCivilization' } },
        { command: { type: 'manualProduce' } },
        { command: { type: 'purchaseBreakthrough', breakthroughId: '../x' } },
        { command: { type: 'purchaseBreakthrough' } },
        { command: 'purchaseBreakthrough' },
        [],
        null,
    ]) assert.equal(D.parseDebugCommandFile(JSON.stringify(bad)), null, JSON.stringify(bad));
    assert.equal(D.parseDebugCommandFile(JSON.stringify({ command: { type: 'purchaseBreakthrough', breakthroughId: 'a' }, delayMs: 999999 }))?.delayMs, D.DEBUG_COMMAND_MAX_DELAY_MS);
    assert.equal(D.parseDebugCommandFile(JSON.stringify({ command: { type: 'purchaseBreakthrough', breakthroughId: 'a' }, delayMs: -5 }))?.delayMs, 0);
    assert.doesNotMatch(code('DebugCommandFile.ts'), /from '\x63c|GameCommand|commandEmitter/, 'pure parser, no engine, no command submission');
    const meta = JSON.parse(presentation('DebugCommandFile.ts.meta'));
    assert.match(meta.uuid, /^a0480000-0000-4000-8000-\d{12}$/);
    assert.notEqual(meta.uuid, JSON.parse(presentation('EraTransition.ts.meta')).uuid);
});

test('AUT-048 DEBUG command guard: read once after ready, only when DEBUG and diagnostics are on, through the normal submit path; no HUD / UiLayout / scene change', () => {
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    const body = bootstrap.slice(bootstrap.indexOf('private runDebugCommandFile('), bootstrap.indexOf('private onGameHide('));
    assert.match(body, /if \(DEBUG !== true \|\| !isDeviceDiagnosticsEnabled\(\)\) return;/, 'DEBUG guard first');
    assert.ok(body.indexOf('port.readText(DEBUG_COMMAND_FILE)') < body.indexOf('port.remove(DEBUG_COMMAND_FILE)'), 'read, then deleted: fires once');
    assert.ok(body.indexOf('port.remove(DEBUG_COMMAND_FILE)') < body.indexOf('parseDebugCommandFile(text)'), 'deleted even when the content is rejected');
    assert.match(body, /binding\.submit\(request\.command\)/, 'the normal command path');
    assert.doesNotMatch(body, /state\.run|runtime|execute\(|\.save|writeText/, 'no state write, no direct runtime call, no save write');
    assert.match(bootstrap, /import \{ DEBUG \} from 'cc\/env';/);
    const activate = bootstrap.slice(bootstrap.indexOf('private activateSessionBinding('), bootstrap.indexOf('private runDebugCommandFile('));
    assert.match(activate, /this\.runDebugCommandFile\(binding\);/, 'after binding.init() and the emitters exist (session ready)');
    assert.ok(activate.indexOf('binding.init()') < activate.indexOf('this.runDebugCommandFile(binding)'));
    assert.ok(activate.indexOf('wiring.hud.commandEmitter') < activate.indexOf('this.runDebugCommandFile(binding)'));
    assert.equal((bootstrap.match(/DEBUG_COMMAND_FILE/g) ?? []).length, 3, 'import + the one guarded reader (read, remove)');
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('debug_command'));
    for (const file of ['UiLayout.ts', 'CoreHudController.ts', 'CoreLoopActions.ts', 'HudViewModel.ts', 'ProducerPanelController.ts']) {
        assert.doesNotMatch(presentation(file), /debug_command|DebugCommand|DEBUG_COMMAND/, `${file}: no player-facing path`);
    }
    assert.doesNotMatch(read('assets/scenes/factory/FactoryWorld.scene'), /debug_command|DebugCommand/);
    for (const file of ['MilestonePresentationController.ts', 'PresentationController.ts', 'RobotPopulationController.ts', 'EraTransition.ts']) assert.doesNotMatch(presentation(file), /DEBUG_COMMAND_FILE/);
});

test('AUT-048 live Era III capture: seed writes save + debug command (stale one removed first), scenario expects command_result, one ROBOTICS COMPLEX ONLINE card, finish <= 3.5 s, focus decision, fade', async () => {
    const calls: string[] = [];
    const written: Record<string, string> = {};
    const driver = {
        forceStop: async () => { calls.push('forceStop'); },
        appDataDirectory: async () => '/data/data/pkg',
        removeAppFiles: async (_pkg: string, paths: string[]) => { calls.push(`remove:${paths.map((p) => p.split('/').pop()).join(',')}`); },
        writeAppFile: async (_pkg: string, file: string, text: string) => { calls.push(`write:${file.split('/').pop()}`); written[file.split('/').pop()!] = text; },
        launch: async () => { calls.push('launch'); },
    };
    await seedAut048Era3Live(driver as never, 'pkg', 'act');
    assert.deepEqual(calls, ['forceStop', 'remove:save_main.json,save_backup.json,save_temp.json,debug_command.json', 'write:save_main.json', 'write:debug_command.json', 'launch'], 'command file is written before the launch, after the save');
    assert.equal(written['debug_command.json'], buildAut048LiveCommandFile());
    const plain: string[] = [];
    await seedAut048({ ...driver, removeAppFiles: async (_pkg: string, paths: string[]) => { plain.push(...paths.map((p) => p.split('/').pop()!)); } } as never, 'pkg', 'act', 'era3');
    assert.ok(plain.includes('debug_command.json'), 'a plain seed removes a stale debug command');
    const live = REVEAL_SCENARIOS['aut048-era3-live'];
    assert.deepEqual([live.trigger, live.expectEraTitle, live.expectCommands, live.expectConstruction], ['none', 'robotics_complex', ['purchaseBreakthrough'], null]);
    assert.ok((live.durationMs ?? 0) >= AUT048_LIVE_COMMAND_DELAY_MS + 6000, 'the capture outlasts delay + card + 3.0 s');
    const ev = (tMs: number, evt: string, fields: Record<string, unknown>): TimelineEvent => ({ tMs, event: { evt, ...fields } as TimelineEvent['event'] });
    const good: TimelineEvent[] = [
        ev(100, 'era_transition', { phase: 'synced', eraId: 'automated_factory' }),
        ev(6000, 'command_result', { ok: true, command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' } }),
        ev(6050, 'era_environment_state', { phase: 'transition_started', eraId: 'robotics_complex' }),
        ev(6450, 'era_transition', { phase: 'title_started', eraId: 'robotics_complex', title: 'ROBOTICS COMPLEX ONLINE' }),
        ev(6450, 'era_transition', { phase: 'focus_skipped', eraId: 'robotics_complex', reason: 'on_centre' }),
        ev(9450, 'era_transition', { phase: 'title_finished', eraId: 'robotics_complex', elapsedSeconds: 3.0 }),
    ];
    const options = { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 20, expectEraTitle: live.expectEraTitle, expectCommands: live.expectCommands };
    const checks = evaluateRevealTimeline(good, options);
    assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
    assert.ok(checks.some((c) => c.id === 'command_purchaseBreakthrough_ok'));
    const noCommand = evaluateRevealTimeline(good.filter((e) => e.event.evt !== 'command_result'), options);
    assert.ok(noCommand.some((c) => !c.ok && c.id === 'command_purchaseBreakthrough_ok'));
    const doubled = evaluateRevealTimeline([...good, ev(7000, 'era_transition', { phase: 'title_started', eraId: 'robotics_complex' })], options);
    assert.ok(doubled.some((c) => !c.ok && c.id === 'era_title_only_for_expected_era'), 'exactly one card');
});
