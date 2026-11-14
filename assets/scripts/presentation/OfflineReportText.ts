import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import { formatCompactNumber } from './NumberFormatter.ts';
import { OFFLINE_REPORT_MAX_NAMED_PRODUCERS, type OfflineReportViewModel } from './OfflineReportViewModel.ts';
import type { DisplayNameSource } from './PresentationText.ts';

/**
 * AUT-051 pure text composition of the Offline Factory Report card (engine-free). Every player-facing string comes from the
 * keyed catalogue (`offline.*`, producer names via `displayNameKey`); the controller only displays what this returns.
 */

export interface OfflineReportTexts {
    readonly title: string;
    readonly timeAway: string;
    /** Null unless the offline cap was applied. */
    readonly capReached: string | null;
    readonly reward: string;
    /** Null unless robots were built (the row is omitted). */
    readonly robots: string | null;
    /** Null unless the educational line is shown. */
    readonly explain: string | null;
    readonly collect: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
/** Symbols, not English: compact duration units. */
const SHORT_DURATION_TEXT = '<1m';

/** "3h 20m", "3h", "45m", "<1m". Floors to whole minutes; non-finite or negative values read "<1m". */
export function formatOfflineDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < SECONDS_PER_MINUTE) return SHORT_DURATION_TEXT;
    const totalMinutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const minutes = totalMinutes % MINUTES_PER_HOUR;
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Display names of the not-automated producers (unresolvable ids are dropped; never a raw key or id). */
export function resolveOfflineProducerNames(ids: readonly string[], names: DisplayNameSource | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): string[] {
    if (names === null) return [];
    const out: string[] = [];
    for (const id of ids) {
        const key = names.getProducer(id)?.displayNameKey;
        if (typeof key === 'string' && catalogue.has(key)) out.push(catalogue.resolveText(key));
    }
    return out;
}

export function formatOfflineExplainLine(ids: readonly string[], names: DisplayNameSource | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): string | null {
    const resolved = resolveOfflineProducerNames(ids, names, catalogue);
    if (resolved.length === 0) return null;
    const shown = resolved.slice(0, OFFLINE_REPORT_MAX_NAMED_PRODUCERS).join(', ');
    const extra = resolved.length - OFFLINE_REPORT_MAX_NAMED_PRODUCERS;
    const list = extra > 0 ? catalogue.resolveText('offline.explain.more', { names: shown, count: extra }) : shown;
    return catalogue.resolveText('offline.explain.manual', { names: list });
}

export function formatOfflineReportTexts(viewModel: OfflineReportViewModel, names: DisplayNameSource | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): OfflineReportTexts {
    const explain = viewModel.explainShown ? formatOfflineExplainLine(viewModel.notAutomatedProducerIds, names, catalogue) : null;
    return Object.freeze({
        title: catalogue.resolveText('offline.title'),
        timeAway: catalogue.resolveText('offline.time_away', { duration: formatOfflineDuration(viewModel.effectiveSeconds) }),
        capReached: viewModel.capApplied ? catalogue.resolveText('offline.cap_reached', { duration: formatOfflineDuration(viewModel.capSeconds) }) : null,
        reward: catalogue.resolveText('offline.reward', { value: formatCompactNumber(viewModel.reward) }),
        robots: !viewModel.showRobotsRow ? null : viewModel.robotsDelta === 1 ? catalogue.resolveText('offline.robot_single') : catalogue.resolveText('offline.robots', { count: formatCompactNumber(viewModel.robotsDelta) }),
        explain,
        collect: catalogue.resolveText('offline.collect'),
    });
}

/** Secondary line shown after a failed collect (the card stays and Collect remains available). */
export function formatOfflineCollectFailed(catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    return catalogue.resolveText('offline.collect_failed');
}
