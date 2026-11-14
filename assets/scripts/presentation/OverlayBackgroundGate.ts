/**
 * AUT-057 pure overlay-vs-absence gate (engine-free, no `cc`).
 *
 * A fullscreen platform overlay (the rewarded ad) pauses and resumes the host activity, which the engine reports as a hide / show pair. That is
 * NOT the player leaving, so it must not suspend the session, stop the boost look, or produce an Offline Factory Report on the way back.
 * `onHide(overlayActive)` is told by the caller whether a PlatformOverlayTracker overlay is active; it remembers an overlay-induced hide in a
 * ONE-SHOT flag so `onShow()` skips the matching resume even if the ad result (and so the overlay end) arrived before the show event.
 * A genuine Home press (no overlay) always suspends / resumes, and a hide without an overlay clears any stale flag.
 */
export type OverlayHideDecision = 'skip' | 'suspend';
export type OverlayShowDecision = 'skip' | 'resume';

export class OverlayBackgroundGate {
    private hideDuringOverlay = false;

    public onHide(overlayActive: boolean): OverlayHideDecision {
        this.hideDuringOverlay = overlayActive === true;
        return this.hideDuringOverlay ? 'skip' : 'suspend';
    }

    public onShow(): OverlayShowDecision {
        if (!this.hideDuringOverlay) return 'resume';
        this.hideDuringOverlay = false;
        return 'skip';
    }

    /** True between an overlay-induced hide and its matching show (diagnostics / tests). */
    public isHideDuringOverlay(): boolean {
        return this.hideDuringOverlay;
    }
}
