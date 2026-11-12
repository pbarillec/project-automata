import { CORE_HUD_LAYOUT, UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, UI_MIN_BODY_FONT_SIZE, cardHeight, computeUiLayout, type UiRect } from './UiLayout.ts';
import type { MilestoneAccent, PresentedMilestoneTier } from './MilestoneTier.ts';

/**
 * AUT-046 milestone toast layout (engine-free, design units of the 720x1280 fixed-width design resolution).
 * One single non-interactive band directly below the HUD top bar (so never over the Next Goal row / action Button) and above the
 * Producer Panel; it never claims a touch. Graphite pill, off-white text, an amber or cyan accent; never red.
 */
export const MILESTONE_TOAST_GAP_BELOW_HUD = 8;

export interface MilestoneToastTierLayout {
    readonly width: number;
    readonly height: number;
    /** Title font size / line height (the chip text for Minor). */
    readonly titleFontSize: number;
    readonly titleLineHeight: number;
    readonly titleCenterY: number;
    /** Subtitle (Major only; 0 = none). */
    readonly subtitleFontSize: number;
    readonly subtitleLineHeight: number;
    readonly subtitleCenterY: number;
    /** Accent underline (Major only; 0 = none): height and centre Y, inset by `underlineInset` on each side. */
    readonly underlineHeight: number;
    readonly underlineCenterY: number;
    readonly underlineInset: number;
}

/** Local layout, y measured down from the top of the band (0 = band top, negative = below). */
export const MILESTONE_TOAST_LAYOUT: Readonly<Record<PresentedMilestoneTier, MilestoneToastTierLayout>> = Object.freeze({
    minor: Object.freeze({
        width: 440, height: 44,
        titleFontSize: 24, titleLineHeight: 36, titleCenterY: -22,
        subtitleFontSize: 0, subtitleLineHeight: 0, subtitleCenterY: 0,
        underlineHeight: 3, underlineCenterY: -41, underlineInset: 12,
    }),
    major: Object.freeze({
        width: 620, height: 96,
        titleFontSize: 30, titleLineHeight: 40, titleCenterY: -30,
        subtitleFontSize: 22, subtitleLineHeight: 28, subtitleCenterY: -66,
        underlineHeight: 4, underlineCenterY: -90, underlineInset: 20,
    }),
});

/** Pill / text / accent colours (RGBA). Cyan is dimmer than the producer lamps (82,206,224). */
export const MILESTONE_TOAST_COLORS = Object.freeze({
    pill: Object.freeze({ r: 24, g: 29, b: 32, a: 245 }),
    text: Object.freeze({ r: 238, g: 241, b: 233, a: 255 }),
    subtitle: Object.freeze({ r: 200, g: 206, b: 198, a: 255 }),
    accent: Object.freeze({
        amber: Object.freeze({ r: 240, g: 176, b: 64, a: 255 }),
        cyan: Object.freeze({ r: 88, g: 170, b: 184, a: 255 }),
    }) as Readonly<Record<MilestoneAccent, { readonly r: number; readonly g: number; readonly b: number; readonly a: number }>>,
    /** Title text carries the accent colour (cyan stays dimmer than the producer lamps 82,206,224). */
    titleAccent: Object.freeze({
        amber: Object.freeze({ r: 255, g: 200, b: 96 }),
        cyan: Object.freeze({ r: 120, g: 205, b: 218 }),
    }) as Readonly<Record<MilestoneAccent, { readonly r: number; readonly g: number; readonly b: number }>>,
});

/** Distance (design units) from the top edge of the safe area to the top of the toast band. */
export function milestoneToastTopOffset(): number {
    return UI_EDGE_MARGIN + cardHeight(CORE_HUD_LAYOUT) + MILESTONE_TOAST_GAP_BELOW_HUD;
}

/** Predicted screen rect (pixels, bottom-left origin) of a toast of `tier` for a screen and its safe area. */
export function computeMilestoneToastRect(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
    tier: PresentedMilestoneTier = 'major',
): UiRect {
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const layout = MILESTONE_TOAST_LAYOUT[tier];
    const w = layout.width * scale;
    const h = layout.height * scale;
    const top = safeAreaPx.y + safeAreaPx.h - milestoneToastTopOffset() * scale;
    return { x: safeAreaPx.x + (safeAreaPx.w - w) / 2, y: top - h, w, h };
}

/** True when every toast font is at least the project's minimum body size. */
export function milestoneToastFontsReadable(): boolean {
    return (['minor', 'major'] as const).every((tier) => {
        const layout = MILESTONE_TOAST_LAYOUT[tier];
        return layout.titleFontSize >= UI_MIN_BODY_FONT_SIZE && (layout.subtitleFontSize === 0 || layout.subtitleFontSize >= UI_MIN_BODY_FONT_SIZE);
    });
}

/** The band stays inside the factory band (between the HUD and the panel) for the given screen. */
export function milestoneToastFitsFactoryBand(screenPx: { w: number; h: number }, safeAreaPx?: UiRect): boolean {
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const rect = computeMilestoneToastRect(screenPx, safeAreaPx, 'major');
    return rect.y >= ui.factoryBand.y && rect.y + rect.h <= ui.hud.y;
}
