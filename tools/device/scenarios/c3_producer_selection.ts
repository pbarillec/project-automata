/**
 * AUT-INFRA-001 scenario C3 — deterministic producer selection on a real device.
 *
 * Launch the FactoryWorld debug APK → wait scene_ready (+ reveal + focus settle) →
 * calibration self-check → tap projected zone centres (re-projected after each focus) and
 * assert touch_end → selection_raycast → selection_state → marker_state → camera_focus →
 * deliberate swipe (must be a drag, selection unchanged) → evidence → result.json.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { AdbError, pngSize, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import {
    adbToCocos, cocosToAdb, evaluateCalibration, evaluateSwipeStep, evaluateTapStep,
    type AssertionFailure, type AssertionRecord, type StepEvaluation,
} from '../classification.ts';
import type { DeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';

export const C3_SCENARIO_ID = 'C3-producer-selection';
export const PRODUCER_ZONE_ORDER = ['Fabricator', 'AssemblyStation', 'RobotLine', 'AutomatedCell', 'AdvancedRoboticsComplex'] as const;

export interface C3Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    /** Fraction of the display kept clear of taps on every side (system overlays, bubbles). */
    edgeMargin: number;
    maxZoneTaps: number;
    timeouts: { sceneReadyMs: number; revealMs: number; settleMs: number; chainMs: number; projectionMs: number; swipeMs: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_C3_OPTIONS: Omit<C3Options, 'apkPath'> = {
    taskId: 'AUT-INFRA-001',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    edgeMargin: 0.1,
    maxZoneTaps: 5,
    timeouts: { sceneReadyMs: 60_000, revealMs: 20_000, settleMs: 6_000, chainMs: 4_000, projectionMs: 2_000, swipeMs: 1_500 },
};

interface Projection { w: number; h: number; zones: Array<{ id: string; sx: number | null; sy: number | null; onScreen: boolean }> }

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function projectionOf(event: ParsedDeviceEvent): Projection | null {
    const screen = event.screen as { w?: number; h?: number } | undefined;
    if (!screen || typeof screen.w !== 'number' || typeof screen.h !== 'number' || !Array.isArray(event.zones)) return null;
    return { w: screen.w, h: screen.h, zones: event.zones as Projection['zones'] };
}

/** Distinct JS error messages (one per exception, not per stack line). */
export function summarizeErrors(lines: string[]): string[] {
    const messages = new Set<string>();
    for (const line of lines) {
        const match = /\b((?:Type|Reference|Range|Syntax|Eval|URI)?Error: [^"\\]+)/.exec(line);
        if (match) messages.add(match[1].trim());
    }
    return [...messages].slice(0, 10);
}

/** Puts message lines first so the head of the evidence names the exception, then the rest in order. */
export function prioritizeErrorLines(lines: string[]): string[] {
    const head = lines.filter((l) => /JS: .*Error:|Uncaught Exception|"evt":"error"/.test(l));
    return [...head, ...lines.filter((l) => !head.includes(l))];
}

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

export interface C3RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runC3Scenario(driver: DeviceDriver, partial: Partial<C3Options> & { apkPath: string | null }): Promise<C3RunOutput> {
    const options: C3Options = { ...DEFAULT_C3_OPTIONS, ...partial, timeouts: { ...DEFAULT_C3_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(C3_SCENARIO_ID, startedAt, apkSha);
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
    let meminfoPath: string | null = null;
    let gfxinfoPath: string | null = null;
    let screenshotIndex = 0;
    let displaySize: { width: number; height: number } | null = null;

    const pass = (id: string, step: string) => assertions.push({ id, step, ok: true });
    const record = (evaluation: StepEvaluation) => {
        assertions.push(...evaluation.assertions);
        if (!evaluation.ok && !failure) failure = evaluation.failure;
        return evaluation.ok;
    };
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
    const errorLinesSince = (cursor: number) => stream!.recordsSince(cursor).filter((r) => r.runtimeError).map((r) => r.line);
    /** Runtime-error lines plus the stack frames that follow them (evidence only). */
    const errorEvidenceSince = (cursor: number) => {
        const out: string[] = [];
        const records = stream!.recordsSince(cursor);
        records.forEach((r, i) => {
            if (!r.runtimeError) return;
            out.push(r.line);
            // Continuation lines of the same exception: same logcat timestamp, error level.
            const stamp = r.line.slice(0, 18);
            for (let j = i + 1; j < records.length && records[j].line.startsWith(stamp) && / E Cocos /.test(records[j].line) && !records[j].runtimeError && out.length < 60; j += 1) out.push(records[j].line);
        });
        return out;
    };
    const appAlive = async () => (await driver.pidOf(options.packageName).catch(() => null)) !== null;

    /**
     * Evidence-only probe after a launch failure: the calibration self-check plus one centre tap
     * (the AUT-038 reveal leaves the camera focused on the Fabricator). Results go to `steps`
     * marked secondary; they never change the primary (first) failure.
     */
    const postFailureProbe = async (projection: Projection) => {
        await sleep(500);
        await capture('post_failure_ready');
        if (!displaySize) return;
        const display = displaySize as { width: number; height: number };
        const win = { w: projection.w, h: projection.h };
        const calAdb = { x: Math.round(display.width * 0.04), y: Math.round(display.height * 0.08) };
        const calExpected = adbToCocos(calAdb, win, display);
        let cursor = stream!.cursor;
        await driver.tap(calAdb.x, calAdb.y);
        await stream!.waitFor((e) => e.evt === 'touch_end', cursor, options.timeouts.chainMs);
        await sleep(400);
        const calibration = evaluateCalibration({ step: 'post_failure_calibration', expectedTouch: calExpected, tolerancePx: 3, events: stream!.eventsSince(cursor), windowSize: win, displaySize: display });
        steps.push({ id: 'post_failure_calibration', secondary: true, kind: 'tap', adb: calAdb, expectedCocos: calExpected, ok: calibration.ok, assertions: calibration.assertions, failure: calibration.failure });
        const centre = { x: Math.round(display.width / 2), y: Math.round(display.height / 2) };
        cursor = stream!.cursor;
        await driver.tap(centre.x, centre.y);
        await stream!.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
        await sleep(250);
        const probe = evaluateTapStep({ step: 'post_failure_centre_tap', zoneId: 'Fabricator', previousSelection: null, expectedTouch: adbToCocos(centre, win, display), touchTolerancePx: 3, events: stream!.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() });
        const shot = await capture('post_failure_centre_tap');
        steps.push({ id: 'post_failure_centre_tap', secondary: true, kind: 'tap', zone: 'Fabricator', adb: centre, ok: probe.ok, assertions: probe.assertions, failure: probe.failure, events: stream!.eventsSince(cursor), screenshot: shot });
    };

    try {
        // ---- Environment ------------------------------------------------------------
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
        pass('device_ready', 'environment');
        driver.useSerial(selection.device.serial);
        device = {
            serial: selection.device.serial,
            model: selection.device.model ?? (await driver.getProp('ro.product.model').catch(() => null)),
            android_release: await driver.getProp('ro.build.version.release').catch(() => null),
            sdk: await driver.getProp('ro.build.version.sdk').catch(() => null),
        };
        writeFileSync(paths.device, `${JSON.stringify({ ...device, state: selection.device.state, product: selection.device.product ?? null }, null, 2)}\n`);

        if (!options.skipInstall) {
            try { await driver.install(apkPath!); } catch (error) {
                throw new EnvironmentStop(envFailure('apk_installed', 'install', 'adb install -r Success', (error as Error).message), null);
            }
            pass('apk_installed', 'install');
        }

        // ---- Launch -----------------------------------------------------------------
        await driver.forceStop(options.packageName);
        await driver.logcatClear();
        stream = driver.startLogcat(paths.logcat);
        logcatStarted = true;
        try { await driver.launch(options.packageName, options.activity); } catch (error) {
            throw new EnvironmentStop(envFailure('app_launched', 'launch', `${options.packageName}/${options.activity}`, (error as Error).message), null);
        }
        pass('app_launched', 'launch');

        // The selection controller reports scene_ready two frames after its start(); a later
        // zones_projected without it means start() never completed, so fail fast.
        const readyOrLater = await stream.waitFor((e) => (e.evt === 'scene_ready' && e.reason === 'scene_ready') || e.evt === 'zones_projected', 0, options.timeouts.sceneReadyMs);
        const ready = readyOrLater && readyOrLater.event.evt === 'scene_ready' ? readyOrLater : null;
        if (!ready) {
            const errors = errorLinesSince(0);
            const anyDiagnostics = stream.allEvents().length > 0;
            const alive = await appAlive();
            const late = readyOrLater ? projectionOf(readyOrLater.event) : null;
            const lateTargets = readyOrLater?.event.targets ?? null;
            if (errors.length > 0 || !alive) {
                failure = {
                    failureClass: 'RUNTIME_ERROR', assertion: 'scene_ready', step: 'launch',
                    expected: { evt: 'scene_ready', from: 'ProducerSelectionController.start()' },
                    actual: { appAlive: alive, runtimeErrors: errors.length, errorMessages: summarizeErrors(errors), laterProjection: readyOrLater ? { targets: lateTargets, zones: late?.zones.length ?? 0 } : null },
                    evidenceLines: errorEvidenceSince(0).slice(0, 60).concat(readyOrLater ? [readyOrLater.record.line] : []),
                };
            } else {
                failure = envFailure('scene_ready', 'launch', { evt: 'scene_ready' }, { diagnosticsSeen: anyDiagnostics, laterProjection: readyOrLater ? { targets: lateTargets } : null, hint: anyDiagnostics ? 'scene never became ready' : 'APK has no [AUT-DEVICE] diagnostics (non-DEBUG build or wrong start scene)' });
            }
            assertions.push({ id: 'scene_ready', step: 'launch', ok: false });
            if (late && alive) await postFailureProbe(late);
            throw new Error('stop');
        }
        pass('scene_ready', 'launch');
        const readyTargets = typeof ready.event.targets === 'number' ? ready.event.targets : 0;
        assertions.push({ id: 'selection_targets_indexed', step: 'launch', ok: readyTargets === PRODUCER_ZONE_ORDER.length });
        if (readyTargets !== PRODUCER_ZONE_ORDER.length) {
            const errors = errorLinesSince(0);
            failure = { failureClass: errors.length > 0 ? 'RUNTIME_ERROR' : 'RAYCAST_MISS', assertion: 'selection_targets_indexed', step: 'launch', expected: { targets: PRODUCER_ZONE_ORDER.length }, actual: { targets: readyTargets, errorMessages: summarizeErrors(errors) }, evidenceLines: [ready.record.line, ...prioritizeErrorLines(errors).slice(0, 10)] };
            throw new Error('stop');
        }
        for (const line of errorLinesSince(0).slice(0, 20)) warnings.push(`pre-ready runtime error (not counted): ${line.slice(0, 300)}`);
        const readyCursor = ready.record.index + 1;
        let projection = projectionOf(ready.event);
        let selectedNow = (ready.event.selected as string | null | undefined) ?? null;

        // AUT-INFRA-001a deterministic reveal gate. The reveal controller announces at start()
        // whether a reveal is scheduled (pending) or the presentation is at rest (idle); a reveal
        // reports started → complete once its camera focus has finished. Never wait on a timer.
        const firstReveal = await stream.waitFor((e) => e.evt === 'reveal_state', 0, 2_000);
        const revealPhase = firstReveal ? stream.allEvents().filter((e) => e.evt === 'reveal_state').pop()?.phase : undefined;
        if (!firstReveal || typeof revealPhase !== 'string') {
            warnings.push('APK emits no phased reveal_state (pre-AUT-INFRA-001a build); proceeding without a reveal gate');
        } else if (revealPhase === 'pending' || revealPhase === 'started' || revealPhase === 'complete') {
            // A reveal was scheduled; it may already have completed by the time we look.
            const done = await stream.waitFor((e) => e.evt === 'reveal_state' && e.phase === 'complete', firstReveal.record.index, options.timeouts.revealMs);
            if (!done) {
                const errors = errorLinesSince(readyCursor);
                assertions.push({ id: 'reveal_complete', step: 'launch', ok: false });
                failure = {
                    failureClass: errors.length > 0 ? 'RUNTIME_ERROR' : 'CAMERA_FOCUS', assertion: 'reveal_complete', step: 'launch',
                    expected: { evt: 'reveal_state', phase: 'complete' },
                    actual: { lastPhase: stream.allEvents().filter((e) => e.evt === 'reveal_state').pop()?.phase ?? null, runtimeErrors: errors.length },
                    evidenceLines: [...stream.recordsSince(firstReveal.record.index).filter((r) => r.event?.evt === 'reveal_state' || r.event?.evt === 'camera_focus').map((r) => r.line).slice(0, 10), ...errors.slice(0, 10)],
                };
                throw new Error('stop');
            }
            pass('reveal_complete', 'launch');
            if (done.event.focusRequested === true) {
                const started = stream.allEvents().filter((e) => e.evt === 'reveal_state' && e.phase === 'started').pop();
                const startedRecord = stream.records.find((r) => r.event === started);
                const projected = await stream.waitFor((e) => e.evt === 'zones_projected', startedRecord?.index ?? done.record.index, options.timeouts.projectionMs);
                if (projected) projection = projectionOf(projected.event) ?? projection;
                else warnings.push('no zones_projected after the reveal focus; using the last projection');
            }
        } else {
            pass('reveal_at_rest', 'launch');
        }
        await sleep(300);
        if (!projection) {
            failure = { failureClass: 'RUNTIME_ERROR', assertion: 'zone_projection_present', step: 'launch', expected: 'scene_ready carries screen + zones', actual: ready.event, evidenceLines: [] };
            throw new Error('stop');
        }
        await capture('ready');
        if (!displaySize) throw new EnvironmentStop(envFailure('display_size', 'calibration', 'screencap PNG', null), null);
        const display = displaySize as { width: number; height: number };
        const win = { w: projection.w, h: projection.h };

        // ---- Calibration self-check (harness coordinate conversion) --------------------
        const calAdb = { x: Math.round(display.width * 0.04), y: Math.round(display.height * 0.08) };
        const calExpected = adbToCocos(calAdb, win, display);
        let cursor = stream.cursor;
        await driver.tap(calAdb.x, calAdb.y);
        await stream.waitFor((e) => e.evt === 'touch_end', cursor, options.timeouts.chainMs);
        await sleep(400);
        const calEvents = stream.eventsSince(cursor);
        const calibrationOk = record(evaluateCalibration({ step: 'calibration', expectedTouch: calExpected, tolerancePx: 3, events: calEvents, windowSize: win, displaySize: display }));
        steps.push({ id: 'calibration', kind: 'tap', adb: calAdb, expectedCocos: calExpected, ok: calibrationOk });
        if (!calibrationOk) throw new Error('stop');
        const calSelection = calEvents.filter((e) => e.evt === 'selection_state').pop();
        if (calSelection) { selectedNow = (calSelection.next as string | null) ?? selectedNow; warnings.push(`calibration tap selected ${String(calSelection.next)}`); }
        const calSettle = calEvents.find((e) => e.evt === 'camera_focus' && e.phase === 'started');
        if (calSettle) {
            const p = await stream.waitFor((e) => e.evt === 'zones_projected', cursor, options.timeouts.settleMs);
            if (p) projection = projectionOf(p.event) ?? projection;
        }

        // ---- Producer taps ------------------------------------------------------------
        const tapped: string[] = [];
        const margin = options.edgeMargin;
        const inSafeArea = (p: { x: number; y: number }) => p.x >= display.width * margin && p.x <= display.width * (1 - margin) && p.y >= display.height * margin && p.y <= display.height * (1 - margin);
        for (let n = 0; n < options.maxZoneTaps; n += 1) {
            const candidates = PRODUCER_ZONE_ORDER
                .filter((id) => !tapped.includes(id))
                .map((id) => projection!.zones.find((z) => z.id === id))
                .filter((z): z is Projection['zones'][number] => !!z && z.onScreen && typeof z.sx === 'number' && typeof z.sy === 'number')
                .map((z) => ({ zone: z, adb: cocosToAdb({ x: z.sx!, y: z.sy! }, win, display) }))
                .filter((c) => inSafeArea(c.adb));
            const next = candidates[0];
            if (!next) break;
            const stepId = `tap_${n + 1}_${next.zone.id}`;
            const expectedCocos = adbToCocos({ x: Math.round(next.adb.x), y: Math.round(next.adb.y) }, win, display);
            cursor = stream.cursor;
            await driver.tap(next.adb.x, next.adb.y);
            const settled = await stream.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
            if (settled) {
                const p = await stream.waitFor((e) => e.evt === 'zones_projected', settled.record.index, options.timeouts.projectionMs);
                if (p) projection = projectionOf(p.event) ?? projection;
            }
            await sleep(250);
            const evaluation = evaluateTapStep({
                step: stepId, zoneId: next.zone.id, previousSelection: selectedNow, expectedTouch: expectedCocos, touchTolerancePx: 3,
                events: stream.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive(),
            });
            const shot = await capture(stepId);
            steps.push({ id: stepId, kind: 'tap', zone: next.zone.id, adb: { x: Math.round(next.adb.x), y: Math.round(next.adb.y) }, expectedCocos, previousSelection: selectedNow, screenshot: shot, ok: evaluation.ok });
            tapped.push(next.zone.id);
            if (!record(evaluation)) throw new Error('stop');
            selectedNow = next.zone.id;
        }
        const enoughZones = tapped.length >= 2;
        assertions.push({ id: 'at_least_two_zones_tapped', step: 'taps', ok: enoughZones });
        if (!enoughZones) {
            failure = { failureClass: 'CAMERA_FOCUS', assertion: 'at_least_two_zones_tapped', step: 'taps', expected: '>= 2 zones projected inside the safe area', actual: { tapped, projection }, evidenceLines: [] };
            throw new Error('stop');
        }

        // ---- Deliberate swipe -----------------------------------------------------------
        const from = { x: display.width * 0.35, y: display.height * 0.6 };
        const to = { x: display.width * 0.6, y: display.height * 0.6 };
        cursor = stream.cursor;
        await driver.swipe(from.x, from.y, to.x, to.y, 400);
        await stream.waitFor((e) => e.evt === 'touch_end', cursor, options.timeouts.chainMs);
        await sleep(options.timeouts.swipeMs);
        const swipeOk = record(evaluateSwipeStep({ step: 'swipe', selectionBefore: selectedNow, events: stream.eventsSince(cursor), runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() }));
        const swipeShot = await capture('swipe');
        steps.push({ id: 'swipe', kind: 'swipe', from, to, durationMs: 400, selectionBefore: selectedNow, screenshot: swipeShot, ok: swipeOk });
        if (!swipeOk) throw new Error('stop');
    } catch (error) {
        if (error instanceof EnvironmentStop) {
            failure ??= error.failure;
            humanAction = error.humanAction;
            assertions.push({ id: error.failure.assertion, step: error.failure.step, ok: false });
        } else if ((error as Error).message !== 'stop') {
            failure ??= { failureClass: 'ENVIRONMENT', assertion: 'harness_execution', step: 'harness', expected: 'scenario completes', actual: (error as Error).stack ?? String(error), evidenceLines: [] };
            assertions.push({ id: 'harness_execution', step: 'harness', ok: false });
        }
    }

    // ---- Evidence (always) ----------------------------------------------------------------
    if (device && logcatStarted) {
        await capture('final');
        try { writeFileSync(paths.meminfo, await driver.meminfo(options.packageName)); meminfoPath = relativeEvidence(paths.meminfo); } catch (e) { warnings.push(`meminfo failed: ${(e as Error).message}`); }
        try { writeFileSync(paths.gfxinfo, await driver.gfxinfo(options.packageName)); gfxinfoPath = relativeEvidence(paths.gfxinfo); } catch (e) { warnings.push(`gfxinfo failed: ${(e as Error).message}`); }
    }
    if (logcatStarted) await driver.stopLogcat();
    const events = stream ? stream.allEvents() : [];
    if (stream) writeFileSync(paths.events, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    writeFileSync(paths.commands, `${JSON.stringify(driver.commandLog(), null, 2)}\n`);

    const result = buildResult({
        taskId: options.taskId,
        scenarioId: C3_SCENARIO_ID,
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
            meminfo: meminfoPath,
            gfxinfo: gfxinfoPath,
            summary: relativeEvidence(paths.summary),
        },
    });
    const schemaErrors = validateDeviceResult(result);
    writeFileSync(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(paths.summary, renderSummary(result, schemaErrors));
    return { result, paths, schemaErrors };
}

export function renderSummary(result: DeviceResult, schemaErrors: string[]): string {
    const lines = [
        `# ${result.scenario_id} — ${result.status}${result.failure_class ? ` (${result.failure_class})` : ''}`,
        '',
        `- Task: ${result.task_id}`,
        `- Run: ${result.run_id}`,
        `- Review decision: ${result.review_decision}`,
        `- Device: ${result.device ? `${result.device.model ?? '?'} (${result.device.serial}), Android ${result.device.android_release ?? '?'}` : 'none'}`,
        `- APK: ${result.apk.path ?? 'n/a'} sha256 ${result.apk.sha256 ?? 'n/a'}`,
        `- Next owner: ${result.next_owner ?? '-'}; retry without code change: ${result.retry_without_code_change}`,
    ];
    if (result.required_human_action) lines.push(`- Required human action: **${result.required_human_action}**`);
    if (result.first_failed_assertion) {
        lines.push('', '## First failed assertion', '', `\`${result.first_failed_assertion.id}\` at step \`${result.first_failed_assertion.step}\``, '', '```json', JSON.stringify({ expected: result.expected, actual: result.actual }, null, 2), '```');
        if (result.first_failed_assertion.evidence_lines.length) lines.push('', '```', ...result.first_failed_assertion.evidence_lines, '```');
    }
    lines.push('', '## Assertions', '', ...result.assertions.map((a) => `- [${a.ok ? 'x' : ' '}] ${a.step} / ${a.id}`));
    if (result.warnings.length) lines.push('', '## Warnings', '', ...result.warnings.map((w) => `- ${w}`));
    lines.push('', `Schema validation: ${schemaErrors.length === 0 ? 'OK' : schemaErrors.join('; ')}`, '');
    return lines.join('\n');
}
