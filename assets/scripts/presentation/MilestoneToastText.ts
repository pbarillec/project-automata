import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import type { DisplayNameSource } from './PresentationText.ts';
import type { MilestoneTrigger } from './MilestoneTier.ts';
import { eraTransitionSpec } from './EraTransition.ts';
import type { RebootBeat } from './RebootPresentation.ts';

/** Toast wording lives in the shared catalogue (`toast.*` keys, AUT-052); producer and breakthrough NAMES come from the config display-name keys. */
function fill(catalogue: TextCatalogue, key: string, params: Readonly<Record<string, string | number>> = {}): string {
    return catalogue.resolveText(`toast.${key}`, params);
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
    beat: RebootBeat | null = null,
): MilestoneToastText {
    // AUT-049: the Reboot card shows one title per beat (REBOOT, AI CORE x N, CIVILIZATION #N); no "+N", no subtitle.
    if (trigger.kind === 'reboot_title') return { title: formatRebootBeat(trigger, beat ?? 'reboot', catalogue), subtitle: null };
    const text = compose(trigger, names, catalogue);
    const title = extra > 0 ? fill(catalogue, 'extra', { text: text.title, count: extra }) : text.title;
    return { title, subtitle: text.subtitle };
}

/** Title of one beat of the Reboot card ("AI CORE ×N" uses the AI Cores granted, "CIVILIZATION #N" the new civilization). */
export function formatRebootBeat(trigger: MilestoneTrigger, beat: RebootBeat, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    if (beat === 'ai_core') return fill(catalogue, 'reboot_ai_core', { count: trigger.reboot?.aiCoresGranted ?? 0 });
    if (beat === 'civilization') return fill(catalogue, 'reboot_civilization', { number: trigger.reboot?.newCivilization ?? 0 });
    return fill(catalogue, 'reboot_title');
}

function compose(trigger: MilestoneTrigger, names: DisplayNameSource | null, catalogue: TextCatalogue): MilestoneToastText {
    switch (trigger.kind) {
        case 'producer_milestone':
            return { title: fill(catalogue, 'producer_milestone', { name: producerName(trigger.producerId, names, catalogue), level: trigger.threshold ?? 0 }), subtitle: null };
        case 'automation':
            return { title: fill(catalogue, 'automation', { name: producerName(trigger.producerId, names, catalogue) }), subtitle: null };
        case 'producer_constructed':
            return { title: fill(catalogue, 'producer_constructed', { name: producerName(trigger.producerId, names, catalogue) }), subtitle: null };
        case 'breakthrough': {
            const key = trigger.breakthroughId !== null ? names?.getBreakthrough(trigger.breakthroughId)?.displayNameKey ?? null : null;
            const title = key !== null && catalogue.has(key) ? catalogue.resolveText(key) : fill(catalogue, 'breakthrough_generic');
            return { title, subtitle: fill(catalogue, 'breakthrough_subtitle') };
        }
        case 'era_title':
            // AUT-048: one all-caps line (catalogue key from the era table), never a subtitle.
            return { title: eraTitle(trigger.eraId, catalogue), subtitle: null };
        case 'robots_built':
            return { title: fill(catalogue, 'robots_built_title', { count: trigger.threshold ?? 0 }), subtitle: fill(catalogue, 'robots_built_subtitle') };
        default:
            return { title: fill(catalogue, 'breakthrough_generic'), subtitle: null };
    }
}

function eraTitle(eraId: string | null, catalogue: TextCatalogue): string {
    const key = eraTransitionSpec(eraId)?.titleKey ?? null;
    return key !== null && catalogue.has(key) ? catalogue.resolveText(key) : fill(catalogue, 'breakthrough_generic');
}

function producerName(producerId: string | null, names: DisplayNameSource | null, catalogue: TextCatalogue): string {
    const key = producerId !== null ? names?.getProducer(producerId)?.displayNameKey ?? null : null;
    return key !== null && catalogue.has(key) ? catalogue.resolveText(key) : fill(catalogue, 'producer_generic');
}
