/**
 * AUT-INFRA-002 live reveal evidence capture (DEBUG FactoryWorld APK, run-as).
 *
 *   start logcat -> seed + launch (aut043 variant `unbuilt` by default) -> wait for `ui_layout` -> baseline frame ->
 *   optional trigger (tap the HUD Next Goal action) -> burst screencaps for `durationMs` -> timeline of frames and
 *   `[AUT-DEVICE]` events -> automatic objective checks -> frames + `timeline.json` + `summary.md` under `temp/reveal/`.
 *
 * The frames are PNGs meant for the vision-capable visual QA review (CLAUDE.md "Review policy"): the checks below only
 * prove the event chain (construction started/activated, camera focus started/settled, zero errors), the frame
 * sequence proves presence/framing/readability over time. Subjective feel stays with the owner.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { REPO_ROOT } from './artifacts.ts';
import { cocosToAdb } from './classification.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { pngSize } from './adb.ts';
import { seedAut043, type Aut043SeedVariant } from './seed_aut043.ts';
import { seedAut044 } from './seed_aut044.ts';
import { parseHudActions } from './scenarios/ui001_core_loop.ts';
import { parseUiLayout, rectCentre } from './ui_geometry.ts';

export type RevealTrigger = 'none' | 'next-goal';

export interface RevealCaptureOptions {
    readonly label: string;
    /** Seeds the save and launches the app (default: AUT-043 `unbuilt`). */
    readonly seed?: (driver: SessionDeviceDriver, packageName: string, activity: string) => Promise<unknown>;
    readonly trigger?: RevealTrigger;
    /** Event types whose arrival is recorded in the timeline (default: reveal-relevant ones). */
    readonly eventTypes?: readonly string[];
    /** Producer id whose `construction_state` started/activated chain must be observed (null = not required). */
    readonly expectConstruction?: string | null;
    readonly expectFocus?: boolean;
    readonly preMs?: number;
    readonly durationMs?: number;
    readonly intervalMs?: number;
    readonly layoutTimeoutMs?: number;
    readonly packageName?: string;
    readonly activity?: string;
    readonly outDir?: string;
}

export interface TimelineFrame { readonly index: number; readonly tMs: number; readonly file: string; readonly phase: 'baseline' | 'pre' | 'post' }
export interface TimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface RevealCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

export interface RevealCaptureResult {
    readonly ok: boolean;
    readonly outDir: string;
    readonly frames: readonly TimelineFrame[];
    readonly events: readonly TimelineEvent[];
    readonly checks: readonly RevealCheck[];
}

export const DEFAULT_REVEAL_EVENT_TYPES: readonly string[] = Object.freeze([
    'scene_ready', 'session_state', 'ui_layout', 'command_result', 'construction_state', 'camera_focus', 'reveal_state',
    'robot_state', 'robot_line_state', 'automated_cell_state', 'advanced_robotics_complex_state', 'era_environment_state', 'robot_population', 'error',
]);

/** A named live-reveal scenario: the seed (unbuilt variant), the producer whose construction must be observed and whether a camera focus is expected. */
export interface RevealScenario {
    readonly id: string;
    readonly label: string;
    readonly seed: (driver: SessionDeviceDriver, packageName: string, activity: string) => Promise<unknown>;
    readonly expectConstruction: string;
    readonly expectFocus: boolean;
}

export const DEFAULT_REVEAL_SCENARIO_ID = 'aut043';

/** Scenario table (pure data, unit-tested): `--scenario aut043|aut044`; aut043 stays the default. */
export const REVEAL_SCENARIOS: Readonly<Record<string, RevealScenario>> = Object.freeze({
    aut043: { id: 'aut043', label: 'aut043-cell', seed: (d, pkg, act) => seedAut043(d, pkg, act, 'unbuilt'), expectConstruction: 'automated_cell', expectFocus: true },
    aut044: { id: 'aut044', label: 'aut044-arc', seed: (d, pkg, act) => seedAut044(d, pkg, act, 'unbuilt'), expectConstruction: 'advanced_robotics_complex', expectFocus: true },
});

export function resolveRevealScenario(id: unknown): RevealScenario | null {
    const key = id === undefined || id === true ? DEFAULT_REVEAL_SCENARIO_ID : id;
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(REVEAL_SCENARIOS, key) ? REVEAL_SCENARIOS[key] : null;
}

/** Objective checks over a timeline (pure, unit-tested). `tMs` is relative to the trigger (negative = before). */
export function evaluateRevealTimeline(events: readonly TimelineEvent[], options: { expectConstruction: string | null; expectFocus: boolean; triggered: boolean; frameCount: number }): RevealCheck[] {
    const checks: RevealCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'no_error_events', ok: errors.length === 0, detail: `${errors.length} error events` });
    checks.push({ id: 'frames_captured', ok: options.frameCount >= 4, detail: `${options.frameCount} frames` });
    if (options.expectConstruction) {
        const producer = options.expectConstruction;
        const started = events.find((e) => e.event.evt === 'construction_state' && e.event.phase === 'started' && e.event.producerId === producer);
        const activated = events.find((e) => e.event.evt === 'construction_state' && e.event.phase === 'activated' && e.event.producerId === producer);
        checks.push({ id: 'construction_started', ok: started !== undefined, detail: started ? `t=${started.tMs}ms modules=${JSON.stringify(started.event.modules ?? null)}` : 'not observed' });
        const gap = started && activated ? activated.tMs - started.tMs : null;
        // The sequence lasts 1.5-3 s; frame cadence widens the observed gap, so allow slack.
        checks.push({ id: 'construction_activated', ok: activated !== undefined && gap !== null && gap >= 0 && gap <= 6000, detail: activated ? `t=${activated.tMs}ms gap=${gap}ms` : 'not observed' });
        if (options.triggered) checks.push({ id: 'construction_after_trigger', ok: started !== undefined && started.tMs >= -200, detail: started ? `started at ${started.tMs}ms relative to the tap` : 'not observed' });
    }
    if (options.expectFocus) {
        const focus = events.find((e) => e.event.evt === 'camera_focus' && e.event.phase === 'started' && e.event.kind === 'reveal');
        const settled = focus ? events.find((e) => e.event.evt === 'camera_focus' && (e.event.phase === 'settled' || e.event.phase === 'cancelled') && Number(e.event.seq) > Number(focus.event.seq)) : undefined;
        checks.push({ id: 'camera_focus_started', ok: focus !== undefined, detail: focus ? `t=${focus.tMs}ms target=${JSON.stringify(focus.event.target ?? null)}` : 'not observed' });
        checks.push({ id: 'camera_focus_finished', ok: settled !== undefined, detail: settled ? `t=${settled.tMs}ms ${String(settled.event.phase)}` : 'not observed' });
    }
    return checks;
}

export function renderRevealSummary(label: string, frames: readonly TimelineFrame[], events: readonly TimelineEvent[], checks: readonly RevealCheck[]): string {
    const lines = [`# Reveal capture: ${label}`, '', '| check | ok | detail |', '|---|---|---|', ...checks.map((c) => `| ${c.id} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail} |`), '', '## Frames', '',
        ...frames.map((f) => `- ${f.file} (t=${f.tMs} ms, ${f.phase})`), '', '## Events (relative to trigger)', '',
        ...events.filter((e) => e.event.evt !== 'ui_layout').map((e) => `- t=${e.tMs} ms ${e.event.evt}${typeof e.event.phase === 'string' ? `:${e.event.phase}` : ''}`)];
    return `${lines.join('\n')}\n`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runRevealCapture(driver: SessionDeviceDriver, options: RevealCaptureOptions): Promise<RevealCaptureResult> {
    const packageName = options.packageName ?? 'com.projectautomata.androidbaseline';
    const activity = options.activity ?? 'com.cocos.game.AppActivity';
    const trigger = options.trigger ?? 'next-goal';
    const types = new Set(options.eventTypes ?? DEFAULT_REVEAL_EVENT_TYPES);
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17);
    const outDir = options.outDir ?? path.join(REPO_ROOT, 'temp', 'reveal', `${options.label}-${stamp}`);
    mkdirSync(path.join(outDir, 'frames'), { recursive: true });

    await driver.forceStop(packageName);
    await driver.logcatClear();
    const stream = driver.startLogcat(path.join(outDir, 'logcat.txt'));
    const seed = options.seed ?? ((d, pkg, act) => seedAut043(d, pkg, act, 'unbuilt' satisfies Aut043SeedVariant));
    await seed(driver, packageName, activity);

    const layoutHit = await stream.waitFor((e) => e.evt === 'ui_layout', 0, options.layoutTimeoutMs ?? 60_000);
    const layout = parseUiLayout(layoutHit?.event);
    const frames: TimelineFrame[] = [];
    const events: TimelineEvent[] = [];
    let cursor = 0;
    let t0 = Date.now();
    const collect = (now: number) => {
        for (const record of stream.recordsSince(cursor)) {
            if (record.event && types.has(String(record.event.evt))) events.push({ tMs: now - t0, event: record.event });
        }
        cursor = stream.cursor;
    };
    const frame = async (phase: TimelineFrame['phase']) => {
        const png = await driver.screencap();
        const now = Date.now();
        const index = frames.length;
        const file = `frames/${String(index).padStart(3, '0')}-${phase}.png`;
        writeFileSync(path.join(outDir, file), png);
        frames.push({ index, tMs: now - t0, file, phase });
        collect(now);
        return png;
    };

    let triggered = false;
    let tapDetail = 'no trigger';
    if (layout) {
        await sleep(options.preMs ?? 2_000);
        const baseline = await frame('baseline');
        if (trigger === 'next-goal') {
            const display = pngSize(baseline);
            const rect = parseHudActions(layoutHit?.event).rects.NextGoalAction;
            if (display && rect) {
                const point = cocosToAdb(rectCentre(rect), { w: layout.screen.w, h: layout.screen.h }, display);
                t0 = Date.now();
                await driver.tap(Math.round(point.x), Math.round(point.y));
                triggered = true;
                tapDetail = `tapped NextGoalAction at ${Math.round(point.x)},${Math.round(point.y)}`;
            } else {
                tapDetail = 'NextGoalAction rect or display size missing';
            }
        }
    }
    const end = Date.now() + (options.durationMs ?? 9_000);
    while (Date.now() < end) {
        await frame(triggered ? 'post' : 'pre');
        await sleep(options.intervalMs ?? 150);
    }
    collect(Date.now());
    await driver.stopLogcat();

    const checks = evaluateRevealTimeline(events, { expectConstruction: options.expectConstruction ?? null, expectFocus: options.expectFocus ?? false, triggered, frameCount: frames.length });
    checks.unshift({ id: 'ui_layout_ready', ok: layout !== null, detail: layout ? 'ui_layout received' : 'no ui_layout (app did not reach the HUD)' });
    if (trigger !== 'none') checks.splice(1, 0, { id: 'trigger_sent', ok: triggered, detail: tapDetail });
    writeFileSync(path.join(outDir, 'timeline.json'), `${JSON.stringify({ label: options.label, frames, events, checks }, null, 2)}\n`);
    writeFileSync(path.join(outDir, 'summary.md'), renderRevealSummary(options.label, frames, events, checks));
    return { ok: checks.every((c) => c.ok), outDir, frames, events, checks };
}
