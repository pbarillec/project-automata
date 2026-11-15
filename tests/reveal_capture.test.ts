import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParsedDeviceEvent } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, DEFAULT_REVEAL_SCENARIO_ID, REVEAL_SCENARIOS, evaluateRevealTimeline, renderRevealSummary, resolveRevealScenario, type TimelineEvent, type TimelineFrame } from '../tools/device/reveal_capture.ts';

const ev = (tMs: number, evt: string, extra: Record<string, unknown> = {}): TimelineEvent => ({ tMs, event: { v: 1, seq: tMs, evt, ...extra } as unknown as ParsedDeviceEvent });
const base = { expectConstruction: 'automated_cell', expectFocus: true, triggered: true, frameCount: 20 };

test('a complete reveal chain passes every objective check', () => {
    const checks = evaluateRevealTimeline([
        ev(120, 'construction_state', { phase: 'started', producerId: 'automated_cell', modules: ['a'] }),
        ev(150, 'camera_focus', { phase: 'started', kind: 'reveal', target: { x: 2.3 } }),
        ev(2500, 'construction_state', { phase: 'activated', producerId: 'automated_cell' }),
        ev(3200, 'camera_focus', { phase: 'settled' }),
    ], base);
    assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
});

test('missing construction, focus, or an error event fails the matching check', () => {
    const none = evaluateRevealTimeline([], base);
    assert.deepEqual(none.filter((c) => !c.ok).map((c) => c.id).sort(), ['camera_focus_finished', 'camera_focus_started', 'construction_activated', 'construction_after_trigger', 'construction_started']);
    const err = evaluateRevealTimeline([ev(10, 'error', { message: 'x' })], { ...base, expectConstruction: null, expectFocus: false });
    assert.equal(err.find((c) => c.id === 'no_error_events')?.ok, false);
});

test('a construction that never activates, or activates far too late, fails', () => {
    const late = evaluateRevealTimeline([
        ev(100, 'construction_state', { phase: 'started', producerId: 'automated_cell' }),
        ev(9000, 'construction_state', { phase: 'activated', producerId: 'automated_cell' }),
    ], { ...base, expectFocus: false });
    assert.equal(late.find((c) => c.id === 'construction_activated')?.ok, false);
});

test('too few frames fail and the summary lists frames, checks and relative events', () => {
    const frames: TimelineFrame[] = [{ index: 0, tMs: -2000, file: 'frames/000-baseline.png', phase: 'baseline' }];
    const checks = evaluateRevealTimeline([ev(5, 'construction_state', { phase: 'started', producerId: 'automated_cell' })], { ...base, frameCount: 1 });
    assert.equal(checks.find((c) => c.id === 'frames_captured')?.ok, false);
    const md = renderRevealSummary('x', frames, [ev(5, 'construction_state', { phase: 'started' })], checks);
    assert.match(md, /frames\/000-baseline\.png/);
    assert.match(md, /t=5 ms construction_state:started/);
});

test('reveal scenarios: aut043 stays the default, aut044 selects the Advanced Robotics Complex seed and expectations', () => {
    assert.deepEqual(Object.keys(REVEAL_SCENARIOS).sort(), ['aut043', 'aut044', 'aut046', 'aut047', 'aut048', 'aut048-era3', 'aut048-era3-live', 'aut049', 'aut049-post', 'aut050', 'aut051', 'aut051-reload', 'aut051-short', 'aut052', 'aut055-closed', 'aut055-failed', 'aut055-ineligible', 'aut055-success', 'aut056-closed', 'aut056-failed', 'aut056-free-active', 'aut056-interval', 'aut056-quota', 'aut056-resume', 'aut056-success', 'aut057-extended', 'aut057-no-fill', 'aut057-offline-double', 'aut059-available', 'aut059-cancel', 'aut059-fail', 'aut059-hidden', 'aut059-locked', 'aut059-owned', 'aut059-pending', 'aut059-purchase-success', 'aut060-cancel', 'aut060-license-tester-purchase', 'aut060-restore-owned', 'aut061-restore-reinstall', 'aut061-restore-store-error', 'aut062-mid-session', 'aut062-not-owned', 'aut062-owned-first', 'aut062-owned-many', 'aut062-reload', 'aut065-error', 'aut065-no-privacy-row', 'aut065-not-required', 'aut065-privacy-row', 'aut065-required-declined', 'aut065-required-obtained', 'aut065-timeout', 'aut065-ump-eea', 'aut066-ai-core', 'aut066-factory', 'aut066-panel', 'aut066-toast-breakthrough', 'aut067-baseline', 'aut067-baseline-founder', 'aut069-qa-offline', 'aut069-qa-patches', 'rbt001', 'ui003']);
    assert.equal(DEFAULT_REVEAL_SCENARIO_ID, 'aut043');
    assert.equal(resolveRevealScenario(undefined)?.id, 'aut043', 'no --scenario = the AUT-043 default');
    assert.equal(resolveRevealScenario(true)?.id, 'aut043', 'a bare --scenario flag falls back to the default');
    const cell = resolveRevealScenario('aut043')!;
    assert.deepEqual([cell.label, cell.expectConstruction, cell.expectFocus], ['aut043-cell', 'automated_cell', true]);
    const arc = resolveRevealScenario('aut044')!;
    assert.deepEqual([arc.label, arc.expectConstruction, arc.expectFocus], ['aut044-arc', 'advanced_robotics_complex', true]);
    assert.notEqual(arc.seed, cell.seed);
    assert.equal(resolveRevealScenario('aut045'), null, 'unknown scenarios are rejected');
    assert.equal(resolveRevealScenario('__proto__'), null);
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('advanced_robotics_complex_state'), 'the AUT-044 DEBUG event is recorded in the timeline');
    const arcChain = [
        ev(100, 'construction_state', { phase: 'started', producerId: 'advanced_robotics_complex' }),
        ev(150, 'camera_focus', { phase: 'started', kind: 'reveal' }),
        ev(2500, 'construction_state', { phase: 'activated', producerId: 'advanced_robotics_complex' }),
        ev(3200, 'camera_focus', { phase: 'settled' }),
    ];
    const options = { expectConstruction: arc.expectConstruction, expectFocus: arc.expectFocus, triggered: true, frameCount: 20 };
    assert.ok(evaluateRevealTimeline(arcChain, options).every((c) => c.ok));
    assert.equal(evaluateRevealTimeline(arcChain, { ...options, expectConstruction: cell.expectConstruction }).find((c) => c.id === 'construction_started')?.ok, false);
});
