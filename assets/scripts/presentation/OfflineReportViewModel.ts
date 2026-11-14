import type { LifecycleCollectResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import type { OfflinePreviewResult } from '../offline/index.ts';

/**
 * AUT-051 pure view model of the Offline Factory Report card (engine-free, no `cc`).
 * It only maps the authoritative offline preview (AUT-027 / AUT-028) to display fields; it never recomputes the
 * economy, never mutates state and owns no persisted flag.
 */

/**
 * D2 (pending owner decision): whether the educational "Automated producers kept working. Not automated: ..." line may appear.
 * One boolean, one place: flip this constant (or pass `showEducationalLine`) to change the policy. It is NOT persisted.
 */
export const OFFLINE_REPORT_SHOW_EDUCATIONAL_LINE = true;

/** At most this many producer names are listed in the educational line; the rest become "and N more". */
export const OFFLINE_REPORT_MAX_NAMED_PRODUCERS = 2;

/**
 * AUT-051b MVP rule (owner decision): an absence shorter than this many seconds (raw, measured BEFORE the offline cap) produces no
 * report card; the pending preview is auto-collected silently (the reward is still applied, no ad offer). Boundary: >= 60 s shows
 * the card. Presentation-only gate: offline formulas, economy and the save format are untouched. (Unrelated to the rewarded x2
 * eligibility `minimumOfflineMinutes` in MONETIZATION.md.)
 */
export const OFFLINE_REPORT_MIN_ABSENCE_SECONDS = 60;

export interface OfflineReportViewModel {
    /** True only for a collectible preview (`preview_ready`) that is worth a card (>= the minimum absence and a positive reward). */
    readonly visible: boolean;
    /** A collectible preview that must NOT show a card: the presentation auto-collects it silently (never "+0", never a sub-minute card). */
    readonly autoCollect: boolean;
    readonly effectiveSeconds: number;
    readonly rawSeconds: number;
    readonly capApplied: boolean;
    readonly capSeconds: number;
    readonly reward: number;
    readonly robotsDelta: number;
    /** The "+N Robots Built" row exists only when robots were built (omitted, never blank). */
    readonly showRobotsRow: boolean;
    /** Built producers that were not automated, in config order. */
    readonly notAutomatedProducerIds: readonly string[];
    /** The educational line is shown (policy allows it and at least one built producer is not automated). */
    readonly explainShown: boolean;
}

export interface OfflineReportViewModelOptions {
    readonly showEducationalLine?: boolean;
}

export const HIDDEN_OFFLINE_REPORT_VIEW_MODEL: OfflineReportViewModel = Object.freeze({
    visible: false,
    autoCollect: false,
    effectiveSeconds: 0,
    rawSeconds: 0,
    capApplied: false,
    capSeconds: 0,
    reward: 0,
    robotsDelta: 0,
    showRobotsRow: false,
    notAutomatedProducerIds: Object.freeze([]) as readonly string[],
    explainShown: false,
});

export function createOfflineReportViewModel(
    preview: OfflinePreviewResult | null | undefined,
    options: OfflineReportViewModelOptions = {},
): OfflineReportViewModel {
    if (!preview || preview.status !== 'preview_ready') return HIDDEN_OFFLINE_REPORT_VIEW_MODEL;
    const allowExplain = options.showEducationalLine ?? OFFLINE_REPORT_SHOW_EDUCATIONAL_LINE;
    const notAutomatedProducerIds = Object.freeze(
        preview.producerContributions.filter((contribution) => contribution.reason === 'not_automated').map((contribution) => contribution.producerId),
    );
    const rawSeconds = preview.rawAbsenceSeconds ?? preview.effectiveOfflineSeconds;
    const rewardPositive = Number.isFinite(preview.totalIndustrialOutputReward) && preview.totalIndustrialOutputReward > 0;
    const worthACard = rawSeconds >= OFFLINE_REPORT_MIN_ABSENCE_SECONDS && rewardPositive;
    const robotsDelta = Number.isFinite(preview.robotsBuiltDelta) && preview.robotsBuiltDelta > 0 ? Math.floor(preview.robotsBuiltDelta) : 0;
    return Object.freeze({
        visible: worthACard,
        autoCollect: !worthACard,
        effectiveSeconds: preview.effectiveOfflineSeconds,
        rawSeconds,
        capApplied: preview.capApplied,
        capSeconds: preview.capSeconds,
        reward: preview.totalIndustrialOutputReward,
        robotsDelta,
        showRobotsRow: robotsDelta > 0,
        notAutomatedProducerIds,
        explainShown: allowExplain && notAutomatedProducerIds.length > 0,
    });
}

/** What the card does with the session's collect result. */
export type OfflineCollectOutcome =
    /** Durable collection (reward or no-reward): close the card. */
    | 'close'
    /** Applied in memory but not durably saved: close the card, report the status (DEBUG event); never claim durability. */
    | 'close_unsaved'
    /** Nothing was applied: keep the card, Collect stays available, show the retry line. */
    | 'keep_retry'
    /** The session had no pending preview (already collected / stale card): close the card. */
    | 'close_stale';

export function resolveOfflineCollectOutcome(result: LifecycleCollectResult | null): OfflineCollectOutcome {
    if (result === null) return 'keep_retry';
    switch (result.status) {
        case 'collected_saved':
        case 'no_reward_saved':
            return 'close';
        case 'collected_persistence_failed':
        case 'no_reward_persistence_failed':
            return 'close_unsaved';
        case 'no_pending_preview':
            return 'close_stale';
        case 'collect_failed':
        default:
            return 'keep_retry';
    }
}
