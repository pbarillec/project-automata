/**
 * AUT-R-031-02 scenario — FactoryWorld camera input is tap-first: one-finger drag pans inside the
 * unlocked-zone bounds, never rotates or zooms, and a tap still selects at the default distance.
 *
 *   clear saves → launch → scene_ready + session_state ready + ui_layout (baseline camera from scene_ready)
 *   one-finger swipe outside the UI rects → camera_state: yaw/pitch/distance unchanged, focus moved and
 *             inside the reported bounds; the swipe is a drag (no selection_raycast / selection_state)
 *   long swipes left/right/up/down → camera_state focus clamped on the bounds edge (±0.01), pose unchanged
 *   tap the Fabricator (projected from the latest camera_state) → C3 chain + camera_focus started with
 *             kind=selection and distance = defaultDistance
 *   zero runtime/`error` events after scene_ready.
 *
 * Multi-touch (pinch / two-finger pan) cannot be driven through adb; it is covered by unit tests
 * and by the AUT-R-036-02 human gate. Requires the FactoryWorld DEBUG APK (diagnostics and run-as).
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { AdbError, pngSize, selectDevice } from '../adb.ts';
import { ensureRunDirs, makeRunId, relativeEvidence, runPaths, sha256File, DEVICE_TEMP_ROOT, type RunPaths } from '../artifacts.ts';
import {
    adbToCocos, cocosToAdb, evaluateSwipeStep, evaluateTapStep,
    type AssertionFailure, type AssertionRecord, type FailureClass, type ScreenPoint, type StepEvaluation,
} from '../classification.ts';
import type { SessionDeviceDriver } from '../driver.ts';
import type { EventStream } from '../events.ts';
import { buildResult, validateDeviceResult, type DeviceInfo, type DeviceResult } from '../result.ts';
import { renderSummary, summarizeErrors } from './c3_producer_selection.ts';
import { SAVE_FILE_NAMES } from './int001_session_persistence.ts';
import { parseUiLayout, uiRectsAt, type ProjectedZone, type UiLayoutSnapshot } from '../ui_geometry.ts';

export const R031_SCENARIO_ID = 'R031-tap-first-camera';
/** World-unit tolerance for "inside the bounds" / "on the bounds edge". */
export const R031_BOUNDS_TOLERANCE = 0.01;
/** Pose tolerance (degrees / world units) for "yaw, pitch and distance unchanged". */
export const R031_POSE_TOLERANCE = 1e-3;
export const R031_LONG_SWIPE_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type R031SwipeDirection = typeof R031_LONG_SWIPE_DIRECTIONS[number];

export interface R031Options {
    taskId: string;
    apkPath: string | null;
    serial?: string;
    runId?: string;
    skipInstall?: boolean;
    packageName: string;
    activity: string;
    artifactRoot?: string;
    /** Short swipe length as a fraction of the display width; long swipes as a fraction of each axis. */
    shortSwipeFraction: number;
    longSwipeFraction: number;
    swipeDurationMs: number;
    timeouts: { sceneReadyMs: number; sessionMs: number; uiLayoutMs: number; revealMs: number; cameraStateMs: number; chainMs: number; swipeSettleMs: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_R031_OPTIONS: Omit<R031Options, 'apkPath'> = {
    taskId: 'AUT-R-031-02',
    packageName: 'com.projectautomata.androidbaseline',
    activity: 'com.cocos.game.AppActivity',
    shortSwipeFraction: 0.08,
    longSwipeFraction: 0.6,
    swipeDurationMs: 400,
    timeouts: { sceneReadyMs: 60_000, sessionMs: 20_000, uiLayoutMs: 5_000, revealMs: 20_000, cameraStateMs: 3_000, chainMs: 4_000, swipeSettleMs: 600 },
};

export interface CameraBoundsSnapshot { minX: number; maxX: number; minZ: number; maxZ: number }
export interface CameraPose { yaw: number; pitch: number; distance: number; focus: { x: number; z: number } }
export interface CameraStateSnapshot extends CameraPose {
    bounds: CameraBoundsSnapshot;
    zones: ProjectedZone[];
    screen: { w: number; h: number } | null;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Parses a DEBUG `camera_state` event (FactoryWorldBootstrap.emitCameraState). */
export function parseCameraState(event: ParsedDeviceEvent | null | undefined): CameraStateSnapshot | null {
    if (!event || event.evt !== 'camera_state') return null;
    const focus = event.focus as { x?: unknown; z?: unknown } | undefined;
    const bounds = event.bounds as Record<string, unknown> | undefined;
    if (!isNumber(event.yaw) || !isNumber(event.pitch) || !isNumber(event.distance)) return null;
    if (!focus || !isNumber(focus.x) || !isNumber(focus.z)) return null;
    if (!bounds || !isNumber(bounds.minX) || !isNumber(bounds.maxX) || !isNumber(bounds.minZ) || !isNumber(bounds.maxZ)) return null;
    const screen = event.screen as { w?: unknown; h?: unknown } | undefined;
    return {
        yaw: event.yaw,
        pitch: event.pitch,
        distance: event.distance,
        focus: { x: focus.x, z: focus.z },
        bounds: { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ },
        zones: Array.isArray(event.zones) ? (event.zones as ProjectedZone[]) : [],
        screen: screen && isNumber(screen.w) && isNumber(screen.h) ? { w: screen.w, h: screen.h } : null,
    };
}

/** The camera pose ProducerSelectionController reports with the `scene_ready` projection. */
export function parseBaselinePose(event: ParsedDeviceEvent | null | undefined): CameraPose | null {
    const camera = event?.cameraState as { yawDeg?: unknown; pitchDeg?: unknown; distance?: unknown; focus?: { x?: unknown; z?: unknown } } | null | undefined;
    if (!camera || !isNumber(camera.yawDeg) || !isNumber(camera.pitchDeg) || !isNumber(camera.distance)) return null;
    if (!camera.focus || !isNumber(camera.focus.x) || !isNumber(camera.focus.z)) return null;
    return { yaw: camera.yawDeg, pitch: camera.pitchDeg, distance: camera.distance, focus: { x: camera.focus.x, z: camera.focus.z } };
}

export function focusInsideBounds(state: CameraStateSnapshot, tolerance = R031_BOUNDS_TOLERANCE): boolean {
    const { focus, bounds } = state;
    return focus.x >= bounds.minX - tolerance && focus.x <= bounds.maxX + tolerance && focus.z >= bounds.minZ - tolerance && focus.z <= bounds.maxZ + tolerance;
}

/** Bounds edges the focus sits on (within tolerance). */
export function boundsEdgesTouched(state: CameraStateSnapshot, tolerance = R031_BOUNDS_TOLERANCE): string[] {
    const { focus, bounds } = state;
    const edges: string[] = [];
    if (Math.abs(focus.x - bounds.minX) <= tolerance) edges.push('minX');
    if (Math.abs(focus.x - bounds.maxX) <= tolerance) edges.push('maxX');
    if (Math.abs(focus.z - bounds.minZ) <= tolerance) edges.push('minZ');
    if (Math.abs(focus.z - bounds.maxZ) <= tolerance) edges.push('maxZ');
    return edges;
}

export interface CameraPanStepInput {
    step: string;
    baseline: CameraPose;
    before: CameraPose;
    after: CameraStateSnapshot | null;
    expectEdge: boolean;
    evidenceLines: string[];
}

/** Pan outcome: pose unchanged, focus inside the reported bounds; moved (short swipe) or on an edge (long swipe). */
export function evaluateCameraPanStep(input: CameraPanStepInput): StepEvaluation {
    const assertions: AssertionRecord[] = [];
    let failure: AssertionFailure | null = null;
    const check = (id: string, ok: boolean, failureClass: FailureClass, expected: unknown, actual: unknown): boolean => {
        assertions.push({ id, step: input.step, ok });
        if (!ok && !failure) failure = { failureClass, assertion: id, step: input.step, expected, actual, evidenceLines: input.evidenceLines };
        return ok;
    };
    const done = (): StepEvaluation => ({ ok: failure === null, assertions, failure });
    const after = input.after;
    if (!check('camera_state_reported', after !== null, 'INPUT_NOT_RECEIVED', { evt: 'camera_state' }, null)) return done();
    const pose = { yaw: after!.yaw, pitch: after!.pitch, distance: after!.distance };
    const same = (a: number, b: number) => Math.abs(a - b) <= R031_POSE_TOLERANCE;
    if (!check('camera_pose_unchanged', same(pose.yaw, input.baseline.yaw) && same(pose.pitch, input.baseline.pitch) && same(pose.distance, input.baseline.distance),
        'CAMERA_FOCUS', { yaw: input.baseline.yaw, pitch: input.baseline.pitch, distance: input.baseline.distance }, pose)) return done();
    if (!check('camera_focus_inside_bounds', focusInsideBounds(after!), 'CAMERA_FOCUS', after!.bounds, after!.focus)) return done();
    if (input.expectEdge) {
        const edges = boundsEdgesTouched(after!);
        check('camera_focus_clamped_at_edge', edges.length > 0, 'CAMERA_FOCUS', { onEdge: true, tolerance: R031_BOUNDS_TOLERANCE }, { focus: after!.focus, bounds: after!.bounds });
    } else {
        const moved = Math.hypot(after!.focus.x - input.before.focus.x, after!.focus.z - input.before.focus.z);
        check('camera_focus_moved', moved > R031_BOUNDS_TOLERANCE, 'CAMERA_FOCUS', { moved: `> ${R031_BOUNDS_TOLERANCE}` }, { moved, before: input.before.focus, after: after!.focus });
    }
    return done();
}

/** ADB vector of a swipe in `direction` (adb y grows downwards). */
export function swipeVector(direction: R031SwipeDirection, length: number): ScreenPoint {
    if (direction === 'left') return { x: -length, y: 0 };
    if (direction === 'right') return { x: length, y: 0 };
    if (direction === 'up') return { x: 0, y: -length };
    return { x: 0, y: length };
}

/**
 * A swipe whose start point is clear of every UI rect (with clearance) and whose end stays on screen.
 * Candidates are scanned from the screen centre outwards, so the choice is deterministic.
 */
export function pickSwipe(
    layout: UiLayoutSnapshot,
    display: { width: number; height: number },
    toCocos: (adb: ScreenPoint) => ScreenPoint,
    vector: ScreenPoint,
    clearancePx = 24,
): { from: ScreenPoint; to: ScreenPoint } | null {
    const margin = 0.03;
    const candidates: ScreenPoint[] = [];
    for (let fy = 0.05; fy <= 0.951; fy += 0.05) {
        for (let fx = 0.05; fx <= 0.951; fx += 0.05) candidates.push({ x: Math.round(display.width * fx), y: Math.round(display.height * fy) });
    }
    const centre = { x: display.width / 2, y: display.height / 2 };
    candidates.sort((a, b) => (Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y)) || (a.y - b.y) || (a.x - b.x));
    for (const from of candidates) {
        const to = { x: Math.round(from.x + vector.x), y: Math.round(from.y + vector.y) };
        if (to.x < display.width * margin || to.x > display.width * (1 - margin) || to.y < display.height * margin || to.y > display.height * (1 - margin)) continue;
        const cocos = toCocos(from);
        const blocked = uiRectsAt({
            ...layout,
            rects: Object.fromEntries(Object.entries(layout.rects).map(([name, r]) => [name, r ? { x: r.x - clearancePx, y: r.y - clearancePx, w: r.w + clearancePx * 2, h: r.h + clearancePx * 2 } : null])) as UiLayoutSnapshot['rects'],
        }, cocos).length > 0;
        if (!blocked) return { from, to };
    }
    return null;
}

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

export interface R031RunOutput { result: DeviceResult; paths: RunPaths; schemaErrors: string[] }

export async function runR031Scenario(driver: SessionDeviceDriver, partial: Partial<R031Options> & { apkPath: string | null }): Promise<R031RunOutput> {
    const options: R031Options = { ...DEFAULT_R031_OPTIONS, ...partial, timeouts: { ...DEFAULT_R031_OPTIONS.timeouts, ...partial.timeouts } };
    const now = options.now ?? (() => new Date());
    const sleep = options.sleep ?? realSleep;
    const startedAt = now();
    const apkPath = options.apkPath ? path.resolve(options.apkPath) : null;
    const apkExists = apkPath !== null && existsSync(apkPath);
    const apkSha = apkExists ? await sha256File(apkPath!) : null;
    const runId = options.runId ?? makeRunId(R031_SCENARIO_ID, startedAt, apkSha);
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
        const projection = stream.allEvents().find((e) => e.evt === 'scene_ready' && e.reason === 'scene_ready') ?? null;
        const baseline = parseBaselinePose(projection);
        check('baseline_camera_reported', 'launch', baseline !== null, 'RUNTIME_ERROR', { evt: 'scene_ready', cameraState: '{ yawDeg, pitchDeg, distance, focus }' }, projection?.cameraState ?? null, asLine(projection));
        steps.push({ id: 'launch', session: session!.event, layout: layoutRecord!.event, baseline });

        // A scheduled first-automation reveal (never on a fresh save) would move the camera; wait it out.
        const lastReveal = stream.allEvents().filter((e) => e.evt === 'reveal_state').pop();
        if (lastReveal && (lastReveal.phase === 'pending' || lastReveal.phase === 'started')) {
            const done = await stream.waitFor((e) => e.evt === 'reveal_state' && e.phase === 'complete', 0, options.timeouts.revealMs);
            if (!done) warnings.push('reveal did not complete before the swipes');
        }

        await sleep(300);
        await capture('launch');
        if (!displaySize) throw new EnvironmentStop(envFailure('display_size', 'launch', 'screencap PNG', null), null);
        const display = displaySize as { width: number; height: number };
        const win = { w: layout!.screen.w, h: layout!.screen.h };
        const toCocos = (adb: ScreenPoint) => adbToCocos(adb, win, display);

        /** Injects one swipe and returns the camera_state it produced (or null). */
        const swipe = async (stepId: string, vector: ScreenPoint, before: CameraPose, expectEdge: boolean): Promise<CameraStateSnapshot> => {
            const picked = pickSwipe(layout!, display, toCocos, vector);
            check(`${stepId}_start_clear_of_ui`, stepId, picked !== null, 'MARKER_PRESENTATION', 'a swipe start outside every UI rect with the end on screen', { vector, rects: layout!.rects });
            const cursor = stream!.cursor;
            await driver.swipe(picked!.from.x, picked!.from.y, picked!.to.x, picked!.to.y, options.swipeDurationMs);
            const stateRecord = await stream!.waitFor((e) => e.evt === 'camera_state', cursor, options.timeouts.cameraStateMs);
            await sleep(options.timeouts.swipeSettleMs);
            const events = stream!.eventsSince(cursor);
            record(evaluateSwipeStep({ step: stepId, selectionBefore: null, events, runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive() }));
            const selectionLeak = events.find((e) => e.evt === 'selection_state') ?? null;
            check(`${stepId}_no_selection_state`, stepId, selectionLeak === null, 'TAP_CLASSIFICATION', { selection_state: 'none' }, selectionLeak, asLine(selectionLeak));
            const after = parseCameraState(stateRecord?.event);
            record(evaluateCameraPanStep({ step: stepId, baseline: baseline!, before, after, expectEdge, evidenceLines: asLine(stateRecord?.event) }));
            steps.push({ id: stepId, kind: 'swipe', from: picked!.from, to: picked!.to, durationMs: options.swipeDurationMs, cameraState: stateRecord!.event, edges: boundsEdgesTouched(after!), screenshot: await capture(stepId) });
            return after!;
        };

        // ---- 2. One-finger swipe → pan only, inside the bounds ------------------------------------
        let current = await swipe('pan_swipe', swipeVector('left', Math.round(display.width * options.shortSwipeFraction)), baseline!, false);

        // ---- 3. Long swipes in four directions → clamped on the bounds edge ------------------------
        for (const direction of R031_LONG_SWIPE_DIRECTIONS) {
            const length = Math.round((direction === 'left' || direction === 'right' ? display.width : display.height) * options.longSwipeFraction);
            current = await swipe(`long_swipe_${direction}`, swipeVector(direction, length), current, true);
        }

        // ---- 4. Tap the Fabricator → selection + camera_focus at the default distance ---------------
        const fabricator = current.zones.find((z) => z.id === 'Fabricator');
        check('fabricator_projected_on_screen', 'tap_fabricator', !!fabricator && fabricator.onScreen && isNumber(fabricator.sx) && isNumber(fabricator.sy), 'CAMERA_FOCUS', { id: 'Fabricator', onScreen: true }, fabricator ?? null);
        const fabricatorCocos = { x: fabricator!.sx as number, y: fabricator!.sy as number };
        check('fabricator_not_under_ui', 'tap_fabricator', uiRectsAt(layout!, fabricatorCocos).length === 0, 'MARKER_PRESENTATION', { under: [] }, { under: uiRectsAt(layout!, fabricatorCocos), centre: fabricatorCocos });
        const adb = cocosToAdb(fabricatorCocos, win, display);
        const tap = { x: Math.round(adb.x), y: Math.round(adb.y) };
        const cursor = stream.cursor;
        await driver.tap(tap.x, tap.y);
        await stream.waitFor((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled'), cursor, options.timeouts.chainMs);
        await sleep(250);
        const tapEvents = stream.eventsSince(cursor);
        record(evaluateTapStep({
            step: 'tap_fabricator', zoneId: 'Fabricator', previousSelection: null, expectedTouch: toCocos(tap), touchTolerancePx: 3,
            events: tapEvents, runtimeErrorLines: errorLinesSince(cursor), appAlive: await appAlive(),
        }));
        const started = tapEvents.find((e) => e.evt === 'camera_focus' && e.phase === 'started') ?? null;
        check('selection_focus_kind', 'tap_fabricator', started?.kind === 'selection', 'CAMERA_FOCUS', { kind: 'selection' }, { kind: started?.kind ?? null }, asLine(started));
        const defaultDistance = isNumber(started?.defaultDistance) ? started!.defaultDistance as number : null;
        const usedDistance = isNumber(started?.distance) ? started!.distance as number : null;
        check('selection_focus_default_distance', 'tap_fabricator',
            defaultDistance !== null && usedDistance !== null && Math.abs(usedDistance - defaultDistance) <= R031_BOUNDS_TOLERANCE && Math.abs(defaultDistance - baseline!.distance) <= R031_BOUNDS_TOLERANCE,
            'CAMERA_FOCUS', { distance: baseline!.distance, defaultDistance: baseline!.distance }, { distance: usedDistance, defaultDistance }, asLine(started));
        steps.push({ id: 'tap_fabricator', kind: 'tap', adb: tap, focus: started, screenshot: await capture('fabricator_selected') });

        // ---- 5. Zero runtime/`error` events after scene_ready -----------------------------------
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
        scenarioId: R031_SCENARIO_ID,
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
