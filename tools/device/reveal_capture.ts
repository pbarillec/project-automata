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
import { seedAut050 } from './seed_aut050.ts';
import { seedAut051 } from './seed_aut051.ts';
import { seedAut052 } from './seed_aut052.ts';
import { seedAut055 } from './seed_aut055.ts';
import { seedAut056 } from './seed_aut056.ts';
import { seedAut057 } from './seed_aut057.ts';
import { ADMOB_AVAILABILITY_WAIT_MS, ADMOB_RESULT_WAIT_AFTER_BACK_MS, ADMOB_RESULT_WAIT_BEFORE_BACK_MS, evaluateAdmob, type AdmobExpectation } from './admob_checks.ts';
import { EXTENDED_OVERCLOCK_RELAUNCH_MARKER_EVT, evaluateExtendedOverclock, type ExtendedOverclockExpectation } from './extended_overclock_checks.ts';
import { OFFLINE_DOUBLE_RELAUNCH_MARKER_EVT, evaluateOfflineDouble, type OfflineDoubleExpectation } from './offline_double_checks.ts';
import { seedRbt001 } from './seed_rbt001.ts';
import { REBOOT_UI_RELAUNCH_MARKER_EVT, evaluateRebootUi, type RebootUiExpectation } from './reboot_ui_checks.ts';
import { SETTINGS_RELAUNCH_MARKER_EVT, evaluateSettings, type SettingsExpectation } from './settings_checks.ts';
import { OFFLINE_RELAUNCH_MARKER_EVT, evaluateOfflineReport, type OfflineReportExpectation } from './offline_report_checks.ts';
import { PERMANENT_UPGRADE_RELAUNCH_MARKER_EVT, evaluatePermanentUpgrades, pickAffordableRow, type PermanentUpgradeExpectation } from './permanent_upgrade_checks.ts';
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
    /** AUT-055: 'success' = REAL tap on COLLECT x2 (mock ad rewarded): exactly 2x, claim persisted across a relaunch; 'closed' / 'failed' = no bonus, the card stays, the free COLLECT pays the normal reward; 'ineligible' = no x2 action, only COLLECT. */
    readonly expectOfflineDouble?: OfflineDoubleExpectation;
    /** AUT-056: 'success' / 'free_active' = REAL tap on the Extended Overclock chip (mock ad rewarded): x2 for 600 s, claim persisted across a relaunch; 'closed' / 'failed' = no boost, the chip stays; 'resume' = seeded Extended + suspended Free (no tap): expiry -> resume -> Free expiry -> cooldown; 'quota' / 'interval' = no chip. */
    readonly expectExtendedOverclock?: ExtendedOverclockExpectation;
    /** AUT-057 (REAL AdMob test ads, best-effort): 'offline_double' / 'extended' = REAL tap on the x2 action / chip, wait ~30 s for the ad result, BACK, wait ~15 s more; 'no_fill' = network OFF (seed), no x2 / chip, free COLLECT works; the network is restored at the end. */
    readonly expectAdmob?: AdmobExpectation;
    /** AUT-050: 'purchase' = tap the AI chip, open the panel, buy an affordable row with a real tap, switch tab, force-stop + relaunch WITHOUT reseeding (balance / rank persisted). */
    readonly expectPermanentUpgrades?: PermanentUpgradeExpectation;
    /** AUT-052: 'toggle_persist' = tap the Settings chip, open the panel, toggle Music OFF with a real tap, close, force-stop + relaunch WITHOUT reseeding (the file survives), toggle it back ON, close. */
    readonly expectSettings?: SettingsExpectation;
    /** AUT-RBT-001: 'confirm_flow' = REAL tap on the Reboot chip, screenshot the modal, REAL tap CANCEL, tap the chip again, REAL tap REBOOT, frames through the AUT-049 sequence, force-stop + relaunch WITHOUT reseeding. */
    readonly expectRebootUi?: RebootUiExpectation;
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
    'milestone_presentation', 'era_transition', 'reboot_presentation', 'offline_report', 'offline_double', 'extended_overclock', 'ads_state', 'permanent_upgrades', 'reboot_ui', 'settings', 'boost_presentation', 'robot_state', 'robot_line_state', 'automated_cell_state', 'advanced_robotics_complex_state', 'era_environment_state', 'robot_population', 'error',
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
    readonly expectOfflineDouble?: OfflineDoubleExpectation;
    readonly expectExtendedOverclock?: ExtendedOverclockExpectation;
    readonly expectAdmob?: AdmobExpectation;
    readonly expectPermanentUpgrades?: PermanentUpgradeExpectation;
    readonly expectSettings?: SettingsExpectation;
    readonly expectRebootUi?: RebootUiExpectation;
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
    // AUT-050: AI Upgrades. Post-Reboot seed (Civilization #2, 4 AI Cores, Optimized Fabrication rank 2): screenshot with the chip, tap the chip, screenshot the open panel, buy an affordable row with a REAL tap, screenshot, switch to Automation (locked row), force-stop + relaunch WITHOUT reseeding (balance / rank persisted).
    aut050: { id: 'aut050', label: 'aut050-ai-upgrades', seed: (d, pkg, act) => seedAut050(d, pkg, act, 'mixed'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectPermanentUpgrades: 'purchase' },
    // AUT-052: Settings. Post-Reboot seed (both chips visible, no settings file): screenshot the chips, REAL tap on the gear chip, screenshot the panel, REAL tap on the Music row (OFF), screenshot, CLOSE, force-stop + relaunch WITHOUT reseeding (settings_loaded source=file, music off), toggle back ON, close.
    aut052: { id: 'aut052', label: 'aut052-settings', seed: (d, pkg, act) => seedAut052(d, pkg, act), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectSettings: 'toggle_persist' },
    // AUT-051: Offline Factory Report. aut051: seeded 3 h absence (Assembly manual -> educational line), screenshot with the card, tap COLLECT at the reported rect, screenshot after, force-stop + relaunch WITHOUT reseeding (no card, reward persisted).
    aut051: { id: 'aut051', label: 'aut051-offline-report', seed: (d, pkg, act) => seedAut051(d, pkg, act, 'first'), expectConstruction: null, expectFocus: false, trigger: 'offline-collect', durationMs: 4_000, intervalMs: 500, expectOfflineReport: 'collect' },
    // AUT-051: the report survives a kill: launch with the seed, force-stop BEFORE Collect, relaunch without reseeding: the card shows again with the same (equivalent) reward.
    // AUT-051b: ~30 s absence: NO card (under the 60 s minimum), the preview is auto-collected silently (offline_report auto_collected).
    'aut051-short': { id: 'aut051-short', label: 'aut051-offline-short', seed: (d, pkg, act) => seedAut051(d, pkg, act, 'short'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 6_000, intervalMs: 500, expectOfflineReport: 'short' },
    'aut051-reload': { id: 'aut051-reload', label: 'aut051-offline-reload', seed: (d, pkg, act) => seedAut051(d, pkg, act, 'reload'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 4_000, intervalMs: 500, expectOfflineReport: 'reload' },
    // AUT-RBT-001: Reboot entry + confirmation UI. Seed: Civilization #1, reward 5 AI Cores, progress ~45%, no debug command. REAL taps: chip -> modal -> CANCEL -> chip -> REBOOT -> frames through the 4 s sequence -> force-stop + relaunch WITHOUT reseeding.
    rbt001: { id: 'rbt001', label: 'rbt001-reboot-ui', seed: (d, pkg, act) => seedRbt001(d, pkg, act), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 2_000, intervalMs: 500, expectRebootUi: 'confirm_flow' },
    // AUT-055: Offline Double (rewarded x2, MOCK ad). The seed writes the DEBUG-only debug_ads.json (read once) with the scripted ad outcome. trigger 'none': the drive uses REAL taps at the rects `ui_layout` reports.
    'aut055-success': { id: 'aut055-success', label: 'aut055-double-success', seed: (d, pkg, act) => seedAut055(d, pkg, act, 'ready', 'rewarded'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectOfflineDouble: 'success' },
    'aut055-closed': { id: 'aut055-closed', label: 'aut055-double-closed', seed: (d, pkg, act) => seedAut055(d, pkg, act, 'ready', 'closed'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectOfflineDouble: 'closed' },
    'aut055-failed': { id: 'aut055-failed', label: 'aut055-double-failed', seed: (d, pkg, act) => seedAut055(d, pkg, act, 'ready', 'failed'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectOfflineDouble: 'failed' },
    'aut055-ineligible': { id: 'aut055-ineligible', label: 'aut055-double-ineligible', seed: (d, pkg, act) => seedAut055(d, pkg, act, 'short_ineligible'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectOfflineDouble: 'ineligible' },
    // AUT-056: Extended Overclock (rewarded x2 for 10 active minutes, MOCK ad). The seed writes the DEBUG-only debug_ads.json (read once) with the scripted ad outcome. trigger 'none': the drive uses REAL taps at the rects `ui_layout` reports.
    'aut056-success': { id: 'aut056-success', label: 'aut056-extended-success', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'eligible', 'rewarded'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectExtendedOverclock: 'success' },
    'aut056-free-active': { id: 'aut056-free-active', label: 'aut056-extended-free-active', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'free_active', 'rewarded'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectExtendedOverclock: 'free_active' },
    'aut056-resume': { id: 'aut056-resume', label: 'aut056-extended-resume', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'resume'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 70_000, intervalMs: 2_000, expectExtendedOverclock: 'resume' },
    'aut056-closed': { id: 'aut056-closed', label: 'aut056-extended-closed', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'eligible', 'closed'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectExtendedOverclock: 'closed' },
    'aut056-failed': { id: 'aut056-failed', label: 'aut056-extended-failed', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'eligible', 'failed'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectExtendedOverclock: 'failed' },
    'aut056-quota': { id: 'aut056-quota', label: 'aut056-extended-quota', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'quota'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 6_000, intervalMs: 500, expectExtendedOverclock: 'quota' },
    'aut056-interval': { id: 'aut056-interval', label: 'aut056-extended-interval', seed: (d, pkg, act) => seedAut056(d, pkg, act, 'interval'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 6_000, intervalMs: 500, expectExtendedOverclock: 'interval' },
    // AUT-057 (REAL AdMob test ads via debug_ads.json provider admob_test; best-effort outcome, see admob_checks.ts). Network access required; no-fill switches Wi-Fi + data OFF (USB adb) and restores them.
    'aut057-offline-double': { id: 'aut057-offline-double', label: 'aut057-admob-offline-double', seed: (d, pkg, act) => seedAut057(d, pkg, act, 'offline_double'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectAdmob: 'offline_double' },
    'aut057-extended': { id: 'aut057-extended', label: 'aut057-admob-extended', seed: (d, pkg, act) => seedAut057(d, pkg, act, 'extended'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectAdmob: 'extended' },
    'aut057-no-fill': { id: 'aut057-no-fill', label: 'aut057-admob-no-fill', seed: (d, pkg, act) => seedAut057(d, pkg, act, 'offline_double', { networkOff: true }), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 3_000, intervalMs: 500, expectAdmob: 'no_fill' },
    'aut048-era3': { id: 'aut048-era3', label: 'aut048-era3-silent-load', seed: (d, pkg, act) => seedAut048(d, pkg, act, 'era3'), expectConstruction: null, expectFocus: false, trigger: 'none', durationMs: 6_000, intervalMs: 400, expectEraTitle: 'none' },
});

export function resolveRevealScenario(id: unknown): RevealScenario | null {
    const key = id === undefined || id === true ? DEFAULT_REVEAL_SCENARIO_ID : id;
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(REVEAL_SCENARIOS, key) ? REVEAL_SCENARIOS[key] : null;
}

/** Objective checks over a timeline (pure, unit-tested). `tMs` is relative to the trigger (negative = before). */
export function evaluateRevealTimeline(events: readonly TimelineEvent[], options: { expectConstruction: string | null; expectFocus: boolean; triggered: boolean; frameCount: number; expectBoostPhases?: readonly string[]; expectCommands?: readonly string[]; expectEraTitle?: string; expectReboot?: RebootExpectation; expectOfflineReport?: OfflineReportExpectation; expectOfflineDouble?: OfflineDoubleExpectation; expectExtendedOverclock?: ExtendedOverclockExpectation; expectAdmob?: AdmobExpectation; expectPermanentUpgrades?: PermanentUpgradeExpectation; expectSettings?: SettingsExpectation; expectRebootUi?: RebootUiExpectation }): RevealCheck[] {
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
    if (options.expectOfflineDouble !== undefined) checks.push(...evaluateOfflineDouble(events, options.expectOfflineDouble));
    if (options.expectExtendedOverclock !== undefined) checks.push(...evaluateExtendedOverclock(events, options.expectExtendedOverclock));
    if (options.expectAdmob !== undefined) checks.push(...evaluateAdmob(events, options.expectAdmob));
    if (options.expectPermanentUpgrades !== undefined) checks.push(...evaluatePermanentUpgrades(events, options.expectPermanentUpgrades));
    if (options.expectSettings !== undefined) checks.push(...evaluateSettings(events, options.expectSettings));
    if (options.expectRebootUi !== undefined) checks.push(...evaluateRebootUi(events, options.expectRebootUi));
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
        } else if (options.expectOfflineReport === 'reload') {
            await reloadWait();
        }
    }
    // AUT-055: the Offline Double drive: REAL taps at the rects `ui_layout` reports (COLLECT x2, then the free COLLECT when no bonus was granted).
    if (layout && options.expectOfflineDouble) {
        const display = pngSize(await driver.screencap());
        const screenSize = { w: layout.screen.w, h: layout.screen.h };
        const rectIn = (event: Record<string, unknown> | undefined, name: string) => toRect((event?.rects as Record<string, unknown> | undefined)?.[name]);
        const latestRect = (name: string) => rectIn(stream.allEvents().filter((e) => e.evt === 'ui_layout' && rectIn(e, name) !== null).pop(), name);
        const waitRect = async (name: string, waitMs = 8_000) => {
            const until = Date.now() + waitMs;
            while (latestRect(name) === null && Date.now() < until) await sleep(200);
            return latestRect(name);
        };
        const tapAt = async (rect: { x: number; y: number; w: number; h: number } | null): Promise<string | null> => {
            if (!display || !rect) return null;
            const point = cocosToAdb(rectCentre(rect), screenSize, display);
            await driver.tap(Math.round(point.x), Math.round(point.y));
            return `${Math.round(point.x)},${Math.round(point.y)}`;
        };
        const relaunch = async (): Promise<void> => {
            collect(Date.now());
            events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: OFFLINE_DOUBLE_RELAUNCH_MARKER_EVT, phase: 'relaunch' } });
            await driver.forceStop(packageName);
            const relaunchCursor = stream.cursor;
            await driver.launch(packageName, activity);
            await stream.waitFor((e) => e.evt === 'ui_layout', relaunchCursor, options.layoutTimeoutMs ?? 60_000);
            await sleep(options.preMs ?? 2_000);
            await frame('post');
        };
        const tapFreeCollect = async (freshAfterCursor: number | null): Promise<string | null> => {
            // After a not-granted result the card re-lays out: wait for the fresh layout before reading the COLLECT rect.
            if (freshAfterCursor !== null) await stream.waitFor((e) => e.evt === 'ui_layout' && e.reason === 'offline_double_result', freshAfterCursor, 5_000);
            await sleep(300);
            const rect = await waitRect('OfflineReportCollect');
            const collectCursor = stream.cursor;
            const at = await tapAt(rect);
            if (at) await stream.waitFor((e) => e.evt === 'offline_report' && e.phase === 'collect_result', collectCursor, 8_000);
            return at;
        };
        const details: string[] = [];
        if (options.expectOfflineDouble === 'ineligible') {
            await waitRect('OfflineReportCollect');
            await sleep(700);
            await frame('post');
            t0 = Date.now();
            const at = await tapFreeCollect(null);
            if (at) { triggered = true; details.push(`tapped OfflineReportCollect at ${at} (no x2 action)`); await sleep(700); await frame('post'); }
            else details.push('OfflineReportCollect rect or display size missing');
        } else {
            const doubleRect = await waitRect('OfflineReportDouble');
            await sleep(700);
            await frame('post');
            const tapCursor = stream.cursor;
            t0 = Date.now();
            const at = await tapAt(doubleRect);
            if (at) {
                triggered = true;
                details.push(`tapped OfflineReportDouble at ${at}`);
                await stream.waitFor((e) => e.evt === 'offline_double' && (e.phase === 'granted' || e.phase === 'not_granted'), tapCursor, 10_000);
                await sleep(700);
                await frame('post');
                if (options.expectOfflineDouble === 'success') {
                    await relaunch();
                } else {
                    const collectAt = await tapFreeCollect(tapCursor);
                    details.push(collectAt ? `then tapped the free OfflineReportCollect at ${collectAt}` : 'free COLLECT rect missing');
                    await sleep(700);
                    await frame('post');
                    await relaunch();
                }
            } else {
                details.push('OfflineReportDouble rect or display size missing');
            }
        }
        tapDetail = details.join('; ');
    }
    // AUT-056: the Extended Overclock drive: a REAL tap at the chip rect `ui_layout` reports (the rect is read from the freshest layout right before the tap), then frames while the HUD countdown ticks, then force-stop + relaunch without reseeding.
    if (layout && options.expectExtendedOverclock) {
        const expectation = options.expectExtendedOverclock;
        const display = pngSize(await driver.screencap());
        const screenSize = { w: layout.screen.w, h: layout.screen.h };
        const rectIn = (event: Record<string, unknown> | undefined, name: string) => toRect((event?.rects as Record<string, unknown> | undefined)?.[name]);
        const latestChipRect = () => rectIn(stream.allEvents().filter((e) => e.evt === 'ui_layout').pop(), 'ExtendedOverclockAction');
        const details: string[] = [];
        if (expectation === 'quota' || expectation === 'interval') {
            await sleep(3_000);
            await frame('post');
            triggered = true;
            details.push('no tap (the chip must not be offered)');
        } else if (expectation === 'resume') {
            await frame('post');
            triggered = true;
            details.push('no tap (seeded Extended + suspended Free: observing expiry -> resume -> Free expiry -> cooldown)');
        } else {
            const until = Date.now() + 8_000;
            while (latestChipRect() === null && Date.now() < until) await sleep(200);
            await sleep(500);
            await frame('pre');
            const rect = latestChipRect();
            if (display && rect) {
                const point = cocosToAdb(rectCentre(rect), screenSize, display);
                const tapCursor = stream.cursor;
                t0 = Date.now();
                await driver.tap(Math.round(point.x), Math.round(point.y));
                triggered = true;
                details.push(`tapped ExtendedOverclockAction at ${Math.round(point.x)},${Math.round(point.y)}`);
                await stream.waitFor((e) => e.evt === 'extended_overclock' && (e.phase === 'granted' || e.phase === 'not_granted'), tapCursor, 10_000);
                await sleep(700);
                await frame('post');
                if (expectation === 'success' || expectation === 'free_active') {
                    // Let the HUD countdown tick (the app reports the HUD every 5 s while a boost runs), then relaunch.
                    await sleep(11_000);
                    await frame('post');
                } else {
                    await sleep(1_500);
                    await frame('post');
                }
                collect(Date.now());
                events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: EXTENDED_OVERCLOCK_RELAUNCH_MARKER_EVT, phase: 'relaunch' } });
                await driver.forceStop(packageName);
                const relaunchCursor = stream.cursor;
                await driver.launch(packageName, activity);
                await stream.waitFor((e) => e.evt === 'ui_layout', relaunchCursor, options.layoutTimeoutMs ?? 60_000);
                await sleep(options.preMs ?? 2_000);
                await frame('post');
            } else {
                details.push('ExtendedOverclockAction rect or display size missing');
            }
        }
        tapDetail = details.join('; ');
    }
    // AUT-057: the REAL AdMob test-ad drive (best-effort outcome): wait for the ad to be offered, REAL tap, wait ~30 s, BACK, wait ~15 s more. The network is always restored for the no-fill run.
    if (layout && options.expectAdmob) {
        const expectation = options.expectAdmob;
        const display = pngSize(await driver.screencap());
        const screenSize = { w: layout.screen.w, h: layout.screen.h };
        const rectIn = (event: Record<string, unknown> | undefined, name: string) => toRect((event?.rects as Record<string, unknown> | undefined)?.[name]);
        const latestRect = (name: string) => rectIn(stream.allEvents().filter((e) => e.evt === 'ui_layout' && rectIn(e, name) !== null).pop(), name);
        const details: string[] = [];
        try {
            if (expectation === 'no_fill') {
                await sleep(8_000);
                await frame('post');
                const collectRect = latestRect('OfflineReportCollect');
                if (display && collectRect) {
                    const point = cocosToAdb(rectCentre(collectRect), screenSize, display);
                    const tapCursor = stream.cursor;
                    t0 = Date.now();
                    await driver.tap(Math.round(point.x), Math.round(point.y));
                    triggered = true;
                    details.push(`network OFF: tapped the free OfflineReportCollect at ${Math.round(point.x)},${Math.round(point.y)}`);
                    await stream.waitFor((e) => e.evt === 'offline_report' && e.phase === 'collect_result', tapCursor, 8_000);
                    await sleep(700);
                    await frame('post');
                } else {
                    details.push('network OFF: OfflineReportCollect rect or display size missing');
                }
            } else {
                const rectName = expectation === 'offline_double' ? 'OfflineReportDouble' : 'ExtendedOverclockAction';
                const until = Date.now() + ADMOB_AVAILABILITY_WAIT_MS;
                while (latestRect(rectName) === null && Date.now() < until) await sleep(500);
                await sleep(500);
                await frame('pre');
                const rect = latestRect(rectName);
                if (display && rect) {
                    const point = cocosToAdb(rectCentre(rect), screenSize, display);
                    const tapCursor = stream.cursor;
                    t0 = Date.now();
                    await driver.tap(Math.round(point.x), Math.round(point.y));
                    triggered = true;
                    details.push(`tapped ${rectName} at ${Math.round(point.x)},${Math.round(point.y)}`);
                    await stream.waitFor((e) => e.evt === 'ads_state' && e.phase === 'native_started', tapCursor, 10_000);
                    await sleep(3_000);
                    await frame('post'); // the ad on screen
                    let hit = await stream.waitFor((e) => e.evt === 'ads_state' && e.phase === 'ad_result', tapCursor, ADMOB_RESULT_WAIT_BEFORE_BACK_MS);
                    if (!hit) {
                        collect(Date.now());
                        events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: 'capture_marker', phase: 'back_pressed' } });
                        details.push('no ad_result yet: pressed BACK');
                        await driver.pressBack?.();
                        hit = await stream.waitFor((e) => e.evt === 'ads_state' && e.phase === 'ad_result', tapCursor, ADMOB_RESULT_WAIT_AFTER_BACK_MS);
                    }
                    details.push(hit ? `ad_result observed (status=${String(hit.event.status ?? null)})` : 'no ad_result within the wait window (best-effort)');
                    await sleep(1_500);
                    await frame('post');
                    await sleep(2_000);
                    await frame('post');
                } else {
                    details.push(`${rectName} never appeared (no available ad within ${ADMOB_AVAILABILITY_WAIT_MS / 1000}s) or display size missing`);
                }
            }
        } finally {
            if (expectation === 'no_fill') await driver.setNetworkEnabled?.(true);
        }
        tapDetail = details.join('; ');
    }
    if (options.expectAdmob === 'no_fill') await driver.setNetworkEnabled?.(true); // idempotent: never leave the device offline (also when no layout was reached)
    // AUT-050: the AI Upgrades drive: real taps at the rects `ui_layout` reports (chip, buy, tab), then force-stop + relaunch without reseeding.
    if (layout && options.expectPermanentUpgrades) {
        const display = pngSize(await driver.screencap());
        const screenSize = { w: layout.screen.w, h: layout.screen.h };
        const rectNow = async (name: string, waitMs = 5_000): Promise<{ x: number; y: number; w: number; h: number } | null> => {
            const pick = () => toRect((stream.allEvents().filter((e) => e.evt === 'ui_layout' && toRect((e.rects as Record<string, unknown> | undefined)?.[name]) !== null).pop()?.rects as Record<string, unknown> | undefined)?.[name]);
            const until = Date.now() + waitMs;
            while (pick() === null && Date.now() < until) await sleep(200);
            return pick();
        };
        const tapRect = async (name: string): Promise<string | null> => {
            const rect = await rectNow(name);
            if (!display || !rect) return null;
            const point = cocosToAdb(rectCentre(rect), screenSize, display);
            await driver.tap(Math.round(point.x), Math.round(point.y));
            return `${name} at ${Math.round(point.x)},${Math.round(point.y)}`;
        };
        const upgradeEvent = (phase: string) => stream.allEvents().filter((e) => e.evt === 'permanent_upgrades' && e.phase === phase).pop();
        const details: string[] = [];
        const chipTap = await tapRect('PermanentUpgradeChip');
        if (chipTap) {
            details.push(`tapped ${chipTap}`);
            await stream.waitFor((e) => e.evt === 'permanent_upgrades' && e.phase === 'opened', 0, 8_000);
            await rectNow('PermanentUpgradeBuy0');
            await sleep(700);
            await frame('post');
            const target = pickAffordableRow(upgradeEvent('opened')?.rows);
            if (target) {
                const cursorBefore = stream.cursor;
                t0 = Date.now();
                const buyTap = await tapRect(`PermanentUpgradeBuy${target.index}`);
                if (buyTap) {
                    triggered = true;
                    details.push(`bought ${target.row.id} via ${buyTap}`);
                    await stream.waitFor((e) => e.evt === 'permanent_upgrades' && e.phase === 'purchase_result', cursorBefore, 8_000);
                    await sleep(150);
                    await frame('post');
                    await sleep(600);
                    await frame('post');
                }
            }
            const tabCursor = stream.cursor;
            const tabTap = await tapRect('PermanentUpgradeTab1');
            if (tabTap) {
                details.push(`switched tab via ${tabTap}`);
                await stream.waitFor((e) => e.evt === 'permanent_upgrades' && e.phase === 'tab', tabCursor, 5_000);
                await sleep(700);
                await frame('post');
            }
            collect(Date.now());
            events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: PERMANENT_UPGRADE_RELAUNCH_MARKER_EVT, phase: 'relaunch' } });
            await driver.forceStop(packageName);
            const relaunchCursor = stream.cursor;
            await driver.launch(packageName, activity);
            await stream.waitFor((e) => e.evt === 'ui_layout', relaunchCursor, options.layoutTimeoutMs ?? 60_000);
            await sleep(options.preMs ?? 2_000);
            await frame('post');
        } else {
            details.push('PermanentUpgradeChip rect or display size missing');
        }
        tapDetail = details.join('; ');
    }
    // AUT-052: the Settings drive: real taps at the rects `ui_layout` reports (gear chip, Music row, CLOSE), force-stop + relaunch without reseeding, toggle back.
    if (layout && options.expectSettings) {
        const display = pngSize(await driver.screencap());
        const screenSize = { w: layout.screen.w, h: layout.screen.h };
        const rectNow = async (name: string, waitMs = 5_000): Promise<{ x: number; y: number; w: number; h: number } | null> => {
            const pick = () => toRect((stream.allEvents().filter((e) => e.evt === 'ui_layout' && toRect((e.rects as Record<string, unknown> | undefined)?.[name]) !== null).pop()?.rects as Record<string, unknown> | undefined)?.[name]);
            const until = Date.now() + waitMs;
            while (pick() === null && Date.now() < until) await sleep(200);
            return pick();
        };
        const tapRect = async (name: string): Promise<string | null> => {
            const rect = await rectNow(name);
            if (!display || !rect) return null;
            const point = cocosToAdb(rectCentre(rect), screenSize, display);
            await driver.tap(Math.round(point.x), Math.round(point.y));
            return `${name} at ${Math.round(point.x)},${Math.round(point.y)}`;
        };
        const settingsEvent = (cursor: number, phase: string) => stream.waitFor((e) => e.evt === 'settings' && e.phase === phase, cursor, 8_000);
        const details: string[] = [];
        // One pass: chip -> panel -> Music row -> CLOSE. A rect reported by an earlier pass is stale (the panel moves out of sight), so each pass waits for fresh layouts.
        const pass = async (label: string, shot: boolean): Promise<boolean> => {
            const openCursor = stream.cursor;
            const chipTap = await tapRect('SettingsChip');
            if (!chipTap) return false;
            details.push(`${label}: tapped ${chipTap}`);
            await settingsEvent(openCursor, 'opened');
            await rectNow('SettingsRow0');
            await sleep(700);
            if (shot) await frame('post');
            const toggleCursor = stream.cursor;
            const rowTap = await tapRect('SettingsRow0');
            if (!rowTap) return false;
            details.push(`${label}: toggled Music via ${rowTap}`);
            await settingsEvent(toggleCursor, 'toggled');
            await sleep(500);
            if (shot) await frame('post');
            const closeCursor = stream.cursor;
            const closeTap = await tapRect('SettingsClose');
            if (!closeTap) return false;
            details.push(`${label}: closed via ${closeTap}`);
            await settingsEvent(closeCursor, 'closed');
            await sleep(400);
            return true;
        };
        if (await pass('first launch', true)) {
            triggered = true;
            collect(Date.now());
            events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: SETTINGS_RELAUNCH_MARKER_EVT, phase: 'relaunch' } });
            await driver.forceStop(packageName);
            const relaunchCursor = stream.cursor;
            await driver.launch(packageName, activity);
            await stream.waitFor((e) => e.evt === 'ui_layout', relaunchCursor, options.layoutTimeoutMs ?? 60_000);
            await sleep(options.preMs ?? 2_000);
            await frame('post');
            await pass('after relaunch', true);
        } else {
            details.push('SettingsChip rect or display size missing');
        }
        tapDetail = details.join('; ');
    }
    // AUT-RBT-001: the Reboot UI drive: REAL taps at the rects `ui_layout` reports (chip, CANCEL, chip, REBOOT), frames through the AUT-049 sequence, then force-stop + relaunch without reseeding.
    if (layout && options.expectRebootUi) {
        const display = pngSize(await driver.screencap());
        const screenSize = { w: layout.screen.w, h: layout.screen.h };
        const rectNow = async (name: string, waitMs = 5_000): Promise<{ x: number; y: number; w: number; h: number } | null> => {
            const pick = () => toRect((stream.allEvents().filter((e) => e.evt === 'ui_layout' && toRect((e.rects as Record<string, unknown> | undefined)?.[name]) !== null).pop()?.rects as Record<string, unknown> | undefined)?.[name]);
            const until = Date.now() + waitMs;
            while (pick() === null && Date.now() < until) await sleep(200);
            return pick();
        };
        const tapRect = async (name: string): Promise<string | null> => {
            const rect = await rectNow(name);
            if (!display || !rect) return null;
            const point = cocosToAdb(rectCentre(rect), screenSize, display);
            await driver.tap(Math.round(point.x), Math.round(point.y));
            return `${name} at ${Math.round(point.x)},${Math.round(point.y)}`;
        };
        const rebootEvent = (cursorFrom: number, phase: string, reason?: string) => stream.waitFor((e) => e.evt === 'reboot_ui' && e.phase === phase && (reason === undefined || e.reason === reason), cursorFrom, 8_000);
        const details: string[] = [];
        const firstChipCursor = stream.cursor;
        const chipTap = await tapRect('RebootChip');
        if (chipTap) {
            details.push(`tapped ${chipTap}`);
            await rebootEvent(firstChipCursor, 'opened');
            await rectNow('RebootConfirm');
            await sleep(700);
            await frame('post');
            // CANCEL: nothing is submitted; the chip returns.
            const cancelCursor = stream.cursor;
            const cancelTap = await tapRect('RebootCancel');
            if (cancelTap) {
                details.push(`cancelled via ${cancelTap}`);
                await rebootEvent(cancelCursor, 'closed', 'cancel');
                await sleep(700);
                await frame('post');
            }
            // Second pass: the chip again, then the REAL REBOOT tap.
            const secondCursor = stream.cursor;
            const secondChipTap = await tapRect('RebootChip');
            if (secondChipTap) {
                details.push(`tapped ${secondChipTap} again`);
                await rebootEvent(secondCursor, 'opened');
                await rectNow('RebootConfirm');
                await sleep(500);
                collect(Date.now());
                const confirmCursor = stream.cursor;
                t0 = Date.now();
                const confirmTap = await tapRect('RebootConfirm');
                if (confirmTap) {
                    triggered = true;
                    details.push(`confirmed via ${confirmTap}`);
                    await rebootEvent(confirmCursor, 'result');
                    for (const atMs of [500, 1_500, 2_500, 3_500, 5_000]) {
                        while (Date.now() - t0 < atMs) await sleep(50);
                        await frame('post');
                    }
                    await sleep(1_000);
                    await frame('post');
                }
            }
            collect(Date.now());
            events.push({ tMs: Date.now() - t0, event: { v: 1, seq: 0, evt: REBOOT_UI_RELAUNCH_MARKER_EVT, phase: 'relaunch' } });
            await driver.forceStop(packageName);
            const relaunchCursor = stream.cursor;
            await driver.launch(packageName, activity);
            await stream.waitFor((e) => e.evt === 'ui_layout', relaunchCursor, options.layoutTimeoutMs ?? 60_000);
            await sleep(options.preMs ?? 2_000);
            await frame('post');
        } else {
            details.push('RebootChip rect or display size missing');
        }
        tapDetail = details.join('; ');
    }
    const end = Date.now() + (options.durationMs ?? 9_000);
    while (Date.now() < end) {
        await frame(triggered ? 'post' : 'pre');
        await sleep(options.intervalMs ?? 150);
    }
    collect(Date.now());
    await driver.stopLogcat();

    const checks = evaluateRevealTimeline(events, { expectConstruction: options.expectConstruction ?? null, expectFocus: options.expectFocus ?? false, triggered, frameCount: frames.length, expectBoostPhases: options.expectBoostPhases, expectCommands: options.expectCommands, expectEraTitle: options.expectEraTitle, expectReboot: options.expectReboot, expectOfflineReport: options.expectOfflineReport, expectOfflineDouble: options.expectOfflineDouble, expectExtendedOverclock: options.expectExtendedOverclock, expectAdmob: options.expectAdmob, expectPermanentUpgrades: options.expectPermanentUpgrades, expectSettings: options.expectSettings, expectRebootUi: options.expectRebootUi });
    checks.unshift({ id: 'ui_layout_ready', ok: layout !== null, detail: layout ? 'ui_layout received' : 'no ui_layout (app did not reach the HUD)' });
    if (options.expectPermanentUpgrades || options.expectSettings || options.expectRebootUi || options.expectOfflineDouble || options.expectExtendedOverclock || options.expectAdmob) checks.splice(1, 0, { id: 'trigger_sent', ok: triggered, detail: tapDetail });
    if (trigger !== 'none') checks.splice(1, 0, { id: 'trigger_sent', ok: triggered, detail: tapDetail });
    writeFileSync(path.join(outDir, 'timeline.json'), `${JSON.stringify({ label: options.label, frames, events, checks }, null, 2)}\n`);
    writeFileSync(path.join(outDir, 'summary.md'), renderRevealSummary(options.label, frames, events, checks));
    return { ok: checks.every((c) => c.ok), outDir, frames, events, checks };
}
