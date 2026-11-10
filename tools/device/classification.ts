/**
 * AUT-INFRA-001 failure classification. Pure functions over parsed `[AUT-DEVICE]` events:
 * the first failed assertion in the chain decides the class.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';

export const FAILURE_CLASSES = [
    'INPUT_NOT_RECEIVED',
    'TAP_CLASSIFICATION',
    'RAYCAST_MISS',
    'SELECTION_STATE',
    'MARKER_PRESENTATION',
    'CAMERA_FOCUS',
    'RUNTIME_ERROR',
    'ENVIRONMENT',
] as const;
export type FailureClass = typeof FAILURE_CLASSES[number];

/** Who acts next, and whether re-running without a code change is meaningful. */
export const FAILURE_ROUTING: Record<FailureClass, { nextOwner: string; retryWithoutCodeChange: boolean }> = {
    INPUT_NOT_RECEIVED: { nextOwner: 'implementer', retryWithoutCodeChange: false },
    TAP_CLASSIFICATION: { nextOwner: 'implementer', retryWithoutCodeChange: false },
    RAYCAST_MISS: { nextOwner: 'implementer', retryWithoutCodeChange: false },
    SELECTION_STATE: { nextOwner: 'implementer', retryWithoutCodeChange: false },
    MARKER_PRESENTATION: { nextOwner: 'scene-presentation', retryWithoutCodeChange: false },
    CAMERA_FOCUS: { nextOwner: 'implementer', retryWithoutCodeChange: false },
    RUNTIME_ERROR: { nextOwner: 'implementer', retryWithoutCodeChange: false },
    ENVIRONMENT: { nextOwner: 'human', retryWithoutCodeChange: true },
};

export interface AssertionFailure {
    failureClass: FailureClass;
    assertion: string;
    step: string;
    expected: unknown;
    actual: unknown;
    evidenceLines: string[];
}

export interface AssertionRecord { id: string; step: string; ok: boolean }

export interface StepEvaluation {
    ok: boolean;
    assertions: AssertionRecord[];
    failure: AssertionFailure | null;
}

type Event = ParsedDeviceEvent;
const line = (event: Event | null | undefined): string[] => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);
const num = (value: unknown): number => (typeof value === 'number' ? value : Number.NaN);

class Checker {
    public readonly assertions: AssertionRecord[] = [];
    public failure: AssertionFailure | null = null;
    private readonly step: string;
    private readonly errors: string[];
    public constructor(step: string, errorLines: string[]) { this.step = step; this.errors = errorLines; }

    /** Records an assertion; on the first failure, a runtime error seen in the same window takes precedence. */
    public check(id: string, ok: boolean, failureClass: FailureClass, expected: unknown, actual: unknown, evidence: string[]): boolean {
        if (this.failure) return false;
        this.assertions.push({ id, step: this.step, ok });
        if (ok) return true;
        if (this.errors.length > 0 && failureClass !== 'ENVIRONMENT') {
            this.failure = { failureClass: 'RUNTIME_ERROR', assertion: id, step: this.step, expected, actual: { observed: actual, runtimeErrors: this.errors.slice(0, 5) }, evidenceLines: [...this.errors.slice(0, 10), ...evidence] };
        } else {
            this.failure = { failureClass, assertion: id, step: this.step, expected, actual, evidenceLines: evidence };
        }
        return false;
    }

    public result(): StepEvaluation { return { ok: this.failure === null, assertions: this.assertions, failure: this.failure }; }
}

export interface ScreenPoint { x: number; y: number }

export interface TapStepInput {
    step: string;
    zoneId: string;
    previousSelection: string | null;
    /** Expected Cocos (bottom-left origin) coordinates of the injected tap. */
    expectedTouch: ScreenPoint;
    touchTolerancePx: number;
    /** Events observed after the tap was injected (in order). */
    events: Event[];
    /** Runtime-error logcat lines observed in the same window. */
    runtimeErrorLines: string[];
    /** False when the app process died during the window. */
    appAlive: boolean;
}

/** C3 chain for one tap: touch_end → selection_raycast → selection_state → marker_state → camera_focus. */
export function evaluateTapStep(input: TapStepInput): StepEvaluation {
    const c = new Checker(input.step, input.appAlive ? input.runtimeErrorLines : [...input.runtimeErrorLines, 'app process not running']);
    const { events, zoneId } = input;
    const touchEnd = events.find((e) => e.evt === 'touch_end') ?? null;
    if (!c.check('touch_end_received', touchEnd !== null, 'INPUT_NOT_RECEIVED', { evt: 'touch_end' }, { events: events.map((e) => e.evt) }, [])) return c.result();
    const dx = num(touchEnd!.x) - input.expectedTouch.x;
    const dy = num(touchEnd!.y) - input.expectedTouch.y;
    if (!c.check('touch_position_matches_injection', Math.hypot(dx, dy) <= input.touchTolerancePx, 'ENVIRONMENT', input.expectedTouch, { x: touchEnd!.x, y: touchEnd!.y }, line(touchEnd))) return c.result();
    if (!c.check('touch_not_ui_blocked', touchEnd!.uiBlocked !== true, 'TAP_CLASSIFICATION', { uiBlocked: false }, { uiBlocked: touchEnd!.uiBlocked }, line(touchEnd))) return c.result();
    if (!c.check('touch_classified_tap', touchEnd!.tap === true, 'TAP_CLASSIFICATION', { tap: true }, { tap: touchEnd!.tap, moved: touchEnd!.moved, slop: touchEnd!.slop }, line(touchEnd))) return c.result();

    const raycast = events.find((e) => e.evt === 'selection_raycast') ?? null;
    if (!c.check('selection_raycast_emitted', raycast !== null, 'RAYCAST_MISS', { evt: 'selection_raycast' }, null, line(touchEnd))) return c.result();
    if (!c.check('raycast_hit_zone', raycast!.hit === zoneId, 'RAYCAST_MISS', { hit: zoneId }, { hit: raycast!.hit, targets: raycast!.targets, ray: raycast!.ray, zone: (raycast!.zones as Array<{ id: string }> | undefined)?.find((z) => z.id === zoneId) ?? null }, line(raycast))) return c.result();

    const selection = events.find((e) => e.evt === 'selection_state' && e.requested === zoneId) ?? null;
    if (!c.check('selection_state_emitted', selection !== null, 'SELECTION_STATE', { evt: 'selection_state', requested: zoneId }, null, line(raycast))) return c.result();
    const expectChanged = input.previousSelection !== zoneId;
    const selectionOk = selection!.next === zoneId && selection!.prev === input.previousSelection && selection!.changed === expectChanged && selection!.rejected === undefined;
    if (!c.check('selection_state_next', selectionOk, 'SELECTION_STATE', { prev: input.previousSelection, next: zoneId, changed: expectChanged }, { prev: selection!.prev, next: selection!.next, changed: selection!.changed, rejected: selection!.rejected }, line(selection))) return c.result();

    const marker = events.find((e) => e.evt === 'marker_state' && e.id === zoneId) ?? null;
    if (!c.check('marker_state_emitted', marker !== null, 'MARKER_PRESENTATION', { evt: 'marker_state', id: zoneId }, null, line(selection))) return c.result();
    const markerOk = marker!.exists === true && marker!.active === true && marker!.activeInHierarchy === true && marker!.hasMesh === true;
    if (!c.check('marker_active', markerOk, 'MARKER_PRESENTATION', { exists: true, active: true, activeInHierarchy: true, hasMesh: true }, { exists: marker!.exists, active: marker!.active, activeInHierarchy: marker!.activeInHierarchy, hasMesh: marker!.hasMesh }, line(marker))) return c.result();
    if (expectChanged && input.previousSelection) {
        const prevMarker = events.find((e) => e.evt === 'marker_state' && e.id === input.previousSelection) ?? null;
        if (!c.check('previous_marker_cleared', prevMarker !== null && prevMarker.active === false, 'MARKER_PRESENTATION', { id: input.previousSelection, active: false }, prevMarker ? { active: prevMarker.active } : null, line(prevMarker))) return c.result();
    }

    const requested = events.find((e) => e.evt === 'camera_focus' && e.source === 'selection' && e.id === zoneId) ?? null;
    if (!c.check('camera_focus_requested', requested !== null && requested.phase === 'requested', 'CAMERA_FOCUS', { phase: 'requested', id: zoneId }, requested ? { phase: requested.phase, reason: requested.reason } : null, line(requested))) return c.result();
    const requestedIndex = events.indexOf(requested!);
    const started = events.slice(requestedIndex).find((e) => e.evt === 'camera_focus' && e.phase === 'started') ?? null;
    if (!c.check('camera_focus_started', started !== null, 'CAMERA_FOCUS', { phase: 'started' }, null, line(requested))) return c.result();
    const startedIndex = events.indexOf(started!);
    const settled = events.slice(startedIndex).find((e) => e.evt === 'camera_focus' && (e.phase === 'settled' || e.phase === 'cancelled')) ?? null;
    if (!c.check('camera_focus_settled', settled !== null && settled.phase === 'settled', 'CAMERA_FOCUS', { phase: 'settled' }, settled ? { phase: settled.phase, reason: settled.reason } : null, line(started))) return c.result();

    c.check('no_runtime_error', input.runtimeErrorLines.length === 0 && input.appAlive, 'RUNTIME_ERROR', { runtimeErrors: 0, appAlive: true }, { runtimeErrors: input.runtimeErrorLines.length, appAlive: input.appAlive }, input.runtimeErrorLines.slice(0, 10));
    return c.result();
}

export interface SwipeStepInput {
    step: string;
    selectionBefore: string | null;
    events: Event[];
    runtimeErrorLines: string[];
    appAlive: boolean;
}

/** A deliberate swipe must arrive, be classified as a drag, and leave the selection unchanged. */
export function evaluateSwipeStep(input: SwipeStepInput): StepEvaluation {
    const c = new Checker(input.step, input.appAlive ? input.runtimeErrorLines : [...input.runtimeErrorLines, 'app process not running']);
    const touchEnd = input.events.find((e) => e.evt === 'touch_end') ?? null;
    if (!c.check('swipe_touch_end_received', touchEnd !== null, 'INPUT_NOT_RECEIVED', { evt: 'touch_end' }, { events: input.events.map((e) => e.evt) }, [])) return c.result();
    if (!c.check('swipe_not_classified_tap', touchEnd!.tap === false, 'TAP_CLASSIFICATION', { tap: false }, { tap: touchEnd!.tap, moved: touchEnd!.moved, slop: touchEnd!.slop }, line(touchEnd))) return c.result();
    const raycast = input.events.find((e) => e.evt === 'selection_raycast') ?? null;
    if (!c.check('swipe_no_selection_raycast', raycast === null, 'TAP_CLASSIFICATION', { selection_raycast: 'none' }, { hit: raycast?.hit }, line(raycast))) return c.result();
    const changed = input.events.find((e) => e.evt === 'selection_state' && (e.changed === true || e.next !== input.selectionBefore)) ?? null;
    if (!c.check('swipe_selection_unchanged', changed === null, 'SELECTION_STATE', { selection: input.selectionBefore }, changed ? { next: changed.next } : null, line(changed))) return c.result();
    c.check('no_runtime_error', input.runtimeErrorLines.length === 0 && input.appAlive, 'RUNTIME_ERROR', { runtimeErrors: 0, appAlive: true }, { runtimeErrors: input.runtimeErrorLines.length, appAlive: input.appAlive }, input.runtimeErrorLines.slice(0, 10));
    return c.result();
}

export interface CalibrationInput {
    step: string;
    expectedTouch: ScreenPoint;
    tolerancePx: number;
    events: Event[];
    windowSize: { w: number; h: number };
    displaySize: { width: number; height: number };
}

/**
 * Harness self-check: the injected point must arrive where the coordinate conversion predicts.
 * A failure is a harness/environment defect (ENVIRONMENT), never a C3 class.
 */
export function evaluateCalibration(input: CalibrationInput): StepEvaluation {
    const c = new Checker(input.step, []);
    const landscapeMatch = (input.windowSize.w >= input.windowSize.h) === (input.displaySize.width >= input.displaySize.height);
    if (!c.check('calibration_orientation_matches', landscapeMatch, 'ENVIRONMENT', input.displaySize, input.windowSize, [])) return c.result();
    const touchStart = input.events.find((e) => e.evt === 'touch_start') ?? null;
    const touchEnd = input.events.find((e) => e.evt === 'touch_end') ?? null;
    if (!c.check('calibration_touch_received', touchStart !== null && touchEnd !== null, 'INPUT_NOT_RECEIVED', { evt: ['touch_start', 'touch_end'] }, { events: input.events.map((e) => e.evt) }, [])) return c.result();
    const distance = Math.hypot(num(touchStart!.x) - input.expectedTouch.x, num(touchStart!.y) - input.expectedTouch.y);
    c.check('calibration_position', distance <= input.tolerancePx, 'ENVIRONMENT', input.expectedTouch, { x: touchStart!.x, y: touchStart!.y, distance }, line(touchStart));
    return c.result();
}

/** Converts between Cocos window coordinates (bottom-left origin) and adb display pixels (top-left origin). */
export function cocosToAdb(point: ScreenPoint, windowSize: { w: number; h: number }, displaySize: { width: number; height: number }): ScreenPoint {
    const sx = displaySize.width / windowSize.w;
    const sy = displaySize.height / windowSize.h;
    return { x: point.x * sx, y: (windowSize.h - point.y) * sy };
}

export function adbToCocos(point: ScreenPoint, windowSize: { w: number; h: number }, displaySize: { width: number; height: number }): ScreenPoint {
    const sx = displaySize.width / windowSize.w;
    const sy = displaySize.height / windowSize.h;
    return { x: point.x / sx, y: windowSize.h - point.y / sy };
}
