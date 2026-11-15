import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import { FOUNDER_SURGE_DURATION_SECONDS, FOUNDER_SURGE_MULTIPLIER, FOUNDER_SURGE_QUANTITY } from '../state/FounderOfferKeys.ts';
import type { FounderShopFlowState, FounderShopNote } from './FounderShopFlow.ts';
import { FOUNDER_DISABLED_ALPHA } from './FounderShopLayout.ts';

/**
 * AUT-059 pure view model of the Founder's Pack chip and modal: flow state in, visibility / enablement / strings out. No state, no commands.
 *
 * Entry visibility: NO entry while the offer is locked (nothing is teased before the First Worker Bot) or the store cannot sell (NoOp / failed
 * provider: release builds without billing); an owned pack always shows its owned state (an owner never sees a store error); a pending
 * purchase keeps the entry. The price text is ONLY the store metadata verbatim; while it is loading or missing the modal shows a neutral
 * line and BUY is disabled (a price is never invented). Contents are the Founder Robot variant and the Factory Surges, nothing else.
 */
export type FounderEntryState = 'available' | 'pending' | 'owned';

export interface FounderChipViewModel {
    readonly visible: boolean;
    readonly state: FounderEntryState;
    readonly label: string;
    readonly tag: string;
    /** 0..255 opacity of the chip colours. */
    readonly alpha: number;
}

export interface FounderModalViewModel {
    readonly state: FounderEntryState;
    readonly title: string;
    /** Exactly the two pack contents: the Founder Robot variant and the Factory Surges. */
    readonly contents: readonly string[];
    readonly priceVisible: boolean;
    readonly priceLabel: string;
    /** The store's localized price verbatim, or a neutral loading / unavailable line. */
    readonly priceText: string;
    /** True only when `priceText` is the store metadata. */
    readonly priceFromStore: boolean;
    readonly buyVisible: boolean;
    readonly buyEnabled: boolean;
    readonly buyLabel: string;
    /** In-progress / pending / owned status, or null. */
    readonly status: string | null;
    /** A calm note about the last attempt (never an error colour), or null. */
    readonly note: string | null;
    readonly close: string;
}

export interface FounderShopViewModel {
    readonly chip: FounderChipViewModel;
    readonly modal: FounderModalViewModel;
}

const NOTE_KEYS: Readonly<Record<FounderShopNote, string>> = Object.freeze({
    cancelled: 'founder.note.cancelled',
    failed: 'founder.note.failed',
    unavailable: 'founder.note.unavailable',
    not_saved: 'founder.note.not_saved',
});

export function resolveFounderEntryState(flow: FounderShopFlowState | null): FounderEntryState | null {
    if (flow === null) return null;
    if (flow.offer === 'owned') return 'owned';
    if (flow.offer !== 'available') return null;
    if (flow.purchase === 'pending') return 'pending';
    return flow.store === 'ready' ? 'available' : null;
}

export function createFounderShopViewModel(flow: FounderShopFlowState | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): FounderShopViewModel {
    const entry = resolveFounderEntryState(flow);
    const state: FounderEntryState = entry ?? 'available';
    const inFlight = flow?.purchase === 'in_flight';
    const price = flow?.price ?? null;
    const loading = flow !== null && (flow.store === 'loading' || flow.store === 'unknown');
    const priceText = price ?? catalogue.resolveText(loading ? 'founder.price.loading' : 'founder.price.unavailable');
    const buyEnabled = entry === 'available' && flow?.store === 'ready' && price !== null && !inFlight;
    const status = entry === 'owned'
        ? catalogue.resolveText('founder.status.owned')
        : entry === 'pending'
            ? catalogue.resolveText('founder.status.pending')
            : inFlight ? catalogue.resolveText('founder.status.in_progress') : null;
    return Object.freeze({
        chip: Object.freeze({
            visible: entry !== null,
            state,
            label: catalogue.resolveText('founder.chip'),
            tag: catalogue.resolveText(`founder.chip.tag.${state}`),
            alpha: 255,
        }),
        modal: Object.freeze({
            state,
            title: catalogue.resolveText('founder.title'),
            contents: Object.freeze([
                catalogue.resolveText('founder.content.robot'),
                catalogue.resolveText('founder.content.surges', { count: FOUNDER_SURGE_QUANTITY, multiplier: FOUNDER_SURGE_MULTIPLIER, minutes: FOUNDER_SURGE_DURATION_SECONDS / 60 }),
            ]),
            priceVisible: entry !== 'owned',
            priceLabel: catalogue.resolveText('founder.price_label'),
            priceText,
            priceFromStore: price !== null,
            buyVisible: entry === 'available' || entry === 'pending',
            buyEnabled,
            buyLabel: catalogue.resolveText(price !== null ? 'founder.buy.with_price' : 'founder.buy', price !== null ? { price } : undefined),
            status,
            note: flow?.note ? catalogue.resolveText(NOTE_KEYS[flow.note]) : null,
            close: catalogue.resolveText('founder.close'),
        }),
    });
}

/** Opacity of the BUY button colours: dimmed while it cannot be pressed. */
export function founderBuyAlpha(viewModel: FounderModalViewModel): number {
    return viewModel.buyEnabled ? 255 : FOUNDER_DISABLED_ALPHA;
}
