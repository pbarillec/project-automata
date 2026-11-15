import { CORE_HUD_LAYOUT, UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, cardHeight, computeUiLayout, type UiRect } from './UiLayout.ts';
import { offlineReportCardCenterOffsetY } from './OfflineReportLayout.ts';

/**
 * AUT-052 layout of the Settings entry chip and modal panel (engine-free, design units of the 720x1280 fixed-width design resolution).
 * Same language as the AUT-050 AI Upgrades panel: graphite pill, off-white text, cyan accent, never red.
 *
 * Chip: one small gear + "SET" button in the band directly under the HUD at the LEFT edge, on the same top line as the AUT-050 AI chip
 * (right-aligned) and the milestone toast band (centred, 440 wide for a Minor toast). The chip is narrow enough to stay clear of the
 * Minor toast; a wider Major / era / Reboot card passes over it for a moment (the chip is placed behind the toast band).
 * Panel: a centred 640-wide card (header, Music / SFX / Vibration toggle rows, an informational Language row, CLOSE).
 * AUT-065: when the consent provider requires it (UMP privacy options), a fifth "Privacy options" row sits under Language and the card grows by one row.
 */

export const SETTINGS_CHIP_WIDTH = 112;
export const SETTINGS_CHIP_HEIGHT = 64;
/** Gap between the HUD band and the chip (the same 8 as the AI chip and the toast band). */
export const SETTINGS_CHIP_GAP_BELOW_HUD = 8;
export const SETTINGS_CHIP_FONT_SIZE = 26;

export const SETTINGS_PANEL_WIDTH = 640;
export const SETTINGS_PADDING_X = 12;
export const SETTINGS_PADDING_Y = 16;
export const SETTINGS_HEADER_HEIGHT = 44;
export const SETTINGS_HEADER_FONT_SIZE = 30;
export const SETTINGS_SECTION_GAP = 12;
export const SETTINGS_ROW_COUNT = 4;
/** AUT-065: the row count when the "Privacy options" row is shown (the card grows by exactly one row + gap). */
export const SETTINGS_ROW_COUNT_WITH_PRIVACY = 5;
export const SETTINGS_ROW_HEIGHT = 72;
export const SETTINGS_ROW_GAP = 8;
/** Row label font (>= the 20-unit body minimum, with margin). */
export const SETTINGS_ROW_FONT_SIZE = 28;
export const SETTINGS_PILL_WIDTH = 124;
export const SETTINGS_PILL_HEIGHT = 44;
export const SETTINGS_PILL_FONT_SIZE = 24;
export const SETTINGS_CLOSE_HEIGHT = 64;
export const SETTINGS_CLOSE_FONT_SIZE = 30;
export const SETTINGS_MIN_BUTTON_HEIGHT = 64;
export const SETTINGS_MIN_BODY_FONT_SIZE = 20;
export const SETTINGS_MIN_CLOSE_FONT_SIZE = 28;
export const SETTINGS_BACKDROP_ALPHA = 150;

export const SETTINGS_COLORS = Object.freeze({
    backdrop: Object.freeze({ r: 0, g: 0, b: 0, a: SETTINGS_BACKDROP_ALPHA }),
    pill: Object.freeze({ r: 24, g: 29, b: 32, a: 245 }),
    graphite: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
    rowFill: Object.freeze({ r: 34, g: 41, b: 45, a: 255 }),
    dimFill: Object.freeze({ r: 30, g: 36, b: 39, a: 255 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    secondary: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
    dimText: Object.freeze({ r: 128, g: 136, b: 136, a: 255 }),
    cyan: Object.freeze({ r: 88, g: 170, b: 184, a: 255 }),
    /** ON pill: cyan fill with dark text; OFF pill: graphite with a cyan outline and secondary text (never colour-only: the text says ON / OFF). */
    darkText: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
});

export interface SettingsLocalRect {
    /** Centre relative to the panel centre (y up). */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface SettingsRowLayout {
    /** The whole row: the toggle's hit rect (equals the drawn rect). */
    readonly slot: SettingsLocalRect;
    readonly label: SettingsLocalRect;
    readonly pill: SettingsLocalRect;
}

export interface SettingsPanelLayout {
    readonly width: number;
    readonly height: number;
    readonly title: SettingsLocalRect;
    readonly rows: readonly SettingsRowLayout[];
    readonly close: SettingsLocalRect;
}

function rect(x: number, y: number, w: number, h: number): SettingsLocalRect {
    return Object.freeze({ x, y, w, h });
}

export function settingsContentWidth(): number {
    return SETTINGS_PANEL_WIDTH - SETTINGS_PADDING_X * 2;
}

export function settingsPanelHeight(rowCount: number = SETTINGS_ROW_COUNT): number {
    const rowsHeight = rowCount * SETTINGS_ROW_HEIGHT + (rowCount - 1) * SETTINGS_ROW_GAP;
    return SETTINGS_PADDING_Y * 2 + SETTINGS_HEADER_HEIGHT + SETTINGS_SECTION_GAP + rowsHeight + SETTINGS_SECTION_GAP + SETTINGS_CLOSE_HEIGHT;
}

export function resolveSettingsPanelLayout(rowCount: number = SETTINGS_ROW_COUNT): SettingsPanelLayout {
    const height = settingsPanelHeight(rowCount);
    const content = settingsContentWidth();
    const left = -content / 2;
    let top = height / 2 - SETTINGS_PADDING_Y;
    const title = rect(0, top - SETTINGS_HEADER_HEIGHT / 2, content, SETTINGS_HEADER_HEIGHT);
    top -= SETTINGS_HEADER_HEIGHT + SETTINGS_SECTION_GAP;
    const rows: SettingsRowLayout[] = [];
    for (let i = 0; i < rowCount; i += 1) {
        const centreY = top - i * (SETTINGS_ROW_HEIGHT + SETTINGS_ROW_GAP) - SETTINGS_ROW_HEIGHT / 2;
        const pillX = content / 2 - 14 - SETTINGS_PILL_WIDTH / 2;
        const labelWidth = content - 14 - 14 - SETTINGS_PILL_WIDTH - 10;
        rows.push(Object.freeze({
            slot: rect(0, centreY, content, SETTINGS_ROW_HEIGHT),
            label: rect(left + 14 + labelWidth / 2, centreY, labelWidth, SETTINGS_ROW_HEIGHT),
            pill: rect(pillX, centreY, SETTINGS_PILL_WIDTH, SETTINGS_PILL_HEIGHT),
        }));
    }
    top -= rowCount * SETTINGS_ROW_HEIGHT + (rowCount - 1) * SETTINGS_ROW_GAP + SETTINGS_SECTION_GAP;
    const close = rect(0, top - SETTINGS_CLOSE_HEIGHT / 2, content, SETTINGS_CLOSE_HEIGHT);
    return Object.freeze({ width: SETTINGS_PANEL_WIDTH, height, title, rows: Object.freeze(rows), close });
}

export function settingsPanelCenterOffsetY(): number {
    return offlineReportCardCenterOffsetY();
}

/** Widget offsets of the chip inside the safe area: the same top line as the AI chip and the toast band, left at the edge margin. */
export function settingsChipWidgetOffsets(): { top: number; left: number } {
    return { top: UI_EDGE_MARGIN + cardHeight(CORE_HUD_LAYOUT) + SETTINGS_CHIP_GAP_BELOW_HUD, left: UI_EDGE_MARGIN };
}

export interface SettingsScreenRects {
    readonly scale: number;
    readonly backdrop: UiRect;
    readonly chip: UiRect;
    readonly panel: UiRect;
    readonly close: UiRect;
    readonly rows: readonly UiRect[];
    readonly pills: readonly UiRect[];
    readonly factoryBand: UiRect;
}

/** Predicted screen rectangles (pixels, bottom-left origin) of the chip and the panel for a screen and its safe area. */
export function computeSettingsRects(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
    rowCount: number = SETTINGS_ROW_COUNT,
): SettingsScreenRects {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const layout = resolveSettingsPanelLayout(rowCount);
    const centreX = safeAreaPx.x + safeAreaPx.w / 2;
    const centreY = safeAreaPx.y + safeAreaPx.h / 2 + settingsPanelCenterOffsetY() * scale;
    const toScreen = (local: SettingsLocalRect): UiRect => ({
        x: centreX + (local.x - local.w / 2) * scale,
        y: centreY + (local.y - local.h / 2) * scale,
        w: local.w * scale,
        h: local.h * scale,
    });
    const offsets = settingsChipWidgetOffsets();
    const chipW = SETTINGS_CHIP_WIDTH * scale;
    const chipH = SETTINGS_CHIP_HEIGHT * scale;
    const chip: UiRect = {
        x: safeAreaPx.x + offsets.left * scale,
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
        rows: layout.rows.map((row) => toScreen(row.slot)),
        pills: layout.rows.map((row) => toScreen(row.pill)),
        factoryBand: ui.factoryBand,
    };
}

export interface SettingsPoint { readonly x: number; readonly y: number }

/** Regular polygon vertices (used for the procedural gear mark: no asset). */
export function gearPoints(cx: number, cy: number, outerRadius: number, innerRadius: number, teeth: number): SettingsPoint[] {
    const points: SettingsPoint[] = [];
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i += 1) {
        const a = i * step;
        // Each tooth: inner, outer, outer, inner (a trapezoid-ish cog profile).
        points.push({ x: cx + Math.cos(a - step * 0.3) * innerRadius, y: cy + Math.sin(a - step * 0.3) * innerRadius });
        points.push({ x: cx + Math.cos(a - step * 0.16) * outerRadius, y: cy + Math.sin(a - step * 0.16) * outerRadius });
        points.push({ x: cx + Math.cos(a + step * 0.16) * outerRadius, y: cy + Math.sin(a + step * 0.16) * outerRadius });
        points.push({ x: cx + Math.cos(a + step * 0.3) * innerRadius, y: cy + Math.sin(a + step * 0.3) * innerRadius });
    }
    return points;
}

/** Regular polygon vertices around a centre. */
export function settingsRegularPolygon(cx: number, cy: number, radius: number, sides: number, startAngleRad: number): SettingsPoint[] {
    const points: SettingsPoint[] = [];
    for (let i = 0; i < sides; i += 1) {
        const angle = startAngleRad + (i * Math.PI * 2) / sides;
        points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    return points;
}
