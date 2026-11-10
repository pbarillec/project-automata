/**
 * AUT-R-036 engine-free geometry checks over the DEBUG `ui_layout` diagnostic.
 *
 * All rectangles are in the Cocos window frame (pixels, bottom-left origin) that touches and
 * `zones_projected` also use. Pure functions so the device scenario and its tests share them.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import type { AssertionFailure, AssertionRecord, FailureClass, ScreenPoint, StepEvaluation } from './classification.ts';

export interface Rect { x: number; y: number; w: number; h: number }

export const UI_RECT_NAMES = ['CoreHUD', 'ProducerPanel', 'Action_x1', 'Action_x10', 'Action_xMax'] as const;
export const UI_BUTTON_NAMES = ['Action_x1', 'Action_x10', 'Action_xMax'] as const;
export type UiRectName = typeof UI_RECT_NAMES[number];

export interface UiLayoutSnapshot {
    screen: { w: number; h: number };
    safeArea: Rect | null;
    rects: Record<UiRectName, Rect | null>;
    /** Row rects per card (`CoreHUD` / `ProducerPanel` → row key → rect); empty when not reported. */
    rows: Record<'CoreHUD' | 'ProducerPanel', Record<string, Rect | null>>;
    reason: string | null;
}

export interface ProjectedZone { id: string; sx: number | null; sy: number | null; onScreen: boolean }

/** Combined HUD + panel coverage budget checked on device. */
export const UI_DEVICE_MAX_COVERAGE = 0.35;
export const UI_RECT_TOLERANCE_PX = 1;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function toRect(value: unknown): Rect | null {
    if (!value || typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    return isNumber(r.x) && isNumber(r.y) && isNumber(r.w) && isNumber(r.h) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}

export function parseUiLayout(event: ParsedDeviceEvent | null | undefined): UiLayoutSnapshot | null {
    if (!event || event.evt !== 'ui_layout') return null;
    const screen = event.screen as { w?: unknown; h?: unknown } | undefined;
    if (!screen || !isNumber(screen.w) || !isNumber(screen.h)) return null;
    const raw = (event.rects ?? {}) as Record<string, unknown>;
    const rects = {} as Record<UiRectName, Rect | null>;
    for (const name of UI_RECT_NAMES) rects[name] = toRect(raw[name]);
    const rawRows = (event.rows ?? {}) as Record<string, unknown>;
    const rowsOf = (card: unknown): Record<string, Rect | null> => (card && typeof card === 'object'
        ? Object.fromEntries(Object.entries(card as Record<string, unknown>).map(([key, value]) => [key, toRect(value)]))
        : {});
    return {
        screen: { w: screen.w, h: screen.h },
        safeArea: toRect(event.safeArea),
        rects,
        rows: { CoreHUD: rowsOf(rawRows.CoreHUD), ProducerPanel: rowsOf(rawRows.ProducerPanel) },
        reason: typeof event.reason === 'string' ? event.reason : null,
    };
}

/** True when two rects share more than `tolerance` px in both axes (touching edges never overlap). */
export function rectsOverlapBeyond(a: Rect, b: Rect, tolerance: number): boolean {
    const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return dx > tolerance && dy > tolerance;
}

export interface UiModelInput {
    step: string;
    layout: UiLayoutSnapshot;
    /** UiLayout prediction for the same screen and safe area (pixels). */
    predictedButtons: Record<string, Rect>;
    /** Row keys each card must report, in order. */
    expectedRows: Record<'CoreHUD' | 'ProducerPanel', readonly string[]>;
    tolerancePx?: number;
    evidenceLines?: string[];
}

/**
 * AUT-R-036 (retry 1) checks on a layout that shows real strings: (a) each Button rect matches its
 * UiLayout prediction within ±2 px, (b) the ×1/×10/×MAX rects do not overlap each other, (c) every row
 * rect is inside its card. Failures are MARKER_PRESENTATION.
 */
export function evaluateUiLayoutModel(input: UiModelInput): StepEvaluation {
    const c = new GeometryChecker(input.step, input.evidenceLines ?? []);
    const tolerance = input.tolerancePx ?? 2;
    const { layout } = input;
    const mismatched = UI_BUTTON_NAMES.flatMap((name) => {
        const actual = layout.rects[name];
        const expected = input.predictedButtons[name];
        const ok = actual !== null && expected !== undefined
            && Math.abs(actual.x - expected.x) <= tolerance && Math.abs(actual.y - expected.y) <= tolerance
            && Math.abs(actual.w - expected.w) <= tolerance && Math.abs(actual.h - expected.h) <= tolerance;
        return ok ? [] : [{ name, actual, expected: expected ?? null }];
    });
    if (!c.check('buttons_match_ui_layout', mismatched.length === 0, 'MARKER_PRESENTATION', { tolerancePx: tolerance }, { mismatched })) return c.result();
    const overlapping: string[] = [];
    UI_BUTTON_NAMES.forEach((a, i) => UI_BUTTON_NAMES.slice(i + 1).forEach((b) => {
        if (rectsOverlapBeyond(layout.rects[a]!, layout.rects[b]!, 0.5)) overlapping.push(`${a}/${b}`);
    }));
    if (!c.check('buttons_do_not_overlap', overlapping.length === 0, 'MARKER_PRESENTATION', { overlapping: [] }, { overlapping, rects: UI_BUTTON_NAMES.map((name) => layout.rects[name]) })) return c.result();
    const outside: Array<{ card: string; row: string; rect: Rect | null }> = [];
    for (const card of ['CoreHUD', 'ProducerPanel'] as const) {
        const cardRect = layout.rects[card];
        for (const key of input.expectedRows[card]) {
            const rect = layout.rows[card][key] ?? null;
            if (!rect || !cardRect || !rectInside(cardRect, rect)) outside.push({ card, row: key, rect });
        }
    }
    c.check('rows_inside_card', outside.length === 0, 'MARKER_PRESENTATION', { rowsInsideCard: true }, { outside });
    return c.result();
}

export function rectArea(rect: Rect): number { return Math.max(0, rect.w) * Math.max(0, rect.h); }

export function rectInside(outer: Rect, inner: Rect, tolerance = UI_RECT_TOLERANCE_PX): boolean {
    return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance
        && inner.x + inner.w <= outer.x + outer.w + tolerance && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function pointInRect(rect: Rect, point: ScreenPoint): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

export function rectCentre(rect: Rect): ScreenPoint { return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }; }

/** Names of the HUD / panel rectangles containing a point (buttons are inside the panel). */
export function uiRectsAt(layout: UiLayoutSnapshot, point: ScreenPoint): UiRectName[] {
    return UI_RECT_NAMES.filter((name) => { const r = layout.rects[name]; return r !== null && pointInRect(r, point); });
}

class GeometryChecker {
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

export interface UiGeometryInput {
    step: string;
    layout: UiLayoutSnapshot;
    /** Latest projected producer zones (zones_projected / scene_ready), same frame as the layout. */
    zones: ProjectedZone[];
    maxCoverage?: number;
    evidenceLines?: string[];
}

/**
 * AUT-R-036 layout checks: every rect inside the screen and the safe area (1 px), HUD/panel disjoint,
 * coverage within budget, each Button inside the panel, and no on-screen producer zone centre under
 * the UI. Any failure is MARKER_PRESENTATION (presentation geometry, routed to Scene Presentation).
 */
export function evaluateUiGeometry(input: UiGeometryInput): StepEvaluation {
    const c = new GeometryChecker(input.step, input.evidenceLines ?? []);
    const { layout } = input;
    const screen: Rect = { x: 0, y: 0, w: layout.screen.w, h: layout.screen.h };
    const missing = UI_RECT_NAMES.filter((name) => { const r = layout.rects[name]; return !r || r.w <= 0 || r.h <= 0; });
    if (!c.check('ui_rects_present', missing.length === 0, 'MARKER_PRESENTATION', UI_RECT_NAMES, { missing })) return c.result();
    const rects = layout.rects as Record<UiRectName, Rect>;
    const outsideScreen = UI_RECT_NAMES.filter((name) => !rectInside(screen, rects[name]));
    if (!c.check('ui_rects_inside_screen', outsideScreen.length === 0, 'MARKER_PRESENTATION', { screen }, { outside: outsideScreen.map((name) => ({ name, rect: rects[name] })) })) return c.result();
    if (!c.check('safe_area_reported', layout.safeArea !== null && rectInside(screen, layout.safeArea), 'MARKER_PRESENTATION', { safeAreaInside: screen }, { safeArea: layout.safeArea })) return c.result();
    const outsideSafe = UI_RECT_NAMES.filter((name) => !rectInside(layout.safeArea!, rects[name]));
    if (!c.check('ui_rects_inside_safe_area', outsideSafe.length === 0, 'MARKER_PRESENTATION', { safeArea: layout.safeArea }, { outside: outsideSafe.map((name) => ({ name, rect: rects[name] })) })) return c.result();
    if (!c.check('hud_panel_no_overlap', !rectsOverlap(rects.CoreHUD, rects.ProducerPanel), 'MARKER_PRESENTATION', { overlap: false }, { CoreHUD: rects.CoreHUD, ProducerPanel: rects.ProducerPanel })) return c.result();
    const coverage = (rectArea(rects.CoreHUD) + rectArea(rects.ProducerPanel)) / rectArea(screen);
    const maxCoverage = input.maxCoverage ?? UI_DEVICE_MAX_COVERAGE;
    if (!c.check('ui_coverage_within_budget', coverage <= maxCoverage, 'MARKER_PRESENTATION', { maxCoverage }, { coverage })) return c.result();
    const buttonsOutside = UI_BUTTON_NAMES.filter((name) => !rectInside(rects.ProducerPanel, rects[name]));
    if (!c.check('buttons_inside_panel', buttonsOutside.length === 0, 'MARKER_PRESENTATION', { panel: rects.ProducerPanel }, { outside: buttonsOutside.map((name) => ({ name, rect: rects[name] })) })) return c.result();
    const occluded = input.zones
        .filter((zone) => zone.onScreen && isNumber(zone.sx) && isNumber(zone.sy))
        .map((zone) => ({ id: zone.id, centre: { x: zone.sx as number, y: zone.sy as number }, under: uiRectsAt(layout, { x: zone.sx as number, y: zone.sy as number }) }))
        .filter((zone) => zone.under.length > 0);
    c.check('no_zone_centre_under_ui', occluded.length === 0, 'MARKER_PRESENTATION', { zonesUnderUi: [] }, { zonesUnderUi: occluded });
    return c.result();
}

export interface UiTapInput {
    step: string;
    target: string;
    selectionBefore: string | null;
    events: ParsedDeviceEvent[];
    runtimeErrorLines: string[];
    appAlive: boolean;
}

const asLine = (event: ParsedDeviceEvent | null | undefined): string[] => (event ? [`[AUT-DEVICE] ${JSON.stringify(event)}`] : []);

/**
 * A tap on the HUD or a panel Button belongs to the UI: within the window there is no world
 * selection raycast, no selection change and no camera focus (SELECTION_STATE on a leak).
 */
export function evaluateUiTap(input: UiTapInput): StepEvaluation {
    const errors = input.appAlive ? input.runtimeErrorLines : [...input.runtimeErrorLines, 'app process not running'];
    const c = new GeometryChecker(input.step, []);
    const raycast = input.events.find((e) => e.evt === 'selection_raycast') ?? null;
    if (!c.check('ui_tap_no_selection_raycast', raycast === null, 'SELECTION_STATE', { target: input.target, selection_raycast: 'none' }, { hit: raycast?.hit, x: raycast?.x, y: raycast?.y })) return withEvidence(c.result(), asLine(raycast));
    const selection = input.events.find((e) => e.evt === 'selection_state') ?? null;
    if (!c.check('ui_tap_no_selection_state', selection === null, 'SELECTION_STATE', { target: input.target, selection: input.selectionBefore }, { next: selection?.next, requested: selection?.requested })) return withEvidence(c.result(), asLine(selection));
    const focus = input.events.find((e) => e.evt === 'camera_focus') ?? null;
    if (!c.check('ui_tap_no_camera_focus', focus === null, 'SELECTION_STATE', { target: input.target, camera_focus: 'none' }, { phase: focus?.phase, id: focus?.id, source: focus?.source })) return withEvidence(c.result(), asLine(focus));
    c.check('no_runtime_error', errors.length === 0, 'RUNTIME_ERROR', { runtimeErrors: 0, appAlive: true }, { runtimeErrors: input.runtimeErrorLines.length, appAlive: input.appAlive });
    return withEvidence(c.result(), errors.slice(0, 10));
}

function withEvidence(result: StepEvaluation, lines: string[]): StepEvaluation {
    if (result.failure && result.failure.evidenceLines.length === 0) result.failure.evidenceLines = lines;
    return result;
}

/**
 * Picks a calibration point (adb fractions of the display) whose Cocos position is clear of every UI
 * rect by `clearancePx`, so the self-check touch reaches the world input listeners.
 */
export const CALIBRATION_CANDIDATES: ReadonlyArray<{ fx: number; fy: number }> = [
    { fx: 0.04, fy: 0.08 }, { fx: 0.5, fy: 0.08 }, { fx: 0.04, fy: 0.92 }, { fx: 0.5, fy: 0.92 }, { fx: 0.96, fy: 0.5 },
];

export function pickCalibrationPoint(
    layout: UiLayoutSnapshot,
    display: { width: number; height: number },
    toCocos: (adb: ScreenPoint) => ScreenPoint,
    clearancePx = 24,
): { adb: ScreenPoint; cocos: ScreenPoint } | null {
    for (const candidate of CALIBRATION_CANDIDATES) {
        const adb = { x: Math.round(display.width * candidate.fx), y: Math.round(display.height * candidate.fy) };
        const cocos = toCocos(adb);
        const blocked = UI_RECT_NAMES.some((name) => {
            const r = layout.rects[name];
            return r !== null && pointInRect({ x: r.x - clearancePx, y: r.y - clearancePx, w: r.w + clearancePx * 2, h: r.h + clearancePx * 2 }, cocos);
        });
        if (!blocked) return { adb, cocos };
    }
    return null;
}
