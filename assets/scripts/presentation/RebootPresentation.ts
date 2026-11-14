import type { DomainEvent, RebootCompletedEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { MILESTONE_FOCUS_OFF_CENTRE_DISTANCE, milestoneRingBars, type MilestoneRingBar } from './MilestoneFeedback.ts';
import type { MilestoneTrigger } from './MilestoneTier.ts';

/**
 * AUT-049 Reboot presentation (pure data + rules, no `cc`). A 4.0 s hard-capped, post-commit sequence started ONLY by the domain event
 * `rebootCompleted` (which the lifecycle coordinator appends only after the durable `reboot_saved`; `reboot_persistence_failed` never
 * carries it, and a save load / first sync is silent). Presentation holds no state of its own beyond the timeline, issues no command and
 * never reads or writes the save.
 *
 *   A scan      0.0 - 1.2 s  thin cyan scan ring (opaque outline bars) + title "REBOOT"
 *   B silence   1.2 - 1.7 s  nothing
 *   C AI Core   1.7 - 3.2 s  placeholder AI Core on a small relay socket + "AI CORE x N"
 *   D new civ   3.2 - 4.0 s  "CIVILIZATION #N"
 *
 * The toast (title card) and the world visuals (ring, socket, core) are two independent consumers of the same event on the same clock
 * (like the AUT-048 title card and the AUT-045 fade): neither waits for the other. The Core is an intentionally simple, temporary
 * placeholder built from primitive boxes (no asset); the final CUSTOM_AI_CORE_01 is NOT made here.
 */
export const REBOOT_SEQUENCE_SECONDS = 4.0;

export const REBOOT_TIMELINE = Object.freeze({
    scanEnd: 1.2,
    silenceEnd: 1.7,
    coreEnd: 3.2,
    civilizationEnd: REBOOT_SEQUENCE_SECONDS,
});

export type RebootPhase = 'scan' | 'silence' | 'core' | 'civilization' | 'complete';
export type RebootBeat = 'reboot' | 'ai_core' | 'civilization';

export function rebootPhaseAt(elapsed: number): RebootPhase {
    const t = Math.max(0, elapsed);
    if (t < REBOOT_TIMELINE.scanEnd) return 'scan';
    if (t < REBOOT_TIMELINE.silenceEnd) return 'silence';
    if (t < REBOOT_TIMELINE.coreEnd) return 'core';
    if (t < REBOOT_TIMELINE.civilizationEnd) return 'civilization';
    return 'complete';
}

/** Dedupe fact key of a Reboot (`x:<newCivilization>`). */
export function rebootFactKey(newCivilization: number): string {
    return `x:${newCivilization}`;
}

/** The `reboot_title` Exceptional toast trigger (no pulse / sparks / toast focus: the world controller owns the one camera beat). */
export function buildRebootTrigger(event: RebootCompletedEvent): MilestoneTrigger {
    return Object.freeze({
        key: rebootFactKey(event.newCivilization),
        tier: 'exceptional' as const,
        kind: 'reboot_title' as const,
        accent: 'cyan' as const,
        producerId: null,
        breakthroughId: null,
        milestoneId: null,
        threshold: null,
        focusProducerId: null,
        sparks: false,
        pulse: false,
        eraId: null,
        focusSuppressed: false,
        reboot: Object.freeze({ newCivilization: event.newCivilization, aiCoresGranted: event.aiCoresGranted }),
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Title card timeline (the toast band)

export const REBOOT_UNDERLINE_WIPE_SECONDS = 0.5;

interface RebootBeatSegment {
    readonly beat: RebootBeat;
    readonly start: number;
    readonly end: number;
    readonly fadeIn: number;
    readonly fadeOut: number;
}

/** C -> D is a hard text cut (no gap): C has no fade-out and D no fade-in. The card is fully gone at 4.0 s. */
export const REBOOT_BEAT_SEGMENTS: readonly RebootBeatSegment[] = Object.freeze([
    Object.freeze({ beat: 'reboot' as const, start: 0, end: REBOOT_TIMELINE.scanEnd, fadeIn: 0.2, fadeOut: 0.2 }),
    Object.freeze({ beat: 'ai_core' as const, start: REBOOT_TIMELINE.silenceEnd, end: REBOOT_TIMELINE.coreEnd, fadeIn: 0.2, fadeOut: 0 }),
    Object.freeze({ beat: 'civilization' as const, start: REBOOT_TIMELINE.coreEnd, end: REBOOT_TIMELINE.civilizationEnd, fadeIn: 0, fadeOut: 0.3 }),
]);

export interface RebootToastSample {
    /** Which title the card shows (null during the silence: the card is invisible). */
    readonly beat: RebootBeat | null;
    /** 0..1 card alpha (0 during the silence and after the end). */
    readonly alpha: number;
    /** 0..1 accent underline wipe of the current beat. */
    readonly wipe: number;
    readonly complete: boolean;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** Pure card timeline at `elapsed` seconds after the Reboot was observed. Hard cap: complete at REBOOT_SEQUENCE_SECONDS. */
export function sampleRebootToast(elapsed: number): RebootToastSample {
    const t = Math.max(0, elapsed);
    if (t >= REBOOT_SEQUENCE_SECONDS) return { beat: null, alpha: 0, wipe: 1, complete: true };
    for (const segment of REBOOT_BEAT_SEGMENTS) {
        if (t < segment.start || t >= segment.end) continue;
        const local = t - segment.start;
        const fadeIn = segment.fadeIn > 0 ? clamp01(local / segment.fadeIn) : 1;
        const fadeOut = segment.fadeOut > 0 ? clamp01((segment.end - t) / segment.fadeOut) : 1;
        const wipe = clamp01((local - segment.fadeIn) / REBOOT_UNDERLINE_WIPE_SECONDS);
        return { beat: segment.beat, alpha: Math.min(fadeIn, fadeOut), wipe, complete: false };
    }
    return { beat: null, alpha: 0, wipe: 0, complete: false };
}

// ---------------------------------------------------------------------------------------------------------------
// World visuals: scan ring, relay socket, placeholder AI Core

/** Persistent inherited-tech marker: shown when the player owns AI Cores or is past Civilization #1 (synced from the snapshot). */
export function shouldShowRelaySocket(aiCores: number, civilization: number): boolean {
    return (Number.isFinite(aiCores) && aiCores > 0) || (Number.isFinite(civilization) && civilization >= 2);
}

/**
 * Relay socket (world XZ): just in front of the Fabricator / opening Workshop foundation (which ends at z -0.3) and west of the logistics
 * spine (x >= -6.3), so it overlaps no foundation, machine or zone. Parts are primitive boxes (unlit, opaque), local to the socket root.
 */
export const REBOOT_SOCKET = Object.freeze({
    x: -7.2,
    z: 0.2,
    base: Object.freeze({ sizeX: 0.9, sizeY: 0.1, sizeZ: 0.9, y: 0.05 }),
    pedestal: Object.freeze({ sizeX: 0.32, sizeY: 0.3, sizeZ: 0.32, y: 0.25 }),
    /** Thin cyan outline on the base top (4 bars). */
    ring: Object.freeze({ inset: 0.05, thickness: 0.05, height: 0.03, y: 0.115 }),
    colors: Object.freeze({
        base: Object.freeze({ r: 59, g: 67, b: 70 }),
        pedestal: Object.freeze({ r: 74, g: 85, b: 88 }),
        /** AUT-045 environment cyan, dimmer than the lamps. */
        ring: Object.freeze({ r: 59, g: 112, b: 121 }),
        /** The placeholder Core (producer lamp cyan). */
        core: Object.freeze({ r: 82, g: 206, b: 224 }),
        scan: Object.freeze({ r: 80, g: 190, b: 205 }),
    }),
});

/** Placeholder Core edge length (world units): the persistent marker is small and static; the reveal peaks at 0.55. */
export const REBOOT_CORE_PERSISTENT_SIZE = 0.2;
export const REBOOT_CORE_PEAK_SIZE = 0.55;
/** Core rests on the pedestal top (0.4) balanced on a vertex (a cube turned 45 / 35.26 deg: half-diagonal = size * sqrt(3) / 2). */
export const REBOOT_CORE_EULER_DEG = Object.freeze({ x: 35.264, y: 45, z: 0 });
const REBOOT_CORE_REST_Y = 0.4;
const REBOOT_CORE_GROW_SECONDS = 0.3;

export function rebootCoreCenterY(size: number): number {
    return REBOOT_CORE_REST_Y + 0.02 + (size * Math.sqrt(3)) / 2;
}

/** Scan ring: a thin outline growing from the starting area over the whole site, then gone. */
export const REBOOT_SCAN = Object.freeze({
    centreX: 0,
    centreZ: 1,
    startWidth: 3,
    startDepth: 2.4,
    endWidth: 19,
    endDepth: 15.2,
    thickness: 0.1,
    height: 0.05,
    y: 0.26,
});

export function scanRingBars(progress: number): readonly MilestoneRingBar[] {
    const p = clamp01(progress);
    const width = REBOOT_SCAN.startWidth + (REBOOT_SCAN.endWidth - REBOOT_SCAN.startWidth) * p;
    const depth = REBOOT_SCAN.startDepth + (REBOOT_SCAN.endDepth - REBOOT_SCAN.startDepth) * p;
    return milestoneRingBars({ x: REBOOT_SCAN.centreX, z: REBOOT_SCAN.centreZ, width, depth }, 0, REBOOT_SCAN.thickness);
}

/** The 4 outline bars of the socket base ring (local to the socket root). */
export function socketRingBars(): readonly MilestoneRingBar[] {
    return milestoneRingBars({ x: 0, z: 0, width: REBOOT_SOCKET.base.sizeX, depth: REBOOT_SOCKET.base.sizeZ }, REBOOT_SOCKET.ring.inset, REBOOT_SOCKET.ring.thickness);
}

function smoothstep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

export interface RebootWorldSample {
    readonly phase: RebootPhase;
    readonly complete: boolean;
    readonly scanVisible: boolean;
    /** 0..1 growth of the scan ring (0 outside the scan phase). */
    readonly scanProgress: number;
    readonly socketVisible: boolean;
    /** Placeholder Core edge length (0 = hidden). */
    readonly coreSize: number;
}

/** Pure world timeline at `elapsed` seconds: the socket and the Core exist only from phase C on (nothing during A / B). */
export function sampleRebootWorld(elapsed: number): RebootWorldSample {
    const t = Math.max(0, elapsed);
    const phase = rebootPhaseAt(t);
    if (phase === 'complete') return { phase, complete: true, scanVisible: false, scanProgress: 0, socketVisible: false, coreSize: 0 };
    const scanVisible = phase === 'scan';
    const scanProgress = scanVisible ? clamp01(t / REBOOT_TIMELINE.scanEnd) : 0;
    if (phase === 'scan' || phase === 'silence') return { phase, complete: false, scanVisible, scanProgress, socketVisible: false, coreSize: 0 };
    const grow = smoothstep((t - REBOOT_TIMELINE.silenceEnd) / REBOOT_CORE_GROW_SECONDS);
    let coreSize = REBOOT_CORE_PEAK_SIZE * grow;
    if (phase === 'civilization') {
        const settle = smoothstep((t - REBOOT_TIMELINE.coreEnd) / (REBOOT_TIMELINE.civilizationEnd - REBOOT_TIMELINE.coreEnd));
        coreSize = REBOOT_CORE_PEAK_SIZE + (REBOOT_CORE_PERSISTENT_SIZE - REBOOT_CORE_PEAK_SIZE) * settle;
    }
    return { phase, complete: false, scanVisible: false, scanProgress: 0, socketVisible: true, coreSize };
}

// ---------------------------------------------------------------------------------------------------------------
// Camera: ONE optional reveal focus beat on the Fabricator anchor (existing MobileCameraController.focusOnRevealTarget only)

export const REBOOT_FOCUS_PRODUCER_ID = 'fabricator';

export type RebootFocusSkipReason = 'no_camera' | 'no_target' | 'camera_busy' | 'on_centre';

export interface RebootFocusInput {
    readonly cameraFocus: { readonly x: number; readonly z: number } | null;
    readonly target: { readonly x: number; readonly z: number } | null;
    /** A camera focus transition is already running (any beat, or the player's own pan owns the camera). */
    readonly cameraFocusActive: boolean;
}

export interface RebootFocusDecision {
    readonly focus: boolean;
    readonly reason: RebootFocusSkipReason | 'requested';
}

export function resolveRebootFocus(input: RebootFocusInput): RebootFocusDecision {
    if (input.cameraFocusActive) return { focus: false, reason: 'camera_busy' };
    if (!input.cameraFocus) return { focus: false, reason: 'no_camera' };
    if (!input.target) return { focus: false, reason: 'no_target' };
    const distance = Math.hypot(input.target.x - input.cameraFocus.x, input.target.z - input.cameraFocus.z);
    if (distance < MILESTONE_FOCUS_OFF_CENTRE_DISTANCE) return { focus: false, reason: 'on_centre' };
    return { focus: true, reason: 'requested' };
}

// ---------------------------------------------------------------------------------------------------------------
// Model (timeline owner of the world visuals)

export interface RebootFrame {
    readonly running: boolean;
    readonly elapsed: number;
    /** `idle` when no sequence runs (the persistent socket rule then decides the visuals). */
    readonly phase: RebootPhase | 'idle';
    readonly scanVisible: boolean;
    readonly scanProgress: number;
    readonly socketVisible: boolean;
    readonly coreSize: number;
    /** The phase entered during this tick (null when unchanged). */
    readonly phaseChanged: RebootPhase | null;
    /** The sequence ended during this tick (elapsed was capped at REBOOT_SEQUENCE_SECONDS). */
    readonly finished: boolean;
}

export interface RebootSequenceInfo {
    readonly key: string;
    readonly newCivilization: number;
    readonly aiCoresGranted: number;
}

export interface RebootUpdate {
    /** The sequence this call started (null = none). */
    readonly started: RebootSequenceInfo | null;
    /** A `rebootCompleted` whose key was already presented (nothing starts). */
    readonly duplicate: boolean;
    /** The persistent socket rule evaluated on the snapshot passed in. */
    readonly socketPersistent: boolean;
}

interface RunningSequence {
    readonly info: RebootSequenceInfo;
    elapsed: number;
    phase: RebootPhase;
}

/**
 * Read-only world timeline. The first sync / event batch is a SILENT baseline (a load never starts a sequence); only a live
 * `rebootCompleted` starts it, once per key `x:<newCivilization>`. Other events (`civilizationChanged` / `aiCoresGranted` of a Reboot
 * whose save failed) only refresh the persistent socket from the snapshot.
 */
export class RebootPresentationModel {
    private initialised = false;
    private persistent = false;
    private sequence: RunningSequence | null = null;
    private readonly presented = new Set<string>();

    public syncFromState(state: GameState): RebootUpdate {
        this.initialised = true;
        this.persistent = shouldShowRelaySocket(state.meta.aiCores, state.meta.civilizationNumber);
        return { started: null, duplicate: false, socketPersistent: this.persistent };
    }

    public consumeEvents(state: GameState, events: readonly DomainEvent[]): RebootUpdate {
        if (!this.initialised) return this.syncFromState(state);
        this.persistent = shouldShowRelaySocket(state.meta.aiCores, state.meta.civilizationNumber);
        let started: RebootSequenceInfo | null = null;
        let duplicate = false;
        for (const event of events) {
            if (event.type !== 'rebootCompleted') continue;
            const key = rebootFactKey(event.newCivilization);
            if (this.presented.has(key)) { duplicate = true; continue; }
            this.presented.add(key);
            started = { key, newCivilization: event.newCivilization, aiCoresGranted: event.aiCoresGranted };
            this.sequence = { info: started, elapsed: 0, phase: 'scan' };
        }
        return { started, duplicate, socketPersistent: this.persistent };
    }

    public isRunning(): boolean { return this.sequence !== null; }
    public get isInitialised(): boolean { return this.initialised; }
    public getPersistentSocket(): boolean { return this.persistent; }
    public getSequence(): RebootSequenceInfo | null { return this.sequence?.info ?? null; }

    public tick(deltaSeconds: number): RebootFrame {
        const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
        const running = this.sequence;
        if (!running) return this.idleFrame(false, null);
        running.elapsed = Math.min(REBOOT_SEQUENCE_SECONDS, running.elapsed + delta);
        const sample = sampleRebootWorld(running.elapsed);
        if (sample.complete) {
            this.sequence = null;
            return this.idleFrame(true, 'complete', REBOOT_SEQUENCE_SECONDS);
        }
        const phaseChanged = sample.phase !== running.phase ? sample.phase : null;
        running.phase = sample.phase;
        return { running: true, elapsed: running.elapsed, phase: sample.phase, scanVisible: sample.scanVisible, scanProgress: sample.scanProgress, socketVisible: sample.socketVisible, coreSize: sample.coreSize, phaseChanged, finished: false };
    }

    private idleFrame(finished: boolean, phaseChanged: RebootPhase | null, elapsed = 0): RebootFrame {
        return { running: false, elapsed, phase: 'idle', scanVisible: false, scanProgress: 0, socketVisible: this.persistent, coreSize: this.persistent ? REBOOT_CORE_PERSISTENT_SIZE : 0, phaseChanged, finished };
    }
}
