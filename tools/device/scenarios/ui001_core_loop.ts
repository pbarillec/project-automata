/**
 * AUT-UI-001 scenario — the first core loop is playable through the HUD on a real device.
 *
 *   clear saves → launch → session_state ready/fresh_game + ui_layout with the HUD action rects
 *   tap Manual Produce N times → N command_result manualProduce ok, Industrial Output +MANUAL_PRODUCTION_AMOUNT
 *             each time, no selection / camera event (N covers the Fabricator ×1 cost)
 *   fresh save: the Next Goal action is hidden or disabled; a tap on its rect issues no command
 *   select the Fabricator, tap ×1 → command_result buyProducerLevels ok (panel Buttons end to end)
 *   force-stop → push a seeded save (Fabricator Lv15, Output = Auto Feeder cost, Auto Feeder not owned) → relaunch
 *   Next Goal action enabled → tap → command_result purchaseBreakthrough ok, reveal_state started then
 *             complete (source runtime); a second tap issues no second purchase
 *   HOME (critical suspend save) → force-stop → relaunch → loaded_main, autoFeederOwned, no reveal_state started
 *   throughout: every non-empty label's effective font size ≥ UI_MIN_BODY_FONT_SIZE, zero `error` events.
 *
 * Requires the FactoryWorld DEBUG APK (diagnostics and run-as).
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { loadGameConfigFromSources } from '../../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { GAME_SESSION_DEV_GAME_VERSION } from '../../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import {
    CURRENT_SAVE_VERSION,
    createSaveTimestampUtcIsoFromUnixMilliseconds,
    serializeGameStateToSaveJson,
} from '../../../assets/scripts/persistence/index.ts';
import { createProducerPanelViewModel } from '../../../assets/scripts/presentation/ProducerPanelViewModel.ts';
import { computeUiLayout, HUD_ACTION_KEYS, UI_MIN_BODY_FONT_SIZE, type HudActionKey } from '../../../assets/scripts/presentation/UiLayout.ts';
import { MANUAL_PRODUCTION_AMOUNT } from '../../../assets/scripts/runtime/index.ts';
import { createFreshGameState } from '../../../assets/scripts/state/index.ts';
import { AdbError, pngSize, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import { cocosToAdb, type AssertionFailure, type AssertionRecord, type FailureClass, type StepEvaluation } from '../classification.ts';
import type { SessionDeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';
import { evaluateUiTap, parseUiLayout, rectCentre, rectInside, rectsOverlapBeyond, toRect, uiRectsAt, type Rect, type UiLayoutSnapshot } from '../ui_geometry.ts';
import { renderSummary, summarizeErrors } from './c3_producer_selection.ts';
import { SAVE_FILE_NAMES } from './int001_session_persistence.ts';

export const UI001_SCENARIO_ID = 'UI001-core-loop';
export const UI001_BREAKTHROUGH_ID = 'auto_feeder';

export interface Ui001Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    /** Lower bound on Manual Produce taps (the run also taps enough to afford Fabricator ×1). */
    minManualTaps: number;
    timeouts: {
        sceneReadyMs: number; sessionMs: number; uiLayoutMs: number; commandMs: number; tapSettleMs: number; uiTapWindowMs: number;
        chainMs: number; revealMs: number; suspendMs: number; noRevealWindowMs: number;
    };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_UI001_OPTIONS: Omit<Ui001Options, 'apkPath'> = {
    taskId: 'AUT-UI-001',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    minManualTaps: 3,
    timeouts: {
        sceneReadyMs: 60_000, sessionMs: 20_000, uiLayoutMs: 5_000, commandMs: 3_000, tapSettleMs: 300, uiTapWindowMs: 1_500,
        chainMs: 4_000, revealMs: 20_000, suspendMs: 10_000, noRevealWindowMs: 3_000,
    },
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const asLine = (event: ParsedDeviceEvent | null | undefined) => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);

// ---- Pure helpers (shared with tests) ---------------------------------------------------------

function economy() {
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

/** Auto Feeder cost from the embedded economy config (never hard-coded). */
export function autoFeederCost(): number {
    const cost = economy().getBreakthrough(UI001_BREAKTHROUGH_ID)?.cost;
    if (typeof cost !== 'number') throw new Error('auto_feeder has no cost in the embedded config');
    return cost;
}

/** Cost of the panel's Fabricator ×1 action on a fresh save (what the Button shows). */
export function fabricatorX1Cost(): number {
    const cost = createProducerPanelViewModel(economy(), createFreshGameState(), 'fabricator').actions?.x1.cost;
    if (typeof cost !== 'number') throw new Error('fabricator ×1 has no cost');
    return cost;
}

/** Manual Produce taps: enough for Fabricator ×1, and at least `minimum`. */
export function manualTapCount(minimum: number): number {
    return Math.max(minimum, Math.ceil(fabricatorX1Cost() / MANUAL_PRODUCTION_AMOUNT));
}

/** A valid current-version save: Fabricator Lv15, Output = Auto Feeder cost, Auto Feeder NOT owned. */
export function buildSeededAutoFeederEligibleSave(nowMs: number): string {
    const repository = economy();
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = autoFeederCost();
    return serializeGameStateToSaveJson(state, {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: repository.contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export interface HudActionsSnapshot {
    rects: Record<HudActionKey, Rect | null>;
    states: Record<HudActionKey, { visible: boolean; enabled: boolean } | null>;
}

/** HUD action rects and states from a `ui_layout` event (missing fields → null; tolerant of older payloads). */
export function parseHudActions(event: ParsedDeviceEvent | null | undefined): HudActionsSnapshot {
    const rects = {} as HudActionsSnapshot['rects'];
    const states = {} as HudActionsSnapshot['states'];
    const rawRects = (event?.rects ?? {}) as Record<string, unknown>;
    const rawStates = (event?.hudActions ?? {}) as Record<string, unknown>;
    for (const key of HUD_ACTION_KEYS) {
        rects[key] = toRect(rawRects[key]);
        const s = rawStates[key] as { visible?: unknown; enabled?: unknown } | undefined;
        states[key] = s && typeof s.visible === 'boolean' && typeof s.enabled === 'boolean' ? { visible: s.visible, enabled: s.enabled } : null;
    }
    return { rects, states };
}

/** Labels whose reported effective font size is below `min` (or that report no font sizes at all). */
export function fontSizeViolations(event: ParsedDeviceEvent, min: number = UI_MIN_BODY_FONT_SIZE): Array<{ card: string; key: string; size: unknown }> {
    const fonts = event.fontSizes as Record<string, Record<string, unknown>> | undefined;
    if (!fonts || typeof fonts !== 'object') return [{ card: '*', key: '*', size: 'missing fontSizes' }];
    const out: Array<{ card: string; key: string; size: unknown }> = [];
    for (const card of ['CoreHUD', 'ProducerPanel']) {
        const sizes = fonts[card];
        if (!sizes || typeof sizes !== 'object') { out.push({ card, key: '*', size: 'missing' }); continue; }
        for (const [key, size] of Object.entries(sizes)) {
            if (size === null) continue; // empty label
            if (typeof size !== 'number' || !(size >= min)) out.push({ card, key, size });
        }
    }
    return out;
}

class Checker {
    public readonly assertions: AssertionRecord[] = [];
    public failure: AssertionFailure | null = null;
    private readonly step: string;
    private readonly evidence: string[];
    public constructor(step: string, evidence: string[]) { this.step = step; this.evidence = evidence; }
    public check(id: string, ok: boolean, failureClass: FailureClass, expected: unknown, actual: unknown): boolean {
        if (this.failure) return false;
        this.assertions.push({ id, step: this.step, ok });
        if (!ok) this.failure = { failureClass, assertion: id, step: this.step, expected, actual, evidenceLines: this.evidence };
        return ok;
    }
    public result(): StepEvaluation { return { ok: this.failure === null, assertions: this.assertions, failure: this.failure }; }
}

/**
 * The HUD action Buttons in a `ui_layout`: reported, inside the HUD card, disjoint, and at their UiLayout
 * prediction (±2 px). Failures are MARKER_PRESENTATION.
 */
export function evaluateHudActionLayout(step: string, layout: UiLayoutSnapshot, event: ParsedDeviceEvent, tolerancePx = 2): StepEvaluation {
    const c = new Checker(step, asLine(event));
    const { rects } = parseHudActions(event);
    const missing = HUD_ACTION_KEYS.filter((key) => !rects[key] || rects[key]!.w <= 0 || rects[key]!.h <= 0);
    if (!c.check('hud_action_rects_present', missing.length === 0, 'MARKER_PRESENTATION', HUD_ACTION_KEYS, { missing })) return c.result();
    const hud = layout.rects.CoreHUD;
    const outside = HUD_ACTION_KEYS.filter((key) => !hud || !rectInside(hud, rects[key]!));
    if (!c.check('hud_actions_inside_hud', outside.length === 0, 'MARKER_PRESENTATION', { CoreHUD: hud }, { outside: outside.map((key) => ({ key, rect: rects[key] })) })) return c.result();
    if (!c.check('hud_actions_do_not_overlap', !rectsOverlapBeyond(rects.ManualProduceAction!, rects.NextGoalAction!, 0.5), 'MARKER_PRESENTATION', { overlap: false }, rects)) return c.result();
    const predicted = computeUiLayout(layout.screen, layout.safeArea ?? undefined).hudButtons;
    const mismatched = HUD_ACTION_KEYS.filter((key) => {
        const a = rects[key]!;
        const e = predicted[key];
        return Math.abs(a.x - e.x) > tolerancePx || Math.abs(a.y - e.y) > tolerancePx || Math.abs(a.w - e.w) > tolerancePx || Math.abs(a.h - e.h) > tolerancePx;
    });
    c.check('hud_actions_match_ui_layout', mismatched.length === 0, 'MARKER_PRESENTATION', { tolerancePx, predicted }, { mismatched: mismatched.map((key) => ({ key, rect: rects[key] })) });
    return c.result();
}

// ---- Scenario -----------------------------------------------------------------------------

class Stop extends Error {}

class EnvironmentStop extends Error {
    public readonly failure: AssertionFailure;
    public readonly humanAction: string | null;
    public constructor(failure: AssertionFailure, humanAction: string | null) {
        super(failure.assertion);
        this.failure = failure;
        this.humanAction = humanAction;
    }
}

function envFailure(assertion: string, step: string, expected: unknown, actual: unknown): AssertionFailure {
    return { failureClass: 'ENVIRONMENT', assertion, step, expected, actual, evidenceLines: [] };
}

const isCommandResult = (type: string) => (e: ParsedDeviceEvent) => e.evt === 'command_result' && (e.command as { type?: unknown } | undefined)?.type === type;

export interface Ui001RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runUi001Scenario(driver: SessionDeviceDriver, partial: Partial<Ui001Options> & { apkPath: string | null }): Promise<Ui001RunOutput> {
    const options: Ui001Options = { ...DEFAULT_UI001_OPTIONS, ...partial, timeouts: { ...DEFAULT_UI001_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(UI001_SCENARIO_ID, startedAt, apkSha);
    const paths = runPaths(runId, options.artifactRoot ?? DEVICE_TEMP_ROOT);
    ensureRunDirs(paths);

    const assertions: AssertionRecord[] = [];
    const warnings: string[] = [];
    const steps: Record<string, unknown>[] = [];
    const screenshots: string[] = [];
    let failure: AssertionFailure | null = null;
    let humanAction: string | null = null;
    let device: DeviceInfo | null = null;
    let stream: EventStream | null = null;
    let logcatStarted = false;
    let screenshotIndex = 0;
    let displaySize: { width: number; height: number } | null = null;
    let firstSceneReadyIndex: number | null = null;

    const capture = async (label: string): Promise<string | null> => {
        try {
            const png = await driver.screencap();
            const file = paths.screenshot(++screenshotIndex, label);
            writeFileSync(file, png);
            screenshots.push(relativeEvidence(file));
            displaySize = pngSize(png) ?? displaySize;
            return relativeEvidence(file);
        } catch (error) {
            warnings.push(`screenshot ${label} failed: ${(error as Error).message}`);
            return null;
        }
    };
    const check = (id: string, step: string, ok: boolean, failureClass: FailureClass, expected: unknown, actual: unknown, evidence: string[] = []) => {
        assertions.push({ id, step, ok });
        if (ok) return;
        failure ??= { failureClass, assertion: id, step, expected, actual, evidenceLines: evidence };
        throw new Stop(id);
    };
    const record = (evaluation: StepEvaluation) => {
        assertions.push(...evaluation.assertions);
        if (!evaluation.ok) {
            failure ??= evaluation.failure;
            throw new Stop(evaluation.failure?.assertion ?? 'step');
        }
    };
    const errorLinesSince = (cursor: number) => stream!.recordsSince(cursor).filter((r) => r.runtimeError).map((r) => r.line);
    const appAlive = async () => (await driver.pidOf(options.packageName).catch(() => null)) !== null;
    const checkNoErrors = (step: string) => {
        if (firstSceneReadyIndex === null) return;
        const errors = errorLinesSince(firstSceneReadyIndex);
        check(`no_errors_after_scene_ready_${step}`, step, errors.length === 0, 'RUNTIME_ERROR', { runtimeErrors: 0 }, { runtimeErrors: errors.length, errorMessages: summarizeErrors(errors) }, errors.slice(0, 20));
    };
    const checkFonts = (step: string, event: ParsedDeviceEvent) => {
        const violations = fontSizeViolations(event);
        check(`effective_font_size_min_${step}`, step, violations.length === 0, 'MARKER_PRESENTATION', { minEffectiveFontSize: UI_MIN_BODY_FONT_SIZE }, { violations }, asLine(event));
    };
    /** Launches and returns the session_state + the following ui_layout of this launch. */
    const launchUntilLayout = async (step: string) => {
        const cursor = stream!.cursor;
        try { await driver.launch(options.packageName, options.activity); } catch (error) {
            throw new EnvironmentStop(envFailure('app_launched', step, `${options.packageName}/${options.activity}`, (error as Error).message), null);
        }
        const ready = await stream!.waitFor((e) => e.evt === 'scene_ready', cursor, options.timeouts.sceneReadyMs);
        if (!ready) {
            const errors = errorLinesSince(cursor);
            if (errors.length > 0) check('scene_ready', step, false, 'RUNTIME_ERROR', { evt: 'scene_ready' }, { errorMessages: summarizeErrors(errors) }, errors.slice(0, 20));
            const anyDiagnostics = stream!.eventsSince(cursor).length > 0;
            throw new EnvironmentStop(envFailure('scene_ready', step, { evt: 'scene_ready' }, { diagnosticsSeen: anyDiagnostics, hint: anyDiagnostics ? 'scene never became ready' : 'APK has no [AUT-DEVICE] diagnostics (non-DEBUG build or wrong start scene)' }), null);
        }
        assertions.push({ id: 'scene_ready', step, ok: true });
        firstSceneReadyIndex ??= ready.record.index;
        const session = await stream!.waitFor((e) => e.evt === 'session_state' && (e.phase === 'ready' || e.phase === 'load_failed'), cursor, options.timeouts.sessionMs);
        check('session_ready', step, session !== null && session.event.phase === 'ready', 'RUNTIME_ERROR', { evt: 'session_state', phase: 'ready' }, session?.event ?? null, asLine(session?.event));
        const layoutRecord = await stream!.waitFor((e) => e.evt === 'ui_layout', session!.record.index, options.timeouts.uiLayoutMs);
        check('ui_layout_reported', step, layoutRecord !== null, 'RUNTIME_ERROR', { evt: 'ui_layout', after: 'session_state ready' }, { events: stream!.eventsSince(session!.record.index).map((e) => e.evt) });
        const layout = parseUiLayout(layoutRecord!.event);
        check('ui_layout_parsed', step, layout !== null && layout.safeArea !== null, 'RUNTIME_ERROR', 'ui_layout with screen + safeArea + rects', layoutRecord!.event, asLine(layoutRecord!.event));
        record(evaluateHudActionLayout(step, layout!, layoutRecord!.event));
        checkFonts(step, layoutRecord!.event);
        return { cursor, session: session!.event, layoutEvent: layoutRecord!.event, layout: layout! };
    };
    const toAdb = (layout: UiLayoutSnapshot, point: { x: number; y: number }) => {
        const adb = cocosToAdb(point, { w: layout.screen.w, h: layout.screen.h }, displaySize!);
        return { x: Math.round(adb.x), y: Math.round(adb.y) };
    };
    const uiTapLeaks = async (step: string, target: string, cursor: number, selectionBefore: string | null) => {
        record(evaluateUiTap({ step, target, selectionBefore, events: stream!.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() }));
    };

    try {
        // ---- Environment -----------------------------------------------------------------
        if (!apkExists && !options.skipInstall) {
            throw new EnvironmentStop(envFailure('apk_present', 'environment', { apk: apkPath ?? '<required --apk>' }, { exists: false }), 'provide the FactoryWorld debug APK (npm run device:gate-build)');
        }
        let devices;
        try {
            devices = await driver.devices();
        } catch (error) {
            const detail = error instanceof AdbError ? `${error.kind}: ${error.detail}` : String(error);
            throw new EnvironmentStop(envFailure('adb_available', 'environment', 'adb responds', detail), error instanceof AdbError && error.kind === 'missing_binary' ? 'install Android platform-tools or set ADB_PATH' : 'connect and authorize the Android device');
        }
        const selection = selectDevice(devices, options.serial);
        if (!selection.ok) throw new EnvironmentStop(envFailure('device_ready', 'environment', { serial: options.serial ?? 'exactly one ready device' }, { reason: selection.reason, detail: selection.detail, devices }), selection.requiredHumanAction);
        assertions.push({ id: 'device_ready', step: 'environment', ok: true });
        driver.useSerial(selection.device.serial);
        device = {
            serial: selection.device.serial,
            model: selection.device.model ?? (await driver.getProp('ro.product.model').catch(() => null)),
            android_release: await driver.getProp('ro.build.version.release').catch(() => null),
            sdk: await driver.getProp('ro.build.version.sdk').catch(() => null),
        };
        writeFileSync(paths.device, `${JSON.stringify({ ...device, state: selection.device.state }, null, 2)}\n`);
        if (!options.skipInstall) {
            try { await driver.install(apkPath!); } catch (error) {
                throw new EnvironmentStop(envFailure('apk_installed', 'install', 'adb install -r Success', (error as Error).message), null);
            }
            assertions.push({ id: 'apk_installed', step: 'install', ok: true });
        }

        // ---- 1. Fresh launch ------------------------------------------------------------------
        await driver.forceStop(options.packageName);
        try {
            await driver.clearAppData(options.packageName);
            steps.push({ id: 'clear_saves', method: 'pm clear' });
        } catch (clearError) {
            // Some OEM builds (NE2215) refuse `pm clear` from the shell; delete only the save files instead.
            warnings.push(`pm clear refused, deleting save files via run-as: ${(clearError as Error).message.slice(0, 200)}`);
            try {
                const filesDir = `${await driver.appDataDirectory(options.packageName)}/files/`;
                await driver.removeAppFiles(options.packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
                steps.push({ id: 'clear_saves', method: 'run-as rm', directory: filesDir });
            } catch (error) {
                throw new EnvironmentStop(envFailure('saves_cleared', 'fresh_launch', 'pm clear or run-as rm of the save files', (error as Error).message), null);
            }
        }
        assertions.push({ id: 'saves_cleared', step: 'fresh_launch', ok: true });
        await driver.logcatClear();
        stream = driver.startLogcat(paths.logcat);
        logcatStarted = true;
        const fresh = await launchUntilLayout('fresh_launch');
        check('fresh_game', 'fresh_launch', fresh.session.status === 'fresh_game', 'RUNTIME_ERROR', { status: 'fresh_game' }, fresh.session, asLine(fresh.session));
        const writablePath = typeof fresh.session.writablePath === 'string' ? fresh.session.writablePath : '';
        check('writable_path_reported', 'fresh_launch', /^\/[A-Za-z0-9._/-]+\/$/.test(writablePath), 'RUNTIME_ERROR', 'absolute app-private directory', writablePath, asLine(fresh.session));
        const freshActions = parseHudActions(fresh.layoutEvent);
        check('manual_produce_enabled', 'fresh_launch', freshActions.states.ManualProduceAction?.visible === true && freshActions.states.ManualProduceAction.enabled === true, 'RUNTIME_ERROR', { visible: true, enabled: true }, freshActions.states, asLine(fresh.layoutEvent));
        steps.push({ id: 'fresh_launch', session: fresh.session, layout: fresh.layoutEvent, screenshot: await capture('fresh_ready') });
        if (!displaySize) throw new EnvironmentStop(envFailure('display_size', 'fresh_launch', 'screencap PNG', null), null);
        checkNoErrors('fresh_launch');

        // ---- 2. Manual Produce × N ---------------------------------------------------------------
        const taps = manualTapCount(options.minManualTaps);
        const manualTap = toAdb(fresh.layout, rectCentre(freshActions.rects.ManualProduceAction!));
        const outputs: number[] = [];
        for (let i = 1; i <= taps; i += 1) {
            const step = `manual_produce_${i}`;
            const cursor = stream.cursor;
            await driver.tap(manualTap.x, manualTap.y);
            const result = await stream.waitFor(isCommandResult('manualProduce'), cursor, options.timeouts.commandMs);
            check('manual_produce_command_result', step, result !== null, 'INPUT_NOT_RECEIVED', { evt: 'command_result', command: 'manualProduce' }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            check('manual_produce_ok', step, result!.event.ok === true, 'RUNTIME_ERROR', { ok: true }, result!.event, asLine(result!.event));
            const output = result!.event.industrialOutput;
            const expected = (outputs.length ? outputs[outputs.length - 1] : 0) + MANUAL_PRODUCTION_AMOUNT;
            check('manual_produce_output_rises', step, typeof output === 'number' && Math.abs(output - expected) < 1e-9, 'RUNTIME_ERROR', { industrialOutput: expected, amount: MANUAL_PRODUCTION_AMOUNT }, { industrialOutput: output }, asLine(result!.event));
            outputs.push(output as number);
            await sleep(options.timeouts.tapSettleMs);
            const results = stream.eventsSince(cursor).filter((e) => e.evt === 'command_result');
            check('one_command_per_tap', step, results.length === 1, 'TAP_CLASSIFICATION', { command_result: 1 }, { command_result: results.length, commands: results.map((e) => e.command) });
            await uiTapLeaks(step, 'ManualProduceAction', cursor, null);
        }
        steps.push({ id: 'manual_produce', kind: 'tap', adb: manualTap, taps, amount: MANUAL_PRODUCTION_AMOUNT, industrialOutput: outputs });
        checkNoErrors('manual_produce');

        // ---- 3. Fresh save: the Next Goal action is not usable -------------------------------------
        const freshNextGoal = freshActions.states.NextGoalAction;
        check('fresh_next_goal_action_unavailable', 'fresh_next_goal', freshNextGoal !== null && !(freshNextGoal.visible && freshNextGoal.enabled), 'RUNTIME_ERROR', { visible: false, or: { enabled: false } }, freshNextGoal, asLine(fresh.layoutEvent));
        {
            const cursor = stream.cursor;
            const tap = toAdb(fresh.layout, rectCentre(freshActions.rects.NextGoalAction!));
            await driver.tap(tap.x, tap.y);
            await sleep(options.timeouts.uiTapWindowMs);
            const results = stream.eventsSince(cursor).filter((e) => e.evt === 'command_result');
            check('fresh_next_goal_tap_no_command', 'fresh_next_goal', results.length === 0, 'RUNTIME_ERROR', { command_result: 0 }, { commands: results.map((e) => e.command) }, results.flatMap(asLine));
            await uiTapLeaks('fresh_next_goal', 'NextGoalAction', cursor, null);
            steps.push({ id: 'fresh_next_goal', kind: 'tap', adb: tap, state: freshNextGoal });
        }

        // ---- 4. Select the Fabricator, buy ×1 through the panel Button -----------------------------
        {
            const zones = stream.allEvents().filter((e) => (e.evt === 'zones_projected' || (e.evt === 'scene_ready' && e.reason === 'scene_ready')) && Array.isArray(e.zones)).pop()?.zones as Array<{ id: string; sx: number | null; sy: number | null; onScreen: boolean }> | undefined;
            const fabricator = zones?.find((z) => z.id === 'Fabricator');
            check('fabricator_projected_on_screen', 'buy_fabricator', !!fabricator && fabricator.onScreen && typeof fabricator.sx === 'number' && typeof fabricator.sy === 'number', 'CAMERA_FOCUS', { id: 'Fabricator', onScreen: true }, fabricator ?? null);
            const centre = { x: fabricator!.sx as number, y: fabricator!.sy as number };
            check('fabricator_not_under_ui', 'buy_fabricator', uiRectsAt(fresh.layout, centre).length === 0, 'MARKER_PRESENTATION', { under: [] }, { under: uiRectsAt(fresh.layout, centre), centre });
            let cursor = stream.cursor;
            const fabricatorTap = toAdb(fresh.layout, centre);
            await driver.tap(fabricatorTap.x, fabricatorTap.y);
            const selected = await stream.waitFor((e) => e.evt === 'selection_state' && e.next === 'Fabricator', cursor, options.timeouts.chainMs);
            check('fabricator_selected', 'buy_fabricator', selected !== null, 'SELECTION_STATE', { evt: 'selection_state', next: 'Fabricator' }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            check('fabricator_tap_no_command', 'buy_fabricator', stream.eventsSince(cursor).every((e) => e.evt !== 'command_result'), 'RUNTIME_ERROR', 'a world tap never submits a command', stream.eventsSince(cursor).filter((e) => e.evt === 'command_result'));
            const refreshed = await stream.waitFor((e) => e.evt === 'ui_layout' && e.reason === 'selection_refresh', cursor, options.timeouts.uiLayoutMs);
            check('ui_layout_after_selection', 'buy_fabricator', refreshed !== null, 'RUNTIME_ERROR', { evt: 'ui_layout', reason: 'selection_refresh' }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            const selectedLayout = parseUiLayout(refreshed!.event);
            check('ui_layout_after_selection_parsed', 'buy_fabricator', selectedLayout !== null && selectedLayout.rects.Action_x1 !== null, 'RUNTIME_ERROR', 'ui_layout with Action_x1', refreshed!.event, asLine(refreshed!.event));
            checkFonts('buy_fabricator', refreshed!.event);
            await stream.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
            await sleep(options.timeouts.tapSettleMs);
            cursor = stream.cursor;
            const x1Tap = toAdb(selectedLayout!, rectCentre(selectedLayout!.rects.Action_x1!));
            await driver.tap(x1Tap.x, x1Tap.y);
            const bought = await stream.waitFor(isCommandResult('buyProducerLevels'), cursor, options.timeouts.commandMs);
            check('buy_x1_command_result', 'buy_fabricator', bought !== null, 'INPUT_NOT_RECEIVED', { evt: 'command_result', command: { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 } }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            const command = bought!.event.command as { producerId?: unknown; quantity?: unknown };
            check('buy_x1_ok', 'buy_fabricator', bought!.event.ok === true && command.producerId === 'fabricator' && command.quantity === 1, 'RUNTIME_ERROR', { ok: true, producerId: 'fabricator', quantity: 1 }, bought!.event, asLine(bought!.event));
            await sleep(options.timeouts.tapSettleMs);
            await uiTapLeaks('buy_fabricator', 'Action_x1', cursor, 'Fabricator');
            steps.push({ id: 'buy_fabricator', kind: 'tap', fabricatorAdb: fabricatorTap, x1Adb: x1Tap, result: bought!.event, screenshot: await capture('fabricator_bought') });
        }
        checkNoErrors('buy_fabricator');

        // ---- 5. Seeded save: Auto Feeder eligible and affordable -----------------------------------
        await driver.forceStop(options.packageName);
        const seeded = buildSeededAutoFeederEligibleSave(now().getTime());
        writeFileSync(path.join(paths.runDir, 'seeded_save_main.json'), seeded);
        try {
            await driver.removeAppFiles(options.packageName, SAVE_FILE_NAMES.map((name) => `${writablePath}${name}`));
            await driver.writeAppFile(options.packageName, `${writablePath}save_main.json`, seeded);
        } catch (error) {
            throw new EnvironmentStop(envFailure('seeded_save_pushed', 'seeded_launch', 'run-as write into app storage (debuggable APK)', (error as Error).message), null);
        }
        assertions.push({ id: 'seeded_save_pushed', step: 'seeded_launch', ok: true });
        const seededLaunch = await launchUntilLayout('seeded_launch');
        check('seeded_loaded_main', 'seeded_launch', seededLaunch.session.status === 'loaded_main' && seededLaunch.session.autoFeederOwned === false, 'RUNTIME_ERROR', { status: 'loaded_main', autoFeederOwned: false }, seededLaunch.session, asLine(seededLaunch.session));
        const seededActions = parseHudActions(seededLaunch.layoutEvent);
        check('next_goal_action_enabled', 'seeded_launch', seededActions.states.NextGoalAction?.visible === true && seededActions.states.NextGoalAction.enabled === true, 'RUNTIME_ERROR', { visible: true, enabled: true }, seededActions.states, asLine(seededLaunch.layoutEvent));
        steps.push({ id: 'seeded_launch', session: seededLaunch.session, layout: seededLaunch.layoutEvent, autoFeederCost: autoFeederCost(), screenshot: await capture('seeded_ready') });
        checkNoErrors('seeded_launch');

        // ---- 6. Next Goal unlock: one purchase, then the payoff ---------------------------------------
        {
            const nextGoalTap = toAdb(seededLaunch.layout, rectCentre(seededActions.rects.NextGoalAction!));
            let cursor = stream.cursor;
            await driver.tap(nextGoalTap.x, nextGoalTap.y);
            const purchased = await stream.waitFor(isCommandResult('purchaseBreakthrough'), cursor, options.timeouts.commandMs);
            check('purchase_command_result', 'next_goal_purchase', purchased !== null, 'INPUT_NOT_RECEIVED', { evt: 'command_result', command: { type: 'purchaseBreakthrough', breakthroughId: UI001_BREAKTHROUGH_ID } }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            const command = purchased!.event.command as { breakthroughId?: unknown };
            check('purchase_ok', 'next_goal_purchase', purchased!.event.ok === true && command.breakthroughId === UI001_BREAKTHROUGH_ID, 'RUNTIME_ERROR', { ok: true, breakthroughId: UI001_BREAKTHROUGH_ID }, purchased!.event, asLine(purchased!.event));
            const started = await stream.waitFor((e) => e.evt === 'reveal_state' && e.phase === 'started' && e.source === 'runtime', cursor, options.timeouts.revealMs);
            check('payoff_reveal_started', 'next_goal_purchase', started !== null, 'CAMERA_FOCUS', { evt: 'reveal_state', phase: 'started', source: 'runtime' }, stream.eventsSince(cursor).filter((e) => e.evt === 'reveal_state'));
            const complete = await stream.waitFor((e) => e.evt === 'reveal_state' && e.phase === 'complete' && e.source === 'runtime', started!.record.index, options.timeouts.revealMs);
            check('payoff_reveal_complete', 'next_goal_purchase', complete !== null, 'CAMERA_FOCUS', { evt: 'reveal_state', phase: 'complete', source: 'runtime' }, stream.eventsSince(started!.record.index).filter((e) => e.evt === 'reveal_state'));
            const leaked = stream.eventsSince(cursor).filter((e) => e.evt === 'selection_raycast' || e.evt === 'selection_state' || (e.evt === 'camera_focus' && e.source === 'selection'));
            check('purchase_tap_no_selection', 'next_goal_purchase', leaked.length === 0, 'SELECTION_STATE', { selection_events: 0 }, { leaked: leaked.map((e) => e.evt) }, leaked.flatMap(asLine));
            steps.push({ id: 'next_goal_purchase', kind: 'tap', adb: nextGoalTap, result: purchased!.event, reveal: [started!.event, complete!.event], screenshot: await capture('auto_feeder_purchased') });

            cursor = stream.cursor;
            await driver.tap(nextGoalTap.x, nextGoalTap.y);
            await sleep(options.timeouts.uiTapWindowMs);
            const again = stream.eventsSince(cursor).filter(isCommandResult('purchaseBreakthrough'));
            check('second_tap_no_second_purchase', 'next_goal_second_tap', again.length === 0, 'RUNTIME_ERROR', { purchaseBreakthrough: 0 }, { results: again }, again.flatMap(asLine));
            const purchases = stream.eventsSince(seededLaunch.cursor).filter(isCommandResult('purchaseBreakthrough'));
            check('exactly_one_purchase', 'next_goal_second_tap', purchases.length === 1, 'RUNTIME_ERROR', { purchaseBreakthrough: 1 }, { purchaseBreakthrough: purchases.length });
            steps.push({ id: 'next_goal_second_tap', kind: 'tap', adb: nextGoalTap, events: stream.eventsSince(cursor).map((e) => e.evt) });
        }
        checkNoErrors('next_goal_purchase');

        // ---- 7. The purchase survives a relaunch (critical suspend save, then kill) --------------------
        {
            const cursor = stream.cursor;
            await driver.pressHome();
            const suspended = await stream.waitFor((e) => e.evt === 'session_state' && e.phase === 'suspended', cursor, options.timeouts.suspendMs);
            check('suspend_save_ok', 'relaunch', suspended !== null && suspended.event.saveOk === true && suspended.event.autoFeederOwned === true, 'RUNTIME_ERROR', { phase: 'suspended', saveOk: true, autoFeederOwned: true }, suspended?.event ?? null, asLine(suspended?.event));
            await driver.forceStop(options.packageName);
            const relaunch = await launchUntilLayout('relaunch');
            check('relaunch_loaded_main_owned', 'relaunch', relaunch.session.status === 'loaded_main' && relaunch.session.autoFeederOwned === true, 'RUNTIME_ERROR', { status: 'loaded_main', autoFeederOwned: true }, relaunch.session, asLine(relaunch.session));
            await sleep(options.timeouts.noRevealWindowMs);
            const replayed = stream.eventsSince(relaunch.cursor).filter((e) => e.evt === 'reveal_state' && e.phase === 'started');
            check('relaunch_no_reveal_replay', 'relaunch', replayed.length === 0, 'CAMERA_FOCUS', { reveal_state_started: 0 }, { reveal_state_started: replayed.length }, replayed.flatMap(asLine));
            const relaunchActions = parseHudActions(relaunch.layoutEvent).states.NextGoalAction;
            check('relaunch_no_auto_feeder_action', 'relaunch', relaunchActions !== null && !relaunchActions.enabled, 'RUNTIME_ERROR', { NextGoalAction: { enabled: false } }, relaunchActions, asLine(relaunch.layoutEvent));
            steps.push({ id: 'relaunch', session: relaunch.session, suspended: suspended!.event, screenshot: await capture('relaunch_ready') });
        }

        // ---- 8. Zero `error` events after scene_ready ------------------------------------------------
        checkNoErrors('final');
    } catch (error) {
        if (error instanceof EnvironmentStop) {
            failure ??= error.failure;
            humanAction = error.humanAction;
            assertions.push({ id: error.failure.assertion, step: error.failure.step, ok: false });
        } else if (!(error instanceof Stop)) {
            failure ??= { failureClass: 'ENVIRONMENT', assertion: 'harness_execution', step: 'harness', expected: 'scenario completes', actual: (error as Error).stack ?? String(error), evidenceLines: [] };
            assertions.push({ id: 'harness_execution', step: 'harness', ok: false });
        }
    }

    // ---- Evidence (always) ---------------------------------------------------------------------
    if (logcatStarted) await driver.stopLogcat();
    const events = stream ? stream.allEvents() : [];
    if (stream) writeFileSync(paths.events, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    writeFileSync(paths.commands, `${JSON.stringify(driver.commandLog(), null, 2)}\n`);

    const result = buildResult({
        taskId: options.taskId,
        scenarioId: UI001_SCENARIO_ID,
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        apk: { path: apkPath ? relativeEvidence(apkPath) : null, sha256: apkSha },
        device,
        failure,
        blocked: failure && (failure as AssertionFailure).failureClass === 'ENVIRONMENT' ? { requiredHumanAction: humanAction ?? 'inspect harness environment', nextOwner: humanAction ? 'human' : 'technical-lead' } : null,
        assertions,
        warnings,
        steps,
        evidence: {
            run_dir: relativeEvidence(paths.runDir),
            result: relativeEvidence(paths.result),
            logcat: logcatStarted ? relativeEvidence(paths.logcat) : null,
            events: stream ? relativeEvidence(paths.events) : null,
            screenshots,
            summary: relativeEvidence(paths.summary),
        },
    });
    const schemaErrors = validateDeviceResult(result);
    writeFileSync(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(paths.summary, renderSummary(result, schemaErrors));
    return { result, paths, schemaErrors };
}
