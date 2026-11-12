import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { isFirstAutomationEvidence } from './AutomationPayoffViewModel.ts';
import { buildFactTrigger, classifyMilestoneEvent, type MilestoneTrigger } from './MilestoneTier.ts';
import { MilestoneToastQueue, type MilestoneEnqueueOutcome, type MilestoneToastFrame, type MilestoneToastTick } from './MilestoneToastQueue.ts';

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
}

const EMPTY_UPDATE: MilestoneUpdate = Object.freeze({ accepted: [], exceptional: [], skipped: [], outcome: null, rebooted: false });

/** Facts a snapshot can prove: breakthrough owned, producer built, producer automated. */
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
    return facts;
}

/**
 * AUT-046 pure, read-only milestone presentation projection (never submits a command or writes GameState).
 * - The first `syncFromState` (save load) is SILENT: it only records the facts already true (AUT-040 dedupe).
 * - A live event produces a trigger once per fact key; a later snapshot that reveals a fact no event announced yet produces
 *   it too (snapshot-before-event ordering), and the pair is deduplicated: nothing fires twice.
 * - Reboot clears the toast timeline and re-baselines silently, so the same milestones can be reached again in the next run.
 * - Exceptional events (first automation / first robot / era change / Reboot) are classified and reported, never presented.
 */
export class MilestonePresentationViewModel {
    private readonly facts = new Set<string>();
    private readonly queue = new MilestoneToastQueue();
    private initialised = false;

    public syncFromState(state: GameState): MilestoneUpdate {
        const current = stateFacts(state);
        if (!this.initialised) {
            this.initialised = true;
            this.facts.clear();
            for (const key of current.keys()) this.facts.add(key);
            return EMPTY_UPDATE;
        }
        // A fact that disappeared means a new run: forget the event-only facts too.
        let reset = false;
        for (const key of [...this.facts]) {
            if ((key.startsWith('b:') || key.startsWith('c:') || key.startsWith('a:')) && !current.has(key)) reset = true;
        }
        if (reset) {
            this.facts.clear();
            this.queue.clear();
            for (const key of current.keys()) this.facts.add(key);
            return { ...EMPTY_UPDATE, rebooted: true };
        }
        const accepted: MilestoneTrigger[] = [];
        for (const [key, trigger] of current) {
            if (this.facts.has(key)) continue;
            this.facts.add(key);
            if (trigger) accepted.push(trigger);
        }
        return this.enqueue(accepted, [], [], false);
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
        const burstBreakthroughs = new Set(events.filter((e) => e.type === 'breakthroughPurchased').map((e) => (e as { breakthroughId: string }).breakthroughId));
        for (const event of events) {
            if (event.type === 'rebootCompleted') {
                exceptional.push(event.type);
                rebooted = true;
                accepted.length = 0;
                this.queue.clear();
                this.facts.clear();
                for (const key of stateFacts(state).keys()) this.facts.add(key);
                continue;
            }
            const classification = classifyMilestoneEvent(event);
            if (classification.tier === 'exceptional') {
                exceptional.push(event.type);
                if (event.type === 'automationStateChanged') this.facts.add(`a:${event.producerId}`);
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
        return this.enqueue(accepted, exceptional, skipped, rebooted);
    }

    public tick(deltaSeconds: number): MilestoneToastTick { return this.queue.tick(deltaSeconds); }
    public getFrame(): MilestoneToastFrame | null { return this.queue.getFrame(); }
    public get isInitialised(): boolean { return this.initialised; }

    private enqueue(accepted: readonly MilestoneTrigger[], exceptional: readonly string[], skipped: readonly MilestoneSkip[], rebooted: boolean): MilestoneUpdate {
        // An Exceptional reveal in the same burst owns the camera: the toast still shows, the focus is skipped.
        const triggers = exceptional.length > 0 ? accepted.map((t) => (t.focusProducerId !== null ? { ...t, focusSuppressed: true } : t)) : accepted;
        const outcome = triggers.length > 0 ? this.queue.enqueueBurst(triggers) : null;
        return { accepted: triggers, exceptional, skipped, outcome, rebooted };
    }
}
