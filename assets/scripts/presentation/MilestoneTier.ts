import type { DomainEvent } from '../domain/Events.ts';
import { isFirstAutomationEvidence } from './AutomationPayoffViewModel.ts';

/**
 * AUT-046 pure importance tiers: ONE reusable pipeline (DomainEvent -> tier -> toast + pulse/spark + optional focus).
 * There is no per-milestone cinematic: every milestone is one row of the data tables below.
 *
 * - `none`: never presented (economy ticks, purchases, boosts, balances, flags ...).
 * - `minor`: small chip toast + short light pulse, never a camera focus, never a title.
 * - `major`: title (+ subtitle) toast, sparks + ~1 s light pulse, camera focus allowed.
 * - `exceptional`: owned by an existing controller (first automation / first robot / era change / Reboot). This module only
 *   classifies it; it never presents it (AUT-048 / AUT-049 own the era / Reboot presentation).
 */
export type MilestoneTier = 'none' | 'minor' | 'major' | 'exceptional';
export type PresentedMilestoneTier = 'minor' | 'major';
export type MilestoneAccent = 'amber' | 'cyan';
export type MilestoneKind = 'producer_milestone' | 'automation' | 'breakthrough' | 'robots_built' | 'producer_constructed';

/** Tier of every DomainEvent type (the tests pin that this table covers exactly the `DomainEvent` union). */
export const MILESTONE_EVENT_TIERS: Readonly<Record<DomainEvent['type'], MilestoneTier>> = Object.freeze({
    industrialOutputChanged: 'none',
    productionGranted: 'none',
    temporaryBoostActivated: 'none',
    temporaryBoostExpired: 'none',
    temporaryBoostSuspended: 'none',
    temporaryBoostResumed: 'none',
    assistedBatchLaunched: 'none',
    assistedBatchCompleted: 'none',
    producerLevelsPurchased: 'none',
    producerConstructed: 'major',
    producerMilestoneReached: 'minor',
    breakthroughPurchased: 'major',
    // Minor for a non-first automation; the first automation is exceptional, a de-automation is none (see classify).
    automationStateChanged: 'minor',
    eraChanged: 'exceptional',
    progressionFlagChanged: 'none',
    firstRobotProduced: 'exceptional',
    robotsBuiltThresholdReached: 'major',
    aiCoresGranted: 'none',
    aiCoreBalanceChanged: 'none',
    permanentUpgradePurchased: 'none',
    civilizationChanged: 'none',
    rebootCompleted: 'exceptional',
});

/**
 * Tier per Robots Built threshold. Which thresholds are "important" is undecided: all are Major for now; downgrade a
 * threshold by editing its single entry here (`'minor'` or `'none'`).
 */
export const ROBOTS_BUILT_THRESHOLD_TIERS: Readonly<Record<number, MilestoneTier>> = Object.freeze({
    1: 'major',
    10: 'major',
    100: 'major',
    1000: 'major',
});

/** Producer whose focus anchor a Major breakthrough may bring into view (data, one entry per breakthrough). */
export const BREAKTHROUGH_FOCUS_PRODUCER: Readonly<Record<string, string>> = Object.freeze({
    auto_feeder: 'fabricator',
    worker_bot: 'assembly_station',
    robotic_logistics: 'assembly_station',
    factory_control_system: 'robot_line',
    automated_cell_architecture: 'automated_cell',
    advanced_robotics: 'advanced_robotics_complex',
});

/** Producer the Robots Built milestones belong to (focus / pulse target). */
export const ROBOTS_BUILT_FOCUS_PRODUCER = 'robot_line';

export interface MilestoneTrigger {
    /** Stable fact key, the dedupe identity (`m:` milestone, `a:` automation, `b:` breakthrough, `c:` constructed, `r:` robots built). */
    readonly key: string;
    readonly tier: PresentedMilestoneTier;
    readonly kind: MilestoneKind;
    readonly accent: MilestoneAccent;
    /** Producer the toast text and the pulse refer to (null when there is none). */
    readonly producerId: string | null;
    readonly breakthroughId: string | null;
    readonly milestoneId: string | null;
    readonly threshold: number | null;
    /** Producer whose focus anchor a camera focus may target (Major only; null = never focus). */
    readonly focusProducerId: string | null;
    /** Sparks from the AUT-040 pool (Major only). */
    readonly sparks: boolean;
    /** Light pulse on the producer. */
    readonly pulse: boolean;
    /** Set by the view model when an Exceptional event shares the burst: the toast shows, the focus is skipped. */
    readonly focusSuppressed: boolean;
}

export interface MilestoneClassification {
    readonly tier: MilestoneTier;
    readonly trigger: MilestoneTrigger | null;
}

const NO_TRIGGER: MilestoneClassification = Object.freeze({ tier: 'none', trigger: null });

export function classifyMilestoneEvent(event: DomainEvent): MilestoneClassification {
    let tier: MilestoneTier = MILESTONE_EVENT_TIERS[event.type] ?? 'none';
    if (event.type === 'automationStateChanged') {
        if (!event.isAutomated) tier = 'none';
        else if (isFirstAutomationEvidence(event)) tier = 'exceptional';
    } else if (event.type === 'robotsBuiltThresholdReached') {
        tier = ROBOTS_BUILT_THRESHOLD_TIERS[event.threshold] ?? MILESTONE_EVENT_TIERS.robotsBuiltThresholdReached;
    }
    if (tier === 'none') return NO_TRIGGER;
    if (tier === 'exceptional') return Object.freeze({ tier, trigger: null });
    return Object.freeze({ tier, trigger: buildTrigger(event, tier) });
}

function buildTrigger(event: DomainEvent, tier: PresentedMilestoneTier): MilestoneTrigger | null {
    switch (event.type) {
        case 'producerMilestoneReached':
            return trigger({ key: `m:${event.producerId}:${event.milestoneId}`, tier, kind: 'producer_milestone', accent: 'amber', producerId: event.producerId, milestoneId: event.milestoneId, threshold: event.threshold, pulse: true });
        case 'automationStateChanged':
            return trigger({ key: `a:${event.producerId}`, tier, kind: 'automation', accent: 'cyan', producerId: event.producerId, pulse: true });
        case 'breakthroughPurchased': {
            const producerId = BREAKTHROUGH_FOCUS_PRODUCER[event.breakthroughId] ?? null;
            return trigger({ key: `b:${event.breakthroughId}`, tier, kind: 'breakthrough', accent: 'amber', producerId, breakthroughId: event.breakthroughId, focusProducerId: producerId, sparks: true, pulse: true });
        }
        case 'robotsBuiltThresholdReached':
            return trigger({ key: `r:${event.threshold}`, tier, kind: 'robots_built', accent: 'cyan', producerId: ROBOTS_BUILT_FOCUS_PRODUCER, threshold: event.threshold, focusProducerId: ROBOTS_BUILT_FOCUS_PRODUCER, sparks: true, pulse: true });
        case 'producerConstructed':
            // Toast title only: AUT-040 owns the build reveal (no second spark, pulse or focus).
            return trigger({ key: `c:${event.producerId}`, tier, kind: 'producer_constructed', accent: 'amber', producerId: event.producerId });
        default:
            return null;
    }
}

/** Builds a trigger from the state-derived facts (breakthrough / automation / constructed) a later snapshot discovers. */
export function buildFactTrigger(kind: 'breakthrough' | 'automation' | 'producer_constructed', id: string): MilestoneTrigger | null {
    if (kind === 'breakthrough') return buildTrigger({ type: 'breakthroughPurchased', breakthroughId: id, cost: 0 }, 'major');
    if (kind === 'automation') return buildTrigger({ type: 'automationStateChanged', producerId: id, isAutomated: true, isOfflineEligible: false, unlockedByBreakthroughId: null }, 'minor');
    return buildTrigger({ type: 'producerConstructed', producerId: id, level: 1, source: 'producer_purchase' }, 'major');
}

interface TriggerFields {
    key: string;
    tier: PresentedMilestoneTier;
    kind: MilestoneKind;
    accent: MilestoneAccent;
    producerId?: string | null;
    breakthroughId?: string | null;
    milestoneId?: string | null;
    threshold?: number | null;
    focusProducerId?: string | null;
    sparks?: boolean;
    pulse?: boolean;
}

function trigger(fields: TriggerFields): MilestoneTrigger {
    return Object.freeze({
        key: fields.key,
        tier: fields.tier,
        kind: fields.kind,
        accent: fields.accent,
        producerId: fields.producerId ?? null,
        breakthroughId: fields.breakthroughId ?? null,
        milestoneId: fields.milestoneId ?? null,
        threshold: fields.threshold ?? null,
        focusProducerId: fields.tier === 'major' ? (fields.focusProducerId ?? null) : null,
        sparks: fields.tier === 'major' && fields.sparks === true,
        pulse: fields.pulse === true,
        focusSuppressed: false,
    });
}
