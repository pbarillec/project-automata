import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import type { ExtendedOverclockFlowState } from './ExtendedOverclockFlow.ts';
import { EXTENDED_OVERCLOCK_DIMMED_ALPHA } from './ExtendedOverclockLayout.ts';

/**
 * AUT-056 pure view model of the Extended Overclock chip: flow state in, visibility / dimming / strings out. No state, no commands.
 *
 * Visible only when the flow offers it (player eligible AND ad available AND no activation gate: `ExtendedOverclockFlowState.offer`).
 * While the ad is in flight the chip stays visible but dimmed and inert. A calm "No bonus this time." note replaces the small tag line
 * for a moment after a failed / closed / unavailable ad; it never changes visibility by itself (the chip stays while still offerable).
 */
export interface ExtendedOverclockChipViewModel {
    readonly visible: boolean;
    /** False while the ad is in flight (the chip is dimmed and inert) or hidden. */
    readonly interactable: boolean;
    /** 0..255 opacity of the chip colours. */
    readonly alpha: number;
    readonly label: string;
    /** The tag line: "Rewarded Ad", or the calm note while `showNote`. */
    readonly tag: string;
    readonly noteShown: boolean;
}

export function createExtendedOverclockChipViewModel(
    state: ExtendedOverclockFlowState | null,
    showNote: boolean,
    catalogue: TextCatalogue = getDefaultTextCatalogue(),
): ExtendedOverclockChipViewModel {
    const visible = state !== null && state.offer;
    const inFlight = state?.inFlight === true;
    const noteShown = visible && showNote && !inFlight;
    return Object.freeze({
        visible,
        interactable: visible && !inFlight,
        alpha: inFlight ? EXTENDED_OVERCLOCK_DIMMED_ALPHA : 255,
        label: catalogue.resolveText('extended_overclock.button'),
        tag: catalogue.resolveText(noteShown ? 'extended_overclock.not_granted' : 'extended_overclock.tag'),
        noteShown,
    });
}
