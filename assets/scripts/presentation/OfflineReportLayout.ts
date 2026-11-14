import { CORE_HUD_LAYOUT, PRODUCER_PANEL_LAYOUT, UI_DESIGN_RESOLUTION, cardHeight, computeUiLayout, type UiRect } from './UiLayout.ts';

/**
 * AUT-051 layout of the Offline Factory Report card (engine-free, design units of the 720x1280 fixed-width design resolution).
 * One card, top to bottom: title, time away, optional offline-limit line, the hero reward, optional robots row, one note slot
 * (the educational line, or the retry line after a failed collect) and the always-visible COLLECT button. Absent rows are omitted
 * (the card shrinks), never blank. The card is centred in the factory band (between the HUD band and the Producer Panel), so it
 * never covers the Next Goal / Overclock rows or the panel buttons; the dim backdrop covers the whole screen.
 * Graphite pill, off-white text, amber for the reward and the button, cyan secondary, never red (AUT-046 / 048 / 049 language).
 */

export type OfflineReportRowKey = 'title' | 'timeAway' | 'capReached' | 'reward' | 'robots' | 'note';

export interface OfflineReportRowSpec {
    readonly key: OfflineReportRowKey;
    readonly height: number;
    /** Gap above this row (design units) when the row is shown. */
    readonly gapBefore: number;
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly lines: number;
}

export const OFFLINE_REPORT_CARD_WIDTH = 640;
export const OFFLINE_REPORT_PADDING_Y = 18;
export const OFFLINE_REPORT_PADDING_X = 16;
export const OFFLINE_REPORT_COLLECT_GAP = 12;
/** COLLECT: at least 64 design units tall, font at least 28 (with margin: 30). */
export const OFFLINE_REPORT_COLLECT_HEIGHT = 64;
export const OFFLINE_REPORT_COLLECT_FONT_SIZE = 30;
export const OFFLINE_REPORT_MIN_COLLECT_HEIGHT = 64;
export const OFFLINE_REPORT_MIN_COLLECT_FONT_SIZE = 28;
/** The card stays at or under this share of the screen height (design units). */
export const OFFLINE_REPORT_MAX_HEIGHT_RATIO = 0.3;
export const OFFLINE_REPORT_ACCENT_HEIGHT = 3;
export const OFFLINE_REPORT_BACKDROP_ALPHA = 150;

/** Font sizes carry a margin over the 20-unit body minimum (Android floors label pixels). */
export const OFFLINE_REPORT_ROWS: readonly OfflineReportRowSpec[] = Object.freeze([
    Object.freeze({ key: 'title', height: 34, gapBefore: 0, fontSize: 30, lineHeight: 34, lines: 1 }),
    Object.freeze({ key: 'timeAway', height: 28, gapBefore: 6, fontSize: 26, lineHeight: 28, lines: 1 }),
    Object.freeze({ key: 'capReached', height: 24, gapBefore: 0, fontSize: 22, lineHeight: 24, lines: 1 }),
    Object.freeze({ key: 'reward', height: 52, gapBefore: 8, fontSize: 42, lineHeight: 52, lines: 1 }),
    Object.freeze({ key: 'robots', height: 30, gapBefore: 0, fontSize: 26, lineHeight: 30, lines: 1 }),
    Object.freeze({ key: 'note', height: 48, gapBefore: 8, fontSize: 22, lineHeight: 24, lines: 2 }),
]);

export const OFFLINE_REPORT_COLORS = Object.freeze({
    backdrop: Object.freeze({ r: 0, g: 0, b: 0, a: OFFLINE_REPORT_BACKDROP_ALPHA }),
    pill: Object.freeze({ r: 24, g: 29, b: 32, a: 245 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    secondary: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
    cyan: Object.freeze({ r: 88, g: 170, b: 184, a: 255 }),
    amber: Object.freeze({ r: 240, g: 176, b: 64, a: 255 }),
    /** Dark text on the amber COLLECT fill. */
    collectText: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
});

export interface OfflineReportRowFlags {
    /** "Offline limit ... reached" row (only when the cap was applied). */
    readonly capReached: boolean;
    /** "+N Robots Built" row (only when robots were built). */
    readonly robots: boolean;
    /** The note slot (educational line, or the retry line after a failed collect). */
    readonly note: boolean;
}

export interface OfflineReportLocalRect {
    /** Centre relative to the card centre (y up). */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface OfflineReportRowLayout extends OfflineReportLocalRect {
    readonly key: OfflineReportRowKey;
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly lines: number;
}

export interface OfflineReportCardLayout {
    readonly width: number;
    readonly height: number;
    readonly rows: readonly OfflineReportRowLayout[];
    readonly collect: OfflineReportLocalRect & { readonly fontSize: number };
    /** Thin amber accent bar along the top edge of the card. */
    readonly accent: OfflineReportLocalRect;
}

function isRowShown(key: OfflineReportRowKey, flags: OfflineReportRowFlags): boolean {
    if (key === 'capReached') return flags.capReached;
    if (key === 'robots') return flags.robots;
    if (key === 'note') return flags.note;
    return true;
}

/** Local layout of the card for a set of shown rows (y measured from the card centre, up). */
export function resolveOfflineReportCardLayout(flags: OfflineReportRowFlags): OfflineReportCardLayout {
    const shown = OFFLINE_REPORT_ROWS.filter((row) => isRowShown(row.key, flags));
    const contentHeight = shown.reduce((sum, row) => sum + row.gapBefore + row.height, 0);
    const height = OFFLINE_REPORT_PADDING_Y * 2 + contentHeight + OFFLINE_REPORT_COLLECT_GAP + OFFLINE_REPORT_COLLECT_HEIGHT;
    const rowWidth = OFFLINE_REPORT_CARD_WIDTH - OFFLINE_REPORT_PADDING_X * 2;
    let top = height / 2 - OFFLINE_REPORT_PADDING_Y;
    const rows: OfflineReportRowLayout[] = [];
    for (const row of shown) {
        top -= row.gapBefore;
        rows.push(Object.freeze({ key: row.key, x: 0, y: top - row.height / 2, w: rowWidth, h: row.height, fontSize: row.fontSize, lineHeight: row.lineHeight, lines: row.lines }));
        top -= row.height;
    }
    const collect = Object.freeze({
        x: 0,
        y: -height / 2 + OFFLINE_REPORT_PADDING_Y + OFFLINE_REPORT_COLLECT_HEIGHT / 2,
        w: rowWidth,
        h: OFFLINE_REPORT_COLLECT_HEIGHT,
        fontSize: OFFLINE_REPORT_COLLECT_FONT_SIZE,
    });
    const accent = Object.freeze({ x: 0, y: height / 2 - OFFLINE_REPORT_ACCENT_HEIGHT / 2, w: OFFLINE_REPORT_CARD_WIDTH, h: OFFLINE_REPORT_ACCENT_HEIGHT });
    return Object.freeze({ width: OFFLINE_REPORT_CARD_WIDTH, height, rows: Object.freeze(rows), collect, accent });
}

/**
 * Vertical offset (design units, up) of the card centre from the centre of the safe area: the centre of the factory band
 * between the HUD band (top) and the Producer Panel (bottom), which share the same edge margin.
 */
export function offlineReportCardCenterOffsetY(): number {
    return (cardHeight(PRODUCER_PANEL_LAYOUT) - cardHeight(CORE_HUD_LAYOUT)) / 2;
}

export interface OfflineReportScreenRects {
    readonly scale: number;
    /** Full screen (the dim backdrop swallows every touch except COLLECT). */
    readonly backdrop: UiRect;
    readonly card: UiRect;
    readonly collect: UiRect;
    readonly rows: Readonly<Record<string, UiRect>>;
    readonly factoryBand: UiRect;
}

/** Predicted screen rectangles (pixels, bottom-left origin) for a screen and its safe area. */
export function computeOfflineReportRects(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
    flags: OfflineReportRowFlags = { capReached: true, robots: true, note: true },
): OfflineReportScreenRects {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const layout = resolveOfflineReportCardLayout(flags);
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const centreX = safeAreaPx.x + safeAreaPx.w / 2;
    const centreY = safeAreaPx.y + safeAreaPx.h / 2 + offlineReportCardCenterOffsetY() * scale;
    const toScreen = (local: OfflineReportLocalRect): UiRect => ({
        x: centreX + (local.x - local.w / 2) * scale,
        y: centreY + (local.y - local.h / 2) * scale,
        w: local.w * scale,
        h: local.h * scale,
    });
    const rows: Record<string, UiRect> = {};
    for (const row of layout.rows) rows[row.key] = toScreen(row);
    return {
        scale,
        backdrop: { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
        card: toScreen({ x: 0, y: 0, w: layout.width, h: layout.height }),
        collect: toScreen(layout.collect),
        rows,
        factoryBand: ui.factoryBand,
    };
}
