import { CORE_HUD_LAYOUT, UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, cardHeight, computeUiLayout, type UiRect } from './UiLayout.ts';
import { offlineReportCardCenterOffsetY } from './OfflineReportLayout.ts';

/**
 * AUT-050 layout of the AI Upgrades entry chip and modal panel (engine-free, design units of the 720x1280 fixed-width design
 * resolution). Same language as the AUT-051 offline card: graphite pill, off-white text, cyan for the AI / permanent accent,
 * amber only for the primary buy of an affordable row, never red (a row that cannot be bought is dimmed, not alarmed).
 *
 * Chip: one small "AI x{N}" button right-aligned in the factory band directly under the HUD band (no HUD height added).
 * Panel: a centred card (header, three tabs, three row slots, CLOSE) in the factory band, at most 75% of the band height.
 * Documented deviation from ART_DIRECTION section 26 (three columns): tabs are three 64-unit-tall buttons so the 20-unit minimum
 * font fits; the panel never scrolls (at most three rows per branch).
 */

export const PERMANENT_UPGRADE_CHIP_WIDTH = 150;
export const PERMANENT_UPGRADE_CHIP_HEIGHT = 64;
/** Gap between the HUD band and the chip. */
export const PERMANENT_UPGRADE_CHIP_GAP_BELOW_HUD = 8;
export const PERMANENT_UPGRADE_CHIP_FONT_SIZE = 26;

export const PERMANENT_UPGRADE_PANEL_WIDTH = 640;
/** The panel stays at or under this share of the factory band height. */
export const PERMANENT_UPGRADE_PANEL_MAX_BAND_RATIO = 0.75;
export const PERMANENT_UPGRADE_PADDING_X = 12;
export const PERMANENT_UPGRADE_PADDING_Y = 16;
export const PERMANENT_UPGRADE_HEADER_HEIGHT = 44;
export const PERMANENT_UPGRADE_HEADER_FONT_SIZE = 30;
export const PERMANENT_UPGRADE_BALANCE_FONT_SIZE = 32;
export const PERMANENT_UPGRADE_SECTION_GAP = 12;
export const PERMANENT_UPGRADE_TAB_WIDTH = 200;
export const PERMANENT_UPGRADE_TAB_HEIGHT = 64;
export const PERMANENT_UPGRADE_TAB_GAP = 8;
export const PERMANENT_UPGRADE_TAB_FONT_SIZE = 24;
export const PERMANENT_UPGRADE_ROW_SLOTS = 3;
export const PERMANENT_UPGRADE_ROW_HEIGHT = 100;
export const PERMANENT_UPGRADE_ROW_GAP = 8;
export const PERMANENT_UPGRADE_BUY_WIDTH = 160;
export const PERMANENT_UPGRADE_BUY_HEIGHT = 64;
export const PERMANENT_UPGRADE_BUY_FONT_SIZE = 26;
export const PERMANENT_UPGRADE_NAME_FONT_SIZE = 26;
export const PERMANENT_UPGRADE_RANK_FONT_SIZE = 22;
/** Effect / locked text: above the 20-unit body minimum with margin (Android floors label pixels). */
export const PERMANENT_UPGRADE_EFFECT_FONT_SIZE = 21;
export const PERMANENT_UPGRADE_EFFECT_LINE_HEIGHT = 24;
export const PERMANENT_UPGRADE_CLOSE_HEIGHT = 64;
export const PERMANENT_UPGRADE_CLOSE_FONT_SIZE = 30;
export const PERMANENT_UPGRADE_MIN_BUTTON_HEIGHT = 64;
export const PERMANENT_UPGRADE_MIN_BODY_FONT_SIZE = 20;
export const PERMANENT_UPGRADE_MIN_CLOSE_FONT_SIZE = 28;
export const PERMANENT_UPGRADE_BACKDROP_ALPHA = 150;
/** The purchase pulse (cyan ring on the bought row) lasts at most this long. */
export const PERMANENT_UPGRADE_PULSE_SECONDS = 0.35;

export const PERMANENT_UPGRADE_COLORS = Object.freeze({
    backdrop: Object.freeze({ r: 0, g: 0, b: 0, a: PERMANENT_UPGRADE_BACKDROP_ALPHA }),
    pill: Object.freeze({ r: 24, g: 29, b: 32, a: 245 }),
    /** Opaque graphite used inside the chip / buttons / rows (the mark and outlines are painted over it). */
    graphite: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
    rowFill: Object.freeze({ r: 34, g: 41, b: 45, a: 255 }),
    dimFill: Object.freeze({ r: 30, g: 36, b: 39, a: 255 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    secondary: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
    dimText: Object.freeze({ r: 128, g: 136, b: 136, a: 255 }),
    cyan: Object.freeze({ r: 88, g: 170, b: 184, a: 255 }),
    amber: Object.freeze({ r: 240, g: 176, b: 64, a: 255 }),
    /** Dark text on the amber / cyan fills. */
    darkText: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
});

export interface PermanentUpgradeLocalRect {
    /** Centre relative to the panel centre (y up). */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface PermanentUpgradeRowLayout {
    readonly slot: PermanentUpgradeLocalRect;
    readonly name: PermanentUpgradeLocalRect;
    readonly rank: PermanentUpgradeLocalRect;
    readonly effect: PermanentUpgradeLocalRect;
    readonly buy: PermanentUpgradeLocalRect;
}

export interface PermanentUpgradePanelLayout {
    readonly width: number;
    readonly height: number;
    readonly title: PermanentUpgradeLocalRect;
    /** Centre / size of the AI mark next to the balance. */
    readonly mark: PermanentUpgradeLocalRect;
    readonly balance: PermanentUpgradeLocalRect;
    readonly tabs: readonly PermanentUpgradeLocalRect[];
    readonly rows: readonly PermanentUpgradeRowLayout[];
    readonly close: PermanentUpgradeLocalRect;
}

function rect(x: number, y: number, w: number, h: number): PermanentUpgradeLocalRect {
    return Object.freeze({ x, y, w, h });
}

export function permanentUpgradeContentWidth(): number {
    return PERMANENT_UPGRADE_PANEL_WIDTH - PERMANENT_UPGRADE_PADDING_X * 2;
}

export function permanentUpgradePanelHeight(): number {
    const rowsHeight = PERMANENT_UPGRADE_ROW_SLOTS * PERMANENT_UPGRADE_ROW_HEIGHT + (PERMANENT_UPGRADE_ROW_SLOTS - 1) * PERMANENT_UPGRADE_ROW_GAP;
    return PERMANENT_UPGRADE_PADDING_Y * 2 + PERMANENT_UPGRADE_HEADER_HEIGHT + PERMANENT_UPGRADE_SECTION_GAP + PERMANENT_UPGRADE_TAB_HEIGHT
        + PERMANENT_UPGRADE_SECTION_GAP + rowsHeight + PERMANENT_UPGRADE_SECTION_GAP + PERMANENT_UPGRADE_CLOSE_HEIGHT;
}

/** Local layout of the panel (a fixed size: every branch fits three row slots, so switching tabs never moves a control). */
export function resolvePermanentUpgradePanelLayout(): PermanentUpgradePanelLayout {
    const height = permanentUpgradePanelHeight();
    const content = permanentUpgradeContentWidth();
    const left = -content / 2;
    const right = content / 2;
    let top = height / 2 - PERMANENT_UPGRADE_PADDING_Y;

    const headerCentre = top - PERMANENT_UPGRADE_HEADER_HEIGHT / 2;
    const balanceWidth = 96;
    const markSize = 34;
    // Wide: the same label shows the short purchase-failure note in place of the title.
    const title = rect(left + 230, headerCentre, 460, PERMANENT_UPGRADE_HEADER_HEIGHT);
    const balance = rect(right - balanceWidth / 2, headerCentre, balanceWidth, PERMANENT_UPGRADE_HEADER_HEIGHT);
    const mark = rect(right - balanceWidth - 8 - markSize / 2, headerCentre, markSize, markSize);
    top -= PERMANENT_UPGRADE_HEADER_HEIGHT + PERMANENT_UPGRADE_SECTION_GAP;

    const tabsCentre = top - PERMANENT_UPGRADE_TAB_HEIGHT / 2;
    const tabs: PermanentUpgradeLocalRect[] = [];
    for (let i = 0; i < 3; i += 1) tabs.push(rect(left + PERMANENT_UPGRADE_TAB_WIDTH / 2 + i * (PERMANENT_UPGRADE_TAB_WIDTH + PERMANENT_UPGRADE_TAB_GAP), tabsCentre, PERMANENT_UPGRADE_TAB_WIDTH, PERMANENT_UPGRADE_TAB_HEIGHT));
    top -= PERMANENT_UPGRADE_TAB_HEIGHT + PERMANENT_UPGRADE_SECTION_GAP;

    const textLeft = left + 14;
    const buyCentreX = right - 12 - PERMANENT_UPGRADE_BUY_WIDTH / 2;
    const textWidth = (buyCentreX - PERMANENT_UPGRADE_BUY_WIDTH / 2 - 10) - textLeft;
    const rankWidth = 110;
    const nameWidth = textWidth - rankWidth - 10;
    const rows: PermanentUpgradeRowLayout[] = [];
    for (let i = 0; i < PERMANENT_UPGRADE_ROW_SLOTS; i += 1) {
        const rowTop = top - i * (PERMANENT_UPGRADE_ROW_HEIGHT + PERMANENT_UPGRADE_ROW_GAP);
        const centreY = rowTop - PERMANENT_UPGRADE_ROW_HEIGHT / 2;
        rows.push(Object.freeze({
            slot: rect(0, centreY, content, PERMANENT_UPGRADE_ROW_HEIGHT),
            name: rect(textLeft + nameWidth / 2, rowTop - 6 - 16, nameWidth, 32),
            rank: rect(textLeft + nameWidth + 10 + rankWidth / 2, rowTop - 6 - 16, rankWidth, 32),
            effect: rect(textLeft + textWidth / 2, rowTop - 6 - 32 - 26, textWidth, 52),
            buy: rect(buyCentreX, centreY, PERMANENT_UPGRADE_BUY_WIDTH, PERMANENT_UPGRADE_BUY_HEIGHT),
        }));
    }
    top -= PERMANENT_UPGRADE_ROW_SLOTS * PERMANENT_UPGRADE_ROW_HEIGHT + (PERMANENT_UPGRADE_ROW_SLOTS - 1) * PERMANENT_UPGRADE_ROW_GAP + PERMANENT_UPGRADE_SECTION_GAP;

    const close = rect(0, top - PERMANENT_UPGRADE_CLOSE_HEIGHT / 2, content, PERMANENT_UPGRADE_CLOSE_HEIGHT);
    return Object.freeze({ width: PERMANENT_UPGRADE_PANEL_WIDTH, height, title, mark, balance, tabs: Object.freeze(tabs), rows: Object.freeze(rows), close });
}

/** Vertical offset of the panel centre from the safe-area centre: the centre of the factory band (shared with the offline card). */
export function permanentUpgradePanelCenterOffsetY(): number {
    return offlineReportCardCenterOffsetY();
}

/** Widget offsets of the chip inside the safe area (top below the HUD band, right at the edge margin). */
export function permanentUpgradeChipWidgetOffsets(): { top: number; right: number } {
    return { top: UI_EDGE_MARGIN + cardHeight(CORE_HUD_LAYOUT) + PERMANENT_UPGRADE_CHIP_GAP_BELOW_HUD, right: UI_EDGE_MARGIN };
}

export interface PermanentUpgradeScreenRects {
    readonly scale: number;
    readonly backdrop: UiRect;
    readonly chip: UiRect;
    readonly panel: UiRect;
    readonly close: UiRect;
    readonly tabs: readonly UiRect[];
    readonly rows: readonly UiRect[];
    readonly buys: readonly UiRect[];
    readonly factoryBand: UiRect;
}

/** Predicted screen rectangles (pixels, bottom-left origin) of the chip and the panel for a screen and its safe area. */
export function computePermanentUpgradeRects(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
): PermanentUpgradeScreenRects {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const layout = resolvePermanentUpgradePanelLayout();
    const centreX = safeAreaPx.x + safeAreaPx.w / 2;
    const centreY = safeAreaPx.y + safeAreaPx.h / 2 + permanentUpgradePanelCenterOffsetY() * scale;
    const toScreen = (local: PermanentUpgradeLocalRect): UiRect => ({
        x: centreX + (local.x - local.w / 2) * scale,
        y: centreY + (local.y - local.h / 2) * scale,
        w: local.w * scale,
        h: local.h * scale,
    });
    const offsets = permanentUpgradeChipWidgetOffsets();
    const chipW = PERMANENT_UPGRADE_CHIP_WIDTH * scale;
    const chipH = PERMANENT_UPGRADE_CHIP_HEIGHT * scale;
    const chip: UiRect = {
        x: safeAreaPx.x + safeAreaPx.w - offsets.right * scale - chipW,
        y: safeAreaPx.y + safeAreaPx.h - offsets.top * scale - chipH,
        w: chipW,
        h: chipH,
    };
    return {
        scale,
        backdrop: { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
        chip,
        panel: toScreen({ x: 0, y: 0, w: layout.width, h: layout.height }),
        close: toScreen(layout.close),
        tabs: layout.tabs.map(toScreen),
        rows: layout.rows.map((row) => toScreen(row.slot)),
        buys: layout.rows.map((row) => toScreen(row.buy)),
        factoryBand: ui.factoryBand,
    };
}

// ---- placeholder AI Core mark (procedural, no asset: CUSTOM_AI_CORE_01 is a separate task) ----

export interface PermanentUpgradePoint { readonly x: number; readonly y: number }

/** Regular polygon vertices around a centre (`startAngleRad` of the first vertex). */
export function regularPolygonPoints(cx: number, cy: number, radius: number, sides: number, startAngleRad: number): PermanentUpgradePoint[] {
    const points: PermanentUpgradePoint[] = [];
    for (let i = 0; i < sides; i += 1) {
        const angle = startAngleRad + (i * Math.PI * 2) / sides;
        points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    return points;
}

export interface AiMarkGeometry {
    /** Cyan hexagon (the outline ring is the area between this and `hexInner`). */
    readonly hexOuter: readonly PermanentUpgradePoint[];
    /** Graphite hexagon painted inside the cyan one, leaving a hexagon outline. */
    readonly hexInner: readonly PermanentUpgradePoint[];
    /** Small off-white diamond in the middle. */
    readonly diamond: readonly PermanentUpgradePoint[];
}

export function aiMarkGeometry(cx: number, cy: number, size: number): AiMarkGeometry {
    const radius = size / 2;
    return {
        hexOuter: regularPolygonPoints(cx, cy, radius, 6, Math.PI / 6),
        hexInner: regularPolygonPoints(cx, cy, radius * 0.7, 6, Math.PI / 6),
        diamond: regularPolygonPoints(cx, cy, radius * 0.38, 4, Math.PI / 2),
    };
}

/** Four opaque bars of the purchase pulse ring around `target` (design units, any frame); `progress` 0..1, empty at 1 or more. */
export function pulseRingBars(target: PermanentUpgradeLocalRect, progress: number): PermanentUpgradeLocalRect[] {
    if (!(progress >= 0) || progress >= 1) return [];
    const grow = 2 + 8 * progress;
    const thickness = Math.max(1, 5 * (1 - progress));
    const w = target.w + grow * 2;
    const h = target.h + grow * 2;
    return [
        rect(target.x, target.y + h / 2 - thickness / 2, w, thickness),
        rect(target.x, target.y - h / 2 + thickness / 2, w, thickness),
        rect(target.x - w / 2 + thickness / 2, target.y, thickness, h - thickness * 2),
        rect(target.x + w / 2 - thickness / 2, target.y, thickness, h - thickness * 2),
    ];
}
