import { CORE_HUD_LAYOUT, UI_DESIGN_RESOLUTION, UI_EDGE_MARGIN, UI_MIN_BODY_FONT_SIZE, cardHeight, computeUiLayout, type UiRect } from './UiLayout.ts';
import type { MilestoneAccent, PresentedMilestoneTier } from './MilestoneTier.ts';
import { FOUNDER_CHIP_HEIGHT, founderChipWidgetOffsets } from './FounderShopLayout.ts';
import { EXTENDED_OVERCLOCK_CHIP_HEIGHT, extendedOverclockChipWidgetOffsets } from './ExtendedOverclockLayout.ts';

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
    // AUT-048 era title card: larger than Major, ONE all-caps line, no subtitle.
    exceptional: Object.freeze({
        width: 680, height: 112,
        titleFontSize: 32, titleLineHeight: 44, titleCenterY: -52,
        subtitleFontSize: 0, subtitleLineHeight: 0, subtitleCenterY: 0,
        underlineHeight: 5, underlineCenterY: -100, underlineInset: 28,
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
    /**
     * AUT-048 era title underline: amber, or the AUT-045 environment cyan (59,112,121; never brighter than the lamps 82,206,224).
     * The era title text stays off-white (`text`) so the cyan never exceeds the lamps.
     */
    eraUnderline: Object.freeze({
        amber: Object.freeze({ r: 240, g: 176, b: 64, a: 255 }),
        cyan: Object.freeze({ r: 59, g: 112, b: 121, a: 255 }),
    }) as Readonly<Record<MilestoneAccent, { readonly r: number; readonly g: number; readonly b: number; readonly a: number }>>,
    /** AUT-049 Reboot card underline: the same AUT-045 environment cyan as the Era III card (never brighter than the lamps); the title stays off-white. */
    rebootUnderline: Object.freeze({ r: 59, g: 112, b: 121, a: 255 }),
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

/**
 * AUT-066 round 3: the Major and Exceptional bands are wide (620 / 680 of 720 units) and used to run under / over the Settings, Extended Overclock, AI,
 * Reboot and Founder chips (the toast icon landed on the SET chip and the underline struck through the Extended Overclock text). They now start BELOW the
 * lowest chip (Founder third line on the right, Extended Overclock second line on the left). The Minor band (440 wide, 44 tall) already sits clear of the
 * left chips on the first line and keeps the original top.
 */
export const MILESTONE_TOAST_GAP_BELOW_CHIPS = 8;

export function milestoneToastTopOffsetFor(tier: PresentedMilestoneTier): number {
    if (tier === 'minor') return milestoneToastTopOffset();
    const chipsBottom = Math.max(founderChipWidgetOffsets().top + FOUNDER_CHIP_HEIGHT, extendedOverclockChipWidgetOffsets().top + EXTENDED_OVERCLOCK_CHIP_HEIGHT);
    return chipsBottom + MILESTONE_TOAST_GAP_BELOW_CHIPS;
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
    const top = safeAreaPx.y + safeAreaPx.h - milestoneToastTopOffsetFor(tier) * scale;
    return { x: safeAreaPx.x + (safeAreaPx.w - w) / 2, y: top - h, w, h };
}

/** True when every toast font is at least the project's minimum body size. */
export function milestoneToastFontsReadable(): boolean {
    return (['minor', 'major', 'exceptional'] as const).every((tier) => {
        const layout = MILESTONE_TOAST_LAYOUT[tier];
        return layout.titleFontSize >= UI_MIN_BODY_FONT_SIZE && (layout.subtitleFontSize === 0 || layout.subtitleFontSize >= UI_MIN_BODY_FONT_SIZE);
    });
}

/** The band stays inside the factory band (between the HUD and the panel) for the given screen. */
export function milestoneToastFitsFactoryBand(screenPx: { w: number; h: number }, safeAreaPx?: UiRect, tier: PresentedMilestoneTier = 'major'): boolean {
    const ui = computeUiLayout(screenPx, safeAreaPx);
    const rect = computeMilestoneToastRect(screenPx, safeAreaPx, tier);
    return rect.y >= ui.factoryBand.y && rect.y + rect.h <= ui.hud.y;
}
