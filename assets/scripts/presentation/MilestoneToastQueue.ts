import type { MilestoneKind, MilestoneTrigger, PresentedMilestoneTier } from './MilestoneTier.ts';
import { REBOOT_SEQUENCE_SECONDS, sampleRebootToast, type RebootBeat } from './RebootPresentation.ts';

/** Toast timing (seconds). Minor 0.15 in / 0.5 hold / 0.2 out; Major 2.5 s with an accent underline wipe. */
export const MILESTONE_TOAST_TIMING: Readonly<Record<PresentedMilestoneTier, { readonly fadeIn: number; readonly hold: number; readonly fadeOut: number }>> = Object.freeze({
    minor: Object.freeze({ fadeIn: 0.15, hold: 0.5, fadeOut: 0.2 }),
    major: Object.freeze({ fadeIn: 0.25, hold: 1.9, fadeOut: 0.35 }),
    // AUT-048 era title card: 0.3 s in / 2.2 s hold / 0.5 s out = 3.0 s hard cap.
    exceptional: Object.freeze({ fadeIn: 0.3, hold: 2.2, fadeOut: 0.5 }),
});
/** The accent underline wipes across the Major toast over this many seconds, starting when the fade-in ends. */
export const MILESTONE_UNDERLINE_WIPE_SECONDS = 0.6;
/** Same-producer Minor toasts closer than this are merged (the later one is dropped). */
export const MILESTONE_MINOR_MERGE_SECONDS = 1.0;
/** Waiting toasts per tier; further ones collapse into a "+N" on the last waiting (or the visible) toast. */
export const MILESTONE_MAX_WAITING_PER_TIER = 2;

/** The AUT-049 Reboot title card has its own 4.0 s hard-capped beat timeline (REBOOT / AI CORE / CIVILIZATION); every other kind uses its tier timing. */
export function milestoneToastDuration(tier: PresentedMilestoneTier, kind?: MilestoneKind): number {
    if (kind === 'reboot_title') return REBOOT_SEQUENCE_SECONDS;
    const timing = MILESTONE_TOAST_TIMING[tier];
    return timing.fadeIn + timing.hold + timing.fadeOut;
}

export type MilestoneToastPhase = 'in' | 'hold' | 'out';

export interface MilestoneToastTimingSample {
    readonly phase: MilestoneToastPhase;
    /** 0..1 */
    readonly alpha: number;
    /** 0..1 accent underline wipe (always 0 for Minor; Major and the era title card wipe). */
    readonly wipe: number;
    readonly complete: boolean;
    /** AUT-049 Reboot card only: which title the card shows (null = silence / not a Reboot card). */
    readonly beat?: RebootBeat | null;
}

/** Pure timing of one toast at `elapsed` seconds. */
export function sampleMilestoneToast(tier: PresentedMilestoneTier, elapsed: number, kind?: MilestoneKind): MilestoneToastTimingSample {
    if (kind === 'reboot_title') {
        const reboot = sampleRebootToast(elapsed);
        return { phase: reboot.complete ? 'out' : reboot.alpha >= 1 ? 'hold' : 'in', alpha: reboot.alpha, wipe: reboot.wipe, complete: reboot.complete, beat: reboot.beat };
    }
    const t = Math.max(0, elapsed);
    const timing = MILESTONE_TOAST_TIMING[tier];
    const total = milestoneToastDuration(tier);
    const wipe = tier !== 'minor' ? clamp01((t - timing.fadeIn) / MILESTONE_UNDERLINE_WIPE_SECONDS) : 0;
    if (t >= total) return { phase: 'out', alpha: 0, wipe, complete: true };
    if (t < timing.fadeIn) return { phase: 'in', alpha: clamp01(t / timing.fadeIn), wipe, complete: false };
    if (t < timing.fadeIn + timing.hold) return { phase: 'hold', alpha: 1, wipe, complete: false };
    return { phase: 'out', alpha: clamp01(1 - (t - timing.fadeIn - timing.hold) / timing.fadeOut), wipe, complete: false };
}

export interface MilestoneToastItem {
    readonly id: number;
    readonly trigger: MilestoneTrigger;
    /** Extra same-tier toasts collapsed into this one ("+N"). */
    extra: number;
    elapsed: number;
}

export type MilestoneDropReason = 'preempted' | 'major_active' | 'exceptional_active' | 'merged' | 'burst_limit';

export interface MilestoneDrop {
    readonly key: string;
    readonly reason: MilestoneDropReason;
}

export interface MilestoneEnqueueOutcome {
    /** Toasts that became visible during this call (id of the item). */
    readonly started: readonly MilestoneToastItem[];
    readonly queued: readonly string[];
    readonly dropped: readonly MilestoneDrop[];
    /** Keys collapsed into a "+N" of a same-tier toast. */
    readonly collapsed: readonly string[];
}

export interface MilestoneToastFrame {
    readonly item: MilestoneToastItem;
    readonly sample: MilestoneToastTimingSample;
}

export interface MilestoneToastTick {
    /** The toast on screen after this tick (null = band idle). */
    readonly frame: MilestoneToastFrame | null;
    readonly finished: readonly MilestoneToastItem[];
    readonly started: readonly MilestoneToastItem[];
}

/**
 * AUT-046 pure toast queue for the single non-interactive band.
 * - One toast is visible at a time (so at most 1 per tier); a Major pre-empts (drops) the visible and waiting Minors, and a Minor
 *   arriving while a Major is visible is dropped (it would be stale when the Major ends).
 * - Same-tier FIFO, at most 2 waiting; further ones collapse into a "+N" on the last waiting (else the visible) toast.
 * - Same-producer Minors within 1 s are merged. A single burst (one batch of events) offers at most 1 Major and 1 Minor: the
 *   others collapse (Major) or drop (Minor).
 * It never reads GameState and never submits a command: it is a presentation timeline.
 */
export class MilestoneToastQueue {
    private clock = 0;
    private nextId = 1;
    private active: MilestoneToastItem | null = null;
    private waiting: MilestoneToastItem[] = [];
    private readonly lastMinorAt = new Map<string, number>();

    public enqueueBurst(triggers: readonly MilestoneTrigger[]): MilestoneEnqueueOutcome {
        const started: MilestoneToastItem[] = [];
        const queued: string[] = [];
        const dropped: MilestoneDrop[] = [];
        const collapsed: string[] = [];
        // Exceptional (era title) first, then Majors, so a lower tier of the same burst never flashes before the higher one pre-empts it.
        const ordered = [...triggers.filter((t) => t.tier === 'exceptional'), ...triggers.filter((t) => t.tier === 'major'), ...triggers.filter((t) => t.tier === 'minor')];
        let majorOffered: MilestoneTrigger | null = null;
        let exceptionalOffered: MilestoneTrigger | null = null;
        let minorOffered = false;
        for (const item of ordered) {
            if (item.tier === 'exceptional') {
                if (exceptionalOffered) { this.collapseInto(item, collapsed); continue; }
                exceptionalOffered = item;
                this.offerExceptional(item, started, queued, dropped, collapsed);
            } else if (item.tier === 'major') {
                if (majorOffered) { this.collapseInto(item, collapsed); continue; }
                majorOffered = item;
                this.offerMajor(item, started, queued, dropped, collapsed);
            } else {
                if (minorOffered) { dropped.push({ key: item.key, reason: 'burst_limit' }); continue; }
                minorOffered = true;
                this.offerMinor(item, started, queued, dropped, collapsed);
            }
        }
        return { started, queued, dropped, collapsed };
    }

    public tick(deltaSeconds: number): MilestoneToastTick {
        const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
        this.clock += delta;
        const finished: MilestoneToastItem[] = [];
        const started: MilestoneToastItem[] = [];
        if (this.active) {
            this.active.elapsed += delta;
            if (sampleMilestoneToast(this.active.trigger.tier, this.active.elapsed, this.active.trigger.kind).complete) {
                finished.push(this.active);
                this.active = null;
            }
        }
        if (!this.active) {
            const next = this.takeNextWaiting();
            if (next) { this.active = next; started.push(next); }
        }
        return { frame: this.currentFrame(), finished, started };
    }

    public getFrame(): MilestoneToastFrame | null { return this.currentFrame(); }
    public getActive(): MilestoneToastItem | null { return this.active; }
    public getWaiting(): readonly MilestoneToastItem[] { return this.waiting; }

    /** Drops everything (Reboot): nothing visible, nothing waiting. */
    public clear(): void {
        this.active = null;
        this.waiting = [];
        this.lastMinorAt.clear();
    }

    /** The era title card pre-empts every visible and waiting Minor / Major; a second card waits (FIFO). */
    private offerExceptional(trigger: MilestoneTrigger, started: MilestoneToastItem[], queued: string[], dropped: MilestoneDrop[], collapsed: string[]): void {
        if (this.active && this.active.trigger.tier !== 'exceptional') {
            dropped.push({ key: this.active.trigger.key, reason: 'preempted' });
            this.active = null;
        }
        for (const waitingItem of this.waiting.filter((w) => w.trigger.tier !== 'exceptional')) dropped.push({ key: waitingItem.trigger.key, reason: 'preempted' });
        this.waiting = this.waiting.filter((w) => w.trigger.tier === 'exceptional');
        if (!this.active) {
            const item = this.create(trigger);
            this.active = item;
            started.push(item);
            return;
        }
        this.waitOrCollapse(trigger, 'exceptional', queued, collapsed);
    }

    private offerMajor(trigger: MilestoneTrigger, started: MilestoneToastItem[], queued: string[], dropped: MilestoneDrop[], collapsed: string[]): void {
        // Pre-emption: visible and waiting Minors are dropped.
        if (this.active && this.active.trigger.tier === 'minor') {
            dropped.push({ key: this.active.trigger.key, reason: 'preempted' });
            this.active = null;
        }
        for (const waitingItem of this.waiting.filter((w) => w.trigger.tier === 'minor')) dropped.push({ key: waitingItem.trigger.key, reason: 'preempted' });
        this.waiting = this.waiting.filter((w) => w.trigger.tier !== 'minor');
        if (!this.active) {
            const item = this.create(trigger);
            this.active = item;
            started.push(item);
            return;
        }
        this.waitOrCollapse(trigger, 'major', queued, collapsed);
    }

    private offerMinor(trigger: MilestoneTrigger, started: MilestoneToastItem[], queued: string[], dropped: MilestoneDrop[], collapsed: string[]): void {
        if (this.active?.trigger.tier === 'exceptional') { dropped.push({ key: trigger.key, reason: 'exceptional_active' }); return; }
        if (this.active?.trigger.tier === 'major') { dropped.push({ key: trigger.key, reason: 'major_active' }); return; }
        const producerKey = trigger.producerId ?? trigger.key;
        const last = this.lastMinorAt.get(producerKey);
        if (last !== undefined && this.clock - last < MILESTONE_MINOR_MERGE_SECONDS) {
            dropped.push({ key: trigger.key, reason: 'merged' });
            return;
        }
        this.lastMinorAt.set(producerKey, this.clock);
        if (!this.active) {
            const item = this.create(trigger);
            this.active = item;
            started.push(item);
            return;
        }
        this.waitOrCollapse(trigger, 'minor', queued, collapsed);
    }

    private waitOrCollapse(trigger: MilestoneTrigger, tier: PresentedMilestoneTier, queued: string[], collapsed: string[]): void {
        const waitingOfTier = this.waiting.filter((w) => w.trigger.tier === tier);
        if (waitingOfTier.length < MILESTONE_MAX_WAITING_PER_TIER) {
            this.waiting.push(this.create(trigger));
            queued.push(trigger.key);
            return;
        }
        waitingOfTier[waitingOfTier.length - 1].extra += 1;
        collapsed.push(trigger.key);
    }

    private collapseInto(trigger: MilestoneTrigger, collapsed: string[]): void {
        const target = [...this.waiting].reverse().find((w) => w.trigger.tier === trigger.tier) ?? (this.active?.trigger.tier === trigger.tier ? this.active : null);
        if (target) target.extra += 1;
        collapsed.push(trigger.key);
    }

    private takeNextWaiting(): MilestoneToastItem | null {
        const exceptionalIndex = this.waiting.findIndex((w) => w.trigger.tier === 'exceptional');
        const majorIndex = this.waiting.findIndex((w) => w.trigger.tier === 'major');
        const index = exceptionalIndex >= 0 ? exceptionalIndex : majorIndex >= 0 ? majorIndex : 0;
        if (this.waiting.length === 0) return null;
        return this.waiting.splice(index, 1)[0];
    }

    private currentFrame(): MilestoneToastFrame | null {
        if (!this.active) return null;
        return { item: this.active, sample: sampleMilestoneToast(this.active.trigger.tier, this.active.elapsed, this.active.trigger.kind) };
    }

    private create(trigger: MilestoneTrigger): MilestoneToastItem {
        const id = this.nextId;
        this.nextId += 1;
        return { id, trigger, extra: 0, elapsed: 0 };
    }
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}
