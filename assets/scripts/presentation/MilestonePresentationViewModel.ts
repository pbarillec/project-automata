import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { isFirstAutomationEvidence } from './AutomationPayoffViewModel.ts';
import { buildEraTrigger, eraTransitionSpec } from './EraTransition.ts';
import { buildFactTrigger, classifyMilestoneEvent, type MilestoneTrigger } from './MilestoneTier.ts';
import { MilestoneToastQueue, type MilestoneEnqueueOutcome, type MilestoneToastFrame, type MilestoneToastItem, type MilestoneToastTick } from './MilestoneToastQueue.ts';

export interface MilestoneSkip {
    readonly key: string;
    readonly reason: 'duplicate' | 'subsumed';
}

export interface MilestoneUpdate {
    /** Triggers accepted after dedupe (before the queue's own drop / merge / collapse rules). */
    readonly accepted: readonly MilestoneTrigger[];
    /** Event types classified Exceptional in this batch (routed to their owners, never presented here). */
    readonly exceptional: readonly string[];
    readonly skipped: readonly MilestoneSkip[];
    /** What the queue did with the accepted triggers (null when none was accepted). */
    readonly outcome: MilestoneEnqueueOutcome | null;
    /** Reboot: the toast timeline was cleared and the fact baseline rebuilt from the new state. */
    readonly rebooted: boolean;
    /** AUT-048: the era title card scheduled by this call (shown after its card delay), null when none. */
    readonly eraScheduled: MilestoneTrigger | null;
    /** AUT-048: a pending or visible era title card was cancelled (Reboot). */
    readonly eraCancelled: boolean;
}

/** Tick result: the toast queue tick plus the era card offer made when its delay elapsed (its start is already merged into `started`). */
export interface MilestoneViewTick extends MilestoneToastTick {
    readonly eraOffer: MilestoneEnqueueOutcome | null;
}

interface PendingEra {
    readonly trigger: MilestoneTrigger;
    /** Seconds since the transition was observed (t0). */
    elapsed: number;
}

const NO_ITEMS: readonly MilestoneToastItem[] = Object.freeze([]);

const EMPTY_UPDATE: MilestoneUpdate = Object.freeze({ accepted: [], exceptional: [], skipped: [], outcome: null, rebooted: false, eraScheduled: null, eraCancelled: false });

/** Facts a snapshot can prove: breakthrough owned, producer built, producer automated, current era (AUT-048 title card). */
function stateFacts(state: GameState): Map<string, MilestoneTrigger | null> {
    const facts = new Map<string, MilestoneTrigger | null>();
    for (const breakthroughId of state.run.purchasedBreakthroughIds) facts.set(`b:${breakthroughId}`, buildFactTrigger('breakthrough', breakthroughId));
    for (const [producerId, producer] of Object.entries(state.run.producers)) {
        if (producer.isBuilt === true && producer.level > 0) facts.set(`c:${producerId}`, buildFactTrigger('producer_constructed', producerId));
    }
    for (const [producerId, automation] of Object.entries(state.run.automation)) {
        if (automation.isAutomated !== true) continue;
        // The first automation is Exceptional (FirstAutomationPresentationController): remembered, never presented here.
        const first = isFirstAutomationEvidence({ type: 'automationStateChanged', producerId, isAutomated: true, isOfflineEligible: automation.isOfflineEligible === true, unlockedByBreakthroughId: automation.unlockedByBreakthroughId ?? null });
        facts.set(`a:${producerId}`, first ? null : buildFactTrigger('automation', producerId));
    }
    const era = buildEraTrigger(state.run.currentEraId);
    if (era) facts.set(era.key, era);
    return facts;
}

/**
 * AUT-046 pure, read-only milestone presentation projection (never submits a command or writes GameState).
 * - The first `syncFromState` (save load) is SILENT: it only records the facts already true (AUT-040 dedupe).
 * - A live event produces a trigger once per fact key; a later snapshot that reveals a fact no event announced yet produces
 *   it too (snapshot-before-event ordering), and the pair is deduplicated: nothing fires twice.
 * - Reboot clears the toast timeline and re-baselines silently, so the same milestones can be reached again in the next run.
 * - Exceptional events (first automation / first robot / Reboot) are classified and reported, never presented here. The era change is
 *   the exception (AUT-048): it becomes ONE title card (fact key `e:<newEraId>`, snapshot and event dedupe like every fact), shown after
 *   its card delay from t0 = observed; same-batch toasts are `subsumed`; Reboot cancels it silently.
 */
export class MilestonePresentationViewModel {
    private readonly facts = new Set<string>();
    private readonly queue = new MilestoneToastQueue();
    private initialised = false;
    private pendingEra: PendingEra | null = null;

    public syncFromState(state: GameState): MilestoneUpdate {
        const current = stateFacts(state);
        if (!this.initialised) {
            this.initialised = true;
            this.facts.clear();
            for (const key of current.keys()) this.facts.add(key);
            return EMPTY_UPDATE;
        }
        // A fact that disappeared means a new run: forget the event-only facts too (the era key only counts when no era remains).
        let reset = false;
        let hadEra = false;
        let hasEra = false;
        for (const key of [...this.facts]) {
            if ((key.startsWith('b:') || key.startsWith('c:') || key.startsWith('a:')) && !current.has(key)) reset = true;
            if (key.startsWith('e:')) hadEra = true;
        }
        for (const key of current.keys()) if (key.startsWith('e:')) hasEra = true;
        if (hadEra && !hasEra) reset = true;
        if (reset) {
            const eraCancelled = this.cancelEra();
            this.facts.clear();
            this.queue.clear();
            for (const key of current.keys()) this.facts.add(key);
            return { ...EMPTY_UPDATE, rebooted: true, eraCancelled };
        }
        const accepted: MilestoneTrigger[] = [];
        for (const [key, trigger] of current) {
            if (this.facts.has(key)) continue;
            this.facts.add(key);
            if (trigger) accepted.push(trigger);
        }
        return this.enqueue(accepted, [], [], false, false);
    }

    public consumeEvents(state: GameState, events: readonly DomainEvent[]): MilestoneUpdate {
        if (!this.initialised) {
            // Never present before the load baseline exists.
            this.syncFromState(state);
            return EMPTY_UPDATE;
        }
        const accepted: MilestoneTrigger[] = [];
        const exceptional: string[] = [];
        const skipped: MilestoneSkip[] = [];
        let rebooted = false;
        let eraCancelled = false;
        const burstBreakthroughs = new Set(events.filter((e) => e.type === 'breakthroughPurchased').map((e) => (e as { breakthroughId: string }).breakthroughId));
        for (const event of events) {
            if (event.type === 'rebootCompleted') {
                exceptional.push(event.type);
                rebooted = true;
                accepted.length = 0;
                eraCancelled = this.cancelEra() || eraCancelled;
                this.queue.clear();
                this.facts.clear();
                for (const key of stateFacts(state).keys()) this.facts.add(key);
                continue;
            }
            const classification = classifyMilestoneEvent(event);
            if (classification.tier === 'exceptional') {
                exceptional.push(event.type);
                if (event.type === 'automationStateChanged') this.facts.add(`a:${event.producerId}`);
                if (event.type === 'eraChanged') {
                    // The era title card (AUT-048): deduped by `e:<newEraId>` like every fact; eras without a card present nothing.
                    const eraTrigger = buildEraTrigger(event.newEraId);
                    if (!eraTrigger) continue;
                    if (this.facts.has(eraTrigger.key)) { skipped.push({ key: eraTrigger.key, reason: 'duplicate' }); continue; }
                    this.facts.add(eraTrigger.key);
                    accepted.push(eraTrigger);
                }
                continue;
            }
            const trigger = classification.trigger;
            if (!trigger) continue;
            if (this.facts.has(trigger.key)) { skipped.push({ key: trigger.key, reason: 'duplicate' }); continue; }
            this.facts.add(trigger.key);
            // A breakthrough that constructs a producer already shows the breakthrough name: no second Major for the same burst.
            if (event.type === 'producerConstructed' && event.source === 'breakthrough' && event.breakthroughId !== undefined && burstBreakthroughs.has(event.breakthroughId)) {
                skipped.push({ key: trigger.key, reason: 'subsumed' });
                continue;
            }
            accepted.push(trigger);
        }
        return this.enqueue(accepted, exceptional, skipped, rebooted, eraCancelled);
    }

    /**
     * Debug / review replay of one era transition card from the era id alone: forgets its fact key and schedules the card again.
     * Presentation only: it never reads or writes GameState, never submits a command and never touches the save.
     */
    public replayEra(eraId: string): MilestoneUpdate {
        const eraTrigger = buildEraTrigger(eraId);
        if (!eraTrigger || !this.initialised) return EMPTY_UPDATE;
        this.facts.delete(eraTrigger.key);
        this.facts.add(eraTrigger.key);
        this.pendingEra = { trigger: eraTrigger, elapsed: 0 };
        return { ...EMPTY_UPDATE, eraScheduled: eraTrigger };
    }

    public tick(deltaSeconds: number): MilestoneViewTick {
        const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
        let eraOffer: MilestoneEnqueueOutcome | null = null;
        let offerStarted: readonly MilestoneToastItem[] = NO_ITEMS;
        const pending = this.pendingEra;
        if (pending) {
            pending.elapsed += delta;
            if (pending.elapsed >= (eraTransitionSpec(pending.trigger.eraId)?.cardDelaySeconds ?? 0)) {
                this.pendingEra = null;
                eraOffer = this.queue.enqueueBurst([pending.trigger]);
                offerStarted = eraOffer.started;
            }
        }
        const tick = this.queue.tick(delta);
        return { frame: tick.frame, finished: tick.finished, started: offerStarted.length > 0 ? [...offerStarted, ...tick.started] : tick.started, eraOffer };
    }
    public getPendingEra(): MilestoneTrigger | null { return this.pendingEra?.trigger ?? null; }
    public getFrame(): MilestoneToastFrame | null { return this.queue.getFrame(); }
    public get isInitialised(): boolean { return this.initialised; }

    /** Cancels a pending or visible era card (Reboot); the caller clears the queue. */
    private cancelEra(): boolean {
        const active = this.queue.getActive();
        const had = this.pendingEra !== null || active?.trigger.kind === 'era_title' || this.queue.getWaiting().some((w) => w.trigger.kind === 'era_title');
        this.pendingEra = null;
        return had;
    }

    private enqueue(acceptedAll: readonly MilestoneTrigger[], exceptional: readonly string[], skippedIn: readonly MilestoneSkip[], rebooted: boolean, eraCancelled: boolean): MilestoneUpdate {
        // ONE era card per batch (the highest era); every other toast of the same batch (Robot Line built / Advanced Robotics Majors and any
        // Minor chip) is subsumed by it, so a single card shows.
        let accepted = acceptedAll;
        let skipped = skippedIn;
        let eraScheduled: MilestoneTrigger | null = null;
        for (const trigger of acceptedAll) if (trigger.kind === 'era_title') eraScheduled = trigger;
        if (eraScheduled) {
            skipped = [...skippedIn, ...acceptedAll.filter((t) => t.kind !== 'era_title').map((t) => ({ key: t.key, reason: 'subsumed' as const }))];
            accepted = [];
            this.pendingEra = { trigger: eraScheduled, elapsed: 0 };
        }
        // An Exceptional reveal in the same burst owns the camera: the toast still shows, the focus is skipped.
        const triggers = exceptional.length > 0 ? accepted.map((t) => (t.focusProducerId !== null ? { ...t, focusSuppressed: true } : t)) : accepted;
        const outcome = triggers.length > 0 ? this.queue.enqueueBurst(triggers) : null;
        return { accepted: triggers, exceptional, skipped, outcome, rebooted, eraScheduled, eraCancelled };
    }
}
