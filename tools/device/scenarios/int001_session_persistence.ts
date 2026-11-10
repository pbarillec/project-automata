/**
 * AUT-INT-001 scenario — the FactoryWorld persistent session survives suspend, kill and relaunch.
 *
 *   clear app data → launch → session_state ready/fresh_game
 *   HOME → session_state suspended saveOk=true (save_main.json on disk)
 *   force-stop → relaunch → session_state ready/loaded_main
 *   force-stop → push a seeded valid envelope that owns Auto Feeder to the reported writablePath
 *   relaunch → ready/loaded_main, autoFeederOwned=true, reveal_state automated:true, and NO
 *   reveal_state started (the first-automation focus beat is not replayed)
 *   zero runtime/`error` events after scene_ready throughout.
 *
 * Requires the FactoryWorld DEBUG APK (run-as needs a debuggable build).
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
import { purchaseBreakthrough } from '../../../assets/scripts/progression/index.ts';
import { createFreshGameState } from '../../../assets/scripts/state/index.ts';
import { AdbError, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import type { AssertionFailure, AssertionRecord, FailureClass } from '../classification.ts';
import type { SessionDeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';
import { renderSummary, summarizeErrors } from './c3_producer_selection.ts';

export const INT001_SCENARIO_ID = 'INT001-session-persistence';
export const SAVE_FILE_NAMES = ['save_main.json', 'save_backup.json', 'save_temp.json'] as const;

export interface Int001Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    timeouts: { sceneReadyMs: number; sessionMs: number; suspendMs: number; noRevealWindowMs: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_INT001_OPTIONS: Omit<Int001Options, 'apkPath'> = {
    taskId: 'AUT-INT-001',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    timeouts: { sceneReadyMs: 60_000, sessionMs: 20_000, suspendMs: 10_000, noRevealWindowMs: 3_000 },
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A valid current-version save envelope whose state owns Auto Feeder, built only with runtime-side helpers. */
export function buildSeededAutoFeederSave(nowMs: number): string {
    const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = 1500;
    const purchase = purchaseBreakthrough(repository, state, 'auto_feeder');
    if (purchase.status !== 'success') throw new Error(`seed: auto_feeder purchase failed (${purchase.status})`);
    return serializeGameStateToSaveJson(purchase.state, {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: repository.contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 60_000),
    });
}

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

const asLine = (event: ParsedDeviceEvent | null | undefined) => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);

export interface Int001RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runInt001Scenario(driver: SessionDeviceDriver, partial: Partial<Int001Options> & { apkPath: string | null }): Promise<Int001RunOutput> {
    const options: Int001Options = { ...DEFAULT_INT001_OPTIONS, ...partial, timeouts: { ...DEFAULT_INT001_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(INT001_SCENARIO_ID, startedAt, apkSha);
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
    let firstSceneReadyIndex: number | null = null;

    const capture = async (label: string) => {
        try {
            const png = await driver.screencap();
            const file = paths.screenshot(++screenshotIndex, label);
            writeFileSync(file, png);
            screenshots.push(relativeEvidence(file));
        } catch (error) {
            warnings.push(`screenshot ${label} failed: ${(error as Error).message}`);
        }
    };
    /** Records an assertion; the first failure stops the run. Runtime errors since scene_ready take precedence. */
    const check = (id: string, step: string, ok: boolean, failureClass: FailureClass, expected: unknown, actual: unknown, evidence: string[] = []) => {
        assertions.push({ id, step, ok });
        if (ok) return;
        failure ??= { failureClass, assertion: id, step, expected, actual, evidenceLines: evidence };
        throw new Stop(id);
    };
    const checkNoErrors = (step: string) => {
        if (firstSceneReadyIndex === null) return;
        const errors = stream!.recordsSince(firstSceneReadyIndex).filter((r) => r.runtimeError).map((r) => r.line);
        check(`no_errors_after_scene_ready_${step}`, step, errors.length === 0, 'RUNTIME_ERROR', { runtimeErrors: 0 }, { runtimeErrors: errors.length, errorMessages: summarizeErrors(errors) }, errors.slice(0, 20));
    };
    /** Launches the app and returns the first `session_state` ready/load_failed event of this launch. */
    const launchUntilSession = async (step: string) => {
        const cursor = stream!.cursor;
        try { await driver.launch(options.packageName, options.activity); } catch (error) {
            throw new EnvironmentStop(envFailure('app_launched', step, `${options.packageName}/${options.activity}`, (error as Error).message), null);
        }
        const ready = await stream!.waitFor((e) => e.evt === 'scene_ready', cursor, options.timeouts.sceneReadyMs);
        if (!ready) {
            const anyDiagnostics = stream!.eventsSince(cursor).length > 0;
            const errors = stream!.recordsSince(cursor).filter((r) => r.runtimeError).map((r) => r.line);
            if (errors.length > 0) check('scene_ready', step, false, 'RUNTIME_ERROR', { evt: 'scene_ready' }, { errorMessages: summarizeErrors(errors) }, errors.slice(0, 20));
            throw new EnvironmentStop(envFailure('scene_ready', step, { evt: 'scene_ready' }, { diagnosticsSeen: anyDiagnostics, hint: anyDiagnostics ? 'scene never became ready' : 'APK has no [AUT-DEVICE] diagnostics (non-DEBUG build or wrong start scene)' }), null);
        }
        assertions.push({ id: 'scene_ready', step, ok: true });
        firstSceneReadyIndex ??= ready.record.index;
        const session = await stream!.waitFor((e) => e.evt === 'session_state' && (e.phase === 'ready' || e.phase === 'load_failed'), cursor, options.timeouts.sessionMs);
        check('session_state_reported', step, session !== null, 'RUNTIME_ERROR', { evt: 'session_state', phase: 'ready' }, { sessionEvents: stream!.eventsSince(cursor).filter((e) => e.evt === 'session_state') });
        return { cursor, session: session!.event, sessionIndex: session!.record.index };
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
        } catch (clearError) {
            // Some OEM builds refuse `pm clear` from the shell; delete only the save files instead.
            // Cocos' Android writable path is the app's `files/` directory.
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
        const fresh = await launchUntilSession('fresh_launch');
        steps.push({ id: 'fresh_launch', session: fresh.session });
        check('fresh_session_ready', 'fresh_launch', fresh.session.phase === 'ready' && fresh.session.status === 'fresh_game', 'RUNTIME_ERROR', { phase: 'ready', status: 'fresh_game' }, fresh.session, asLine(fresh.session));
        const writablePath = typeof fresh.session.writablePath === 'string' ? fresh.session.writablePath : '';
        check('writable_path_reported', 'fresh_launch', /^\/[A-Za-z0-9._/-]+\/$/.test(writablePath), 'RUNTIME_ERROR', 'absolute app-private directory', writablePath, asLine(fresh.session));
        await capture('fresh_ready');
        checkNoErrors('fresh_launch');

        // ---- 2. HOME → critical suspend save -------------------------------------------------------
        let cursor = stream.cursor;
        await driver.pressHome();
        const suspended = await stream.waitFor((e) => e.evt === 'session_state' && e.phase === 'suspended', cursor, options.timeouts.suspendMs);
        check('suspend_reported', 'suspend', suspended !== null, 'RUNTIME_ERROR', { evt: 'session_state', phase: 'suspended' }, null);
        steps.push({ id: 'suspend', session: suspended!.event });
        check('suspend_save_ok', 'suspend', suspended!.event.saveOk === true && suspended!.event.status === 'suspended_saved', 'RUNTIME_ERROR', { saveOk: true, status: 'suspended_saved' }, suspended!.event, asLine(suspended!.event));
        const filesAfterSuspend = await driver.listAppFiles(options.packageName, writablePath).catch((error: Error) => { warnings.push(`listAppFiles failed: ${error.message}`); return null; });
        if (filesAfterSuspend) check('save_main_on_disk', 'suspend', filesAfterSuspend.includes('save_main.json'), 'RUNTIME_ERROR', 'save_main.json', filesAfterSuspend);
        checkNoErrors('suspend');

        // ---- 3. Kill + relaunch → loaded_main ----------------------------------------------------------
        await driver.forceStop(options.packageName);
        const relaunch = await launchUntilSession('relaunch');
        steps.push({ id: 'relaunch', session: relaunch.session });
        check('relaunch_loaded_main', 'relaunch', relaunch.session.phase === 'ready' && relaunch.session.status === 'loaded_main', 'RUNTIME_ERROR', { phase: 'ready', status: 'loaded_main' }, relaunch.session, asLine(relaunch.session));
        await capture('relaunch_ready');
        checkNoErrors('relaunch');

        // ---- 4. Seeded Auto Feeder save → automated without a focus beat ----------------------------------
        await driver.forceStop(options.packageName);
        const seeded = buildSeededAutoFeederSave(now().getTime());
        writeFileSync(path.join(paths.runDir, 'seeded_save_main.json'), seeded);
        try {
            await driver.removeAppFiles(options.packageName, SAVE_FILE_NAMES.map((name) => `${writablePath}${name}`));
            await driver.writeAppFile(options.packageName, `${writablePath}save_main.json`, seeded);
        } catch (error) {
            throw new EnvironmentStop(envFailure('seeded_save_pushed', 'seeded_launch', 'run-as write into app storage (debuggable APK)', (error as Error).message), null);
        }
        assertions.push({ id: 'seeded_save_pushed', step: 'seeded_launch', ok: true });
        const seededLaunch = await launchUntilSession('seeded_launch');
        steps.push({ id: 'seeded_launch', session: seededLaunch.session });
        check('seeded_loaded_main', 'seeded_launch', seededLaunch.session.phase === 'ready' && seededLaunch.session.status === 'loaded_main', 'RUNTIME_ERROR', { phase: 'ready', status: 'loaded_main' }, seededLaunch.session, asLine(seededLaunch.session));
        check('seeded_auto_feeder_owned', 'seeded_launch', seededLaunch.session.autoFeederOwned === true, 'RUNTIME_ERROR', { autoFeederOwned: true }, seededLaunch.session, asLine(seededLaunch.session));
        const automated = await stream.waitFor((e) => e.evt === 'reveal_state' && e.automated === true, seededLaunch.cursor, options.timeouts.sessionMs);
        check('seeded_reveal_automated', 'seeded_launch', automated !== null, 'RUNTIME_ERROR', { evt: 'reveal_state', automated: true }, stream.eventsSince(seededLaunch.cursor).filter((e) => e.evt === 'reveal_state'));
        await sleep(options.timeouts.noRevealWindowMs);
        const replayed = stream.eventsSince(seededLaunch.cursor).filter((e) => e.evt === 'reveal_state' && e.phase === 'started');
        check('seeded_no_focus_replay', 'seeded_launch', replayed.length === 0, 'CAMERA_FOCUS', { reveal_state_started: 0 }, { reveal_state_started: replayed.length }, replayed.flatMap(asLine));
        await capture('seeded_ready');
        checkNoErrors('seeded_launch');
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
        scenarioId: INT001_SCENARIO_ID,
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
