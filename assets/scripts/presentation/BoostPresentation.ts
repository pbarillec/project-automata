import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import type { FreeOverclockViewState } from './HudViewModel.ts';

/**
 * AUT-047 temporary-boost presentation (pure, no `cc`, no constructor parameter properties). Keyed on "a temporary PRODUCTION boost is
 * active" (any boost id, so Extended Overclock reuses it), never on free_overclock alone. Presentation only: it reads a state snapshot
 * and domain events, owns no economy value and never writes state. The visual speed-up (~1.3x) is independent from the economy x2.
 *
 * Looks (Art Direction section 22): ACTIVE = shared presentation time scale ~1.3x + low-rate amber sparks on at most 2 built machines;
 * activation = one ~0.35 s impulse (amber ring on the Assembly anchor + <= 3 sparks) while the speed ramps up over ~0.4 s;
 * expiry / suspend = ease out over ~0.6 s; READY / LOCKED / COOLDOWN = baseline (HUD only). No toast (temporaryBoost* stays tier none).
 */
export const BOOST_VISUAL_SPEED = 1.3;
export const BOOST_VISUAL_SPEED_RANGE = Object.freeze({ min: 1.25, max: 1.4 });
export const BOOST_RAMP_IN_SECONDS = 0.4;
export const BOOST_RAMP_OUT_SECONDS = 0.6;
export const BOOST_IMPULSE_SECONDS = 0.35;
export const BOOST_IMPULSE_SPARK_COUNT = 3;
export const BOOST_SPARK_MACHINE_LIMIT = 2;
/** Producers that may carry sustained sparks, in priority order: slot 0 = Assembly Station, slot 1 = Robot Line else Fabricator. */
export const BOOST_SPARK_PRIMARY_PRODUCER = 'assembly_station';
export const BOOST_SPARK_SECONDARY_PRODUCERS: readonly string[] = Object.freeze(['robot_line', 'fabricator']);
/**
 * AUT-040 spark pool nodes used (the odd indices are already amber, so the pool is never recoloured and AUT-046's cyan accent
 * restore path stays untouched). machine = index into the machine list; at most 3 sparks overall.
 */
export const BOOST_SPARK_SLOTS: readonly { readonly machine: number; readonly poolIndex: number }[] = Object.freeze([
    Object.freeze({ machine: 0, poolIndex: 1 }),
    Object.freeze({ machine: 0, poolIndex: 3 }),
    Object.freeze({ machine: 1, poolIndex: 5 }),
]);
/** Sustained spark: one short flash per slot every BOOST_SPARK_PERIOD_SECONDS (low rate). */
export const BOOST_SPARK_PERIOD_SECONDS = 1.3;
export const BOOST_SPARK_DUTY = 0.22;

export type BoostPresentationMode = 'inactive' | 'active' | 'suspended';
export type BoostPresentationPhase = 'synced' | 'started' | 'ended' | 'suspended' | 'resumed';

export interface BoostSnapshot {
    readonly mode: BoostPresentationMode;
    readonly remainingSeconds: number;
    readonly multiplier: number;
    readonly boostIds: readonly string[];
}

/** Reads the production-multiplier boosts of a state: active when any is running, suspended when all of them are suspended. */
export function resolveBoostSnapshot(state: GameState): BoostSnapshot {
    const ids: string[] = [];
    let anyRunning = false;
    let remaining = 0;
    let multiplier = 1;
    for (const boost of Object.values(state.boosts.activeBoosts)) {
        if (boost.effect.type !== 'productionMultiplier') continue;
        ids.push(boost.boostId);
        if (!boost.isSuspended) anyRunning = true;
        remaining = Math.max(remaining, boost.remainingSeconds);
        multiplier = Math.max(multiplier, boost.effect.multiplier);
    }
    ids.sort();
    return { mode: ids.length === 0 ? 'inactive' : anyRunning ? 'active' : 'suspended', remainingSeconds: remaining, multiplier, boostIds: ids };
}

/** HUD view state -> world look (locked / ready / cooldown show no world cue, suspended is a paused baseline). */
export function boostModeForViewState(state: FreeOverclockViewState): BoostPresentationMode {
    return state === 'active' ? 'active' : state === 'suspended' ? 'suspended' : 'inactive';
}

/** Built machines that may carry sparks: Assembly Station first, then Robot Line (else Fabricator); never more than 2. */
export function selectBoostSparkMachines(state: GameState): readonly string[] {
    const built = (producerId: string): boolean => state.run.producers[producerId]?.isBuilt === true;
    const machines: string[] = [];
    if (built(BOOST_SPARK_PRIMARY_PRODUCER)) machines.push(BOOST_SPARK_PRIMARY_PRODUCER);
    for (const producerId of BOOST_SPARK_SECONDARY_PRODUCERS) {
        if (machines.length < BOOST_SPARK_MACHINE_LIMIT && built(producerId)) { machines.push(producerId); break; }
    }
    return machines;
}

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);
const smooth = (value: number): number => { const t = clamp01(value); return t * t * (3 - (2 * t)); };

/** Activation ring envelope (0..1, plateau-clamped) at `elapsed` seconds after the impulse started. */
export function boostImpulseRing(elapsed: number): number {
    return elapsed >= 0 && elapsed < BOOST_IMPULSE_SECONDS ? Math.min(1, 1.6 * Math.sin(Math.PI * (elapsed / BOOST_IMPULSE_SECONDS))) : 0;
}

export function boostImpulseSparkIntensity(elapsed: number): number {
    return elapsed >= 0 && elapsed < BOOST_IMPULSE_SECONDS ? Math.sin(Math.PI * (elapsed / BOOST_IMPULSE_SECONDS)) : 0;
}

export interface BoostSparkPlacement { intensity: number; angle: number; height: number }

/** Sustained low-rate spark of `slot` (0..2) at `clock` seconds: writes into `out` (no allocation). */
export function sampleBoostSustainedSpark(clock: number, slot: number, out: BoostSparkPlacement): BoostSparkPlacement {
    const cycles = (clock / BOOST_SPARK_PERIOD_SECONDS) + (slot * 0.37);
    const cycle = Math.floor(cycles);
    const phase = cycles - cycle;
    out.intensity = phase < BOOST_SPARK_DUTY ? Math.sin(Math.PI * (phase / BOOST_SPARK_DUTY)) : 0;
    out.angle = ((slot * 2.1) + (cycle * 1.3)) % (Math.PI * 2);
    out.height = 0.45 + (0.5 * (phase < BOOST_SPARK_DUTY ? phase / BOOST_SPARK_DUTY : 1));
    return out;
}

/** Activation spark `slot` (0..BOOST_IMPULSE_SPARK_COUNT-1): a short burst around the Assembly anchor. */
export function sampleBoostImpulseSpark(elapsed: number, slot: number, out: BoostSparkPlacement): BoostSparkPlacement {
    out.intensity = boostImpulseSparkIntensity(elapsed);
    out.angle = (slot * ((Math.PI * 2) / BOOST_IMPULSE_SPARK_COUNT)) + (elapsed * 3);
    out.height = 0.5 + (0.6 * clamp01(elapsed / BOOST_IMPULSE_SECONDS));
    return out;
}

export interface BoostTransition {
    readonly phase: BoostPresentationPhase;
    readonly source: 'session' | 'events' | 'state';
    /** The ~0.35 s activation impulse starts with this transition (live activation only, never on load). */
    readonly impulse: boolean;
    readonly mode: BoostPresentationMode;
    readonly remainingSeconds: number;
    readonly multiplier: number;
}

/** Frame written by `tick` (the same object every call: read it before the next tick, do not keep it). */
export interface BoostFrame {
    /** 0..1 eased ramp (1 = fully active). */
    level: number;
    /** Presentation time scale (1 .. BOOST_VISUAL_SPEED). */
    timeScale: number;
    /** 0..1 activation ring envelope (0 outside the impulse). */
    ring: number;
    /** 0..1 activation spark envelope. */
    impulseSparks: number;
    impulseElapsed: number;
    impulseActive: boolean;
    /** Seconds since the effect left idle (drives the sustained sparks). */
    clock: number;
    /** Nothing to render: the controller may skip all work. */
    idle: boolean;
}

export class BoostPresentationModel {
    private baselineDone = false;
    private mode: BoostPresentationMode = 'inactive';
    private ramp = 0;
    private impulseElapsed = -1;
    private clock = 0;
    private machines: readonly string[] = [];
    private remainingSeconds = 0;
    private multiplier = 1;
    private readonly frame: BoostFrame = { level: 0, timeScale: 1, ring: 0, impulseSparks: 0, impulseElapsed: -1, impulseActive: false, clock: 0, idle: true };

    public getMode(): BoostPresentationMode { return this.mode; }
    public getMachines(): readonly string[] { return this.machines; }
    public isIdle(): boolean { return this.mode !== 'active' && this.ramp <= 0 && this.impulseElapsed < 0; }
    public hasBaseline(): boolean { return this.baselineDone; }

    /** Initial / restored state: silent (no impulse). A boost that is already active shows the sustained look at once. */
    public syncFromState(state: GameState): BoostTransition {
        const snapshot = resolveBoostSnapshot(state);
        this.baselineDone = true;
        this.mode = snapshot.mode;
        this.machines = selectBoostSparkMachines(state);
        this.remainingSeconds = snapshot.remainingSeconds;
        this.multiplier = snapshot.multiplier;
        this.ramp = snapshot.mode === 'active' ? 1 : 0;
        this.impulseElapsed = -1;
        this.clock = 0;
        return this.transition('synced', 'session', false);
    }

    /** Live events + the resulting state. Returns the transition (null when nothing changed). A call without a baseline syncs silently. */
    public consumeEvents(state: GameState, events: readonly DomainEvent[]): BoostTransition | null {
        if (!this.baselineDone) return this.syncFromState(state);
        const before = this.mode;
        const snapshot = resolveBoostSnapshot(state);
        this.machines = selectBoostSparkMachines(state);
        this.remainingSeconds = snapshot.remainingSeconds;
        this.multiplier = snapshot.multiplier;
        let activated = false;
        let boostEvent = false;
        for (const event of events) {
            if (event.type === 'temporaryBoostActivated' && event.multiplier > 1) activated = true;
            if (event.type === 'temporaryBoostActivated' || event.type === 'temporaryBoostExpired' || event.type === 'temporaryBoostSuspended' || event.type === 'temporaryBoostResumed') boostEvent = true;
        }
        const after = snapshot.mode;
        this.mode = after;
        if (before === after) return null;
        const impulse = activated && after === 'active' && before !== 'active';
        if (impulse) this.impulseElapsed = 0;
        const source = boostEvent ? 'events' : 'state';
        if (after === 'active') return this.transition(before === 'suspended' ? 'resumed' : 'started', source, impulse);
        if (after === 'suspended') return this.transition('suspended', source, false);
        return this.transition('ended', source, false);
    }

    /** App background / reset: back to the idle baseline at once (no ease, no impulse). */
    public reset(): void {
        this.mode = 'inactive';
        this.ramp = 0;
        this.impulseElapsed = -1;
        this.clock = 0;
    }

    public tick(deltaSeconds: number): BoostFrame {
        const step = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
        const frame = this.frame;
        if (this.impulseElapsed >= 0) {
            this.impulseElapsed += step;
            if (this.impulseElapsed >= BOOST_IMPULSE_SECONDS) this.impulseElapsed = -1;
        }
        if (this.mode === 'active') this.ramp = Math.min(1, this.ramp + (step / BOOST_RAMP_IN_SECONDS));
        else this.ramp = Math.max(0, this.ramp - (step / BOOST_RAMP_OUT_SECONDS));
        frame.idle = this.isIdle();
        this.clock = frame.idle ? 0 : this.clock + step;
        frame.level = smooth(this.ramp);
        frame.timeScale = 1 + ((BOOST_VISUAL_SPEED - 1) * frame.level);
        frame.impulseActive = this.impulseElapsed >= 0;
        frame.impulseElapsed = this.impulseElapsed;
        frame.ring = frame.impulseActive ? boostImpulseRing(this.impulseElapsed) : 0;
        frame.impulseSparks = frame.impulseActive ? boostImpulseSparkIntensity(this.impulseElapsed) : 0;
        frame.clock = this.clock;
        return frame;
    }

    private transition(phase: BoostPresentationPhase, source: BoostTransition['source'], impulse: boolean): BoostTransition {
        return { phase, source, impulse, mode: this.mode, remainingSeconds: this.remainingSeconds, multiplier: this.multiplier };
    }
}
