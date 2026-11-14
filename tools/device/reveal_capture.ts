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
import { seedAut046 } from './seed_aut046.ts';
import { seedAut047 } from './seed_aut047.ts';
import { seedAut048, seedAut048Era3Live } from './seed_aut048.ts';
import { seedAut049 } from './seed_aut049.ts';
import { seedAut051 } from './seed_aut051.ts';
import { OFFLINE_RELAUNCH_MARKER_EVT, evaluateOfflineReport, type OfflineReportExpectation } from './offline_report_checks.ts';
import { seedUi003 } from './seed_ui003.ts';
import { parseHudActions } from './scenarios/ui001_core_loop.ts';
import { parseUiLayout, rectCentre, toRect } from './ui_geometry.ts';

/** robot-line-build (AUT-048 Era II): tap the Robot Line zone (projected position), then the producer panel x1 button: both existing player tap paths. */
export type RevealTrigger = 'none' | 'next-goal' | 'overclock' | 'robot-line-build' | 'offline-collect';

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
    readonly expectBoostPhases?: readonly string[];
    /** AUT-048: era id whose title card must start / finish (a string), or 'none' when the capture must show NO era card (silent load). */
    readonly expectEraTitle?: string;
    /** AUT-049: 'sequence' = the 4 s Reboot sequence must start / finish; 'silent' = a load with the persistent socket and NO sequence. */
    readonly expectReboot?: RebootExpectation;
    /** AUT-051: 'collect' = tap COLLECT on the card, then force-stop + relaunch WITHOUT reseeding (no card, reward persisted); 'reload' = force-stop BEFORE Collect and relaunch (the card shows again with the same reward). */
    readonly expectOfflineReport?: OfflineReportExpectation;
    /** AUT-UI-003: command types whose accepted `command_result` (ok) must be observed. */
    readonly expectCommands?: readonly string[];
    readonly preMs?: number;
    readonly durationMs?: number;
    readonly intervalMs?: number;
    readonly layoutTimeoutMs?: number;
    readonly packageName?: string;
    readonly activity?: string;
    readonly outDir?: string;
}

export type RebootExpectation = 'sequence' | 'silent';

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
    'milestone_presentation', 'era_transition', 'reboot_presentation', 'offline_report', 'boost_presentation', 'robot_state', 'robot_line_state', 'automated_cell_state', 'advanced_robotics_complex_state', 'era_environment_state', 'robot_population', 'error',
]);

/** A named live-reveal scenario: the seed (unbuilt variant), the producer whose construction must be observed and whether a camera focus is expected. */
export interface RevealScenario {
    readonly id: string;
    readonly label: string;
    readonly seed: (driver: SessionDeviceDriver, packageName: string, activity: string) => Promise<unknown>;
    readonly expectConstruction: string | null;
    readonly expectFocus: boolean;
    /** Optional AUT-047 settings: no trigger (the boost is seeded active), a longer capture and the `boost_presentation` phases that must be observed. */
    readonly trigger?: RevealTrigger;
    readonly durationMs?: number;
    readonly intervalMs?: number;
    readonly expectBoostPhases?: readonly string[];
    readonly expectCommands?: readonly string[];
    readonly expectEraTitle?: string;
    readonly expectReboot?: RebootExpectation;
    readonly expectOfflineReport?: OfflineReportExpectation;
}

export const DEFAULT_REVEAL_SCENARIO_ID = 'aut043';

/** Scenario table (pure data, unit-tested): `--scenario aut043|aut044`; aut043 stays the default. */
export const REVEAL_SCENARIOS: Readonly<Record<string, RevealScenario>> = Object.freeze({
    aut043: { id: 'aut043', label: 'aut043-cell', seed: (d, pkg, act) => seedAut043(d, pkg, act, 'unbuilt'), expectConstruction: 'automated_cell', expectFocus: true },
    aut044: { id: 'aut044', label: 'aut044-arc', seed: (d, pkg, act) => seedAut044(d, pkg, act, 'unbuilt'), expectConstruction: 'advanced_robotics_complex', expectFocus: true },
    aut046: { id: 'aut046', label: 'aut046-milestone', seed: (d, pkg, act) => seedAut046(d, pkg, act, 'breakthrough'), expectConstruction: null, expectFocus: false },
    // AUT-047: Free Overclock seeded ACTIVE (22 s left): sustained look from the load, then the expiry ease-out; the HUD Overclock action (AUT-UI-003) is exercised by the ui003 scenario.
    aut047: { id: 'aut047', label: 'aut047-overclock', seed: (d, pkg, act) => seedAut047(d, pkg, act, 'active'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 30_000, intervalMs: 400, expectBoostPhases: ['synced', 'effect_applied', 'ended', 'settled'] },
    // AUT-UI-003: Free Overclock READY, baseline frame, tap the HUD OverclockAction, then the activation impulse and the active countdown (30 s capture).
    ui003: { id: 'ui003', label: 'ui003-overclock-action', seed: (d, pkg, act) => seedUi003(d, pkg, act), expectConstruction: null, expectFocus: false, trigger: 'overclock', durationMs: 30_000, intervalMs: 400, expectBoostPhases: ['started', 'effect_applied'], expectCommands: ['activateFreeOverclock'] },
    // AUT-048 Era II: Robot Line one step before construction; tap the zone then the panel x1 button; the title card (t0 + 0.6 s) must start / finish, no card on load.
    aut048: { id: 'aut048', label: 'aut048-era2', seed: (d, pkg, act) => seedAut048(d, pkg, act, 'era2'), expectConstruction: 'robot_line', expectFocus: false, trigger: 'robot-line-build', durationMs: 12_000, intervalMs: 300, expectEraTitle: 'automated_factory' },
    // AUT-048 Era III: no existing tap path triggers the era goal (no HUD action by design): this capture only proves the silent load (no card, no focus) at the natural era.
    // AUT-048 follow-up: the DEBUG-only debug_command.json (written by the seed, read once after ready) submits the normal Advanced Robotics purchase; trigger 'none' on the capture side.
    'aut048-era3-live': { id: 'aut048-era3-live', label: 'aut048-era3-live', seed: (d, pkg, act) => seedAut048Era3Live(d, pkg, act), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 18_000, intervalMs: 400, expectEraTitle: 'robotics_complex', expectCommands: ['purchaseBreakthrough'] },
    // AUT-049: the DEBUG-only debug_command.json (written by the seed, read once after ready) submits the confirmed Reboot; trigger 'none' on the capture side.
    aut049: { id: 'aut049', label: 'aut049-reboot', seed: (d, pkg, act) => seedAut049(d, pkg, act, 'reboot'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 18_000, intervalMs: 300, expectCommands: ['rebootCivilization'], expectReboot: 'sequence' },
    // AUT-049: a post-Reboot save (Civilization #2, AI Cores): silent load, persistent relay socket, no sequence.
    'aut049-post': { id: 'aut049-post', label: 'aut049-post-reboot-socket', seed: (d, pkg, act) => seedAut049(d, pkg, act, 'post'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 6_000, intervalMs: 400, expectReboot: 'silent' },
    // AUT-051: Offline Factory Report. aut051: seeded 3 h absence (Assembly manual -> educational line), screenshot with the card, tap COLLECT at the reported rect, screenshot after, force-stop + relaunch WITHOUT reseeding (no card, reward persisted).
    aut051: { id: 'aut051', label: 'aut051-offline-report', seed: (d, pkg, act) => seedAut051(d, pkg, act, 'first'), expectConstruction: null, expectFocus: false, trigger: 'offline-collect', durationMs: 4_000, intervalMs: 500, expectOfflineReport: 'collect' },
    // AUT-051: the report survives a kill: launch with the seed, force-stop BEFORE Collect, relaunch without reseeding: the card shows again with the same (equivalent) reward.
    'aut051-reload': { id: 'aut051-reload', label: 'aut051-offline-reload', seed: (d, pkg, act) => seedAut051(d, pkg, act, 'reload'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 4_000, intervalMs: 500, expectOfflineReport: 'reload' },
    'aut048-era3': { id: 'aut048-era3', label: 'aut048-era3-silent-load', seed: (d, pkg, act) => seedAut048(d, pkg, act, 'era3'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 6_000, intervalMs: 400, expectEraTitle: 'none' },
});

export function resolveRevealScenario(id: unknown): RevealScenario | null {
    const key = id === undefined || id === true ? DEFAULT_REVEAL_SCENARIO_ID : id;
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(REVEAL_SCENARIOS, key) ? REVEAL_SCENARIOS[key] : null;
}

/** Objective checks over a timeline (pure, unit-tested). `tMs` is relative to the trigger (negative = before). */
export function evaluateRevealTimeline(events: readonly TimelineEvent[], options: { expectConstruction: string | null; expectFocus: boolean; triggered: boolean; frameCount: number; expectBoostPhases?: readonly string[]; expectCommands?: readonly string[]; expectEraTitle?: string; expectReboot?: RebootExpectation; expectOfflineReport?: OfflineReportExpectation }): RevealCheck[] {
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
    for (const phase of options.expectBoostPhases ?? []) {
        const hit = events.find((e) => e.event.evt === 'boost_presentation' && e.event.phase === phase);
        checks.push({ id: `boost_${phase}`, ok: hit !== undefined, detail: hit ? `t=${hit.tMs}ms ${JSON.stringify({ mode: hit.event.mode ?? null, timeScale: hit.event.timeScale ?? null, anchorResolved: hit.event.anchorResolved ?? null })}` : 'not observed' });
    }
    for (const type of options.expectCommands ?? []) {
        const hit = events.find((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === type && e.event.ok === true);
        checks.push({ id: `command_${type}_ok`, ok: hit !== undefined, detail: hit ? `t=${hit.tMs}ms ${JSON.stringify({ eventTypes: hit.event.eventTypes ?? null })}` : 'no accepted command_result' });
    }
    if (options.expectEraTitle !== undefined) checks.push(...evaluateEraTransition(events, options.expectEraTitle));
    if (options.expectReboot !== undefined) checks.push(...evaluateRebootPresentation(events, options.expectReboot));
    if (options.expectOfflineReport !== undefined) checks.push(...evaluateOfflineReport(events, options.expectOfflineReport));
    return checks;
}

/** Reboot presentation objective checks (pure): post-commit start only, phases, 4 s cap, title beats, socket; a silent load starts nothing. */
export function evaluateRebootPresentation(events: readonly TimelineEvent[], expect: RebootExpectation): RevealCheck[] {
    const reboot = events.filter((e) => e.event.evt === 'reboot_presentation');
    const phase = (name: string) => reboot.filter((e) => e.event.phase === name);
    const checks: RevealCheck[] = [];
    const synced = phase('synced')[0];
    checks.push({ id: 'reboot_synced_on_load', ok: synced !== undefined, detail: synced ? `socketPersistent=${String(synced.event.socketPersistent)} civilization=${String(synced.event.civilization)}` : 'no reboot_presentation synced' });
    const started = phase('sequence_started');
    if (expect === 'silent') {
        checks.push({ id: 'reboot_persistent_socket_on_load', ok: synced?.event.socketPersistent === true, detail: `socketPersistent=${String(synced?.event.socketPersistent ?? null)}` });
        checks.push({ id: 'reboot_no_sequence_on_load', ok: started.length === 0 && phase('toast_started').length === 0, detail: `${started.length} sequence_started, ${phase('toast_started').length} toast_started` });
        return checks;
    }
    checks.push({ id: 'reboot_sequence_started', ok: started.length === 1, detail: started.length ? `t=${started[0].tMs}ms newCivilization=${String(started[0].event.newCivilization)} aiCoresGranted=${String(started[0].event.aiCoresGranted)}` : 'not observed' });
    const commit = events.find((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'rebootCivilization' && e.event.ok === true);
    const commitTypes: unknown[] = Array.isArray(commit?.event.eventTypes) ? (commit?.event.eventTypes as unknown[]) : [];
    checks.push({ id: 'reboot_event_after_durable_save', ok: commitTypes.includes('rebootCompleted'), detail: commit ? `eventTypes=${JSON.stringify(commitTypes)}` : 'no accepted rebootCivilization command_result' });
    checks.push({ id: 'reboot_no_sequence_before_command', ok: started.every((e) => commit === undefined || e.tMs >= commit.tMs - 500), detail: started.length ? `sequence t=${started[0].tMs}ms, command t=${String(commit?.tMs ?? null)}ms` : 'none' });
    const reached = phase('phase').map((e) => String(e.event.name));
    checks.push({ id: 'reboot_phases_observed', ok: ['silence', 'core', 'civilization'].every((name) => reached.includes(name)), detail: `phases=${JSON.stringify(reached)}` });
    const finished = phase('sequence_finished')[0];
    const elapsed = finished && typeof finished.event.elapsedSeconds === 'number' ? finished.event.elapsedSeconds : null;
    checks.push({ id: 'reboot_sequence_finished_within_cap', ok: finished !== undefined && elapsed !== null && elapsed <= 4.05, detail: finished ? `t=${finished.tMs}ms elapsed=${String(elapsed)}s socketVisible=${String(finished.event.socketVisible)}` : 'not observed' });
    checks.push({ id: 'reboot_socket_persists_after', ok: finished?.event.socketVisible === true, detail: `socketVisible=${String(finished?.event.socketVisible ?? null)}` });
    const titles = phase('title_applied').map((e) => String(e.event.labelText ?? ''));
    checks.push({ id: 'reboot_title_beats', ok: titles.length === 3 && titles[0] === 'REBOOT' && /^AI CORE \u00d7\d+$/.test(titles[1]) && /^CIVILIZATION #\d+$/.test(titles[2]), detail: JSON.stringify(titles) });
    const toastFinished = phase('toast_finished')[0];
    const toastElapsed = toastFinished && typeof toastFinished.event.elapsedSeconds === 'number' ? toastFinished.event.elapsedSeconds : null;
    checks.push({ id: 'reboot_toast_finished_within_cap', ok: toastFinished !== undefined && toastElapsed !== null && toastElapsed <= 4.2, detail: toastFinished ? `elapsed=${String(toastElapsed)}s` : 'not observed' });
    const focus = reboot.find((e) => e.event.phase === 'focus_requested' || e.event.phase === 'focus_skipped');
    checks.push({ id: 'reboot_focus_decision', ok: focus !== undefined, detail: focus ? `${String(focus.event.phase)} reason=${String(focus.event.reason ?? 'requested')} anchorResolved=${String(focus.event.anchorResolved ?? null)}` : 'no focus_requested / focus_skipped' });
    const scan = reboot.find((e) => e.event.phase === 'effect_applied' && e.event.part === 'scan');
    const core = reboot.find((e) => e.event.phase === 'effect_applied' && e.event.part === 'core');
    checks.push({ id: 'reboot_scan_applied', ok: scan !== undefined && scan.event.plateScale === 1, detail: scan ? `plateScale=${String(scan.event.plateScale)}` : 'not observed' });
    checks.push({ id: 'reboot_core_applied', ok: core !== undefined && core.event.socketScale === 1 && typeof core.event.coreScale === 'number' && core.event.coreScale > 0, detail: core ? `socketScale=${String(core.event.socketScale)} coreScale=${String(core.event.coreScale)}` : 'not observed' });
    return checks;
}

/** Era title card objective checks (pure): correct era, finished within ~3.5 s, a focus decision, nothing on load. */
export function evaluateEraTransition(events: readonly TimelineEvent[], expectEraTitle: string): RevealCheck[] {
    const era = events.filter((e) => e.event.evt === 'era_transition');
    const started = era.filter((e) => e.event.phase === 'title_started');
    const checks: RevealCheck[] = [];
    const synced = era.some((e) => e.event.phase === 'synced');
    checks.push({ id: 'era_synced_on_load', ok: synced, detail: synced ? 'era_transition synced observed' : 'no era_transition synced' });
    if (expectEraTitle === 'none') {
        checks.push({ id: 'era_no_title_on_load', ok: started.length === 0, detail: `${started.length} title_started events` });
        return checks;
    }
    const hit = started.find((e) => e.event.eraId === expectEraTitle);
    checks.push({ id: 'era_title_started', ok: hit !== undefined, detail: hit ? `t=${hit.tMs}ms eraId=${String(hit.event.eraId)} title=${String(hit.event.title ?? '')}` : `no title_started for ${expectEraTitle}` });
    checks.push({ id: 'era_title_only_for_expected_era', ok: started.every((e) => e.event.eraId === expectEraTitle) && started.length === 1, detail: `${started.length} title_started (${started.map((e) => String(e.event.eraId)).join(',')})` });
    checks.push({ id: 'era_no_title_before_trigger', ok: started.every((e) => e.tMs >= -200), detail: started.length ? `first at ${started[0].tMs}ms` : 'none' });
    const finished = era.find((e) => e.event.phase === 'title_finished' && e.event.eraId === expectEraTitle);
    const elapsed = finished && typeof finished.event.elapsedSeconds === 'number' ? finished.event.elapsedSeconds : null;
    checks.push({ id: 'era_title_finished', ok: finished !== undefined && elapsed !== null && elapsed <= 3.5, detail: finished ? `t=${finished.tMs}ms elapsed=${String(elapsed)}s` : 'not observed' });
    const focus = era.find((e) => (e.event.phase === 'focus_requested' || e.event.phase === 'focus_skipped') && e.event.eraId === expectEraTitle);
    checks.push({ id: 'era_focus_decision', ok: focus !== undefined, detail: focus ? `${String(focus.event.phase)} reason=${String(focus.event.reason ?? 'requested')} anchorResolved=${String(focus.event.anchorResolved ?? null)}` : 'no focus_requested / focus_skipped' });
    const fade = events.find((e) => e.event.evt === 'era_environment_state' && e.event.phase === 'transition_started');
    checks.push({ id: 'era_environment_fade_started', ok: fade !== undefined, detail: fade ? `t=${fade.tMs}ms eraId=${String(fade.event.eraId ?? null)}` : 'not observed' });
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
        if (trigger === 'robot-line-build') {
            const display = pngSize(baseline);
            const zones = stream.allEvents().filter((e) => (e.evt === 'zones_projected' || (e.evt === 'scene_ready' && e.reason === 'scene_ready')) && Array.isArray(e.zones)).pop()?.zones as Array<{ id: string; sx: number | null; sy: number | null; onScreen: boolean }> | undefined;
            const zone = zones?.find((z) => z.id === 'RobotLine');
            if (display && zone && zone.onScreen && typeof zone.sx === 'number' && typeof zone.sy === 'number') {
                const zoneTap = cocosToAdb({ x: zone.sx, y: zone.sy }, { w: layout.screen.w, h: layout.screen.h }, display);
                const cursor = stream.cursor;
                await driver.tap(Math.round(zoneTap.x), Math.round(zoneTap.y));
                const refreshed = await stream.waitFor((e) => e.evt === 'ui_layout' && e.reason === 'selection_refresh', cursor, 5_000);
                const buy = parseUiLayout(refreshed?.event)?.rects.Action_x1 ?? null;
                if (buy) {
                    await sleep(700);
                    const buyTap = cocosToAdb(rectCentre(buy), { w: layout.screen.w, h: layout.screen.h }, display);
                    t0 = Date.now();
                    await driver.tap(Math.round(buyTap.x), Math.round(buyTap.y));
                    triggered = true;
                    tapDetail = `tapped RobotLine zone at ${Math.round(zoneTap.x)},${Math.round(zoneTap.y)} then Action_x1 at ${Math.round(buyTap.x)},${Math.round(buyTap.y)}`;
                } else {
                    tapDetail = 'no ui_layout selection_refresh with Action_x1 after the zone tap';
                }
            } else {
                tapDetail = 'RobotLine zone not projected on screen (or display size missing)';
            }
        }
        const actionKey = trigger === 'next-goal' ? 'NextGoalAction' : trigger === 'overclock' ? 'OverclockAction' : null;
        if (actionKey) {
            const display = pngSize(baseline);
            const rect = parseHudActions(layoutHit?.event).rects[actionKey];
            if (display && rect) {
                const point = cocosToAdb(rectCentre(rect), { w: layout.screen.w, h: layout.screen.h }, display);
                t0 = Date.now();
                await driver.tap(Math.round(point.x), Math.round(point.y));
                triggered = true;
                tapDetail = `tapped ${actionKey} at ${Math.round(point.x)},${Math.round(point.y)}`;
            } else {
                tapDetail = `${actionKey} rect or display size missing`;
            }
        }
    }
    // AUT-051: the Offline Factory Report drive (tap COLLECT / force-stop + relaunch without reseeding). The card is already up (the baseline frame shows it).
    if (layout && options.expectOfflineReport) {
        const display = pngSize(await driver.screencap());
        const reloadWait = async (): Promise<void> => {
            await collect(Date.now());
            events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: OFFLINE_RELAUNCH_MARKER_EVT, phase: 'relaunch' } });
            await driver.forceStop(packageName);
            const relaunchCursor = stream.cursor;
            await driver.launch(packageName, activity);
            await stream.waitFor((e) => e.evt === 'ui_layout', relaunchCursor, options.layoutTimeoutMs ?? 60_000);
            await sleep(options.preMs ?? 2_000);
            await frame('post');
        };
        if (options.expectOfflineReport === 'collect') {
            const shown = stream.allEvents().filter((e) => e.evt === 'offline_report' && e.phase === 'shown').pop();
            const latestLayout = stream.allEvents().filter((e) => e.evt === 'ui_layout' && toRect((e.rects as Record<string, unknown> | undefined)?.OfflineReportCollect) !== null).pop();
            const rect = toRect((latestLayout?.rects as Record<string, unknown> | undefined)?.OfflineReportCollect) ?? toRect(shown?.collectRect);
            if (display && rect) {
                const point = cocosToAdb(rectCentre(rect), { w: layout.screen.w, h: layout.screen.h }, display);
                const tapCursor = stream.cursor;
                t0 = Date.now();
                await driver.tap(Math.round(point.x), Math.round(point.y));
                triggered = true;
                tapDetail = `tapped OfflineReportCollect at ${Math.round(point.x)},${Math.round(point.y)}`;
                await stream.waitFor((e) => e.evt === 'offline_report' && e.phase === 'collect_result', tapCursor, 8_000);
                await sleep(700);
                await frame('post');
                await reloadWait();
            } else {
                tapDetail = 'OfflineReportCollect rect or display size missing';
            }
        } else {
            await reloadWait();
        }
    }
    const end = Date.now() + (options.durationMs ?? 9_000);
    while (Date.now() < end) {
        await frame(triggered ? 'post' : 'pre');
        await sleep(options.intervalMs ?? 150);
    }
    collect(Date.now());
    await driver.stopLogcat();

    const checks = evaluateRevealTimeline(events, { expectConstruction: options.expectConstruction ?? null, expectFocus: options.expectFocus ?? false, triggered, frameCount: frames.length, expectBoostPhases: options.expectBoostPhases, expectCommands: options.expectCommands, expectEraTitle: options.expectEraTitle, expectReboot: options.expectReboot, expectOfflineReport: options.expectOfflineReport });
    checks.unshift({ id: 'ui_layout_ready', ok: layout !== null, detail: layout ? 'ui_layout received' : 'no ui_layout (app did not reach the HUD)' });
    if (trigger !== 'none') checks.splice(1, 0, { id: 'trigger_sent', ok: triggered, detail: tapDetail });
    writeFileSync(path.join(outDir, 'timeline.json'), `${JSON.stringify({ label: options.label, frames, events, checks }, null, 2)}\n`);
    writeFileSync(path.join(outDir, 'summary.md'), renderRevealSummary(options.label, frames, events, checks));
    return { ok: checks.every((c) => c.ok), outDir, frames, events, checks };
}
