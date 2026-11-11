/**
 * AUT-GP-001 scenario — the Assembly batch action works end to end on a real device.
 *
 *   clear saves → fresh launch (writablePath) → force-stop → push a seeded save (Fabricator Lv15 automated by
 *             Auto Feeder, Assembly Station Lv1, no Worker Bot) → relaunch → loaded_main
 *   tap the Assembly Station → selection_state AssemblyStation → ui_layout selection_refresh with the
 *             AssemblyBatchAction rect inside the panel, state ready, disjoint from Manual Produce
 *   tap the batch → command_result launchAssemblyBatch ok, assembly_batch launched, ui running with progress;
 *             a second tap while running issues no command; no selection / camera event from the UI taps
 *   wait → assembly_batch completed with payout = the pure preview (> 0) → ui ready again
 *   throughout: zero `error` events after scene_ready.
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
import { createAssemblyBatchViewModel } from '../../../assets/scripts/presentation/AssemblyBatchViewModel.ts';
import { ASSEMBLY_BATCH_ACTION_KEY } from '../../../assets/scripts/presentation/UiLayout.ts';
import { createFreshGameState, type GameState } from '../../../assets/scripts/state/index.ts';
import { AdbError, pngSize, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import { cocosToAdb, type AssertionFailure, type AssertionRecord, type FailureClass, type StepEvaluation } from '../classification.ts';
import type { SessionDeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';
import { evaluateUiTap, parseUiLayout, rectCentre, rectInside, rectsOverlapBeyond, toRect, uiRectsAt, type Rect, type UiLayoutSnapshot } from '../ui_geometry.ts';
import { renderSummary, summarizeErrors } from './c3_producer_selection.ts';
import { SAVE_FILE_NAMES } from './int001_session_persistence.ts';
import { parseHudActions } from './ui001_core_loop.ts';

export const GP001_SCENARIO_ID = 'GP001-assembly-batch';
export const GP001_ZONE = 'AssemblyStation';

export interface Gp001Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    timeouts: { sceneReadyMs: number; sessionMs: number; uiLayoutMs: number; commandMs: number; chainMs: number; uiTapWindowMs: number; batchSlackMs: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_GP001_OPTIONS: Omit<Gp001Options, 'apkPath'> = {
    taskId: 'AUT-GP-001',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    timeouts: { sceneReadyMs: 60_000, sessionMs: 20_000, uiLayoutMs: 5_000, commandMs: 3_000, chainMs: 4_000, uiTapWindowMs: 1_500, batchSlackMs: 10_000 },
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const asLine = (event: ParsedDeviceEvent | null | undefined) => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);

// ---- Pure helpers (shared with tests) ---------------------------------------------------------

function economy() {
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

/** Fabricator Lv15 automated by Auto Feeder, Assembly Station Lv1 (manual: the batch is available), no Worker Bot. */
export function buildGp001SeededState(): GameState {
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.producers.assembly_station = { level: 1, isUnlocked: true, isBuilt: true };
    return state;
}

export function buildGp001SeededSave(nowMs: number): string {
    return serializeGameStateToSaveJson(buildGp001SeededState(), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

/** The batch payout and duration the seeded save must produce (pure view model; never hard-coded). */
export function expectedGp001Batch(): { payout: number; durationSeconds: number } {
    const repository = economy();
    const viewModel = createAssemblyBatchViewModel(repository, buildGp001SeededState(), 'assembly_station');
    const durationSeconds = repository.getProducer('assembly_station')?.assistedProduction?.batchDurationSeconds;
    if (viewModel.state !== 'ready' || typeof durationSeconds !== 'number') throw new Error('seeded state does not expose a ready Assembly batch');
    return { payout: viewModel.payout, durationSeconds };
}

export interface AssemblyBatchUiSnapshot { rect: Rect | null; state: string | null; enabled: boolean | null; caption: string | null }

/** The batch Button rect and rendered state from a `ui_layout` event (missing → null). */
export function parseAssemblyBatchUi(event: ParsedDeviceEvent | null | undefined): AssemblyBatchUiSnapshot {
    const rect = toRect(((event?.rects ?? {}) as Record<string, unknown>)[ASSEMBLY_BATCH_ACTION_KEY]);
    const raw = event?.assemblyBatch as { state?: unknown; enabled?: unknown; caption?: unknown } | null | undefined;
    return {
        rect,
        state: typeof raw?.state === 'string' ? raw.state : null,
        enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : null,
        caption: typeof raw?.caption === 'string' ? raw.caption : null,
    };
}

/** Batch Button shown, ready, inside the panel and disjoint from Manual Produce. Failures are MARKER_PRESENTATION / RUNTIME_ERROR. */
export function evaluateAssemblyBatchReady(step: string, layout: UiLayoutSnapshot, event: ParsedDeviceEvent): StepEvaluation {
    const assertions: AssertionRecord[] = [];
    const fail = (id: string, failureClass: FailureClass, expected: unknown, actual: unknown): StepEvaluation => {
        assertions.push({ id, step, ok: false });
        return { ok: false, assertions, failure: { failureClass, assertion: id, step, expected, actual, evidenceLines: asLine(event) } };
    };
    const batch = parseAssemblyBatchUi(event);
    if (!batch.rect || batch.rect.w <= 0 || batch.rect.h <= 0) return fail('batch_action_rect_present', 'MARKER_PRESENTATION', { rect: ASSEMBLY_BATCH_ACTION_KEY }, batch);
    assertions.push({ id: 'batch_action_rect_present', step, ok: true });
    if (batch.state !== 'ready' || batch.enabled !== true || !batch.caption) return fail('batch_action_ready', 'RUNTIME_ERROR', { state: 'ready', enabled: true, caption: 'non-empty' }, batch);
    assertions.push({ id: 'batch_action_ready', step, ok: true });
    const panel = layout.rects.ProducerPanel;
    if (!panel || !rectInside(panel, batch.rect)) return fail('batch_action_inside_panel', 'MARKER_PRESENTATION', { inside: panel }, batch.rect);
    assertions.push({ id: 'batch_action_inside_panel', step, ok: true });
    const manual = parseHudActions(event).rects.ManualProduceAction;
    if (!manual || rectsOverlapBeyond(manual, batch.rect, 0.5)) return fail('batch_action_disjoint_from_manual_produce', 'MARKER_PRESENTATION', { overlap: false }, { manual, batch: batch.rect });
    assertions.push({ id: 'batch_action_disjoint_from_manual_produce', step, ok: true });
    return { ok: true, assertions, failure: null };
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
const isBatch = (phase: string, state?: string) => (e: ParsedDeviceEvent) => e.evt === 'assembly_batch' && e.phase === phase && (state === undefined || e.state === state);

export interface Gp001RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runGp001Scenario(driver: SessionDeviceDriver, partial: Partial<Gp001Options> & { apkPath: string | null }): Promise<Gp001RunOutput> {
    const options: Gp001Options = { ...DEFAULT_GP001_OPTIONS, ...partial, timeouts: { ...DEFAULT_GP001_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(GP001_SCENARIO_ID, startedAt, apkSha);
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
        return { cursor, session: session!.event, layoutEvent: layoutRecord!.event, layout: layout! };
    };
    const toAdb = (layout: UiLayoutSnapshot, point: { x: number; y: number }) => {
        const adb = cocosToAdb(point, { w: layout.screen.w, h: layout.screen.h }, displaySize!);
        return { x: Math.round(adb.x), y: Math.round(adb.y) };
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

        // ---- 1. Fresh launch (app-private save directory) ---------------------------------------
        await driver.forceStop(options.packageName);
        try {
            await driver.clearAppData(options.packageName);
            steps.push({ id: 'clear_saves', method: 'pm clear' });
        } catch (clearError) {
            warnings.push(`pm clear refused, deleting save files via run-as: ${(clearError as Error).message.slice(0, 200)}`);
            try {
                const filesDir = `${await driver.appDataDirectory(options.packageName)}/files/`;
                await driver.removeAppFiles(options.packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
                steps.push({ id: 'clear_saves', method: 'run-as rm', directory: filesDir });
            } catch (error) {
                throw new EnvironmentStop(envFailure('saves_cleared', 'fresh_launch', 'pm clear or run-as rm of the save files', (error as Error).message), null);
            }
        }
        await driver.logcatClear();
        stream = driver.startLogcat(paths.logcat);
        logcatStarted = true;
        const fresh = await launchUntilLayout('fresh_launch');
        const writablePath = typeof fresh.session.writablePath === 'string' ? fresh.session.writablePath : '';
        check('writable_path_reported', 'fresh_launch', /^\/[A-Za-z0-9._/-]+\/$/.test(writablePath), 'RUNTIME_ERROR', 'absolute app-private directory', writablePath, asLine(fresh.session));
        check('fresh_batch_hidden', 'fresh_launch', parseAssemblyBatchUi(fresh.layoutEvent).rect === null, 'RUNTIME_ERROR', { [ASSEMBLY_BATCH_ACTION_KEY]: null }, parseAssemblyBatchUi(fresh.layoutEvent), asLine(fresh.layoutEvent));
        await capture('fresh_ready');
        if (!displaySize) throw new EnvironmentStop(envFailure('display_size', 'fresh_launch', 'screencap PNG', null), null);

        // ---- 2. Seeded save: Assembly Station Lv1, manual ---------------------------------------
        await driver.forceStop(options.packageName);
        const seeded = buildGp001SeededSave(now().getTime());
        writeFileSync(path.join(paths.runDir, 'seeded_save_main.json'), seeded);
        try {
            await driver.removeAppFiles(options.packageName, SAVE_FILE_NAMES.map((name) => `${writablePath}${name}`));
            await driver.writeAppFile(options.packageName, `${writablePath}save_main.json`, seeded);
        } catch (error) {
            throw new EnvironmentStop(envFailure('seeded_save_pushed', 'seeded_launch', 'run-as write into app storage (debuggable APK)', (error as Error).message), null);
        }
        assertions.push({ id: 'seeded_save_pushed', step: 'seeded_launch', ok: true });
        const seededLaunch = await launchUntilLayout('seeded_launch');
        check('seeded_loaded_main', 'seeded_launch', seededLaunch.session.status === 'loaded_main', 'RUNTIME_ERROR', { status: 'loaded_main' }, seededLaunch.session, asLine(seededLaunch.session));
        steps.push({ id: 'seeded_launch', session: seededLaunch.session, layout: seededLaunch.layoutEvent, screenshot: await capture('seeded_ready') });
        checkNoErrors('seeded_launch');

        // ---- 3. Select the Assembly Station: the batch Button appears, ready ---------------------
        let batchLayout: UiLayoutSnapshot;
        let batchRect: Rect;
        {
            const zones = stream.allEvents().filter((e) => (e.evt === 'zones_projected' || (e.evt === 'scene_ready' && e.reason === 'scene_ready')) && Array.isArray(e.zones)).pop()?.zones as Array<{ id: string; sx: number | null; sy: number | null; onScreen: boolean }> | undefined;
            const zone = zones?.find((z) => z.id === GP001_ZONE);
            check('assembly_projected_on_screen', 'select_assembly', !!zone && zone.onScreen && typeof zone.sx === 'number' && typeof zone.sy === 'number', 'CAMERA_FOCUS', { id: GP001_ZONE, onScreen: true }, zone ?? null);
            const centre = { x: zone!.sx as number, y: zone!.sy as number };
            check('assembly_not_under_ui', 'select_assembly', uiRectsAt(seededLaunch.layout, centre).length === 0, 'MARKER_PRESENTATION', { under: [] }, { under: uiRectsAt(seededLaunch.layout, centre), centre });
            const cursor = stream.cursor;
            const tap = toAdb(seededLaunch.layout, centre);
            await driver.tap(tap.x, tap.y);
            const selected = await stream.waitFor((e) => e.evt === 'selection_state' && e.next === GP001_ZONE, cursor, options.timeouts.chainMs);
            check('assembly_selected', 'select_assembly', selected !== null, 'SELECTION_STATE', { evt: 'selection_state', next: GP001_ZONE }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            const refreshed = await stream.waitFor((e) => e.evt === 'ui_layout' && e.reason === 'selection_refresh', cursor, options.timeouts.uiLayoutMs);
            check('ui_layout_after_selection', 'select_assembly', refreshed !== null, 'RUNTIME_ERROR', { evt: 'ui_layout', reason: 'selection_refresh' }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            const layout = parseUiLayout(refreshed!.event);
            check('ui_layout_after_selection_parsed', 'select_assembly', layout !== null, 'RUNTIME_ERROR', 'ui_layout', refreshed!.event, asLine(refreshed!.event));
            record(evaluateAssemblyBatchReady('select_assembly', layout!, refreshed!.event));
            batchLayout = layout!;
            batchRect = parseAssemblyBatchUi(refreshed!.event).rect!;
            await stream.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
            steps.push({ id: 'select_assembly', kind: 'tap', adb: tap, batch: parseAssemblyBatchUi(refreshed!.event), screenshot: await capture('assembly_selected') });
        }
        checkNoErrors('select_assembly');

        // ---- 4. Launch the batch; a second tap while running issues nothing ------------------------
        const expected = expectedGp001Batch();
        const batchTap = toAdb(batchLayout, rectCentre(batchRect));
        let launchedIndex: number;
        {
            let cursor = stream.cursor;
            await driver.tap(batchTap.x, batchTap.y);
            const result = await stream.waitFor(isCommandResult('launchAssemblyBatch'), cursor, options.timeouts.commandMs);
            check('launch_command_result', 'launch_batch', result !== null, 'INPUT_NOT_RECEIVED', { evt: 'command_result', command: { type: 'launchAssemblyBatch' } }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            check('launch_ok', 'launch_batch', result!.event.ok === true, 'RUNTIME_ERROR', { ok: true }, result!.event, asLine(result!.event));
            const launched = await stream.waitFor(isBatch('launched'), cursor, options.timeouts.chainMs);
            check('batch_launched_event', 'launch_batch', launched !== null && launched.event.durationSeconds === expected.durationSeconds, 'RUNTIME_ERROR', { evt: 'assembly_batch', phase: 'launched', durationSeconds: expected.durationSeconds }, launched?.event ?? null, asLine(launched?.event));
            launchedIndex = launched!.record.index;
            const running = await stream.waitFor(isBatch('ui', 'running'), cursor, options.timeouts.chainMs);
            check('batch_ui_running', 'launch_batch', running !== null && running.event.enabled === false && typeof running.event.progress === 'number', 'RUNTIME_ERROR', { phase: 'ui', state: 'running', enabled: false }, running?.event ?? null, asLine(running?.event));
            await sleep(options.timeouts.uiTapWindowMs);
            record(evaluateUiTap({ step: 'launch_batch', target: ASSEMBLY_BATCH_ACTION_KEY, selectionBefore: GP001_ZONE, events: stream.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() }));
            steps.push({ id: 'launch_batch', kind: 'tap', adb: batchTap, result: result!.event, launched: launched!.event, running: running!.event, screenshot: await capture('batch_running') });

            cursor = stream.cursor;
            await driver.tap(batchTap.x, batchTap.y);
            await sleep(options.timeouts.uiTapWindowMs);
            const again = stream.eventsSince(cursor).filter((e) => e.evt === 'command_result');
            check('running_tap_no_command', 'running_tap', again.length === 0, 'RUNTIME_ERROR', { command_result: 0 }, { commands: again.map((e) => e.command) }, again.flatMap(asLine));
            record(evaluateUiTap({ step: 'running_tap', target: ASSEMBLY_BATCH_ACTION_KEY, selectionBefore: GP001_ZONE, events: stream.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() }));
        }
        checkNoErrors('launch_batch');

        // ---- 5. Completion pays the batch; the Button is ready again ---------------------------------
        {
            const waitMs = expected.durationSeconds * 1000 + options.timeouts.batchSlackMs;
            const completed = await stream.waitFor(isBatch('completed'), launchedIndex, waitMs);
            check('batch_completed_event', 'complete_batch', completed !== null, 'RUNTIME_ERROR', { evt: 'assembly_batch', phase: 'completed', withinMs: waitMs }, stream.eventsSince(launchedIndex).filter((e) => e.evt === 'assembly_batch'));
            const payout = completed!.event.payout;
            check('batch_payout', 'complete_batch', typeof payout === 'number' && payout > 0 && Math.abs(payout - expected.payout) <= 1e-6 * expected.payout, 'RUNTIME_ERROR', { payout: expected.payout }, completed!.event, asLine(completed!.event));
            const progressSeen = stream.eventsSince(launchedIndex).filter(isBatch('ui', 'running')).map((e) => e.progress as number);
            check('batch_progress_reported', 'complete_batch', progressSeen.length >= 3 && progressSeen.every((p, i) => i === 0 || p >= progressSeen[i - 1]), 'RUNTIME_ERROR', { runningUiEvents: '≥3, non-decreasing' }, { progress: progressSeen });
            // The binding refreshes the Button before it reports the domain events, so `ui ready` may precede `completed`.
            const ready = await stream.waitFor(isBatch('ui', 'ready'), launchedIndex, options.timeouts.chainMs);
            check('batch_ready_again', 'complete_batch', ready !== null && ready.event.enabled === true, 'RUNTIME_ERROR', { phase: 'ui', state: 'ready', enabled: true }, ready?.event ?? null);
            const launches = stream.eventsSince(seededLaunch.cursor).filter(isCommandResult('launchAssemblyBatch'));
            check('exactly_one_launch', 'complete_batch', launches.length === 1, 'RUNTIME_ERROR', { launchAssemblyBatch: 1 }, { launchAssemblyBatch: launches.length });
            steps.push({ id: 'complete_batch', expected, completed: completed!.event, progress: progressSeen, ready: ready!.event, screenshot: await capture('batch_completed') });
        }

        // ---- 6. Zero `error` events after scene_ready ------------------------------------------------
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
        scenarioId: GP001_SCENARIO_ID,
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
