import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import type { DisplayNameSource } from './PresentationText.ts';
import type { MilestoneTrigger } from './MilestoneTier.ts';
import { eraTransitionSpec } from './EraTransition.ts';

/**
 * English toast templates. They live here rather than in localization/en.json on purpose: the AUT-LOC-001 tests pin the shared
 * catalogue to the HUD / panel composition (no dead keys, exact params). Producer and breakthrough NAMES still come from the
 * catalogue through the config display-name keys. Moving these to the catalogue is a localization follow-up (AUT-052).
 */
export const MILESTONE_TEXT_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
    producer_milestone: '{name} Lv {level}',
    automation: '{name} automated',
    producer_constructed: '{name} built',
    breakthrough_subtitle: 'Breakthrough unlocked',
    breakthrough_generic: 'New breakthrough',
    robots_built_title: 'Robots built: {count}',
    robots_built_subtitle: 'Robot output milestone',
    producer_generic: 'Producer',
    extra: '{text} +{count}',
});

function fill(key: string, params: Readonly<Record<string, string | number>> = {}): string {
    return MILESTONE_TEXT_TEMPLATES[key].replace(/\{(\w+)\}/g,(placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}

export interface MilestoneToastText {
    /** Chip text (Minor) or title (Major). Never the x multiplier as the headline. */
    readonly title: string;
    /** Major subtitle; null = title only (Minor, producerConstructed). */
    readonly subtitle: string | null;
}

/** Pure toast wording from a trigger through the text catalogue (names via the config display-name keys). */
export function formatMilestoneToast(
    trigger: MilestoneTrigger,
    names: DisplayNameSource | null,
    extra = 0,
    catalogue: TextCatalogue = getDefaultTextCatalogue(),
): MilestoneToastText {
    const text = compose(trigger, names, catalogue);
    const title = extra > 0 ? fill('extra', { text: text.title, count: extra }) : text.title;
    return { title, subtitle: text.subtitle };
}

function compose(trigger: MilestoneTrigger, names: DisplayNameSource | null, catalogue: TextCatalogue): MilestoneToastText {
    switch (trigger.kind) {
        case 'producer_milestone':
            return { title: fill('producer_milestone', { name: producerName(trigger.producerId, names, catalogue), level: trigger.threshold ?? 0 }), subtitle: null };
        case 'automation':
            return { title: fill('automation', { name: producerName(trigger.producerId, names, catalogue) }), subtitle: null };
        case 'producer_constructed':
            return { title: fill('producer_constructed', { name: producerName(trigger.producerId, names, catalogue) }), subtitle: null };
        case 'breakthrough': {
            const key = trigger.breakthroughId !== null ? names?.getBreakthrough(trigger.breakthroughId)?.displayNameKey ?? null : null;
            const title = key !== null && catalogue.has(key) ? catalogue.resolveText(key) : fill('breakthrough_generic');
            return { title, subtitle: fill('breakthrough_subtitle') };
        }
        case 'era_title':
            // AUT-048: one all-caps line from the era table (English until the AUT-052 catalogue move), never a subtitle.
            return { title: eraTransitionSpec(trigger.eraId)?.title ?? fill('breakthrough_generic'), subtitle: null };
        case 'robots_built':
            return { title: fill('robots_built_title', { count: trigger.threshold ?? 0 }), subtitle: fill('robots_built_subtitle') };
        default:
            return { title: fill('breakthrough_generic'), subtitle: null };
    }
}

function producerName(producerId: string | null, names: DisplayNameSource | null, catalogue: TextCatalogue): string {
    const key = producerId !== null ? names?.getProducer(producerId)?.displayNameKey ?? null : null;
    return key !== null && catalogue.has(key) ? catalogue.resolveText(key) : fill('producer_generic');
}
