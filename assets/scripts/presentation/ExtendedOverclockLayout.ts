import { CORE_HUD_LAYOUT, UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, cardHeight, type UiRect } from './UiLayout.ts';
import { SETTINGS_CHIP_GAP_BELOW_HUD, SETTINGS_CHIP_HEIGHT } from './SettingsLayout.ts';

/**
 * AUT-056 layout of the Extended Overclock chip (engine-free, design units of the 720x1280 fixed-width design resolution).
 *
 * One passive, optional-looking chip on the SECOND line under the HUD band, LEFT-aligned (below the Settings chip; the AI chip and the
 * Reboot chip are on the right). Fixed slot: the HUD is already at the 35% coverage ceiling, so nothing here grows the HUD.
 * Two text lines inside the 64-unit chip: the label (font 26) and a small "Rewarded Ad" tag (font 22). The outline is two fillRects.
 */

/** Wider than the ~280 first estimate: "Extended Overclock 10 min" must stay >= 21 units after SHRINK (checked by the DEBUG chip_shown report). */
export const EXTENDED_OVERCLOCK_CHIP_WIDTH = 340;
export const EXTENDED_OVERCLOCK_CHIP_HEIGHT = 64;
/** Gap between the Settings chip row and this chip (the same 8 as every other chip gap). */
export const EXTENDED_OVERCLOCK_CHIP_GAP_BELOW_SETTINGS = 8;
export const EXTENDED_OVERCLOCK_LABEL_FONT_SIZE = 26;
export const EXTENDED_OVERCLOCK_TAG_FONT_SIZE = 22;
export const EXTENDED_OVERCLOCK_MIN_FONT_SIZE = 20;
export const EXTENDED_OVERCLOCK_MIN_BUTTON_HEIGHT = 64;
export const EXTENDED_OVERCLOCK_OUTLINE_THICKNESS = 2;
/** Alpha of the chip while the ad is in flight (inert). */
export const EXTENDED_OVERCLOCK_DIMMED_ALPHA = 110;

/** Same amber as the active boost pill (BOOST_HUD_AMBER 224,168,72). */
export const EXTENDED_OVERCLOCK_COLORS = Object.freeze({
    graphite: Object.freeze({ r: 24, g: 29, b: 32, a: 255 }),
    amber: Object.freeze({ r: 224, g: 168, b: 72, a: 255 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    secondary: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
});

export interface ExtendedOverclockLocalRect {
    /** Centre relative to the chip centre (y up). */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface ExtendedOverclockChipLayout {
    readonly label: ExtendedOverclockLocalRect;
    readonly tag: ExtendedOverclockLocalRect;
}

/** Label (top line) and tag (bottom line) rects inside the chip; the two lines share the 64 units. */
export function resolveExtendedOverclockChipLayout(): ExtendedOverclockChipLayout {
    const pad = 14;
    const w = EXTENDED_OVERCLOCK_CHIP_WIDTH - pad * 2;
    return Object.freeze({
        label: Object.freeze({ x: 0, y: 12, w, h: 32 }),
        tag: Object.freeze({ x: 0, y: -18, w, h: 26 }),
    });
}

/** Widget offsets of the chip inside the safe area: second line under the HUD band, left at the edge margin. */
export function extendedOverclockChipWidgetOffsets(): { top: number; left: number } {
    return {
        top: UI_EDGE_MARGIN + cardHeight(CORE_HUD_LAYOUT) + SETTINGS_CHIP_GAP_BELOW_HUD + SETTINGS_CHIP_HEIGHT + EXTENDED_OVERCLOCK_CHIP_GAP_BELOW_SETTINGS,
        left: UI_EDGE_MARGIN,
    };
}

/** Predicted screen rectangle (pixels, bottom-left origin) of the chip for a screen and its safe area. */
export function computeExtendedOverclockChipRect(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
): UiRect {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const offsets = extendedOverclockChipWidgetOffsets();
    const w = EXTENDED_OVERCLOCK_CHIP_WIDTH * scale;
    const h = EXTENDED_OVERCLOCK_CHIP_HEIGHT * scale;
    return {
        x: safeAreaPx.x + offsets.left * scale,
        y: safeAreaPx.y + safeAreaPx.h - offsets.top * scale - h,
        w,
        h,
    };
}

/** The two fillRects of the amber outline (design units, chip-centred): the outer amber rect and the graphite interior. */
export function extendedOverclockOutlineRects(): { outer: ExtendedOverclockLocalRect; inner: ExtendedOverclockLocalRect } {
    const t = EXTENDED_OVERCLOCK_OUTLINE_THICKNESS;
    return {
        outer: { x: 0, y: 0, w: EXTENDED_OVERCLOCK_CHIP_WIDTH, h: EXTENDED_OVERCLOCK_CHIP_HEIGHT },
        inner: { x: 0, y: 0, w: EXTENDED_OVERCLOCK_CHIP_WIDTH - t * 2, h: EXTENDED_OVERCLOCK_CHIP_HEIGHT - t * 2 },
    };
}
