import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParsedDeviceEvent } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { evaluateRevealTimeline, renderRevealSummary, type TimelineEvent, type TimelineFrame } from '../tools/device/reveal_capture.ts';

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
