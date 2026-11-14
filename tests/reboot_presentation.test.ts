import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFreshGameState, type GameState } from '../assets/scripts/state/index.ts';
import type { DomainEvent } from '../assets/scripts/domain/Events.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { InMemorySaveStorage, SAVE_MAIN_NAME, SAVE_TEMP_NAME } from '../assets/scripts/persistence/index.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { computeUiLayout, rectsOverlap, rectContains } from '../assets/scripts/presentation/UiLayout.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { ZONE_LAYOUT } from '../assets/scripts/presentation/FactoryZoneLayout.ts';
import * as R from '../assets/scripts/presentation/RebootPresentation.ts';
import * as Q from '../assets/scripts/presentation/MilestoneToastQueue.ts';
import * as X from '../assets/scripts/presentation/MilestoneToastText.ts';
import * as L from '../assets/scripts/presentation/MilestoneToastLayout.ts';
import * as T from '../assets/scripts/presentation/MilestoneTier.ts';
import { MilestonePresentationViewModel } from '../assets/scripts/presentation/MilestonePresentationViewModel.ts';
import * as D from '../assets/scripts/presentation/DebugCommandFile.ts';
import { ERA_ENV_CYAN } from '../assets/scripts/presentation/EraEnvironmentLayout.ts';
import { AUT049_LIVE_COMMAND_DELAY_MS, AUT049_SEED_VARIANTS, buildAut049LiveCommandFile, buildAut049SeededSave, buildAut049SeededState, isAut049SeedVariant, seedAut049 } from '../tools/device/seed_aut049.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateRebootPresentation, evaluateRevealTimeline, type TimelineEvent } from '../tools/device/reveal_capture.ts';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { createRebootPreview } from '../assets/scripts/progression/index.ts';
import { createOfflineProgressPreviewFromUtc } from '../assets/scripts/offline/index.ts';

/*
 * AUT-049 Reboot presentation: the 4.0 s post-commit sequence (resolver phases / timing cap), silent load, no start on persistence failure,
 * dedupe, tier / subsumption of the `reboot_title` card, layout, the persistent socket rule, the DEBUG command allow-list and the tooling.
 * Presentation only: no economy / runtime / data / save change; the AI Core is a placeholder (no asset).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const presentation = (file: string): string => read(`assets/scripts/presentation/${file}`);
const code = (file: string): string => presentation(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

const rebootEvent = (newCivilization = 2, aiCoresGranted = 5): DomainEvent => ({ type: 'rebootCompleted', oldCivilization: newCivilization - 1, newCivilization, aiCoresGranted, prestigePower: 1 });
const civilizationEvent = (): DomainEvent => ({ type: 'civilizationChanged', oldCivilization: 1, newCivilization: 2, reason: 'reboot' });
const coresEvent = (): DomainEvent => ({ type: 'aiCoresGranted', amount: 5, previousAiCores: 0, newAiCores: 5, source: 'reboot' });
const milestoneEvent = (): DomainEvent => ({ type: 'producerMilestoneReached', producerId: 'fabricator', milestoneId: 'm', threshold: 25 } as DomainEvent);
const eraEvent = (): DomainEvent => ({ type: 'eraChanged', oldEraId: 'manual_workshop', newEraId: 'automated_factory' });

const before = (): GameState => buildAut049SeededState('reboot');
const after = (): GameState => buildAut049SeededState('post');

function runCard(viewModel: MilestonePresentationViewModel, seconds: number, dt = 0.016): { alphas: number[]; beats: Array<string | null>; finishedAt: number | null; finishedElapsed: number | null; frames: number } {
    const alphas: number[] = [];
    const beats: Array<string | null> = [];
    let finishedAt: number | null = null;
    let finishedElapsed: number | null = null;
    let frames = 0;
    for (let t = 0; t < seconds; t += dt) {
        const tick = viewModel.tick(dt);
        if (tick.finished.some((i) => i.trigger.kind === 'reboot_title')) { finishedAt = t; finishedElapsed = tick.finished[0].elapsed; }
        if (tick.frame) { frames += 1; alphas.push(tick.frame.sample.alpha); beats.push(tick.frame.sample.beat ?? null); }
    }
    return { alphas, beats, finishedAt, finishedElapsed, frames };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolver: phases and the 4.0 s hard cap

test('AUT-049 timeline: A scan 0-1.2, B silence 1.2-1.7, C AI Core 1.7-3.2, D civilization 3.2-4.0, nothing after 4.0 s', () => {
    assert.equal(R.REBOOT_SEQUENCE_SECONDS, 4.0);
    assert.deepEqual([R.REBOOT_TIMELINE.scanEnd, R.REBOOT_TIMELINE.silenceEnd, R.REBOOT_TIMELINE.coreEnd, R.REBOOT_TIMELINE.civilizationEnd], [1.2, 1.7, 3.2, 4.0]);
    const cases: Array<[number, R.RebootPhase]> = [[0, 'scan'], [1.19, 'scan'], [1.2, 'silence'], [1.69, 'silence'], [1.7, 'core'], [3.19, 'core'], [3.2, 'civilization'], [3.99, 'civilization'], [4.0, 'complete'], [60, 'complete'], [-1, 'scan']];
    for (const [t, phase] of cases) assert.equal(R.rebootPhaseAt(t), phase, `t=${t}`);
});

test('AUT-049 title card timeline: REBOOT in A, invisible silence in B, AI CORE in C, CIVILIZATION in D, alpha 0 and complete exactly at 4.0 s', () => {
    const at = (t: number) => R.sampleRebootToast(t);
    assert.deepEqual([at(0).beat, at(0).alpha], ['reboot', 0], 'fades in from 0');
    assert.equal(at(0.6).beat, 'reboot');
    assert.equal(at(0.6).alpha, 1);
    assert.ok(at(1.1).alpha > 0 && at(1.1).alpha < 1, 'fading out before the silence');
    for (const t of [1.2, 1.4, 1.69]) assert.deepEqual([at(t).beat, at(t).alpha], [null, 0], `silence t=${t}`);
    assert.equal(at(1.7).beat, 'ai_core');
    assert.equal(at(2.5).alpha, 1);
    assert.equal(at(3.19).beat, 'ai_core');
    assert.equal(at(3.19).alpha, 1, 'C -> D is a hard text cut, no gap');
    assert.deepEqual([at(3.2).beat, at(3.2).alpha], ['civilization', 1]);
    assert.ok(at(3.9).alpha > 0 && at(3.9).alpha < 1, 'D fades out at the end');
    assert.deepEqual([at(4.0).alpha, at(4.0).complete, at(4.0).beat], [0, true, null]);
    assert.equal(at(3.999).complete, false);
    assert.equal(at(99).complete, true);
    for (let t = 0; t < 4.0; t += 0.01) assert.ok(at(t).alpha >= 0 && at(t).alpha <= 1 && at(t).wipe >= 0 && at(t).wipe <= 1);
    assert.equal(at(0.2).wipe, 0, 'the wipe starts when the fade-in ends');
    assert.equal(at(0.9).wipe, 1);
    assert.equal(at(3.2).wipe, 0, 'the CIVILIZATION line wipes again from its own start');
    assert.deepEqual(R.sampleRebootToast(-5), R.sampleRebootToast(0));
});

test('AUT-049 world timeline: the ring only in A, nothing in B, socket + Core from C, nothing after the cap', () => {
    const at = (t: number) => R.sampleRebootWorld(t);
    assert.deepEqual([at(0).scanVisible, at(0.6).scanVisible, at(1.19).scanVisible], [true, true, true]);
    assert.ok(at(0).scanProgress < at(0.6).scanProgress && at(0.6).scanProgress < at(1.19).scanProgress, 'the ring grows');
    assert.deepEqual([at(0.6).socketVisible, at(0.6).coreSize], [false, 0], 'no socket / Core before C');
    for (const t of [1.2, 1.5, 1.69]) {
        const s = at(t);
        assert.deepEqual([s.phase, s.scanVisible, s.socketVisible, s.coreSize], ['silence', false, false, 0], `B is silent t=${t}`);
    }
    assert.equal(at(1.7).socketVisible, true);
    assert.equal(at(1.7).coreSize, 0, 'the Core grows in from nothing');
    assert.ok(at(2.0).coreSize >= R.REBOOT_CORE_PEAK_SIZE - 1e-9, 'peak by 0.3 s into C');
    assert.equal(at(3.19).coreSize, R.REBOOT_CORE_PEAK_SIZE);
    assert.ok(at(3.9).coreSize < R.REBOOT_CORE_PEAK_SIZE && at(3.9).coreSize > R.REBOOT_CORE_PERSISTENT_SIZE, 'D settles to the persistent size');
    for (const t of [4.0, 4.5, 100]) assert.deepEqual(at(t), { phase: 'complete', complete: true, scanVisible: false, scanProgress: 0, socketVisible: false, coreSize: 0 });
    assert.ok(R.REBOOT_CORE_PERSISTENT_SIZE < R.REBOOT_CORE_PEAK_SIZE / 2, 'persistent marker is subtle');
});

test('AUT-049 scan ring: 4 thin opaque outline bars that grow and stay inside the site', () => {
    const first = R.scanRingBars(0);
    const last = R.scanRingBars(1);
    assert.equal(first.length, 4);
    assert.ok(last[0].sizeX > first[0].sizeX);
    for (const bar of [...first, ...last]) assert.ok(Math.min(bar.sizeX, bar.sizeZ) <= R.REBOOT_SCAN.thickness + 1e-9, 'thin');
    for (const bar of last) {
        assert.ok(Math.abs(bar.x) + bar.sizeX / 2 <= 10 + 1e-9 && Math.abs(bar.z - 1) + bar.sizeZ / 2 <= 8 + 1e-9, 'inside the 20 x 16 site boundary');
    }
    assert.equal(R.socketRingBars().length, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// Model: silent on load, only the event starts, dedupe, cap

test('AUT-049 model: silent on load (sync, first event batch), the persistent socket follows the snapshot, nothing starts', () => {
    const model = new R.RebootPresentationModel();
    const sync = model.syncFromState(after());
    assert.deepEqual([sync.started, sync.duplicate, sync.socketPersistent], [null, false, true]);
    assert.equal(model.isRunning(), false);
    assert.deepEqual([model.tick(0.016).running, model.tick(10).running], [false, false]);
    // A load of a Civilization #1 save without Cores shows no socket.
    assert.equal(new R.RebootPresentationModel().syncFromState(before()).socketPersistent, false);
    // A rebootCompleted before the baseline exists is the baseline (never presented).
    const early = new R.RebootPresentationModel();
    const update = early.consumeEvents(after(), [rebootEvent()]);
    assert.equal(update.started, null);
    assert.equal(early.isRunning(), false);
    assert.equal(early.isInitialised, true);
});

test('AUT-049 model: started ONLY by rebootCompleted; the pre-commit events of a failed save never start it', () => {
    const model = new R.RebootPresentationModel();
    model.syncFromState(before());
    // reboot_persistence_failed: the coordinator returns aiCoresGranted + civilizationChanged WITHOUT rebootCompleted.
    const failed = model.consumeEvents(after(), [coresEvent(), civilizationEvent()]);
    assert.equal(failed.started, null);
    assert.equal(model.isRunning(), false);
    assert.equal(failed.socketPersistent, true, 'the state changed, so the static marker follows the snapshot');
    const unrelated = model.consumeEvents(after(), [milestoneEvent(), eraEvent()]);
    assert.equal(unrelated.started, null);
    const saved = model.consumeEvents(after(), [coresEvent(), civilizationEvent(), rebootEvent()]);
    assert.deepEqual(saved.started, { key: 'x:2', newCivilization: 2, aiCoresGranted: 5 });
    assert.equal(model.isRunning(), true);
});

test('AUT-049 model: one sequence per x:<newCivilization>, hard-capped at 4.0 s even with a frame hitch, idle afterwards', () => {
    const model = new R.RebootPresentationModel();
    model.syncFromState(before());
    model.consumeEvents(after(), [rebootEvent()]);
    const duplicate = model.consumeEvents(after(), [rebootEvent()]);
    assert.deepEqual([duplicate.started, duplicate.duplicate], [null, true], 'the same key never restarts');
    const phases: string[] = [];
    let finished = 0;
    let frames = 0;
    let last = model.tick(0.016);
    for (let t = 0; t < 6; t += 0.016) {
        last = model.tick(0.016);
        if (last.running) frames += 1;
        if (last.phaseChanged) phases.push(last.phaseChanged);
        if (last.finished) { finished += 1; assert.equal(last.elapsed, 4.0); }
        if (last.running) assert.ok(last.elapsed <= 4.0);
    }
    assert.deepEqual(phases, ['silence', 'core', 'civilization', 'complete']);
    assert.equal(finished, 1);
    assert.ok(frames <= Math.ceil(4.0 / 0.016) + 1, 'no frame of the sequence past 4.0 s');
    assert.deepEqual([last.running, last.phase, last.scanVisible, last.socketVisible, last.coreSize], [false, 'idle', false, true, R.REBOOT_CORE_PERSISTENT_SIZE], 'afterwards: the static persistent socket');
    const hitch = new R.RebootPresentationModel();
    hitch.syncFromState(before());
    hitch.consumeEvents(after(), [rebootEvent(3)]);
    const jump = hitch.tick(30);
    assert.deepEqual([jump.finished, jump.elapsed, jump.running], [true, 4.0, false], 'a 30 s hitch ends the sequence at the cap');
    assert.equal(hitch.tick(0.016).finished, false, 'finishes once');
    const restart = new R.RebootPresentationModel();
    restart.syncFromState(before());
    restart.consumeEvents(after(), [rebootEvent(2)]);
    assert.equal(restart.consumeEvents(after(), [rebootEvent(3)]).started?.key, 'x:3', 'a different civilization is a new sequence');
});

test('AUT-049 persistent socket visibility rule: aiCores > 0 or civilization >= 2', () => {
    assert.equal(R.shouldShowRelaySocket(0, 1), false, 'a fresh Civilization #1 shows nothing');
    assert.equal(R.shouldShowRelaySocket(1, 1), true);
    assert.equal(R.shouldShowRelaySocket(0, 2), true, 'Cores spent, still past #1');
    assert.equal(R.shouldShowRelaySocket(7, 3), true);
    assert.equal(R.shouldShowRelaySocket(Number.NaN, Number.NaN), false);
    assert.equal(R.shouldShowRelaySocket(-1, 1), false);
    const fresh = createFreshGameState();
    assert.equal(R.shouldShowRelaySocket(fresh.meta.aiCores, fresh.meta.civilizationNumber), false);
    // The model decides from the snapshot, and never invents a socket for a #1 run.
    const model = new R.RebootPresentationModel();
    model.syncFromState(fresh);
    assert.equal(model.tick(0.016).socketVisible, false);
    model.consumeEvents(after(), [civilizationEvent()]);
    assert.equal(model.tick(0.016).socketVisible, true);
    assert.equal(model.tick(0.016).coreSize, R.REBOOT_CORE_PERSISTENT_SIZE);
});

test('AUT-049 socket geometry: clear of every zone, the Workshop foundation, the spine and the site edge; primitives only', () => {
    const { x, z, base } = R.REBOOT_SOCKET;
    const rect = { x0: x - base.sizeX / 2, x1: x + base.sizeX / 2, z0: z - base.sizeZ / 2, z1: z + base.sizeZ / 2 };
    const overlaps = (a: { x0: number; x1: number; z0: number; z1: number }, b: { x0: number; x1: number; z0: number; z1: number }) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
    for (const [name, zone] of Object.entries(ZONE_LAYOUT)) {
        assert.equal(overlaps(rect, { x0: zone.x - zone.width / 2, x1: zone.x + zone.width / 2, z0: zone.z - zone.depth / 2, z1: zone.z + zone.depth / 2 }), false, `not on ${name}`);
    }
    assert.equal(overlaps(rect, { x0: -5.2 - 3, x1: -5.2 + 3, z0: -2.7 - 2.4, z1: -2.7 + 2.4 }), false, 'not on the OpeningWorkshopFoundation');
    assert.equal(overlaps(rect, { x0: 0.2 - 6.5, x1: 0.2 + 6.5, z0: -0.3 - 0.35, z1: -0.3 + 0.35 }), false, 'not on the MainLogisticsSpine');
    assert.ok(rect.x0 >= -10 && rect.x1 <= 10 && rect.z0 >= -7 && rect.z1 <= 9, 'inside the 20 x 16 site boundary');
    assert.ok(R.rebootCoreCenterY(R.REBOOT_CORE_PEAK_SIZE) > R.rebootCoreCenterY(R.REBOOT_CORE_PERSISTENT_SIZE), 'the Core rests on the pedestal and grows upward');
    assert.ok(R.rebootCoreCenterY(0) >= R.REBOOT_SOCKET.pedestal.y + R.REBOOT_SOCKET.pedestal.sizeY / 2);
    const colors = R.REBOOT_SOCKET.colors;
    assert.deepEqual([colors.ring.r, colors.ring.g, colors.ring.b], [ERA_ENV_CYAN.r, ERA_ENV_CYAN.g, ERA_ENV_CYAN.b], 'socket outline = AUT-045 environment cyan');
    for (const rgb of Object.values(colors)) assert.ok(!(rgb.r > rgb.g * 1.5 && rgb.r > rgb.b * 1.5), 'red is never used');
});

test('AUT-049 camera: one reveal focus, skipped on-centre / while a focus is active / without camera or target', () => {
    const base = { cameraFocus: { x: -2.5, z: 0 }, target: { x: -6, z: -2.85 }, cameraFocusActive: false };
    assert.deepEqual(R.resolveRebootFocus(base), { focus: true, reason: 'requested' });
    assert.equal(R.resolveRebootFocus({ ...base, target: { x: -2.5, z: 1 } }).reason, 'on_centre');
    assert.equal(R.resolveRebootFocus({ ...base, cameraFocusActive: true }).reason, 'camera_busy');
    assert.equal(R.resolveRebootFocus({ ...base, cameraFocus: null }).reason, 'no_camera');
    assert.equal(R.resolveRebootFocus({ ...base, target: null }).reason, 'no_target');
    assert.equal(R.REBOOT_FOCUS_PRODUCER_ID, 'fabricator');
});

// ---------------------------------------------------------------------------------------------------------------
// reboot_title toast kind: trigger, text, tier / subsumption, dedupe, timing, layout

test('AUT-049 trigger: dedicated Exceptional reboot_title kind, key x:<newCivilization>, cyan, no pulse / spark / toast focus', () => {
    const trigger = R.buildRebootTrigger(rebootEvent(4, 12) as Extract<DomainEvent, { type: 'rebootCompleted' }>);
    assert.deepEqual([trigger.tier, trigger.kind, trigger.key, trigger.accent], ['exceptional', 'reboot_title', 'x:4', 'cyan']);
    assert.deepEqual([trigger.pulse, trigger.sparks, trigger.focusProducerId, trigger.producerId, trigger.eraId], [false, false, null, null, null]);
    assert.deepEqual(trigger.reboot, { newCivilization: 4, aiCoresGranted: 12 });
    assert.equal(R.rebootFactKey(7), 'x:7');
    assert.equal(T.MILESTONE_EVENT_TIERS.rebootCompleted, 'exceptional');
    assert.equal(T.classifyMilestoneEvent(rebootEvent()).trigger, null, 'built by the Reboot module, not the generic classifier');
});

test('AUT-049 text: REBOOT, AI CORE x N, CIVILIZATION #N (all caps, one line, no subtitle, no +N)', () => {
    const trigger = R.buildRebootTrigger(rebootEvent(3, 12) as Extract<DomainEvent, { type: 'rebootCompleted' }>);
    assert.equal(X.formatRebootBeat(trigger, 'reboot'), 'REBOOT');
    assert.equal(X.formatRebootBeat(trigger, 'ai_core'), 'AI CORE ×12');
    assert.equal(X.formatRebootBeat(trigger, 'civilization'), 'CIVILIZATION #3');
    assert.deepEqual(X.formatMilestoneToast(trigger, repository, 0, undefined, 'ai_core'), { title: 'AI CORE ×12', subtitle: null });
    assert.deepEqual(X.formatMilestoneToast(trigger, repository, 3, undefined, 'civilization'), { title: 'CIVILIZATION #3', subtitle: null });
    assert.equal(X.formatMilestoneToast(trigger, repository).title, 'REBOOT', 'default beat');
    for (const beat of ['reboot', 'ai_core', 'civilization'] as const) assert.equal(X.formatRebootBeat(trigger, beat), X.formatRebootBeat(trigger, beat).toUpperCase());
});

test('AUT-049 view model: the event shows ONE reboot_title card on the cleared queue (Reboot clears the keys, the reveal still shows)', () => {
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(before());
    const update = viewModel.consumeEvents(after(), [coresEvent(), civilizationEvent(), rebootEvent()]);
    assert.equal(update.rebooted, true);
    assert.deepEqual(update.exceptional, ['rebootCompleted']);
    assert.equal(update.rebootScheduled?.key, 'x:2');
    assert.deepEqual(update.accepted.map((t) => t.key), ['x:2']);
    assert.equal(update.outcome?.started.length, 1, 'starts at once (offer path)');
    assert.equal(viewModel.getFrame()?.item.trigger.kind, 'reboot_title');
    // The fact keys were cleared: the same milestone of the next run presents again (after the card).
    assert.equal(viewModel.consumeEvents(after(), [milestoneEvent()]).accepted.length, 1);
    assert.equal(update.eraScheduled, null);
});

test('AUT-049 dedupe: the same Reboot event twice shows one card; a load, a snapshot and a failed save never show one', () => {
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(before());
    assert.equal(viewModel.consumeEvents(after(), [rebootEvent()]).rebootScheduled?.key, 'x:2');
    const dup = viewModel.consumeEvents(after(), [rebootEvent()]);
    assert.equal(dup.rebootScheduled, null);
    assert.deepEqual(dup.skipped, [{ key: 'x:2', reason: 'duplicate' }]);
    assert.equal(runCard(viewModel, 4.5).finishedAt !== null, true);
    assert.equal(viewModel.consumeEvents(after(), [rebootEvent(3, 2)]).rebootScheduled?.key, 'x:3', 'the next Civilization has its own key');

    const load = new MilestonePresentationViewModel();
    assert.equal(load.syncFromState(after()).rebootScheduled, null, 'load: silent');
    assert.equal(runCard(load, 5).frames, 0);
    const earlyEvent = new MilestonePresentationViewModel();
    assert.equal(earlyEvent.consumeEvents(after(), [rebootEvent()]).rebootScheduled, null, 'an event before the load baseline is the baseline');
    assert.equal(runCard(earlyEvent, 5).frames, 0);

    const snapshot = new MilestonePresentationViewModel();
    snapshot.syncFromState(before());
    const reset = snapshot.syncFromState(after());
    assert.deepEqual([reset.rebooted, reset.rebootScheduled], [true, null], 'a snapshot that shows the new run re-baselines silently');
    assert.equal(runCard(snapshot, 5).frames, 0);

    const failed = new MilestonePresentationViewModel();
    failed.syncFromState(before());
    const failedUpdate = failed.consumeEvents(after(), [coresEvent(), civilizationEvent()]);
    assert.deepEqual([failedUpdate.rebootScheduled, failedUpdate.accepted.length], [null, 0], 'reboot_persistence_failed carries no rebootCompleted: no card');
    assert.equal(runCard(failed, 5).frames, 0);
});

test('AUT-049 card timeline through the queue: 4.0 s hard cap, silence invisible, beats REBOOT / AI CORE / CIVILIZATION in order', () => {
    assert.equal(Q.milestoneToastDuration('exceptional', 'reboot_title'), 4.0);
    assert.ok(Math.abs(Q.milestoneToastDuration('exceptional') - 3.0) < 1e-9, 'the era card stays 3.0 s');
    assert.deepEqual(Q.MILESTONE_TOAST_TIMING.exceptional, { fadeIn: 0.3, hold: 2.2, fadeOut: 0.5 }, 'era card timing untouched');
    assert.equal(Q.sampleMilestoneToast('exceptional', 1.0, 'era_title').beat, undefined);
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(before());
    viewModel.consumeEvents(after(), [rebootEvent()]);
    const result = runCard(viewModel, 5);
    assert.ok(result.finishedAt !== null && result.finishedAt >= 3.9 && result.finishedAt <= 4.1, `finished at ${String(result.finishedAt)}`);
    assert.ok((result.finishedElapsed ?? 99) <= 4.0 + 0.017, 'one frame of overshoot at most');
    const distinct = result.beats.filter((beat, index) => beat !== null && beat !== result.beats[index - 1]);
    assert.deepEqual(distinct, ['reboot', 'ai_core', 'civilization']);
    assert.ok(result.alphas.some((a) => a === 0), 'the silence is invisible');
    assert.equal(runCard(viewModel, 3).frames, 0, 'nothing after the window');
});

test('AUT-049 tier and subsumption (consistent with the era title): pre-empts and cancels, every same-batch toast subsumed, a later Minor is dropped while it shows', () => {
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(before());
    viewModel.consumeEvents(before(), [eraEvent()]);
    assert.equal(viewModel.getPendingEra()?.key, 'e:automated_factory');
    const update = viewModel.consumeEvents(after(), [milestoneEvent(), rebootEvent(), eraEvent()]);
    assert.equal(update.eraCancelled, true, 'the pending era card is cancelled by the Reboot');
    assert.equal(viewModel.getPendingEra(), null, 'no era card is scheduled behind the Reboot card');
    assert.equal(update.eraScheduled, null);
    assert.deepEqual(update.accepted.map((t) => t.key), ['x:2'], 'one card for the batch');
    assert.deepEqual(update.skipped, [{ key: 'e:automated_factory', reason: 'subsumed' }], 'a same-batch toast after the Reboot is subsumed');
    assert.equal(viewModel.getFrame()?.item.trigger.kind, 'reboot_title');

    const queue = new Q.MilestoneToastQueue();
    queue.enqueueBurst([T.classifyMilestoneEvent(milestoneEvent()).trigger!]);
    const card = R.buildRebootTrigger(rebootEvent() as Extract<DomainEvent, { type: 'rebootCompleted' }>);
    const outcome = queue.enqueueBurst([card]);
    assert.deepEqual(outcome.dropped.map((d) => d.reason), ['preempted']);
    assert.equal(queue.getActive()?.trigger.kind, 'reboot_title');
    const minor = queue.enqueueBurst([T.classifyMilestoneEvent({ type: 'producerMilestoneReached', producerId: 'assembly_station', milestoneId: 'm2', threshold: 25 } as DomainEvent).trigger!]);
    assert.deepEqual(minor.dropped.map((d) => d.reason), ['exceptional_active']);
});

test('AUT-049 layout: the reboot card uses the Exceptional band on 5 screens, never over HUD / Next Goal / buttons / panel, fonts >= 24, cyan never brighter than the lamps', () => {
    const card = L.MILESTONE_TOAST_LAYOUT.exceptional;
    assert.ok(card.titleFontSize >= 24 && card.subtitleFontSize === 0);
    assert.equal(L.milestoneToastFontsReadable(), true);
    for (const screen of [{ w: 720, h: 1280 }, { w: 1080, h: 1920 }, { w: 1080, h: 2412 }, { w: 1080, h: 2340 }, { w: 1440, h: 3120 }]) {
        const ui = computeUiLayout(screen);
        const rect = L.computeMilestoneToastRect(screen, undefined, 'exceptional');
        const label = `${screen.w}x${screen.h}`;
        assert.equal(rectsOverlap(rect, ui.hud), false, `${label}: never over the HUD / Next Goal`);
        assert.equal(rectsOverlap(rect, ui.panel), false, `${label}: not over the panel`);
        for (const button of Object.values(ui.buttons)) assert.equal(rectsOverlap(rect, button), false);
        assert.equal(rectContains(ui.safeArea, rect), true);
        assert.equal(L.milestoneToastFitsFactoryBand(screen, undefined, 'exceptional'), true, `${label}: inside the factory band`);
    }
    const cyan = L.MILESTONE_TOAST_COLORS.rebootUnderline;
    assert.deepEqual([cyan.r, cyan.g, cyan.b], [ERA_ENV_CYAN.r, ERA_ENV_CYAN.g, ERA_ENV_CYAN.b]);
    assert.ok(cyan.r <= 82 && cyan.g <= 206 && cyan.b <= 224);
});

// ---------------------------------------------------------------------------------------------------------------
// Post-commit ordering through the real session and binding

async function realBinding(variant: 'reboot' | 'post' = 'reboot', failSave = false) {
    const nowMs = Date.parse('2026-11-14T08:00:00.000Z');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: buildAut049SeededSave(variant, nowMs) });
    const boot = await bootstrapGameSession({ storage, timeService: new ManualTimeService({ utcIso: '2026-11-14T08:00:00.000Z', monotonicSeconds: 0 }) });
    assert.equal(boot.startup.ok, true);
    const session = boot.startup.session;
    const batches: DomainEvent[][] = [];
    const viewModel = new MilestonePresentationViewModel();
    const model = new R.RebootPresentationModel();
    const results: unknown[] = [];
    const binding = new FactoryWorldStateBinding({
        session, configRepository: boot.configRepository, hud: null, panel: null,
        automation: {
            syncAutomationState: (state) => { viewModel.syncFromState(state); model.syncFromState(state); },
            consumeDomainEvents: (state, events) => { batches.push([...events]); viewModel.consumeEvents(state, events); model.consumeEvents(state, events); },
        },
        reportCommandResult: (command, result) => results.push({ command, result }),
    });
    binding.init();
    if (failSave) storage.failNext({ operation: 'replace', fromName: SAVE_TEMP_NAME, toName: SAVE_MAIN_NAME, mode: 'after_delete_destination', message: 'durability failure' });
    return { binding, session, batches, viewModel, model, results, storage };
}

test('AUT-049 real session: the confirmed Reboot through binding.submit starts the sequence only from the durable rebootCompleted (after reboot_saved)', async () => {
    const ctx = await realBinding('reboot');
    assert.equal(ctx.model.isRunning(), false, 'load is silent');
    assert.equal(ctx.viewModel.getFrame(), null);
    assert.equal(ctx.session.getStateSnapshot().meta.civilizationNumber, 1);
    const result = await ctx.binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(result?.execution.ok, true);
    assert.equal(result?.save?.ok, true, 'the critical save succeeded before the event was fanned out');
    assert.deepEqual(ctx.batches[0].map((e) => e.type), ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted']);
    const completed = ctx.batches[0].find((e) => e.type === 'rebootCompleted') as Extract<DomainEvent, { type: 'rebootCompleted' }>;
    assert.ok(completed.aiCoresGranted > 0);
    assert.deepEqual([completed.oldCivilization, completed.newCivilization], [1, 2]);
    assert.equal(ctx.model.isRunning(), true);
    assert.equal(ctx.model.getSequence()?.newCivilization, 2);
    assert.equal(ctx.viewModel.getFrame()?.item.trigger.kind, 'reboot_title');
    assert.equal(ctx.session.getStateSnapshot().meta.civilizationNumber, 2, 'the new RunState / meta is what the presentation syncs to');
    assert.equal(ctx.results.length, 1, 'the normal command_result hook still fires once');
    // The same command again: no longer eligible, no events, no second sequence.
    const again = await ctx.binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(again?.execution.ok, false);
    assert.equal(ctx.batches.length, 1);
});

test('AUT-049 real session: reboot_persistence_failed fans out the state change but NEVER starts the sequence', async () => {
    const ctx = await realBinding('reboot', true);
    const result = await ctx.binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(result?.execution.ok, true, 'the in-memory transaction committed');
    assert.equal(result?.save?.ok, false);
    assert.deepEqual(ctx.batches[0].map((e) => e.type), ['aiCoresGranted', 'civilizationChanged']);
    assert.equal(ctx.model.isRunning(), false);
    assert.equal(ctx.viewModel.getFrame(), null);
    assert.equal(ctx.model.getPersistentSocket(), true, 'the persistent marker follows the (already changed) snapshot');
    assert.equal(runCard(ctx.viewModel, 5).frames, 0);
});

test('AUT-049 binding: non-Reboot commands keep the ordinary execute path; a port without the Reboot transaction falls back to execute', async () => {
    const ctx = await realBinding('reboot');
    const manual = await ctx.binding.submit({ type: 'manualProduce' });
    assert.equal(manual?.execution.ok, true);
    const calls: string[] = [];
    const port = {
        getStateSnapshot: () => createFreshGameState(),
        execute: async () => { calls.push('execute'); return { execution: { ok: false, command: { type: 'rebootCivilization', confirmed: true }, reason: 'x', message: 'x', events: [] }, save: null }; },
        advanceActiveSessionFromClock: async () => { throw new Error('unused'); },
        suspend: async () => { throw new Error('unused'); },
        resume: () => { throw new Error('unused'); },
    };
    const minimal = new FactoryWorldStateBinding({ session: port as never, configRepository: repository, automation: null, hud: null, panel: null });
    await minimal.submit({ type: 'rebootCivilization', confirmed: true });
    assert.deepEqual(calls, ['execute']);
    const pending = new FactoryWorldStateBinding({
        session: { ...port, rebootCivilizationConfirmed: async () => ({ status: 'pending_offline_preview', offlinePreview: {} }) } as never,
        configRepository: repository, automation: { syncAutomationState: () => { throw new Error('unused'); }, consumeDomainEvents: () => { throw new Error('no fan-out'); } }, hud: null, panel: null,
    });
    assert.equal(await pending.submit({ type: 'rebootCivilization', confirmed: true }), null, 'blocked by a pending offline report: nothing executed, nothing fanned out');
});

test('AUT-049 seeds: the reboot save has a positive AI Core reward and survives the round trip; the post save is Civilization #2 with Cores', () => {
    assert.deepEqual([...AUT049_SEED_VARIANTS], ['reboot', 'post']);
    assert.equal(isAut049SeedVariant('post'), true);
    assert.equal(isAut049SeedVariant('x'), false);
    const nowMs = Date.parse('2026-11-14T08:00:00.000Z');
    for (const variant of AUT049_SEED_VARIANTS) {
        const text = buildAut049SeededSave(variant, nowMs);
        const round = deserializeGameStateFromSaveJson(text);
        assert.deepEqual(round.diagnostics, [], `${variant} loads`);
        assert.deepEqual(round.state, buildAut049SeededState(variant), `${variant} round trip`);
        // No pending offline report on launch (it would block the Reboot transaction): no offline-eligible reward after a long absence.
        const offline = createOfflineProgressPreviewFromUtc(repository, round.state, { persistedAtUtcIso: '2026-11-14T08:00:00.000Z', currentUtcIso: '2026-11-14T09:00:00.000Z' });
        assert.equal(offline.status, 'no_reward', `${variant}: launching never leaves a pending offline report`);
    }
    const preview = createRebootPreview(repository, buildAut049SeededState('reboot'));
    assert.equal(preview.eligibility, 'eligible');
    assert.ok(preview.aiCoresToGain > 0);
    assert.equal(buildAut049SeededState('reboot').meta.civilizationNumber, 1);
    const post = buildAut049SeededState('post');
    assert.deepEqual([post.meta.civilizationNumber, post.meta.aiCores, post.run.currentEraId], [2, 5, 'manual_workshop']);
    assert.equal(R.shouldShowRelaySocket(post.meta.aiCores, post.meta.civilizationNumber), true);
    assert.equal(createRebootPreview(repository, post).eligibility, 'not_eligible');
});

// ---------------------------------------------------------------------------------------------------------------
// DEBUG command allow-list

test('AUT-049 DEBUG command file: rebootCivilization only with confirmed:true, anything else ignored, delay bounded', () => {
    assert.deepEqual(D.parseDebugCommandFile(buildAut049LiveCommandFile()), { command: { type: 'rebootCivilization', confirmed: true }, delayMs: AUT049_LIVE_COMMAND_DELAY_MS });
    for (const bad of [
        { command: { type: 'rebootCivilization' } },
        { command: { type: 'rebootCivilization', confirmed: false } },
        { command: { type: 'rebootCivilization', confirmed: 'true' } },
        { command: { type: 'rebootCivilization', confirmed: 1 } },
        { command: { type: 'purchasePermanentUpgrade', upgradeId: 'x' } },
        { command: { type: 'manualProduce' } },
        { command: 'rebootCivilization' },
        { delayMs: 10 },
    ]) assert.equal(D.parseDebugCommandFile(JSON.stringify(bad)), null, JSON.stringify(bad));
    assert.equal(D.parseDebugCommandFile(JSON.stringify({ command: { type: 'rebootCivilization', confirmed: true }, delayMs: 999999 }))?.delayMs, D.DEBUG_COMMAND_MAX_DELAY_MS);
    assert.equal(D.parseDebugCommandFile(JSON.stringify({ command: { type: 'rebootCivilization', confirmed: true }, delayMs: -4 }))?.delayMs, 0);
    assert.equal(D.parseDebugCommandFile(JSON.stringify({ command: { type: 'rebootCivilization', confirmed: true, extra: 1 } }))?.command.type, 'rebootCivilization');
    // The AUT-048 command is unchanged.
    assert.deepEqual(D.parseDebugCommandFile(JSON.stringify({ command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' }, delayMs: 5 })), { command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' }, delayMs: 5 });
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    const body = bootstrap.slice(bootstrap.indexOf('private runDebugCommandFile('), bootstrap.indexOf('private onGameHide('));
    assert.match(body, /if \(DEBUG !== true \|\| !isDeviceDiagnosticsEnabled\(\)\) return;/, 'same DEBUG + diagnostics guard');
    assert.ok(body.indexOf('port.readText(DEBUG_COMMAND_FILE)') < body.indexOf('port.remove(DEBUG_COMMAND_FILE)'), 'read once, then deleted');
    assert.match(body, /binding\.submit\(request\.command\)/, 'through the normal binding.submit');
    assert.equal((bootstrap.match(/binding\.submit\(/g) ?? []).length, 5, 'no extra submit site was added beyond the AUT-050 AI Upgrades emitter');
    for (const file of ['UiLayout.ts', 'CoreHudController.ts', 'CoreLoopActions.ts', 'HudViewModel.ts', 'ProducerPanelController.ts', 'RebootPresentationController.ts', 'RebootPresentation.ts']) {
        assert.doesNotMatch(presentation(file), /debug_command|DebugCommand|DEBUG_COMMAND/, `${file}: no player-facing Reboot trigger`);
        assert.doesNotMatch(code(file), /rebootCivilization/, `${file}: submits no Reboot command`);
    }
    assert.doesNotMatch(read('assets/scenes/factory/FactoryWorld.scene'), /debug_command|rebootCivilization/);
    assert.doesNotMatch(code('DebugCommandFile.ts'), /from '\x63c|GameCommand|commandEmitter/, 'still a pure parser');
});

// ---------------------------------------------------------------------------------------------------------------
// Controller / wiring pins and Android lessons

test('AUT-049 controller + wiring: thin cc controller, scale-based visibility, inert, one camera call, no light / particle / tint, registered after the toast', () => {
    const controller = code('RebootPresentationController.ts');
    assert.match(controller, /@ccclass\('RebootPresentationController'\)/);
    assert.match(controller, /public update\(deltaSeconds: number\)/);
    assert.doesNotMatch(controller, /\.active\s*=/, 'scale-based visibility, never node.active');
    assert.doesNotMatch(controller, /\bSprite\b|SpriteFrame/, 'a spriteFrame-less Sprite renders nothing on Android');
    assert.doesNotMatch(controller, /Light|ParticleSystem|Graphics|Tween|tween|clearColor|Camera\b.*\.(fov|visibility)/, 'no new lights / particles / tint');
    assert.doesNotMatch(controller, /on\(Node\.EventType|input\.on|TOUCH|systemEvent/, 'inert: no touch listener');
    assert.doesNotMatch(controller, /commandEmitter|submit\(|execute\(|GameCommand|saveText|writeText|getStateSnapshot/, 'no command, no save, no state read beyond the snapshot handed in');
    assert.equal((controller.match(/focusOnRevealTarget\(/g) ?? []).length, 1, 'ONE camera call');
    assert.doesNotMatch(controller, /focusOnWorldTarget|setFocusBounds|applyConfiguredInitialView/);
    assert.match(controller, /if \(!this\.model\.isRunning\(\) && !this\.idleDirty\) return;/, 'idle tick does nothing');
    assert.match(controller, /resolveRebootFocus\(/);
    const model = code('RebootPresentation.ts');
    assert.doesNotMatch(model, /from '\x63c|constructor\([^)]*(private|public|readonly) /, 'pure: no cc, no parameter properties');
    const registry = presentation('PresentationController.ts');
    assert.match(registry, /@property\(RebootPresentationController\)\s*public rebootPresentation/);
    assert.match(registry, /this\.rebootPresentation\?\.sync\(/);
    assert.match(registry, /this\.rebootPresentation\?\.consumeDomainEvents\(state, events\)/);
    assert.ok(registry.indexOf('this.milestonePresentation?.consumeDomainEvents') < registry.indexOf('this.rebootPresentation?.consumeDomainEvents'));
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /this\.createRebootPresentation\(site\);/);
    assert.match(bootstrap, /presentation\.rebootPresentation = controller;/);
    const build = bootstrap.slice(bootstrap.indexOf('private createRebootPresentation('), bootstrap.indexOf('private connectFirstAutomationPresentation('));
    assert.match(build, /scan\.setScale\(0, 0, 0\)/, 'ring hidden by scale at rest');
    assert.match(build, /socket\.setScale\(0, 0, 0\)/, 'socket hidden by scale at rest');
    assert.match(build, /core\.setScale\(0, 0, 0\)/);
    assert.match(build, /zoneFocusAnchorLookup|Zone_\$\{zone\}/, 'anchors through Zone_<Zone>/<Zone>_FocusAnchor');
    assert.match(build, /producerZoneName\(producerId\)/);
    assert.doesNotMatch(build, /DirectionalLight|Light|ParticleSystem|Sprite|\.active\s*=|assets\/art|Prefab|instantiate/, 'primitives only: no asset, no light, no particle');
    // The Milestone controller only draws the card: no ring / socket / camera work for the Reboot.
    const toast = code('MilestonePresentationController.ts');
    assert.match(toast, /trigger\.kind === 'reboot_title'/);
    assert.match(toast, /isReboot && \(beat === null \|\| alpha <= 0\)/, 'the silence hides the band by scale');
    assert.match(toast, /colors\.rebootUnderline/);
    assert.equal((toast.match(/focusOnRevealTarget\(/g) ?? []).length, 2, 'toast controller: only the existing Major and era focus calls');
    assert.match(code('MilestoneToastQueue.ts'), /sampleMilestoneToast\(this\.active\.trigger\.tier, this\.active\.elapsed, this\.active\.trigger\.kind\)/);
});

test('AUT-049 diagnostics, scenarios and capture checks', async () => {
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('reboot_presentation'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('reboot_presentation'));
    assert.match(presentation('DeviceDiagnostics.ts'), /AUT-049: Reboot presentation/);
    const controller = presentation('RebootPresentationController.ts');
    for (const phase of ['synced', 'sequence_started', 'phase', 'sequence_finished', 'duplicate_ignored', 'focus_requested', 'focus_skipped', 'effect_applied']) assert.match(controller, new RegExp(`'${phase}'`), phase);
    for (const phase of ['toast_started', 'title_applied', 'toast_finished']) assert.match(presentation('MilestonePresentationController.ts'), new RegExp(`'${phase}'`), phase);
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut049'/);
    assert.match(cli, /seed-aut049 \[--variant reboot\|post\]/);
    assert.match(cli, /aut048-era3-live\|aut049\|aut049-post\|aut050\|aut051\|aut051-reload\|aut051-short\]/);
    assert.match(cli, /expectReboot: scenario\.expectReboot/);
    assert.match(read('package.json'), /"device:seed-aut049": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-aut049"/);
    const live = REVEAL_SCENARIOS.aut049;
    assert.deepEqual([live.trigger, live.expectReboot, live.expectCommands, live.expectConstruction], ['none', 'sequence', ['rebootCivilization'], null]);
    assert.ok((live.durationMs ?? 0) >= AUT049_LIVE_COMMAND_DELAY_MS + 4000 + 4000, 'the capture outlasts delay + the 4 s sequence');
    const post = REVEAL_SCENARIOS['aut049-post'];
    assert.deepEqual([post.trigger, post.expectReboot], ['none', 'silent']);

    const calls: string[] = [];
    const written: Record<string, string> = {};
    const driver = {
        forceStop: async () => { calls.push('forceStop'); },
        appDataDirectory: async () => '/data/data/pkg',
        removeAppFiles: async (_pkg: string, paths: string[]) => { calls.push(`remove:${paths.map((p) => p.split('/').pop()).join(',')}`); },
        writeAppFile: async (_pkg: string, file: string, text: string) => { calls.push(`write:${file.split('/').pop()}`); written[file.split('/').pop()!] = text; },
        launch: async () => { calls.push('launch'); },
    };
    await seedAut049(driver as never, 'pkg', 'act', 'reboot');
    assert.deepEqual(calls, ['forceStop', 'remove:save_main.json,save_backup.json,save_temp.json,debug_command.json', 'write:save_main.json', 'write:debug_command.json', 'launch']);
    assert.equal(written['debug_command.json'], buildAut049LiveCommandFile());
    calls.length = 0;
    await seedAut049(driver as never, 'pkg', 'act', 'post');
    assert.deepEqual(calls, ['forceStop', 'remove:save_main.json,save_backup.json,save_temp.json,debug_command.json', 'write:save_main.json', 'launch'], 'the post seed writes no command and removes a stale one');

    const ev = (tMs: number, evt: string, fields: Record<string, unknown>): TimelineEvent => ({ tMs, event: { evt, ...fields } as TimelineEvent['event'] });
    const good: TimelineEvent[] = [
        ev(100, 'reboot_presentation', { phase: 'synced', socketPersistent: false, civilization: 1 }),
        ev(6000, 'reboot_presentation', { phase: 'sequence_started', key: 'x:2', newCivilization: 2, aiCoresGranted: 5 }),
        ev(6000, 'reboot_presentation', { phase: 'focus_requested', producerId: 'fabricator', anchorResolved: true }),
        ev(6010, 'reboot_presentation', { phase: 'toast_started', key: 'x:2' }),
        ev(6100, 'reboot_presentation', { phase: 'title_applied', labelText: 'REBOOT' }),
        ev(6200, 'reboot_presentation', { phase: 'effect_applied', part: 'scan', plateScale: 1 }),
        ev(7200, 'reboot_presentation', { phase: 'phase', name: 'silence' }),
        ev(7700, 'reboot_presentation', { phase: 'phase', name: 'core' }),
        ev(7900, 'reboot_presentation', { phase: 'title_applied', labelText: 'AI CORE ×5' }),
        ev(8100, 'reboot_presentation', { phase: 'effect_applied', part: 'core', socketScale: 1, coreScale: 0.55 }),
        ev(9200, 'reboot_presentation', { phase: 'phase', name: 'civilization' }),
        ev(9210, 'reboot_presentation', { phase: 'title_applied', labelText: 'CIVILIZATION #2' }),
        ev(10000, 'reboot_presentation', { phase: 'sequence_finished', elapsedSeconds: 4.0, socketVisible: true }),
        ev(10010, 'reboot_presentation', { phase: 'toast_finished', elapsedSeconds: 4.01 }),
        ev(6005, 'command_result', { ok: true, command: { type: 'rebootCivilization', confirmed: true }, eventTypes: ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted'] }),
    ];
    const options = { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 20, expectCommands: live.expectCommands, expectReboot: live.expectReboot };
    const checks = evaluateRevealTimeline(good, options);
    assert.deepEqual(checks.filter((c) => !c.ok).map((c) => c.id), [], 'the good timeline passes every check');
    for (const id of ['reboot_sequence_started', 'reboot_event_after_durable_save', 'reboot_phases_observed', 'reboot_sequence_finished_within_cap', 'reboot_title_beats', 'reboot_toast_finished_within_cap', 'reboot_focus_decision', 'reboot_scan_applied', 'reboot_core_applied', 'reboot_socket_persists_after']) assert.ok(checks.some((c) => c.id === id), id);
    const slow = good.map((e) => (e.event.phase === 'sequence_finished' ? ev(e.tMs, 'reboot_presentation', { phase: 'sequence_finished', elapsedSeconds: 4.6, socketVisible: true }) : e));
    assert.equal(evaluateRebootPresentation(slow, 'sequence').find((c) => c.id === 'reboot_sequence_finished_within_cap')?.ok, false, 'over the 4 s cap fails');
    assert.equal(evaluateRebootPresentation(good.filter((e) => e.event.name !== 'silence'), 'sequence').find((c) => c.id === 'reboot_phases_observed')?.ok, false);
    const noCommit = good.filter((e) => e.event.evt !== 'command_result');
    assert.equal(evaluateRebootPresentation(noCommit, 'sequence').find((c) => c.id === 'reboot_event_after_durable_save')?.ok, false);
    const silentGood = [ev(100, 'reboot_presentation', { phase: 'synced', socketPersistent: true, civilization: 2 })];
    assert.deepEqual(evaluateRebootPresentation(silentGood, 'silent').map((c) => c.ok), [true, true, true]);
    assert.equal(evaluateRebootPresentation([...silentGood, ev(500, 'reboot_presentation', { phase: 'sequence_started' })], 'silent').some((c) => !c.ok), true, 'a sequence on load fails');
    assert.equal(evaluateRevealTimeline(good, { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 10 }).some((c) => c.id.startsWith('reboot_')), false, 'other scenarios are unaffected');
});

test('AUT-049 .ts.meta files: typescript importer, unique a0490000 uuids; no new asset was added', () => {
    const seen = new Set<string>();
    for (const file of ['RebootPresentation', 'RebootPresentationController']) {
        const meta = JSON.parse(presentation(`${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^a0490000-0000-4000-8000-\d{12}$/);
        seen.add(meta.uuid);
    }
    assert.equal(seen.size, 2);
    assert.doesNotMatch(read('docs/ASSET_MANIFEST.md'), /CUSTOM_AI_CORE_01.*(imported|done|ready)/i);
});
