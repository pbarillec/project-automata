import { aiMarkGeometry, permanentUpgradeChipWidgetOffsets, PERMANENT_UPGRADE_CHIP_HEIGHT, regularPolygonPoints } from './PermanentUpgradeLayout.ts';
import { offlineReportCardCenterOffsetY } from './OfflineReportLayout.ts';
import { UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, computeUiLayout, type UiRect } from './UiLayout.ts';

/**
 * AUT-RBT-001 layout of the Reboot entry chip and the confirmation modal (engine-free, design units of the 720x1280 fixed-width design
 * resolution). Same language as the AUT-050 / 051 cards: graphite pill, off-white text, cyan (88,170,184) for the AI / permanent accent, never
 * amber or red (a Reboot is transformation into permanent knowledge, not loss: ART_DIRECTION section 25).
 *
 * Chip: "REBOOT +N" with the procedural cyan AI mark, a FIXED slot on the second line under the HUD band, right-aligned at the edge margin,
 * directly under the AI chip (so nothing shifts when it appears). Modal: a centred card in the factory band (at most 75% of it), no scrolling:
 * header, hero reward, Civilization line, progress bar, RESETS / KEEPS columns, a full-width REBOOT confirm and a CANCEL.
 */

export const REBOOT_CHIP_WIDTH = 200;
export const REBOOT_CHIP_HEIGHT = 64;
/** Gap between the AI chip line and the Reboot chip line. */
export const REBOOT_CHIP_GAP_BELOW_AI_CHIP = 8;
export const REBOOT_CHIP_FONT_SIZE = 26;

export const REBOOT_PANEL_WIDTH = 640;
/** The modal stays at or under this share of the factory band height. */
export const REBOOT_PANEL_MAX_BAND_RATIO = 0.75;
export const REBOOT_PADDING_X = 12;
export const REBOOT_PADDING_Y = 16;
export const REBOOT_HEADER_HEIGHT = 44;
export const REBOOT_HEADER_FONT_SIZE = 30;
export const REBOOT_HERO_HEIGHT = 52;
export const REBOOT_HERO_FONT_SIZE = 42;
export const REBOOT_CIVILIZATION_HEIGHT = 30;
export const REBOOT_CIVILIZATION_FONT_SIZE = 24;
export const REBOOT_PROGRESS_HEIGHT = 40;
export const REBOOT_PROGRESS_BAR_HEIGHT = 14;
export const REBOOT_PROGRESS_FONT_SIZE = 22;
export const REBOOT_COLUMN_WIDTH = 300;
export const REBOOT_COLUMN_GAP = 16;
export const REBOOT_COLUMN_HEADING_HEIGHT = 22;
export const REBOOT_COLUMN_HEADING_FONT_SIZE = 22;
export const REBOOT_COLUMN_LINE_HEIGHT = 28;
export const REBOOT_COLUMN_LINE_FONT_SIZE = 22;
export const REBOOT_COLUMN_LINES = 5;
export const REBOOT_COLUMN_PADDING = 8;
export const REBOOT_BUTTON_HEIGHT = 64;
export const REBOOT_BUTTON_FONT_SIZE = 30;
export const REBOOT_BUTTON_GAP = 10;
export const REBOOT_MIN_BUTTON_HEIGHT = 64;
export const REBOOT_MIN_BODY_FONT_SIZE = 20;
export const REBOOT_MIN_BUTTON_FONT_SIZE = 28;
export const REBOOT_BACKDROP_ALPHA = 150;
export const REBOOT_ACCENT_HEIGHT = 3;

export const REBOOT_COLORS = Object.freeze({
    backdrop: Object.freeze({ r: 0, g: 0, b: 0, a: REBOOT_BACKDROP_ALPHA }),
    pill: Object.freeze({ r: 24, g: 29, b: 32, a: 245 }),
    /** Opaque graphite used inside the chip / buttons (the mark and outlines are painted over it). */
    graphite: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
    rowFill: Object.freeze({ r: 34, g: 41, b: 45, a: 255 }),
    dimFill: Object.freeze({ r: 30, g: 36, b: 39, a: 255 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    secondary: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
    dimText: Object.freeze({ r: 128, g: 136, b: 136, a: 255 }),
    cyan: Object.freeze({ r: 88, g: 170, b: 184, a: 255 }),
    /** Dark text on the cyan REBOOT fill. */
    darkText: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
});

export interface RebootLocalRect {
    /** Centre relative to the card centre (y up). */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface RebootColumnLayout {
    /** The whole column (a slightly lighter slab behind the heading and the five lines). */
    readonly slot: RebootLocalRect;
    readonly heading: RebootLocalRect;
    readonly lines: readonly RebootLocalRect[];
    /** Marker centres (dim dash / cyan dot), one per line, card-local. */
    readonly markers: readonly { readonly x: number; readonly y: number }[];
}

export interface RebootPanelLayout {
    readonly width: number;
    readonly height: number;
    readonly header: RebootLocalRect;
    /** AI mark left of the hero reward text. */
    readonly heroMark: RebootLocalRect;
    readonly hero: RebootLocalRect;
    /** The Civilization line (also the failure-note slot). */
    readonly civilization: RebootLocalRect;
    /** Track of the progress bar (the fill is drawn inside it). */
    readonly progressBar: RebootLocalRect;
    readonly progressLabel: RebootLocalRect;
    readonly resets: RebootColumnLayout;
    readonly keeps: RebootColumnLayout;
    readonly confirm: RebootLocalRect;
    readonly cancel: RebootLocalRect;
}

function rect(x: number, y: number, w: number, h: number): RebootLocalRect {
    return Object.freeze({ x, y, w, h });
}

export function rebootContentWidth(): number {
    return REBOOT_PANEL_WIDTH - REBOOT_PADDING_X * 2;
}

/** Gaps ABOVE each row (design units). */
const GAP_HERO = 8;
const GAP_CIVILIZATION = 4;
const GAP_PROGRESS = 10;
const GAP_COLUMNS = 10;
const GAP_CONFIRM = 10;

export function rebootColumnHeight(): number {
    return REBOOT_COLUMN_PADDING * 2 + REBOOT_COLUMN_HEADING_HEIGHT + REBOOT_COLUMN_LINES * REBOOT_COLUMN_LINE_HEIGHT;
}

export function rebootPanelHeight(): number {
    return REBOOT_PADDING_Y * 2 + REBOOT_HEADER_HEIGHT
        + GAP_HERO + REBOOT_HERO_HEIGHT
        + GAP_CIVILIZATION + REBOOT_CIVILIZATION_HEIGHT
        + GAP_PROGRESS + REBOOT_PROGRESS_HEIGHT
        + GAP_COLUMNS + rebootColumnHeight()
        + GAP_CONFIRM + REBOOT_BUTTON_HEIGHT
        + REBOOT_BUTTON_GAP + REBOOT_BUTTON_HEIGHT;
}

function columnLayout(centreX: number, top: number): RebootColumnLayout {
    const height = rebootColumnHeight();
    const slot = rect(centreX, top - height / 2, REBOOT_COLUMN_WIDTH, height);
    const heading = rect(centreX, top - REBOOT_COLUMN_PADDING - REBOOT_COLUMN_HEADING_HEIGHT / 2, REBOOT_COLUMN_WIDTH - REBOOT_COLUMN_PADDING * 2 - 8, REBOOT_COLUMN_HEADING_HEIGHT);
    const lines: RebootLocalRect[] = [];
    const markers: { x: number; y: number }[] = [];
    const left = centreX - REBOOT_COLUMN_WIDTH / 2;
    const textLeft = left + 30;
    const textWidth = REBOOT_COLUMN_WIDTH - 30 - 8;
    for (let i = 0; i < REBOOT_COLUMN_LINES; i += 1) {
        const lineCentreY = top - REBOOT_COLUMN_PADDING - REBOOT_COLUMN_HEADING_HEIGHT - REBOOT_COLUMN_LINE_HEIGHT * (i + 0.5);
        lines.push(rect(textLeft + textWidth / 2, lineCentreY, textWidth, REBOOT_COLUMN_LINE_HEIGHT));
        markers.push({ x: left + 16, y: lineCentreY });
    }
    return Object.freeze({ slot, heading, lines: Object.freeze(lines), markers: Object.freeze(markers.map((m) => Object.freeze(m))) });
}

/** Local layout of the modal (a fixed size: nothing moves between refreshes). */
export function resolveRebootPanelLayout(): RebootPanelLayout {
    const height = rebootPanelHeight();
    const content = rebootContentWidth();
    let top = height / 2 - REBOOT_PADDING_Y;

    const header = rect(0, top - REBOOT_HEADER_HEIGHT / 2, content, REBOOT_HEADER_HEIGHT);
    top -= REBOOT_HEADER_HEIGHT + GAP_HERO;

    const heroCentreY = top - REBOOT_HERO_HEIGHT / 2;
    const heroMark = rect(-150, heroCentreY, 40, 40);
    const hero = rect(30, heroCentreY, 320, REBOOT_HERO_HEIGHT);
    top -= REBOOT_HERO_HEIGHT + GAP_CIVILIZATION;

    const civilization = rect(0, top - REBOOT_CIVILIZATION_HEIGHT / 2, content, REBOOT_CIVILIZATION_HEIGHT);
    top -= REBOOT_CIVILIZATION_HEIGHT + GAP_PROGRESS;

    // Progress block: the bar on top, the label under it (the whole block is REBOOT_PROGRESS_HEIGHT tall).
    const barWidth = content - 80;
    const progressBar = rect(0, top - REBOOT_PROGRESS_BAR_HEIGHT / 2, barWidth, REBOOT_PROGRESS_BAR_HEIGHT);
    const labelHeight = REBOOT_PROGRESS_HEIGHT - REBOOT_PROGRESS_BAR_HEIGHT - 2;
    const progressLabel = rect(0, top - REBOOT_PROGRESS_BAR_HEIGHT - 2 - labelHeight / 2, content, labelHeight);
    top -= REBOOT_PROGRESS_HEIGHT + GAP_COLUMNS;

    const columnOffset = (REBOOT_COLUMN_WIDTH + REBOOT_COLUMN_GAP) / 2;
    const resets = columnLayout(-columnOffset, top);
    const keeps = columnLayout(columnOffset, top);
    top -= rebootColumnHeight() + GAP_CONFIRM;

    const confirm = rect(0, top - REBOOT_BUTTON_HEIGHT / 2, content, REBOOT_BUTTON_HEIGHT);
    top -= REBOOT_BUTTON_HEIGHT + REBOOT_BUTTON_GAP;
    const cancel = rect(0, top - REBOOT_BUTTON_HEIGHT / 2, content, REBOOT_BUTTON_HEIGHT);

    return Object.freeze({ width: REBOOT_PANEL_WIDTH, height, header, heroMark, hero, civilization, progressBar, progressLabel, resets, keeps, confirm, cancel });
}

/** Vertical offset of the modal centre from the safe-area centre: the centre of the factory band (shared with the offline card). */
export function rebootPanelCenterOffsetY(): number {
    return offlineReportCardCenterOffsetY();
}

/**
 * Widget offsets of the chip inside the safe area: the second line under the HUD band (one AI chip height plus a gap lower than the AI chip
 * and the Settings chip), right-aligned at the edge margin.
 */
export function rebootChipWidgetOffsets(): { top: number; right: number } {
    return { top: permanentUpgradeChipWidgetOffsets().top + PERMANENT_UPGRADE_CHIP_HEIGHT + REBOOT_CHIP_GAP_BELOW_AI_CHIP, right: UI_EDGE_MARGIN };
}

/** Chip mark geometry (centre, size) inside the chip, local to the chip centre. */
export const REBOOT_CHIP_MARK = Object.freeze({ x: -REBOOT_CHIP_WIDTH / 2 + 28, y: 0, size: 32 });
/** Chip label rect (local to the chip centre): right of the mark, shrink handles longer counts. */
export const REBOOT_CHIP_LABEL = Object.freeze({ x: 20, y: 0, w: 144, h: REBOOT_CHIP_HEIGHT });

export interface RebootScreenRects {
    readonly scale: number;
    /** Full screen (the dim backdrop swallows every touch outside the card). */
    readonly backdrop: UiRect;
    readonly chip: UiRect;
    readonly panel: UiRect;
    readonly confirm: UiRect;
    readonly cancel: UiRect;
    readonly columns: readonly UiRect[];
    readonly factoryBand: UiRect;
}

/** Predicted screen rectangles (pixels, bottom-left origin) of the chip and the modal for a screen and its safe area. */
export function computeRebootRects(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
): RebootScreenRects {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const layout = resolveRebootPanelLayout();
    const centreX = safeAreaPx.x + safeAreaPx.w / 2;
    const centreY = safeAreaPx.y + safeAreaPx.h / 2 + rebootPanelCenterOffsetY() * scale;
    const toScreen = (local: RebootLocalRect): UiRect => ({
        x: centreX + (local.x - local.w / 2) * scale,
        y: centreY + (local.y - local.h / 2) * scale,
        w: local.w * scale,
        h: local.h * scale,
    });
    const offsets = rebootChipWidgetOffsets();
    const chipW = REBOOT_CHIP_WIDTH * scale;
    const chipH = REBOOT_CHIP_HEIGHT * scale;
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
        confirm: toScreen(layout.confirm),
        cancel: toScreen(layout.cancel),
        columns: [toScreen(layout.resets.slot), toScreen(layout.keeps.slot)],
        factoryBand: ui.factoryBand,
    };
}

// ---- placeholder AI mark and markers (procedural; reuses the AUT-050 geometry) ----

export { aiMarkGeometry, regularPolygonPoints };
