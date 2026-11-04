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

export const SELECTION_DEBUG_LOG = true; // TEMP AUT-038 human-gate diagnostic: remove with the AUT-038 harness

/** TEMP AUT-038 human-gate diagnostic line (one per selection touch end); remove with the AUT-038 harness. */
export function formatSelectionDebugLine(i: { moved: number; slop: number; tap: boolean; hit: string | null; x: number; y: number; dpr: number; shortSide: number }): string {
    return `[AUT-038-HG] SELECT moved=${i.moved.toFixed(1)} slop=${i.slop.toFixed(1)} tap=${i.tap} hit=${i.hit ?? 'none'} x=${Math.round(i.x)} y=${Math.round(i.y)} dpr=${i.dpr} short=${Math.round(i.shortSide)}`;
}
