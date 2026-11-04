/**
 * Tap slop for producer selection (AUT-R-035-04).
 *
 * Touch locations arrive in physical pixels, and on Android `screen.devicePixelRatio`
 * is hard-coded to 1, so a fixed or DPR-scaled pixel threshold collapses to a few dp on
 * high-resolution phones and normal finger jitter turns every tap into a micro-drag.
 * The slop therefore has a screen-relative floor: 3% of the short side (about 38 px,
 * roughly 12 dp, on a 1272 px short side; Android's own touch slop is 8 dp).
 * Engine-free so it can be unit-tested under Node.
 */
export const SELECTION_TAP_SLOP_SHORT_SIDE_RATIO = 0.03;

const DEFAULT_BASE_SLOP_PIXELS = 12;

export function selectionTapSlopPixels(basePx: number, devicePixelRatio: number, shortSidePx: number): number {
    const base = Number.isFinite(basePx) ? basePx : DEFAULT_BASE_SLOP_PIXELS;
    const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
    const shortSide = Number.isFinite(shortSidePx) ? shortSidePx : 0;
    return Math.max(base * Math.max(1, dpr), SELECTION_TAP_SLOP_SHORT_SIDE_RATIO * Math.max(0, shortSide));
}
