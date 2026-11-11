/**
 * AUT-039 scenario — Assembly + first Worker Bot vertical slice on a real device.
 *
 *   clear saves → fresh launch (writablePath) → robot_state synced, no robot
 *   force-stop → push a seeded save (Fabricator Lv15 automated by Auto Feeder, Assembly Station Lv10,
 *             Output = Worker Bot cost, Worker Bot not owned) → relaunch → loaded_main, robot_state synced
 *             present:false at the Worker Bot frontier, Next Goal action enabled
 *   tap Next Goal → command_result purchaseBreakthrough worker_bot ok (eventTypes ∋ firstRobotProduced)
 *             → robot_state reveal_started (Civilization 1, focus requested) + camera_focus started kind reveal
 *             on the reveal target → reveal_complete → loop_started → waypoints in loop order (robot on route)
 *   HOME (critical suspend save) → force-stop → relaunch → loaded_main, robot_state synced present:true
 *             mode loop, NO robot_state reveal_started / reveal_state started, waypoints continue
 *   throughout: zero `error` events after scene_ready. Portrait screenshots at each beat.
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
import { FIRST_ROBOT_REVEAL_TARGET } from '../../../assets/scripts/presentation/AssemblySliceLayout.ts';
import { WORKER_BOT_LOOP_ROUTE, WORKER_BOT_LOOP_SECONDS } from '../../../assets/scripts/presentation/WorkerBotRoute.ts';
import { createFreshGameState, type GameState } from '../../../assets/scripts/state/index.ts';
import { AdbError, pngSize, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import { cocosToAdb, type AssertionFailure, type AssertionRecord, type FailureClass, type StepEvaluation } from '../classification.ts';
import type { SessionDeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';
import { parseUiLayout, rectCentre, type UiLayoutSnapshot } from '../ui_geometry.ts';
import { renderSummary, summarizeErrors } from './c3_producer_selection.ts';
import { SAVE_FILE_NAMES } from './int001_session_persistence.ts';
import { parseHudActions } from './ui001_core_loop.ts';

export const AUT039_SCENARIO_ID = 'AUT039-first-robot';
export const AUT039_BREAKTHROUGH_ID = 'worker_bot';
export const AUT039_ALLOWED_CLIPS = Object.freeze(['Robot_ThumbsUp', 'Robot_Walking', 'Robot_Idle']);
/** Loop stop ids in route order (the harness checks the cyclic order of the waypoint events). */
export const AUT039_LOOP_ORDER: readonly string[] = Object.freeze(WORKER_BOT_LOOP_ROUTE.map((stop) => stop.id));

export interface Aut039Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    /** Loop waypoints required after the reveal / after the relaunch. */
    minLoopWaypoints: number;
    minRelaunchWaypoints: number;
    timeouts: { sceneReadyMs: number; sessionMs: number; uiLayoutMs: number; commandMs: number; chainMs: number; revealMs: number; suspendMs: number; noRevealWindowMs: number; activationShotMs: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_AUT039_OPTIONS: Omit<Aut039Options, 'apkPath'> = {
    taskId: 'AUT-039',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    minLoopWaypoints: 5,
    minRelaunchWaypoints: 3,
    timeouts: { sceneReadyMs: 60_000, sessionMs: 20_000, uiLayoutMs: 5_000, commandMs: 3_000, chainMs: 4_000, revealMs: 10_000, suspendMs: 10_000, noRevealWindowMs: 3_000, activationShotMs: 700 },
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const asLine = (event: ParsedDeviceEvent | null | undefined) => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);

// ---- Pure helpers (shared with tests) ---------------------------------------------------------

function economy() {
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

/** Worker Bot cost from the embedded economy config (never hard-coded). */
export function workerBotCost(): number {
    const cost = economy().getBreakthrough(AUT039_BREAKTHROUGH_ID)?.cost;
    if (typeof cost !== 'number') throw new Error('worker_bot has no cost in the embedded config');
    return cost;
}

/** Fabricator Lv15 automated by Auto Feeder, Assembly Station Lv10, Output = Worker Bot cost, Worker Bot NOT owned. */
export function buildAut039SeededState(): GameState {
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.producers.assembly_station = { level: 10, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = workerBotCost();
    return state;
}

export function buildAut039SeededSave(nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut039SeededState(), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

const isRobot = (phase: string) => (e: ParsedDeviceEvent) => e.evt === 'robot_state' && e.phase === phase;
const isCommandResult = (type: string) => (e: ParsedDeviceEvent) => e.evt === 'command_result' && (e.command as { type?: unknown } | undefined)?.type === type;

/**
 * Loop waypoint events: at least `min`, all in loop mode with an allowed clip, following the cyclic
 * route order and each reported near its stop. Failures are RUNTIME_ERROR (wrong route) / MARKER_PRESENTATION (clip).
 */
export function evaluateRobotLoop(step: string, events: readonly ParsedDeviceEvent[], min: number): StepEvaluation {
    const assertions: AssertionRecord[] = [];
    const waypoints = events.filter(isRobot('waypoint')).filter((e) => e.mode === 'loop');
    const fail = (id: string, failureClass: FailureClass, expected: unknown, actual: unknown): StepEvaluation => {
        assertions.push({ id, step, ok: false });
        return { ok: false, assertions, failure: { failureClass, assertion: id, step, expected, actual, evidenceLines: waypoints.slice(0, 12).flatMap(asLine) } };
    };
    if (waypoints.length < min) return fail('robot_loop_waypoints', 'RUNTIME_ERROR', { loopWaypoints: `>= ${min}` }, { loopWaypoints: waypoints.length });
    assertions.push({ id: 'robot_loop_waypoints', step, ok: true });
    const ids = waypoints.map((e) => String(e.stopId));
    const start = AUT039_LOOP_ORDER.indexOf(ids[0]);
    const ordered = start >= 0 && ids.every((id, i) => id === AUT039_LOOP_ORDER[(start + i) % AUT039_LOOP_ORDER.length]);
    if (!ordered) return fail('robot_loop_order', 'RUNTIME_ERROR', { cyclicOrder: AUT039_LOOP_ORDER }, { ids });
    assertions.push({ id: 'robot_loop_order', step, ok: true });
    const far = waypoints.filter((e) => {
        const stop = WORKER_BOT_LOOP_ROUTE.find((s) => s.id === e.stopId);
        return !stop || typeof e.x !== 'number' || typeof e.z !== 'number' || Math.hypot(e.x - stop.x, e.z - stop.z) > 0.35;
    });
    if (far.length > 0) return fail('robot_loop_on_route', 'RUNTIME_ERROR', { withinUnits: 0.35 }, { far });
    assertions.push({ id: 'robot_loop_on_route', step, ok: true });
    const badClip = waypoints.filter((e) => !AUT039_ALLOWED_CLIPS.includes(String(e.clip)));
    if (badClip.length > 0) return fail('robot_loop_clips', 'MARKER_PRESENTATION', { clips: AUT039_ALLOWED_CLIPS }, { badClip });
    assertions.push({ id: 'robot_loop_clips', step, ok: true });
    return { ok: true, assertions, failure: null };
}

/** The reveal focus beat targets the first-robot reveal anchor (camera_focus started, kind reveal). */
export function isRevealFocusOnTarget(event: ParsedDeviceEvent | null | undefined, tolerance = 0.05): boolean {
    const target = event?.target as { x?: unknown; z?: unknown } | undefined;
    return event?.evt === 'camera_focus' && event.phase === 'started' && event.kind === 'reveal'
        && typeof target?.x === 'number' && typeof target?.z === 'number'
        && Math.abs(target.x - FIRST_ROBOT_REVEAL_TARGET.x) <= tolerance && Math.abs(target.z - FIRST_ROBOT_REVEAL_TARGET.z) <= tolerance;
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

export interface Aut039RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runAut039Scenario(driver: SessionDeviceDriver, partial: Partial<Aut039Options> & { apkPath: string | null }): Promise<Aut039RunOutput> {
    const options: Aut039Options = { ...DEFAULT_AUT039_OPTIONS, ...partial, timeouts: { ...DEFAULT_AUT039_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(AUT039_SCENARIO_ID, startedAt, apkSha);
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
        const synced = stream!.eventsSince(cursor).filter(isRobot('synced')).pop() ?? null;
        check('robot_synced', step, synced !== null, 'RUNTIME_ERROR', { evt: 'robot_state', phase: 'synced' }, { events: stream!.eventsSince(cursor).map((e) => e.evt) });
        const layoutRecord = await stream!.waitFor((e) => e.evt === 'ui_layout', session!.record.index, options.timeouts.uiLayoutMs);
        check('ui_layout_reported', step, layoutRecord !== null, 'RUNTIME_ERROR', { evt: 'ui_layout', after: 'session_state ready' }, { events: stream!.eventsSince(session!.record.index).map((e) => e.evt) });
        const layout = parseUiLayout(layoutRecord!.event);
        check('ui_layout_parsed', step, layout !== null && layout.safeArea !== null, 'RUNTIME_ERROR', 'ui_layout with screen + safeArea + rects', layoutRecord!.event, asLine(layoutRecord!.event));
        return { cursor, session: session!.event, synced: synced!, layoutEvent: layoutRecord!.event, layout: layout! };
    };
    const toAdb = (layout: UiLayoutSnapshot, point: { x: number; y: number }) => {
        const adb = cocosToAdb(point, { w: layout.screen.w, h: layout.screen.h }, displaySize!);
        return { x: Math.round(adb.x), y: Math.round(adb.y) };
    };
    const loopWaitMs = (waypoints: number) => Math.ceil(((waypoints + 1) / AUT039_LOOP_ORDER.length) * WORKER_BOT_LOOP_SECONDS * 1000) + options.timeouts.chainMs;
    const waitForWaypoints = async (since: number, count: number) => {
        const deadline = Date.now() + loopWaitMs(count);
        while (Date.now() < deadline) {
            if (stream!.eventsSince(since).filter(isRobot('waypoint')).filter((e) => e.mode === 'loop').length >= count) return;
            await sleep(250);
        }
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

        // ---- 1. Fresh launch: no robot -----------------------------------------------------------
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
        check('fresh_no_robot', 'fresh_launch', fresh.synced.present === false && fresh.synced.mode === 'hidden' && fresh.synced.assemblyPhase === 'unbuilt', 'RUNTIME_ERROR', { present: false, mode: 'hidden', assemblyPhase: 'unbuilt' }, fresh.synced, asLine(fresh.synced));
        await capture('fresh_ready');
        if (!displaySize) throw new EnvironmentStop(envFailure('display_size', 'fresh_launch', 'screencap PNG', null), null);

        // ---- 2. Seeded save: Worker Bot frontier ----------------------------------------------------
        await driver.forceStop(options.packageName);
        const seeded = buildAut039SeededSave(now().getTime());
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
        const frontierModules = Array.isArray(seededLaunch.synced.modules) ? seededLaunch.synced.modules as string[] : [];
        check('frontier_no_robot', 'seeded_launch', seededLaunch.synced.present === false && seededLaunch.synced.assemblyPhase === 'worker_bot_frontier' && frontierModules.includes('robot_bay') && frontierModules.includes('assembly_arm') && seededLaunch.synced.bayLit === false,
            'RUNTIME_ERROR', { present: false, assemblyPhase: 'worker_bot_frontier', modules: ['robot_bay', 'assembly_arm'], bayLit: false }, seededLaunch.synced, asLine(seededLaunch.synced));
        const seededActions = parseHudActions(seededLaunch.layoutEvent);
        check('next_goal_action_enabled', 'seeded_launch', seededActions.states.NextGoalAction?.visible === true && seededActions.states.NextGoalAction.enabled === true && seededActions.rects.NextGoalAction !== null,
            'RUNTIME_ERROR', { visible: true, enabled: true }, seededActions.states, asLine(seededLaunch.layoutEvent));
        steps.push({ id: 'seeded_launch', session: seededLaunch.session, synced: seededLaunch.synced, workerBotCost: workerBotCost(), screenshot: await capture('worker_bot_frontier') });
        checkNoErrors('seeded_launch');

        // ---- 3. Next Goal → Worker Bot → reveal → work loop ------------------------------------------
        let loopStartedIndex: number;
        {
            const nextGoalTap = toAdb(seededLaunch.layout, rectCentre(seededActions.rects.NextGoalAction!));
            const cursor = stream.cursor;
            await driver.tap(nextGoalTap.x, nextGoalTap.y);
            const purchased = await stream.waitFor(isCommandResult('purchaseBreakthrough'), cursor, options.timeouts.commandMs);
            check('purchase_command_result', 'worker_bot_purchase', purchased !== null, 'INPUT_NOT_RECEIVED', { evt: 'command_result', command: { type: 'purchaseBreakthrough', breakthroughId: AUT039_BREAKTHROUGH_ID } }, { events: stream.eventsSince(cursor).map((e) => e.evt) });
            const command = purchased!.event.command as { breakthroughId?: unknown };
            const eventTypes = Array.isArray(purchased!.event.eventTypes) ? purchased!.event.eventTypes as string[] : [];
            check('purchase_ok', 'worker_bot_purchase', purchased!.event.ok === true && command.breakthroughId === AUT039_BREAKTHROUGH_ID && eventTypes.includes('firstRobotProduced'),
                'RUNTIME_ERROR', { ok: true, breakthroughId: AUT039_BREAKTHROUGH_ID, eventTypes: ['firstRobotProduced'] }, purchased!.event, asLine(purchased!.event));
            const started = await stream.waitFor(isRobot('reveal_started'), cursor, options.timeouts.chainMs);
            check('robot_reveal_started', 'worker_bot_purchase', started !== null && started.event.focusRequested === true && started.event.civilization === 1 && started.event.present === true && started.event.bayLit === true && started.event.robotNode === true,
                'CAMERA_FOCUS', { phase: 'reveal_started', focusRequested: true, civilization: 1, present: true, bayLit: true, robotNode: true }, started?.event ?? stream.eventsSince(cursor).filter((e) => e.evt === 'robot_state'), asLine(started?.event));
            check('robot_has_animation', 'worker_bot_purchase', typeof started!.event.clips === 'number' && started!.event.clips > 0, 'MARKER_PRESENTATION', { clips: '> 0 Animation components' }, started!.event, asLine(started!.event));
            const focus = stream.eventsSince(cursor).find((e) => e.evt === 'camera_focus' && e.phase === 'started' && e.kind === 'reveal') ?? null;
            check('reveal_focus_on_target', 'worker_bot_purchase', isRevealFocusOnTarget(focus), 'CAMERA_FOCUS', { camera_focus: 'started', kind: 'reveal', target: FIRST_ROBOT_REVEAL_TARGET }, focus, asLine(focus));
            await sleep(options.timeouts.activationShotMs);
            const activationShot = await capture('reveal_activation');
            const complete = await stream.waitFor(isRobot('reveal_complete'), started!.record.index, options.timeouts.revealMs);
            check('robot_reveal_complete', 'worker_bot_purchase', complete !== null, 'CAMERA_FOCUS', { phase: 'reveal_complete' }, stream.eventsSince(started!.record.index).filter((e) => e.evt === 'robot_state'));
            const revealShot = await capture('reveal_complete');
            const loopStarted = await stream.waitFor(isRobot('loop_started'), started!.record.index, options.timeouts.revealMs);
            check('robot_loop_started', 'worker_bot_purchase', loopStarted !== null && loopStarted.event.reason === 'reveal_finished', 'RUNTIME_ERROR', { phase: 'loop_started', reason: 'reveal_finished' }, loopStarted?.event ?? null, asLine(loopStarted?.event));
            loopStartedIndex = loopStarted!.record.index;
            const entry = stream.eventsSince(started!.record.index).filter(isRobot('waypoint')).filter((e) => e.mode !== 'loop' || e.stopId === 'station').map((e) => e.stopId);
            check('robot_entry_path', 'worker_bot_purchase', entry[0] === 'bay_exit' && entry.includes('station'), 'RUNTIME_ERROR', { entry: ['bay_exit', 'station'] }, { entry });
            const autoFeederReplay = stream.eventsSince(cursor).filter((e) => e.evt === 'reveal_state' && e.phase === 'started');
            check('no_auto_feeder_reveal', 'worker_bot_purchase', autoFeederReplay.length === 0, 'CAMERA_FOCUS', { reveal_state_started: 0 }, { reveal_state_started: autoFeederReplay.length }, autoFeederReplay.flatMap(asLine));
            steps.push({ id: 'worker_bot_purchase', kind: 'tap', adb: nextGoalTap, result: purchased!.event, reveal: [started!.event, complete!.event, loopStarted!.event], focus, screenshots: [activationShot, revealShot] });
        }
        checkNoErrors('worker_bot_purchase');

        // ---- 4. Robot on route ------------------------------------------------------------------------
        {
            await waitForWaypoints(loopStartedIndex, options.minLoopWaypoints);
            const loopShot1 = await capture('robot_loop_1');
            record(evaluateRobotLoop('robot_loop', stream.eventsSince(loopStartedIndex), options.minLoopWaypoints));
            await sleep(1_500);
            const loopShot2 = await capture('robot_loop_2');
            const purchases = stream.eventsSince(seededLaunch.cursor).filter(isCommandResult('purchaseBreakthrough'));
            check('exactly_one_purchase', 'robot_loop', purchases.length === 1, 'RUNTIME_ERROR', { purchaseBreakthrough: 1 }, { purchaseBreakthrough: purchases.length });
            const reveals = stream.eventsSince(seededLaunch.cursor).filter(isRobot('reveal_started'));
            check('exactly_one_reveal', 'robot_loop', reveals.length === 1, 'CAMERA_FOCUS', { reveal_started: 1 }, { reveal_started: reveals.length });
            steps.push({ id: 'robot_loop', waypoints: stream.eventsSince(loopStartedIndex).filter(isRobot('waypoint')).map((e) => e.stopId), screenshots: [loopShot1, loopShot2] });
        }
        checkNoErrors('robot_loop');

        // ---- 5. Suspend → kill → relaunch: robot rebuilt in its loop, no reveal replay -----------------
        {
            const cursor = stream.cursor;
            await driver.pressHome();
            const suspended = await stream.waitFor((e) => e.evt === 'session_state' && e.phase === 'suspended', cursor, options.timeouts.suspendMs);
            check('suspend_save_ok', 'relaunch', suspended !== null && suspended.event.saveOk === true, 'RUNTIME_ERROR', { phase: 'suspended', saveOk: true }, suspended?.event ?? null, asLine(suspended?.event));
            await driver.forceStop(options.packageName);
            const relaunch = await launchUntilLayout('relaunch');
            check('relaunch_loaded_main', 'relaunch', relaunch.session.status === 'loaded_main', 'RUNTIME_ERROR', { status: 'loaded_main' }, relaunch.session, asLine(relaunch.session));
            check('relaunch_robot_in_loop', 'relaunch', relaunch.synced.present === true && relaunch.synced.mode === 'loop' && relaunch.synced.assemblyPhase === 'automated' && relaunch.synced.bayLit === true,
                'RUNTIME_ERROR', { present: true, mode: 'loop', assemblyPhase: 'automated', bayLit: true }, relaunch.synced, asLine(relaunch.synced));
            await sleep(options.timeouts.noRevealWindowMs);
            await waitForWaypoints(relaunch.cursor, options.minRelaunchWaypoints);
            const replayed = stream.eventsSince(relaunch.cursor).filter((e) => (e.evt === 'robot_state' && e.phase === 'reveal_started') || (e.evt === 'reveal_state' && e.phase === 'started') || (e.evt === 'camera_focus' && e.kind === 'reveal'));
            check('relaunch_no_reveal_replay', 'relaunch', replayed.length === 0, 'CAMERA_FOCUS', { reveal_started: 0 }, { replayed: replayed.length }, replayed.flatMap(asLine));
            record(evaluateRobotLoop('relaunch', stream.eventsSince(relaunch.cursor), options.minRelaunchWaypoints));
            const relaunchActions = parseHudActions(relaunch.layoutEvent).states.NextGoalAction;
            check('relaunch_worker_bot_not_offered', 'relaunch', relaunchActions === null || !(relaunchActions.visible && relaunchActions.enabled), 'RUNTIME_ERROR', { NextGoalAction: { enabled: false } }, relaunchActions, asLine(relaunch.layoutEvent));
            steps.push({ id: 'relaunch', session: relaunch.session, synced: relaunch.synced, suspended: suspended!.event, screenshot: await capture('relaunch_loop') });
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
        scenarioId: AUT039_SCENARIO_ID,
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
