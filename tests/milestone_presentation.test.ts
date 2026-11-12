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
import { resolveNextGoal } from '../assets/scripts/progression/NextGoal.ts';
import { ROBOTS_BUILT_THRESHOLDS } from '../assets/scripts/economy/RobotsBuilt.ts';
import { createHudViewModel } from '../assets/scripts/presentation/HudViewModel.ts';
import { resolveNextGoalAction } from '../assets/scripts/presentation/CoreLoopActions.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { computeUiLayout, rectsOverlap, rectContains } from '../assets/scripts/presentation/UiLayout.ts';
import * as T from '../assets/scripts/presentation/MilestoneTier.ts';
import * as Q from '../assets/scripts/presentation/MilestoneToastQueue.ts';
import * as F from '../assets/scripts/presentation/MilestoneFeedback.ts';
import * as X from '../assets/scripts/presentation/MilestoneToastText.ts';
import * as L from '../assets/scripts/presentation/MilestoneToastLayout.ts';
import { MilestonePresentationViewModel } from '../assets/scripts/presentation/MilestonePresentationViewModel.ts';
import { AUT046_BREAKTHROUGH_COST, AUT046_BREAKTHROUGH_ID, AUT046_SEED_VARIANTS, buildAut046SeededSave, buildAut046SeededState, isAut046SeedVariant } from '../tools/device/seed_aut046.ts';
import { DEFAULT_REVEAL_EVENT_TYPES } from '../tools/device/reveal_capture.ts';

/*
 * AUT-046 milestone & breakthrough presentation: tier table, toast queue (merge / pre-emption / FIFO / collapse), silent first sync and
 * dedupe, focus gating, no-toast events, wording, layout, wiring and the device seed. No new asset, no economy / runtime change.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const presentation = (file: string): string => read(`assets/scripts/presentation/${file}`);
const code = (file: string): string => presentation(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

const milestoneEvent = (producerId = 'fabricator', threshold = 25): DomainEvent => ({ type: 'producerMilestoneReached', producerId, milestoneId: `level_${threshold}`, threshold, productionMultiplier: 2, cumulativeMultiplierAfterCrossing: 2 });
const automationEvent = (producerId: string, isAutomated = true, by: string | null = 'worker_bot'): DomainEvent => ({ type: 'automationStateChanged', producerId, isAutomated, isOfflineEligible: false, unlockedByBreakthroughId: by });
const breakthroughEvent = (breakthroughId: string): DomainEvent => ({ type: 'breakthroughPurchased', breakthroughId, cost: 1 });
const constructedEvent = (producerId: string, source: 'producer_purchase' | 'breakthrough' = 'producer_purchase', breakthroughId?: string): DomainEvent => ({ type: 'producerConstructed', producerId, level: 1, source, ...(breakthroughId ? { breakthroughId } : {}) });
const robotsEvent = (threshold: number): DomainEvent => ({ type: 'robotsBuiltThresholdReached', threshold, previousAmount: threshold - 1, newAmount: threshold });
const rebootEvent = (): DomainEvent => ({ type: 'rebootCompleted', oldCivilization: 1, newCivilization: 2, aiCoresGranted: 1, prestigePower: 1 });

const trigger = (event: DomainEvent): T.MilestoneTrigger => {
    const result = T.classifyMilestoneEvent(event).trigger;
    assert.ok(result, `${event.type} has a trigger`);
    return result;
};

// ---------------------------------------------------------------------------------------------------------------
// Tier mapping

test('AUT-046 tier table: covers exactly the DomainEvent union, with the approved tier per event type', () => {
    const union = [...read('assets/scripts/domain/Events.ts').matchAll(/readonly type: '(\w+)';/g)].map((m) => m[1]).sort();
    assert.deepEqual(Object.keys(T.MILESTONE_EVENT_TIERS).sort(), union, 'every event type has exactly one tier row');
    const expected: Record<string, T.MilestoneTier> = {
        producerMilestoneReached: 'minor', automationStateChanged: 'minor',
        breakthroughPurchased: 'major', robotsBuiltThresholdReached: 'major', producerConstructed: 'major',
        firstRobotProduced: 'exceptional', eraChanged: 'exceptional', rebootCompleted: 'exceptional',
    };
    for (const type of union) assert.equal(T.MILESTONE_EVENT_TIERS[type as DomainEvent['type']], expected[type] ?? 'none', type);
    assert.ok(Object.isFrozen(T.MILESTONE_EVENT_TIERS));
});

test('AUT-046 classification: automation (first = exceptional, de-automation = none), robots thresholds are one data entry each, exceptional events carry no trigger', () => {
    assert.equal(T.classifyMilestoneEvent(automationEvent('assembly_station')).tier, 'minor');
    assert.equal(T.classifyMilestoneEvent(automationEvent('fabricator', true, 'auto_feeder')).tier, 'exceptional', 'first automation is owned by FirstAutomationPresentationController');
    assert.equal(T.classifyMilestoneEvent(automationEvent('fabricator', true, 'auto_feeder')).trigger, null);
    assert.equal(T.classifyMilestoneEvent(automationEvent('robot_line', false)).tier, 'none');
    for (const threshold of ROBOTS_BUILT_THRESHOLDS) assert.equal(T.ROBOTS_BUILT_THRESHOLD_TIERS[threshold], 'major', `threshold ${threshold} has one table entry (Major for now)`);
    assert.deepEqual(Object.keys(T.ROBOTS_BUILT_THRESHOLD_TIERS).map(Number), [...ROBOTS_BUILT_THRESHOLDS]);
    assert.equal(T.classifyMilestoneEvent(robotsEvent(100)).tier, 'major');
    for (const event of [{ type: 'firstRobotProduced' }, { type: 'eraChanged', oldEraId: 'manual_workshop', newEraId: 'automated_factory' }, rebootEvent()] as DomainEvent[]) {
        assert.deepEqual(T.classifyMilestoneEvent(event), { tier: 'exceptional', trigger: null }, `${event.type} is classified only`);
    }
});

test('AUT-046 triggers: Minor = no focus / no sparks; Major = sparks + pulse + focus target; producerConstructed = toast title only; accents', () => {
    const minor = trigger(milestoneEvent());
    assert.deepEqual([minor.tier, minor.kind, minor.accent, minor.focusProducerId, minor.sparks, minor.pulse], ['minor', 'producer_milestone', 'amber', null, false, true]);
    const automation = trigger(automationEvent('assembly_station'));
    assert.deepEqual([automation.tier, automation.accent, automation.focusProducerId, automation.sparks, automation.pulse], ['minor', 'cyan', null, false, true]);
    const breakthrough = trigger(breakthroughEvent('robotic_logistics'));
    assert.deepEqual([breakthrough.tier, breakthrough.accent, breakthrough.focusProducerId, breakthrough.sparks, breakthrough.pulse], ['major', 'amber', 'assembly_station', true, true]);
    const robots = trigger(robotsEvent(10));
    assert.deepEqual([robots.tier, robots.accent, robots.focusProducerId, robots.sparks], ['major', 'cyan', 'robot_line', true]);
    const built = trigger(constructedEvent('robot_line'));
    assert.deepEqual([built.tier, built.kind, built.focusProducerId, built.sparks, built.pulse], ['major', 'producer_constructed', null, false, false], 'AUT-040 owns the build reveal: no second spark, pulse or focus');
    const breakthroughIds = [...read('data/economy/breakthroughs.json').matchAll(/"id": "(\w+)",\s*"displayNameKey"/g)].map((m) => m[1]).sort();
    assert.ok(breakthroughIds.length >= 6);
    assert.deepEqual(Object.keys(T.BREAKTHROUGH_FOCUS_PRODUCER).sort(), breakthroughIds, 'every breakthrough has one focus-producer entry');
});

test('AUT-046 no-toast events: output / production / purchases / assisted batches / balances / flags / boosts / grants / civilization never present', () => {
    const none: DomainEvent[] = [
        { type: 'industrialOutputChanged', previousAmount: 0, newAmount: 1, delta: 1, reason: 'manual_production' },
        { type: 'productionGranted', source: 'manual', amount: 1 },
        { type: 'producerLevelsPurchased', producerId: 'fabricator', quantity: 1, oldLevel: 1, newLevel: 2, cost: 1 },
        { type: 'assistedBatchLaunched', producerId: 'assembly_station', durationSeconds: 5 },
        { type: 'assistedBatchCompleted', producerId: 'assembly_station', durationSeconds: 5, payout: 5 },
        { type: 'aiCoreBalanceChanged', previousAiCores: 0, newAiCores: 1, delta: 1, reason: 'permanent_upgrade_purchase' },
        { type: 'permanentUpgradePurchased', upgradeId: 'x', previousRank: 0, newRank: 1, cost: 1 },
        { type: 'progressionFlagChanged', flagId: 'first_robot', value: true },
        { type: 'temporaryBoostActivated', boostId: 'free_overclock', source: 'free', multiplier: 2, durationSeconds: 30, cooldownSeconds: 60, requestId: null },
        { type: 'temporaryBoostExpired', boostId: 'free_overclock', source: 'free' },
        { type: 'temporaryBoostSuspended', boostId: 'a', suspendedByBoostId: 'b', remainingSeconds: 1 },
        { type: 'temporaryBoostResumed', boostId: 'a', remainingSeconds: 1 },
        { type: 'aiCoresGranted', amount: 1, previousAiCores: 0, newAiCores: 1, source: 'reboot' },
        { type: 'civilizationChanged', oldCivilization: 1, newCivilization: 2, reason: 'reboot' },
    ];
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(createFreshGameState());
    for (const event of none) assert.deepEqual(T.classifyMilestoneEvent(event), { tier: 'none', trigger: null }, event.type);
    const update = viewModel.consumeEvents(createFreshGameState(), none);
    assert.deepEqual([update.accepted.length, update.exceptional.length, update.outcome], [0, 0, null]);
    assert.equal(viewModel.getFrame(), null);
    assert.equal(viewModel.tick(0.1).frame, null);
});

// ---------------------------------------------------------------------------------------------------------------
// Toast timing and queue

test('AUT-046 timing: Minor 0.15 in / 0.5 hold / 0.2 out; Major 2-3 s with an accent underline wipe', () => {
    assert.deepEqual(Q.MILESTONE_TOAST_TIMING.minor, { fadeIn: 0.15, hold: 0.5, fadeOut: 0.2 });
    assert.ok(Q.milestoneToastDuration('minor') >= 0.5 && Q.milestoneToastDuration('minor') <= 1.0);
    const major = Q.milestoneToastDuration('major');
    assert.ok(major >= 2 && major <= 3, `Major lasts ${major}s`);
    assert.equal(Q.sampleMilestoneToast('minor', 0).alpha, 0);
    assert.equal(Q.sampleMilestoneToast('minor', 0.4).phase, 'hold');
    assert.equal(Q.sampleMilestoneToast('minor', 0.4).alpha, 1);
    assert.equal(Q.sampleMilestoneToast('minor', 0.4).wipe, 0, 'a Minor has no underline');
    assert.equal(Q.sampleMilestoneToast('minor', 0.9).complete, true);
    assert.equal(Q.sampleMilestoneToast('major', 0.25).wipe, 0);
    assert.ok(Q.sampleMilestoneToast('major', 0.55).wipe > 0 && Q.sampleMilestoneToast('major', 0.55).wipe < 1);
    assert.equal(Q.sampleMilestoneToast('major', 1.0).wipe, 1);
    assert.equal(Q.sampleMilestoneToast('major', major).complete, true);
    assert.deepEqual(Q.sampleMilestoneToast('major', -3), Q.sampleMilestoneToast('major', 0));
});

test('AUT-046 queue: a toast plays once and the band empties; Major pre-empts visible and waiting Minors; Minors during a Major are dropped', () => {
    const queue = new Q.MilestoneToastQueue();
    const first = queue.enqueueBurst([trigger(milestoneEvent('fabricator', 25))]);
    assert.equal(first.started.length, 1);
    queue.tick(0.1);
    queue.enqueueBurst([trigger(milestoneEvent('assembly_station', 25))]);
    assert.equal(queue.getWaiting().length, 1, 'a second Minor of another producer waits');
    const major = queue.enqueueBurst([trigger(breakthroughEvent('robotic_logistics'))]);
    assert.deepEqual(major.dropped.map((d) => d.reason), ['preempted', 'preempted'], 'visible and waiting Minors are dropped');
    assert.equal(queue.getActive()?.trigger.tier, 'major');
    assert.equal(queue.getWaiting().length, 0);
    const during = queue.enqueueBurst([trigger(milestoneEvent('robot_line', 10))]);
    assert.deepEqual(during.dropped.map((d) => d.reason), ['major_active']);
    let seen = 0;
    for (let step = 0; step < 40; step += 1) { if (queue.tick(0.1).finished.length > 0) seen += 1; }
    assert.equal(seen, 1, 'the Major finished exactly once');
    assert.equal(queue.getFrame(), null, 'the band is idle afterwards');
});

test('AUT-046 queue: same-tier FIFO, at most 2 waiting, extras collapse into "+N"; same-producer Minors within 1 s merge', () => {
    const queue = new Q.MilestoneToastQueue();
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) queue.enqueueBurst([trigger(milestoneEvent(id, 10))]);
    assert.equal(queue.getActive()?.trigger.producerId, 'a1');
    assert.deepEqual(queue.getWaiting().map((w) => w.trigger.producerId), ['a2', 'a3'], 'FIFO, max 2 waiting');
    assert.equal(queue.getWaiting()[1].extra, 2, 'a4 and a5 collapsed into +2 on the last waiting toast');
    for (let i = 0; i < 20 && queue.getActive()?.trigger.producerId === 'a1'; i += 1) queue.tick(0.1);
    assert.equal(queue.getActive()?.trigger.producerId, 'a2', 'FIFO order kept when the visible one ends');

    const merge = new Q.MilestoneToastQueue();
    merge.enqueueBurst([trigger(milestoneEvent('fabricator', 25))]);
    const again = merge.enqueueBurst([trigger(automationEvent('fabricator'))]);
    assert.deepEqual(again.dropped.map((d) => d.reason), ['merged'], 'same producer within ~1 s: merged');
    merge.tick(1.2);
    const later = merge.enqueueBurst([trigger(milestoneEvent('fabricator', 50))]);
    assert.equal(later.dropped.length, 0, 'after the merge window it is accepted again');

    const majors = new Q.MilestoneToastQueue();
    for (const id of ['auto_feeder', 'worker_bot', 'robotic_logistics', 'factory_control_system', 'automated_cell_architecture']) majors.enqueueBurst([trigger(breakthroughEvent(id))]);
    assert.equal(majors.getWaiting().length, 2);
    assert.equal(majors.getWaiting()[1].extra, 2);
});

test('AUT-046 queue: a burst shows at most 1 Major + 1 Minor (extras collapse / drop)', () => {
    const queue = new Q.MilestoneToastQueue();
    const outcome = queue.enqueueBurst([
        trigger(milestoneEvent('fabricator', 25)), trigger(milestoneEvent('assembly_station', 25)),
        trigger(breakthroughEvent('robotic_logistics')), trigger(robotsEvent(10)), trigger(constructedEvent('robot_line')),
    ]);
    assert.equal(outcome.started.length, 1);
    assert.equal(queue.getActive()?.trigger.tier, 'major');
    assert.equal(queue.getActive()?.trigger.key, 'b:robotic_logistics', 'the first Major wins');
    assert.equal(queue.getActive()?.extra, 2, 'the other Majors collapse into +2');
    assert.ok(outcome.dropped.every((d) => d.reason === 'burst_limit' || d.reason === 'major_active'));
    assert.equal(queue.getWaiting().length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// View model: silent first sync, dedupe, reboot, exceptional batches

const seeded = (): GameState => buildAut046SeededState();

test('AUT-046 view model: the first sync (save load) is silent; a loaded state never toasts, even for the same events later', () => {
    const viewModel = new MilestonePresentationViewModel();
    const loaded = seeded();
    const first = viewModel.syncFromState(loaded);
    assert.deepEqual([first.accepted.length, first.outcome], [0, null]);
    assert.equal(viewModel.tick(0.1).frame, null, 'nothing visible after the load');
    assert.equal(viewModel.syncFromState(loaded).accepted.length, 0, 'a repeated snapshot of the same state is silent');
    const replay = viewModel.consumeEvents(loaded, [breakthroughEvent('worker_bot'), constructedEvent('assembly_station'), automationEvent('assembly_station')]);
    assert.deepEqual(replay.skipped.map((s) => s.reason), ['duplicate', 'duplicate', 'duplicate']);
    assert.equal(replay.accepted.length, 0);
    assert.equal(viewModel.getFrame(), null);
});

test('AUT-046 view model: events before the load baseline never present', () => {
    const viewModel = new MilestonePresentationViewModel();
    const update = viewModel.consumeEvents(seeded(), [breakthroughEvent('robotic_logistics')]);
    assert.equal(update.accepted.length, 0);
    assert.equal(viewModel.isInitialised, true);
    assert.equal(viewModel.getFrame(), null);
});

test('AUT-046 view model: a real breakthrough purchase through GameRuntime yields one Major toast with the breakthrough name', () => {
    const runtime = new GameRuntime(repository, seeded());
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(runtime.getStateSnapshot());
    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: AUT046_BREAKTHROUGH_ID });
    assert.equal(result.ok, true);
    const state = runtime.getStateSnapshot();
    const update = viewModel.consumeEvents(state, result.events);
    assert.equal(update.accepted.length, 1);
    assert.deepEqual(update.exceptional, [], 'no Exceptional reveal in this burst: the focus is allowed');
    assert.equal(update.accepted[0].focusSuppressed, false);
    assert.equal(update.outcome?.started.length, 1);
    assert.equal(viewModel.getFrame()?.item.trigger.key, 'b:robotic_logistics');
    assert.deepEqual(X.formatMilestoneToast(update.accepted[0], repository), { title: 'Robotic Logistics', subtitle: 'Breakthrough unlocked' });
    assert.equal(viewModel.consumeEvents(state, result.events).accepted.length, 0, 'the same events delivered again never double-fire');
    assert.equal(viewModel.syncFromState(state).accepted.length, 0, 'a late snapshot never double-fires');
});

test('AUT-046 view model: snapshot-before-event and event-before-snapshot both fire exactly once', () => {
    const base = seeded();
    const after = seeded();
    after.run.purchasedBreakthroughIds = [...after.run.purchasedBreakthroughIds, 'robotic_logistics'];
    const snapshotFirst = new MilestonePresentationViewModel();
    snapshotFirst.syncFromState(base);
    assert.equal(snapshotFirst.syncFromState(after).accepted.length, 1);
    assert.equal(snapshotFirst.consumeEvents(after, [breakthroughEvent('robotic_logistics')]).accepted.length, 0);
    const eventFirst = new MilestonePresentationViewModel();
    eventFirst.syncFromState(base);
    assert.equal(eventFirst.consumeEvents(after, [breakthroughEvent('robotic_logistics')]).accepted.length, 1);
    assert.equal(eventFirst.syncFromState(after).accepted.length, 0);
});

test('AUT-046 view model: milestone / robots fire once per run; Reboot clears the queue and the same milestones can present again', () => {
    const viewModel = new MilestonePresentationViewModel();
    const state = seeded();
    viewModel.syncFromState(state);
    const events = [milestoneEvent('fabricator', 100), robotsEvent(1000)];
    assert.equal(viewModel.consumeEvents(state, events).accepted.length, 2);
    assert.equal(viewModel.consumeEvents(state, events).accepted.length, 0, 'milestone / robots events are deduplicated by fact key');
    const reboot = createFreshGameState();
    const update = viewModel.consumeEvents(reboot, [rebootEvent()]);
    assert.equal(update.rebooted, true);
    assert.deepEqual(update.exceptional, ['rebootCompleted']);
    assert.equal(viewModel.getFrame(), null, 'Reboot clears the visible toast');
    assert.equal(viewModel.consumeEvents(reboot, events).accepted.length, 2, 'the same milestones present again in the next run');
    const lateReboot = new MilestonePresentationViewModel();
    lateReboot.syncFromState(state);
    const reset = lateReboot.syncFromState(createFreshGameState());
    assert.deepEqual([reset.rebooted, reset.accepted.length], [true, 0], 'a snapshot that shows facts vanished re-baselines silently');
});

test('AUT-046 view model: an Exceptional event in the burst suppresses the focus only (toast still shown); a breakthrough that constructs a producer shows one Major', () => {
    const state = seeded();
    const viewModel = new MilestonePresentationViewModel();
    viewModel.syncFromState(state);
    const era: DomainEvent = { type: 'eraChanged', oldEraId: 'manual_workshop', newEraId: 'automated_factory' };
    const update = viewModel.consumeEvents(state, [constructedEvent('robot_line'), era]);
    assert.deepEqual(update.exceptional, ['eraChanged']);
    assert.deepEqual(update.accepted.map((t) => t.key), ['c:robot_line']);
    assert.equal(update.outcome?.started.length, 1, 'the toast is shown');

    const second = new MilestonePresentationViewModel();
    second.syncFromState(state);
    const burst = second.consumeEvents(state, [breakthroughEvent('advanced_robotics'), constructedEvent('advanced_robotics_complex', 'breakthrough', 'advanced_robotics'), { type: 'eraChanged', oldEraId: 'automated_factory', newEraId: 'robotics_complex', breakthroughId: 'advanced_robotics' }]);
    assert.deepEqual(burst.accepted.map((t) => t.key), ['b:advanced_robotics'], 'the construction is subsumed by the breakthrough toast');
    assert.equal(burst.accepted[0].focusSuppressed, true, 'the era / construction reveal owns the camera');
    assert.deepEqual(burst.skipped, [{ key: 'c:advanced_robotics_complex', reason: 'subsumed' }]);

    const first = new MilestonePresentationViewModel();
    first.syncFromState(state);
    const robot = first.consumeEvents(state, [{ type: 'firstRobotProduced', breakthroughId: 'worker_bot' }]);
    assert.deepEqual([robot.exceptional, robot.accepted.length], [['firstRobotProduced'], 0], 'first robot is routed, never duplicated');
});

// ---------------------------------------------------------------------------------------------------------------
// Focus gating and effects

test('AUT-046 focus: Minor never; Major only when off-centre, nothing else owns the camera, no Exceptional reveal / construction / burst', () => {
    const major = trigger(breakthroughEvent('robotic_logistics'));
    const base = { trigger: major, cameraFocus: { x: -2.5, z: 0 }, target: { x: 3, z: 0 }, exceptionalRevealActive: false, cameraFocusActive: false };
    assert.deepEqual(F.resolveMilestoneFocus(base), { focus: true, reason: 'requested' });
    assert.equal(F.resolveMilestoneFocus({ ...base, trigger: trigger(milestoneEvent()) }).focus, false, 'Minor never focuses');
    assert.equal(F.resolveMilestoneFocus({ ...base, trigger: trigger(automationEvent('assembly_station')) }).reason, 'not_major');
    assert.equal(F.resolveMilestoneFocus({ ...base, target: { x: -2.4, z: 0.5 } }).reason, 'on_centre');
    assert.equal(F.resolveMilestoneFocus({ ...base, exceptionalRevealActive: true }).reason, 'reveal_active');
    assert.equal(F.resolveMilestoneFocus({ ...base, cameraFocusActive: true }).reason, 'camera_busy');
    assert.equal(F.resolveMilestoneFocus({ ...base, trigger: { ...major, focusSuppressed: true } }).reason, 'suppressed_by_exceptional');
    assert.equal(F.resolveMilestoneFocus({ ...base, trigger: trigger(constructedEvent('robot_line')) }).reason, 'no_target', 'producerConstructed never focuses (AUT-040 owns it)');
    assert.equal(F.resolveMilestoneFocus({ ...base, target: null }).reason, 'no_target');
    assert.equal(F.resolveMilestoneFocus({ ...base, cameraFocus: null }).reason, 'no_camera');
});

test('AUT-046 effects: Minor = short pulse, no sparks; Major = 4-6 sparks + about 1 s pulse; accents never red', () => {
    const minor = trigger(milestoneEvent());
    const major = trigger(breakthroughEvent('robotic_logistics'));
    assert.equal(F.sampleMilestoneEffect(minor, 0.25).sparkIntensity, 0);
    assert.ok(F.sampleMilestoneEffect(minor, 0.25).pulse > 0.9);
    assert.equal(F.sampleMilestoneEffect(minor, 0.5).complete, true);
    assert.ok(F.sampleMilestoneEffect(major, 0.4).sparkIntensity > 0.9);
    assert.equal(F.MILESTONE_PULSE_SECONDS.major, 1.0);
    assert.equal(F.sampleMilestoneEffect(major, 1.0).complete, true);
    assert.ok(F.MILESTONE_SPARK_COUNT >= 4 && F.MILESTONE_SPARK_COUNT <= 6);
    assert.deepEqual(F.sampleMilestoneEffect(trigger(constructedEvent('robot_line')), 0.3), { pulse: 0, sparkIntensity: 0, complete: true }, 'construction toast: no effect');
    for (const rgb of Object.values(F.MILESTONE_ACCENT_RGB)) assert.ok(!(rgb.r > rgb.g + 60 && rgb.r > rgb.b + 60 && rgb.g < 90), 'never red');
    assert.ok(F.MILESTONE_ACCENT_RGB.cyan.b < 224 && F.MILESTONE_ACCENT_RGB.cyan.g < 206, 'cyan accent is dimmer than the producer lamps (82,206,224)');
    assert.ok(F.sampleMilestoneEffect(major, 0.3).pulse === 1 && F.sampleMilestoneEffect(major, 0.5).pulse === 1, 'the Major pulse plateaus at full strength (clearly visible)');
    assert.ok(L.MILESTONE_TOAST_COLORS.pill.a >= 240, 'the pill is nearly opaque');
    for (const accent of ['amber', 'cyan'] as const) {
        const title = L.MILESTONE_TOAST_COLORS.titleAccent[accent];
        const plain = L.MILESTONE_TOAST_COLORS.text;
        assert.notDeepEqual([title.r, title.g, title.b], [plain.r, plain.g, plain.b], 'the title carries the accent colour');
    }
    assert.ok(L.MILESTONE_TOAST_COLORS.accent.cyan.g < 206 && L.MILESTONE_TOAST_COLORS.titleAccent.cyan.g < 206, 'toast cyan stays dimmer than the lamps');
});

// ---------------------------------------------------------------------------------------------------------------
// Wording and layout

test('AUT-046 wording: chip "<producer> <milestone>", "automated", "built", breakthrough title + subtitle, robots title, "+N"; never an x multiplier headline', () => {
    const names = repository;
    assert.deepEqual(X.formatMilestoneToast(trigger(milestoneEvent('fabricator', 25)), names), { title: 'Fabricator Lv 25', subtitle: null });
    assert.deepEqual(X.formatMilestoneToast(trigger(automationEvent('assembly_station')), names), { title: 'Assembly Station automated', subtitle: null });
    assert.deepEqual(X.formatMilestoneToast(trigger(constructedEvent('robot_line')), names), { title: 'Robot Line built', subtitle: null });
    assert.deepEqual(X.formatMilestoneToast(trigger(breakthroughEvent('worker_bot')), names), { title: 'Worker Bot', subtitle: 'Breakthrough unlocked' });
    assert.deepEqual(X.formatMilestoneToast(trigger(robotsEvent(100)), names), { title: 'Robots built: 100', subtitle: 'Robot output milestone' });
    assert.equal(X.formatMilestoneToast(trigger(milestoneEvent('fabricator', 25)), names, 2).title, 'Fabricator Lv 25 +2');
    assert.equal(X.formatMilestoneToast(trigger(breakthroughEvent('worker_bot')), null).title, 'New breakthrough', 'no name source: generic text, never a key');
    assert.equal(X.formatMilestoneToast(trigger(milestoneEvent('mystery', 10)), names).title, 'Producer Lv 10');
    for (const event of [milestoneEvent('fabricator', 25), automationEvent('robot_line'), constructedEvent('robot_line'), breakthroughEvent('worker_bot'), robotsEvent(10)]) {
        const text = X.formatMilestoneToast(trigger(event), names);
        assert.doesNotMatch(`${text.title} ${text.subtitle ?? ''}`, /×|\bx\d|multiplier|\{|\}|milestone\./i);
    }
});

test('AUT-046 layout: one band below the HUD and above the panel, never over Next Goal / buttons, readable fonts', () => {
    assert.equal(L.milestoneToastFontsReadable(), true);
    for (const screen of [{ w: 720, h: 1280 }, { w: 1080, h: 1920 }, { w: 1080, h: 2412 }, { w: 1080, h: 2340 }, { w: 1440, h: 3120 }]) {
        const ui = computeUiLayout(screen);
        for (const tier of ['minor', 'major'] as const) {
            const rect = L.computeMilestoneToastRect(screen, undefined, tier);
            const label = `${screen.w}x${screen.h} ${tier}`;
            assert.equal(rectsOverlap(rect, ui.hud), false, `${label}: not over the HUD (Next Goal row / action)`);
            assert.equal(rectsOverlap(rect, ui.panel), false, `${label}: not over the panel`);
            assert.equal(rectsOverlap(rect, ui.hudButtons.NextGoalAction), false);
            assert.equal(rectsOverlap(rect, ui.hudButtons.ManualProduceAction), false);
            for (const button of Object.values(ui.buttons)) assert.equal(rectsOverlap(rect, button), false);
            assert.equal(rectContains(ui.safeArea, rect), true);
            assert.equal(rect.y + rect.h <= ui.hud.y + 1e-6, true);
            assert.equal(rect.y >= ui.panel.y + ui.panel.h, true);
        }
        assert.equal(L.milestoneToastFitsFactoryBand(screen), true);
        assert.ok(L.computeMilestoneToastRect(screen).h <= ui.factoryBand.h * 0.2, 'the band stays a small part of the factory view');
    }
    assert.ok(L.MILESTONE_TOAST_LAYOUT.major.width <= 720 - 32 && L.MILESTONE_TOAST_LAYOUT.minor.width <= L.MILESTONE_TOAST_LAYOUT.major.width);
    const major = L.MILESTONE_TOAST_LAYOUT.major;
    assert.ok(major.underlineCenterY - major.underlineHeight / 2 >= -major.height, 'underline inside the pill');
    const accent = L.MILESTONE_TOAST_COLORS.accent;
    assert.ok(accent.amber.r > accent.amber.b && accent.cyan.b > accent.cyan.r, 'amber / cyan accents');
});

// ---------------------------------------------------------------------------------------------------------------
// Wiring and presentation-only guarantees

test('AUT-046 wiring: PresentationController feeds the pipeline last; bootstrap builds a touch-transparent band, pulse plates and wires names; diagnostics event declared', () => {
    const registry = presentation('PresentationController.ts');
    assert.match(registry, /this\.milestonePresentation\?\.sync\(/);
    assert.match(registry, /this\.milestonePresentation\?\.consumeDomainEvents\(state, events\)/);
    assert.ok(registry.indexOf('this.constructionPresentation?.consumeDomainEvents') < registry.indexOf('this.milestonePresentation?.consumeDomainEvents'), 'owner reveals first');
    assert.ok(registry.indexOf('this.eraEnvironmentVisual?.consumeDomainEvents') < registry.indexOf('this.milestonePresentation?.consumeDomainEvents'));
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /this\.createMilestonePresentation\(site\);/);
    assert.ok(bootstrap.indexOf('this.createUiRoot(site)') < bootstrap.indexOf('this.createMilestonePresentation(site)'), 'the UI root exists first');
    assert.match(bootstrap, /addComponent\(MilestonePresentationController\)/);
    assert.match(bootstrap, /widget\.top = milestoneToastTopOffset\(\)/);
    assert.match(bootstrap, /controller\.resolveProducerAnchor = /);
    assert.match(bootstrap, /MilestonePulse_\$\{accent\}/);
    assert.match(bootstrap, /milestonePresentation\.setNameSource\(displayNames\)/);
    assert.ok(bootstrap.indexOf('binding.init()') < bootstrap.indexOf('milestonePresentation.setNameSource(displayNames)'), 'the load baseline is taken before names exist; names never cause a toast');
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('milestone_presentation'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('milestone_presentation'));
    assert.match(presentation('DeviceDiagnostics.ts'), /AUT-046: milestone/);
    assert.match(code('ConstructionPresentationController.ts'), /public isAnyConstructing\(\): boolean/);
});

test('AUT-046 controller: thin cc wrapper, no touch listener, no new camera API, no GameState write or command, scale-based visibility, no ctor parameter properties', () => {
    const controller = code('MilestonePresentationController.ts');
    assert.doesNotMatch(controller, /\.on\(\s*(Node\.EventType|Input)|input\.on|TOUCH_|swallowTouch|Button|BlockInputEvents/, 'touch-transparent: never claims or reads a touch');
    assert.match(controller, /focusOnRevealTarget\(anchor\.worldPosition\)/);
    assert.doesNotMatch(controller, /focusOnWorldTarget|snapToWorldTarget|applyConfiguredInitialView|setFocusBounds/, 'only the existing reveal focus API');
    assert.doesNotMatch(controller, /commandEmitter|submit\(|execute\(|state\.run\.\w+\s*=[^=]|\.node\.active|\.active\s*=/, 'never writes state, never submits a command, no node.active');
    assert.match(controller, /setScale\(0, 0, 0\)/);
    assert.match(controller, /addComponent\(Graphics\)/, 'solid fills through Graphics (a spriteFrame-less Sprite renders nothing)');
    assert.doesNotMatch(controller, /addComponent\(Sprite\)/);
    assert.match(controller, /'pulse_started'/);
    assert.match(controller, /'sparks_started'/);
    const files = ['MilestoneTier', 'MilestoneToastQueue', 'MilestoneFeedback', 'MilestoneToastText', 'MilestoneToastLayout', 'MilestonePresentationViewModel', 'MilestonePresentationController'];
    for (const file of files) {
        assert.doesNotMatch(code(`${file}.ts`), /constructor\s*\(\s*(public|private|protected|readonly)\s/, `${file}: no constructor parameter properties`);
        if (file !== 'MilestonePresentationController') {
            assert.doesNotMatch(presentation(`${file}.ts`), /from '\x63c'/, `${file} is engine-free`);
            assert.doesNotMatch(code(`${file}.ts`), /GameCommand|commandEmitter/, `${file} submits no command`);
        }
    }
    const uuids = new Set<string>();
    for (const file of files) {
        const meta = JSON.parse(presentation(`${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^a0460000-0000-4000-8000-\d{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, files.length, 'unique meta uuids');
});

test('AUT-046 no new asset or scene churn: the scene file does not mention the milestone nodes (runtime-built only)', () => {
    assert.doesNotMatch(read('assets/scenes/factory/FactoryWorld.scene'), /MilestonePresentationController|MilestoneToast|MilestonePulse/);
});

// ---------------------------------------------------------------------------------------------------------------
// Seed

test('AUT-046 seed: one tap before a Major (Next Goal = Robotic Logistics, affordable), save round-trips, no Exceptional in the burst, command registered', () => {
    assert.deepEqual([...AUT046_SEED_VARIANTS], ['breakthrough']);
    assert.equal(isAut046SeedVariant('breakthrough'), true);
    assert.equal(isAut046SeedVariant('x'), false);
    const state = buildAut046SeededState();
    assert.equal(repository.getBreakthrough(AUT046_BREAKTHROUGH_ID)?.cost, AUT046_BREAKTHROUGH_COST, 'the seed constant matches the economy data');
    assert.ok(state.run.industrialOutput >= AUT046_BREAKTHROUGH_COST);
    assert.deepEqual(resolveNextGoal(repository, state).focusTarget, { kind: 'breakthrough', breakthroughId: AUT046_BREAKTHROUGH_ID });
    assert.deepEqual(resolveNextGoalAction(createHudViewModel(repository, state).nextGoal), { visible: true, enabled: true, command: { type: 'purchaseBreakthrough', breakthroughId: AUT046_BREAKTHROUGH_ID }, breakthroughId: AUT046_BREAKTHROUGH_ID });
    const loaded = deserializeGameStateFromSaveJson(buildAut046SeededSave('breakthrough', Date.now()));
    assert.deepEqual(loaded.diagnostics, []);
    assert.deepEqual(loaded.state.run.purchasedBreakthroughIds, ['auto_feeder', 'worker_bot']);
    const viewModel = new MilestonePresentationViewModel();
    assert.equal(viewModel.syncFromState(loaded.state).accepted.length, 0, 'loading the seed is silent');
    const runtime = new GameRuntime(repository, loaded.state);
    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: AUT046_BREAKTHROUGH_ID });
    assert.equal(result.ok, true);
    const update = viewModel.consumeEvents(runtime.getStateSnapshot(), result.events);
    assert.deepEqual(update.accepted.map((t) => [t.key, t.tier, t.focusSuppressed]), [['b:robotic_logistics', 'major', false]]);
    assert.deepEqual(update.exceptional, []);

    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['device:seed-aut046'], /tools\/device\/cli\.ts seed-aut046$/);
    assert.match(pkg.scripts['device:seed-aut045'], /seed-aut045$/, 'the AUT-045 seed command is untouched');
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut046'/);
    assert.match(cli, /seed-aut046 \[--variant breakthrough\]/);
});
