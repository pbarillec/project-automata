import { offlineReportCardCenterOffsetY } from './OfflineReportLayout.ts';
import { REBOOT_CHIP_HEIGHT, rebootChipWidgetOffsets } from './RebootLayout.ts';
import { UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, computeUiLayout, type UiRect } from './UiLayout.ts';

/**
 * AUT-059 layout of the Founder's Pack entry chip and modal (engine-free, design units of the 720x1280 fixed-width design resolution).
 * Same language as the Settings / AI Upgrades / Reboot modals: graphite pill, off-white text, cyan / amber accents, never red.
 *
 * Chip PLACEMENT (decision): the THIRD line under the HUD band, RIGHT-aligned, directly under the Reboot chip. Existing slots: line 1 = SET
 * (left, 112 wide) and AI chip (right) with the milestone toast band centred; line 2 = Extended Overclock chip (left, 340 wide) and Reboot
 * chip (right, 200 wide). Line 3 is empty on both sides, so the chip (280 wide) overlaps nothing, never touches the centred toast band
 * (which lives on line 1) and keeps the left half of the factory view free. It stays a fixed slot: nothing here grows the HUD.
 *
 * Modal: a centred 640-wide card (title, two content rows, a price row, a note line, BUY, CLOSE) at the shared card centre offset. Each button
 * is a Button on its own child node whose hit rect is the drawn rect (>= 64 units tall).
 */

export const FOUNDER_CHIP_WIDTH = 280;
export const FOUNDER_CHIP_HEIGHT = 64;
export const FOUNDER_CHIP_GAP_BELOW_REBOOT = 8;
export const FOUNDER_CHIP_LABEL_FONT_SIZE = 26;
export const FOUNDER_CHIP_TAG_FONT_SIZE = 22;
export const FOUNDER_CHIP_OUTLINE_THICKNESS = 2;

export const FOUNDER_PANEL_WIDTH = 640;
export const FOUNDER_PADDING_X = 12;
export const FOUNDER_PADDING_Y = 16;
export const FOUNDER_TITLE_HEIGHT = 44;
export const FOUNDER_TITLE_FONT_SIZE = 30;
export const FOUNDER_SECTION_GAP = 12;
export const FOUNDER_CONTENT_ROW_COUNT = 2;
export const FOUNDER_CONTENT_ROW_HEIGHT = 72;
export const FOUNDER_CONTENT_ROW_GAP = 8;
export const FOUNDER_CONTENT_FONT_SIZE = 28;
export const FOUNDER_PRICE_ROW_HEIGHT = 64;
export const FOUNDER_PRICE_FONT_SIZE = 28;
export const FOUNDER_NOTE_HEIGHT = 56;
export const FOUNDER_NOTE_FONT_SIZE = 24;
export const FOUNDER_BUY_HEIGHT = 64;
export const FOUNDER_BUY_FONT_SIZE = 30;
export const FOUNDER_CLOSE_HEIGHT = 64;
export const FOUNDER_CLOSE_FONT_SIZE = 30;
export const FOUNDER_BUTTON_GAP = 8;
export const FOUNDER_MIN_BUTTON_HEIGHT = 64;
export const FOUNDER_MIN_BODY_FONT_SIZE = 20;
export const FOUNDER_BACKDROP_ALPHA = 150;
/** Alpha of the dimmed (disabled) BUY button. */
export const FOUNDER_DISABLED_ALPHA = 110;

export const FOUNDER_COLORS = Object.freeze({
    backdrop: Object.freeze({ r: 0, g: 0, b: 0, a: FOUNDER_BACKDROP_ALPHA }),
    pill: Object.freeze({ r: 24, g: 29, b: 32, a: 245 }),
    graphite: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
    rowFill: Object.freeze({ r: 34, g: 41, b: 45, a: 255 }),
    dimFill: Object.freeze({ r: 30, g: 36, b: 39, a: 255 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    secondary: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
    dimText: Object.freeze({ r: 128, g: 136, b: 136, a: 255 }),
    cyan: Object.freeze({ r: 88, g: 170, b: 184, a: 255 }),
    amber: Object.freeze({ r: 224, g: 168, b: 72, a: 255 }),
    darkText: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
});

export interface FounderLocalRect {
    /** Centre relative to its parent (the chip / the panel), y up. */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface FounderChipLayout {
    readonly label: FounderLocalRect;
    readonly tag: FounderLocalRect;
}

export interface FounderPanelLayout {
    readonly width: number;
    readonly height: number;
    readonly title: FounderLocalRect;
    readonly contentRows: readonly FounderLocalRect[];
    readonly priceRow: FounderLocalRect;
    readonly priceLabel: FounderLocalRect;
    readonly priceValue: FounderLocalRect;
    readonly note: FounderLocalRect;
    readonly buy: FounderLocalRect;
    readonly close: FounderLocalRect;
}

const rect = (x: number, y: number, w: number, h: number): FounderLocalRect => Object.freeze({ x, y, w, h });

export function resolveFounderChipLayout(): FounderChipLayout {
    const pad = 14;
    const w = FOUNDER_CHIP_WIDTH - pad * 2;
    return Object.freeze({ label: rect(0, 12, w, 32), tag: rect(0, -18, w, 26) });
}

/** The two fillRects of the outline (design units, chip-centred): the outer accent rect and the graphite interior. */
export function founderChipOutlineRects(): { outer: FounderLocalRect; inner: FounderLocalRect } {
    const t = FOUNDER_CHIP_OUTLINE_THICKNESS;
    return { outer: rect(0, 0, FOUNDER_CHIP_WIDTH, FOUNDER_CHIP_HEIGHT), inner: rect(0, 0, FOUNDER_CHIP_WIDTH - t * 2, FOUNDER_CHIP_HEIGHT - t * 2) };
}

/** Widget offsets of the chip inside the safe area: third line under the HUD band, right edge margin (under the Reboot chip). */
export function founderChipWidgetOffsets(): { top: number; right: number } {
    return { top: rebootChipWidgetOffsets().top + REBOOT_CHIP_HEIGHT + FOUNDER_CHIP_GAP_BELOW_REBOOT, right: UI_EDGE_MARGIN };
}

export function founderContentWidth(): number {
    return FOUNDER_PANEL_WIDTH - FOUNDER_PADDING_X * 2;
}

export function founderPanelHeight(): number {
    const contentHeight = FOUNDER_CONTENT_ROW_COUNT * FOUNDER_CONTENT_ROW_HEIGHT + (FOUNDER_CONTENT_ROW_COUNT - 1) * FOUNDER_CONTENT_ROW_GAP;
    return FOUNDER_PADDING_Y * 2 + FOUNDER_TITLE_HEIGHT + FOUNDER_SECTION_GAP + contentHeight + FOUNDER_SECTION_GAP + FOUNDER_PRICE_ROW_HEIGHT
        + FOUNDER_SECTION_GAP + FOUNDER_NOTE_HEIGHT + FOUNDER_SECTION_GAP + FOUNDER_BUY_HEIGHT + FOUNDER_BUTTON_GAP + FOUNDER_CLOSE_HEIGHT;
}

export function resolveFounderPanelLayout(): FounderPanelLayout {
    const height = founderPanelHeight();
    const content = founderContentWidth();
    let top = height / 2 - FOUNDER_PADDING_Y;
    const title = rect(0, top - FOUNDER_TITLE_HEIGHT / 2, content, FOUNDER_TITLE_HEIGHT);
    top -= FOUNDER_TITLE_HEIGHT + FOUNDER_SECTION_GAP;
    const contentRows: FounderLocalRect[] = [];
    for (let i = 0; i < FOUNDER_CONTENT_ROW_COUNT; i += 1) {
        contentRows.push(rect(0, top - i * (FOUNDER_CONTENT_ROW_HEIGHT + FOUNDER_CONTENT_ROW_GAP) - FOUNDER_CONTENT_ROW_HEIGHT / 2, content, FOUNDER_CONTENT_ROW_HEIGHT));
    }
    top -= FOUNDER_CONTENT_ROW_COUNT * FOUNDER_CONTENT_ROW_HEIGHT + (FOUNDER_CONTENT_ROW_COUNT - 1) * FOUNDER_CONTENT_ROW_GAP + FOUNDER_SECTION_GAP;
    const priceRow = rect(0, top - FOUNDER_PRICE_ROW_HEIGHT / 2, content, FOUNDER_PRICE_ROW_HEIGHT);
    // Row-local label (left) / value (right) rects, centred on the row.
    const labelWidth = 150;
    const valueWidth = content - 14 - 14 - labelWidth - 10;
    const priceLabel = rect(-content / 2 + 14 + labelWidth / 2, 0, labelWidth, FOUNDER_PRICE_ROW_HEIGHT);
    const priceValue = rect(content / 2 - 14 - valueWidth / 2, 0, valueWidth, FOUNDER_PRICE_ROW_HEIGHT);
    top -= FOUNDER_PRICE_ROW_HEIGHT + FOUNDER_SECTION_GAP;
    const note = rect(0, top - FOUNDER_NOTE_HEIGHT / 2, content, FOUNDER_NOTE_HEIGHT);
    top -= FOUNDER_NOTE_HEIGHT + FOUNDER_SECTION_GAP;
    const buy = rect(0, top - FOUNDER_BUY_HEIGHT / 2, content, FOUNDER_BUY_HEIGHT);
    top -= FOUNDER_BUY_HEIGHT + FOUNDER_BUTTON_GAP;
    const close = rect(0, top - FOUNDER_CLOSE_HEIGHT / 2, content, FOUNDER_CLOSE_HEIGHT);
    return Object.freeze({ width: FOUNDER_PANEL_WIDTH, height, title, contentRows: Object.freeze(contentRows), priceRow, priceLabel, priceValue, note, buy, close });
}

export function founderPanelCenterOffsetY(): number {
    return offlineReportCardCenterOffsetY();
}

export interface FounderScreenRects {
    readonly scale: number;
    readonly backdrop: UiRect;
    readonly chip: UiRect;
    readonly panel: UiRect;
    readonly buy: UiRect;
    readonly close: UiRect;
    readonly factoryBand: UiRect;
}

/** Predicted screen rectangles (pixels, bottom-left origin) of the chip and the modal for a screen and its safe area. */
export function computeFounderShopRects(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
): FounderScreenRects {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const layout = resolveFounderPanelLayout();
    const centreX = safeAreaPx.x + safeAreaPx.w / 2;
    const centreY = safeAreaPx.y + safeAreaPx.h / 2 + founderPanelCenterOffsetY() * scale;
    const toScreen = (local: FounderLocalRect): UiRect => ({
        x: centreX + (local.x - local.w / 2) * scale,
        y: centreY + (local.y - local.h / 2) * scale,
        w: local.w * scale,
        h: local.h * scale,
    });
    const offsets = founderChipWidgetOffsets();
    const chipW = FOUNDER_CHIP_WIDTH * scale;
    const chipH = FOUNDER_CHIP_HEIGHT * scale;
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
        buy: toScreen(layout.buy),
        close: toScreen(layout.close),
        factoryBand: ui.factoryBand,
    };
}
