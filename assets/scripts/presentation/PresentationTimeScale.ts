/**
 * AUT-047 shared presentation-only time scale. The simulation never reads it: only world presentation loops (belt / arm / panel clocks,
 * Worker Bot route and clip speed, pooled robots) multiply their own `deltaSeconds` and clip speed by it. 1 = baseline.
 * Engine-free (no `cc`); written by `BoostPresentationController`, read by the animated work-loop controllers.
 */
export const PRESENTATION_TIME_SCALE_MIN = 1;
/** Art Direction section 22.1: machine / conveyor animation appears ~1.25-1.4x faster; never above 1.4. */
export const PRESENTATION_TIME_SCALE_MAX = 1.4;

let currentScale = PRESENTATION_TIME_SCALE_MIN;

export function getPresentationTimeScale(): number {
    return currentScale;
}

export function setPresentationTimeScale(value: number): void {
    currentScale = Number.isFinite(value) ? Math.min(PRESENTATION_TIME_SCALE_MAX, Math.max(PRESENTATION_TIME_SCALE_MIN, value)) : PRESENTATION_TIME_SCALE_MIN;
}

export function resetPresentationTimeScale(): void {
    currentScale = PRESENTATION_TIME_SCALE_MIN;
}
