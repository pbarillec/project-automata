/**
 * AUT-R-036 scenario — the landscape HUD and Producer Panel are on screen, anchored, and own their touches.
 *
 *   clear saves → launch → scene_ready + session_state ready + ui_layout
 *   geometry: every rect inside the screen and the safe area, HUD/panel disjoint, coverage ≤ 35%,
 *             Buttons inside the panel, no projected producer zone centre under the UI
 *   screenshot (kept for the readability gate deferred to AUT-UI-001)
 *   calibration self-check (a point clear of the UI) → tap the Fabricator → selection_state next=Fabricator
 *   post-selection ui_layout (real strings): the geometry again, plus each Button rect = UiLayout ±2 px,
 *             ×1/×10/×MAX disjoint, every row inside its card
 *   tap the centre of the HUD and of each panel Button → no selection_raycast / selection_state /
 *   camera_focus within 1.5 s; the selection stays Fabricator
 *   zero runtime/`error` events after scene_ready.
 *
 * Requires the FactoryWorld DEBUG APK (diagnostics and run-as).
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { AdbError, pngSize, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import {
    adbToCocos, cocosToAdb, evaluateCalibration, evaluateTapStep,
    type AssertionFailure, type AssertionRecord, type FailureClass, type StepEvaluation,
} from '../classification.ts';
import type { SessionDeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';
import { renderSummary, summarizeErrors } from './c3_producer_selection.ts';
import { SAVE_FILE_NAMES } from './int001_session_persistence.ts';
import {
    evaluateUiGeometry, evaluateUiLayoutModel, evaluateUiTap, parseUiLayout, pickCalibrationPoint, rectCentre, uiRectsAt,
    type ProjectedZone, type UiRectName,
} from '../ui_geometry.ts';
import { computeUiLayout, CORE_HUD_LAYOUT, PRODUCER_PANEL_LAYOUT } from '../../../assets/scripts/presentation/UiLayout.ts';

export const R036_SCENARIO_ID = 'R036-ui-layout';
/** UI tap targets, in order: the HUD card, then each panel Button row. */
export const R036_UI_TAP_TARGETS: readonly UiRectName[] = ['CoreHUD', 'Action_x1', 'Action_x10', 'Action_xMax'];

export interface R036Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    timeouts: { sceneReadyMs: number; sessionMs: number; uiLayoutMs: number; revealMs: number; chainMs: number; projectionMs: number; uiTapWindowMs: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_R036_OPTIONS: Omit<R036Options, 'apkPath'> = {
    taskId: 'AUT-R-036',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    timeouts: { sceneReadyMs: 60_000, sessionMs: 20_000, uiLayoutMs: 5_000, revealMs: 20_000, chainMs: 4_000, projectionMs: 2_000, uiTapWindowMs: 1_500 },
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const asLine = (event: ParsedDeviceEvent | null | undefined) => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);

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

function zonesOf(event: ParsedDeviceEvent | null | undefined): ProjectedZone[] | null {
    return event && Array.isArray(event.zones) ? (event.zones as ProjectedZone[]) : null;
}

export interface R036RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runR036Scenario(driver: SessionDeviceDriver, partial: Partial<R036Options> & { apkPath: string | null }): Promise<R036RunOutput> {
    const options: R036Options = { ...DEFAULT_R036_OPTIONS, ...partial, timeouts: { ...DEFAULT_R036_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(R036_SCENARIO_ID, startedAt, apkSha);
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
    let sceneReadyIndex: number | null = null;

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
    /** Records an assertion; the first failure stops the run. */
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
    const latestZones = (): ProjectedZone[] | null => {
        const events = stream!.allEvents().filter((e) => (e.evt === 'zones_projected' || (e.evt === 'scene_ready' && e.reason === 'scene_ready')) && Array.isArray(e.zones));
        return zonesOf(events.pop());
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

        // ---- 1. Fresh launch → scene_ready + session ready + ui_layout ------------------------
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
                throw new EnvironmentStop(envFailure('saves_cleared', 'launch', 'pm clear or run-as rm of the save files', (error as Error).message), null);
            }
        }
        assertions.push({ id: 'saves_cleared', step: 'launch', ok: true });
        await driver.logcatClear();
        stream = driver.startLogcat(paths.logcat);
        logcatStarted = true;
        try { await driver.launch(options.packageName, options.activity); } catch (error) {
            throw new EnvironmentStop(envFailure('app_launched', 'launch', `${options.packageName}/${options.activity}`, (error as Error).message), null);
        }
        assertions.push({ id: 'app_launched', step: 'launch', ok: true });
        const ready = await stream.waitFor((e) => e.evt === 'scene_ready', 0, options.timeouts.sceneReadyMs);
        if (!ready) {
            const errors = errorLinesSince(0);
            if (errors.length > 0) check('scene_ready', 'launch', false, 'RUNTIME_ERROR', { evt: 'scene_ready' }, { errorMessages: summarizeErrors(errors) }, errors.slice(0, 20));
            const anyDiagnostics = stream.allEvents().length > 0;
            throw new EnvironmentStop(envFailure('scene_ready', 'launch', { evt: 'scene_ready' }, { diagnosticsSeen: anyDiagnostics, hint: anyDiagnostics ? 'scene never became ready' : 'APK has no [AUT-DEVICE] diagnostics (non-DEBUG build or wrong start scene)' }), null);
        }
        assertions.push({ id: 'scene_ready', step: 'launch', ok: true });
        sceneReadyIndex = ready.record.index;
        const session = await stream.waitFor((e) => e.evt === 'session_state' && (e.phase === 'ready' || e.phase === 'load_failed'), 0, options.timeouts.sessionMs);
        check('session_ready', 'launch', session !== null && session.event.phase === 'ready', 'RUNTIME_ERROR', { evt: 'session_state', phase: 'ready' }, session?.event ?? null, asLine(session?.event));
        const layoutRecord = await stream.waitFor((e) => e.evt === 'ui_layout', session!.record.index, options.timeouts.uiLayoutMs);
        check('ui_layout_reported', 'launch', layoutRecord !== null, 'RUNTIME_ERROR', { evt: 'ui_layout', after: 'session_state ready' }, { events: stream.eventsSince(session!.record.index).map((e) => e.evt) });
        const layout = parseUiLayout(layoutRecord!.event);
        check('ui_layout_parsed', 'launch', layout !== null, 'RUNTIME_ERROR', 'ui_layout with screen + rects', layoutRecord!.event, asLine(layoutRecord!.event));
        steps.push({ id: 'ui_layout', session: session!.event, layout: layoutRecord!.event });

        // A scheduled first-automation reveal (never on a fresh save) would move the camera; wait it out.
        const lastReveal = stream.allEvents().filter((e) => e.evt === 'reveal_state').pop();
        if (lastReveal && (lastReveal.phase === 'pending' || lastReveal.phase === 'started')) {
            const done = await stream.waitFor((e) => e.evt === 'reveal_state' && e.phase === 'complete', 0, options.timeouts.revealMs);
            if (!done) warnings.push('reveal did not complete; using the latest projection');
            else await stream.waitFor((e) => e.evt === 'zones_projected', done.record.index, options.timeouts.projectionMs);
        }

        // ---- 2. Geometry -------------------------------------------------------------------
        const zones = latestZones();
        check('zones_projected_present', 'geometry', zones !== null, 'RUNTIME_ERROR', 'scene_ready / zones_projected carries zones', null);
        const screenOfZones = stream.allEvents().filter((e) => Array.isArray(e.zones)).pop()?.screen as { w?: number; h?: number } | undefined;
        check('ui_layout_same_frame_as_zones', 'geometry', screenOfZones?.w === layout!.screen.w && screenOfZones?.h === layout!.screen.h, 'ENVIRONMENT', layout!.screen, screenOfZones ?? null);
        record(evaluateUiGeometry({ step: 'geometry', layout: layout!, zones: zones!, evidenceLines: asLine(layoutRecord!.event) }));

        // ---- 3. Screenshot (kept for the readability gate deferred to AUT-UI-001) --------------
        await sleep(300);
        const layoutShot = await capture('ui_layout');
        steps.push({ id: 'screenshot', screenshot: layoutShot });
        if (!displaySize) throw new EnvironmentStop(envFailure('display_size', 'calibration', 'screencap PNG', null), null);
        const display = displaySize as { width: number; height: number };
        const win = { w: layout!.screen.w, h: layout!.screen.h };

        // ---- Calibration: the ui_layout frame is the touch frame --------------------------------
        const calibration = pickCalibrationPoint(layout!, display, (adb) => adbToCocos(adb, win, display));
        check('calibration_point_clear_of_ui', 'calibration', calibration !== null, 'MARKER_PRESENTATION', 'a calibration candidate outside every UI rect', layout!.rects);
        let cursor = stream.cursor;
        await driver.tap(calibration!.adb.x, calibration!.adb.y);
        await stream.waitFor((e) => e.evt === 'touch_end', cursor, options.timeouts.chainMs);
        await sleep(400);
        const calEvents = stream.eventsSince(cursor);
        record(evaluateCalibration({ step: 'calibration', expectedTouch: calibration!.cocos, tolerancePx: 3, events: calEvents, windowSize: win, displaySize: display }));
        steps.push({ id: 'calibration', kind: 'tap', adb: calibration!.adb, expectedCocos: calibration!.cocos, ok: true });
        let selectedNow = (stream.allEvents().filter((e) => e.evt === 'selection_state').pop()?.next as string | null | undefined) ?? null;
        if (calEvents.some((e) => e.evt === 'camera_focus' && e.phase === 'started')) {
            warnings.push(`calibration tap selected ${String(selectedNow)}`);
            const settled = await stream.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
            if (settled) await stream.waitFor((e) => e.evt === 'zones_projected', settled.record.index, options.timeouts.projectionMs);
        }

        // ---- 4. Tap the Fabricator → selection_state next=Fabricator ---------------------------
        const fabricator = (latestZones() ?? []).find((z) => z.id === 'Fabricator');
        check('fabricator_projected_on_screen', 'tap_fabricator', !!fabricator && fabricator.onScreen && typeof fabricator.sx === 'number' && typeof fabricator.sy === 'number', 'CAMERA_FOCUS', { id: 'Fabricator', onScreen: true }, fabricator ?? null);
        const fabricatorCocos = { x: fabricator!.sx as number, y: fabricator!.sy as number };
        check('fabricator_not_under_ui', 'tap_fabricator', uiRectsAt(layout!, fabricatorCocos).length === 0, 'MARKER_PRESENTATION', { under: [] }, { under: uiRectsAt(layout!, fabricatorCocos), centre: fabricatorCocos });
        const fabricatorAdb = cocosToAdb(fabricatorCocos, win, display);
        const fabricatorTap = { x: Math.round(fabricatorAdb.x), y: Math.round(fabricatorAdb.y) };
        cursor = stream.cursor;
        await driver.tap(fabricatorTap.x, fabricatorTap.y);
        await stream.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
        await sleep(250);
        record(evaluateTapStep({
            step: 'tap_fabricator', zoneId: 'Fabricator', previousSelection: selectedNow, expectedTouch: adbToCocos(fabricatorTap, win, display), touchTolerancePx: 3,
            events: stream.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive(),
        }));
        selectedNow = 'Fabricator';

        // ---- 4b. Post-selection ui_layout (real Fabricator strings) → geometry + model checks ------
        const refreshed = await stream.waitFor((e) => e.evt === 'ui_layout' && e.reason === 'selection_refresh', cursor, options.timeouts.uiLayoutMs);
        check('ui_layout_after_selection', 'selection_layout', refreshed !== null, 'RUNTIME_ERROR', { evt: 'ui_layout', reason: 'selection_refresh' }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
        const selectedLayout = parseUiLayout(refreshed!.event);
        check('ui_layout_after_selection_parsed', 'selection_layout', selectedLayout !== null && selectedLayout.safeArea !== null, 'RUNTIME_ERROR', 'ui_layout with screen + safeArea + rects', refreshed!.event, asLine(refreshed!.event));
        record(evaluateUiGeometry({ step: 'selection_layout', layout: selectedLayout!, zones: latestZones() ?? [], evidenceLines: asLine(refreshed!.event) }));
        const predicted = computeUiLayout(selectedLayout!.screen, selectedLayout!.safeArea!);
        record(evaluateUiLayoutModel({
            step: 'selection_layout', layout: selectedLayout!, predictedButtons: predicted.buttons,
            expectedRows: { CoreHUD: CORE_HUD_LAYOUT.rows.map((row) => row.key), ProducerPanel: PRODUCER_PANEL_LAYOUT.rows.map((row) => row.key) },
            evidenceLines: asLine(refreshed!.event),
        }));
        steps.push({ id: 'tap_fabricator', kind: 'tap', adb: fabricatorTap, ok: true, layout: refreshed!.event, screenshot: await capture('fabricator_selected') });

        // ---- 5. UI taps: HUD and each panel Button (rects from the post-selection layout) -----------
        for (const target of R036_UI_TAP_TARGETS) {
            const centre = rectCentre(selectedLayout!.rects[target]!);
            const adb = cocosToAdb(centre, win, display);
            const tap = { x: Math.round(adb.x), y: Math.round(adb.y) };
            const stepId = `ui_tap_${target}`;
            cursor = stream.cursor;
            await driver.tap(tap.x, tap.y);
            await sleep(options.timeouts.uiTapWindowMs);
            const events = stream.eventsSince(cursor);
            steps.push({ id: stepId, kind: 'tap', target, adb: tap, expectedCocos: centre, events: events.map((e) => e.evt) });
            record(evaluateUiTap({ step: stepId, target, selectionBefore: selectedNow, events, runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() }));
        }
        const lastSelection = stream.allEvents().filter((e) => e.evt === 'selection_state').pop();
        check('selection_still_fabricator', 'ui_taps', lastSelection?.next === 'Fabricator', 'SELECTION_STATE', { next: 'Fabricator' }, { next: lastSelection?.next ?? null }, asLine(lastSelection));
        await capture('after_ui_taps');

        // ---- 6. Zero runtime/`error` events after scene_ready -----------------------------------
        const errors = stream.recordsSince(sceneReadyIndex).filter((r) => r.runtimeError).map((r) => r.line);
        check('no_errors_after_scene_ready', 'final', errors.length === 0, 'RUNTIME_ERROR', { runtimeErrors: 0 }, { runtimeErrors: errors.length, errorMessages: summarizeErrors(errors) }, errors.slice(0, 20));
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
        scenarioId: R036_SCENARIO_ID,
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
