import type { BoostState, GameState } from '../state/GameState.ts';
import { clonePlainData } from '../state/StateClone.ts';
import { ModifierSet, createGlobalProductionMultiplier } from '../economy/ModifierSet.ts';

export const FREE_OVERCLOCK_BOOST_ID = 'free_overclock';
export const FREE_OVERCLOCK_MULTIPLIER = 2;
export const FREE_OVERCLOCK_DURATION_SECONDS = 60;
export const FREE_OVERCLOCK_COOLDOWN_SECONDS = 240;
export const WORKER_BOT_BREAKTHROUGH_ID = 'worker_bot';
export const FIRST_ROBOT_PROGRESSION_FLAG_ID = 'first_robot';

export type TemporaryBoostActivationStatus =
    | 'activated'
    | 'locked'
    | 'already_active'
    | 'suspended'
    | 'cooldown';

export type TemporaryBoostTransitionStatus =
    | 'changed'
    | 'missing'
    | 'already_suspended'
    | 'already_active'
    | 'suspender_mismatch';

export interface TemporaryBoostActivatedEvent {
    readonly type: 'temporaryBoostActivated';
    readonly boostId: string;
    readonly source: string;
    readonly multiplier: number;
    readonly durationSeconds: number;
    readonly cooldownSeconds: number;
    readonly requestId: string | null;
}

export interface TemporaryBoostExpiredEvent {
    readonly type: 'temporaryBoostExpired';
    readonly boostId: string;
    readonly source: string;
}

export interface TemporaryBoostSuspendedEvent {
    readonly type: 'temporaryBoostSuspended';
    readonly boostId: string;
    readonly suspendedByBoostId: string;
    readonly remainingSeconds: number;
}

export interface TemporaryBoostResumedEvent {
    readonly type: 'temporaryBoostResumed';
    readonly boostId: string;
    readonly remainingSeconds: number;
}

export type TemporaryBoostEvent =
    | TemporaryBoostActivatedEvent
    | TemporaryBoostExpiredEvent
    | TemporaryBoostSuspendedEvent
    | TemporaryBoostResumedEvent;

export interface ActivateFreeOverclockResult {
    readonly status: TemporaryBoostActivationStatus;
    readonly boosts: BoostState;
    readonly events: readonly TemporaryBoostEvent[];
    readonly remainingCooldownSeconds?: number;
}

export interface AdvanceTemporaryBoostsResult {
    readonly boosts: BoostState;
    readonly events: readonly TemporaryBoostEvent[];
}

export interface TemporaryBoostTransitionResult {
    readonly status: TemporaryBoostTransitionStatus;
    readonly boosts: BoostState;
    readonly events: readonly TemporaryBoostEvent[];
}

export class TemporaryBoostInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'TemporaryBoostInputError';
    }
}

export function isFreeOverclockUnlocked(state: GameState): boolean {
    if (state.meta.civilizationNumber >= 2) {
        return true;
    }

    return state.run.progressionFlags[FIRST_ROBOT_PROGRESSION_FLAG_ID] === true ||
        state.run.purchasedBreakthroughIds.includes(WORKER_BOT_BREAKTHROUGH_ID);
}

export function activateFreeOverclock(state: GameState): ActivateFreeOverclockResult {
    if (!isFreeOverclockUnlocked(state)) {
        return {
            status: 'locked',
            boosts: cloneBoostState(state.boosts),
            events: [],
        };
    }

    const existing = state.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID];
    if (existing !== undefined) {
        return {
            status: existing.isSuspended ? 'suspended' : 'already_active',
            boosts: cloneBoostState(state.boosts),
            events: [],
        };
    }

    const cooldown = state.boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID];
    if (cooldown !== undefined && cooldown.remainingSeconds > 0) {
        return {
            status: 'cooldown',
            boosts: cloneBoostState(state.boosts),
            events: [],
            remainingCooldownSeconds: cooldown.remainingSeconds,
        };
    }

    return activateTemporaryProductionBoost(state.boosts, {
        boostId: FREE_OVERCLOCK_BOOST_ID,
        multiplier: FREE_OVERCLOCK_MULTIPLIER,
        durationSeconds: FREE_OVERCLOCK_DURATION_SECONDS,
        cooldownSeconds: FREE_OVERCLOCK_COOLDOWN_SECONDS,
        source: 'free',
        requestId: null,
    });
}

export function activateTemporaryProductionBoost(
    boostState: BoostState,
    input: {
        readonly boostId: string;
        readonly multiplier: number;
        readonly durationSeconds: number;
        readonly cooldownSeconds?: number;
        readonly source: string;
        readonly requestId?: string | null;
    },
): ActivateFreeOverclockResult {
    const boostId = readNonEmptyString(input.boostId, 'boostId');
    const source = readNonEmptyString(input.source, 'source');
    const multiplier = readPositiveFiniteNumber(input.multiplier, 'multiplier');
    const durationSeconds = readPositiveFiniteNumber(input.durationSeconds, 'durationSeconds');
    const cooldownSeconds = input.cooldownSeconds === undefined
        ? 0
        : readNonNegativeFiniteNumber(input.cooldownSeconds, 'cooldownSeconds');
    const requestId = input.requestId === undefined ? null : readNullableString(input.requestId, 'requestId');
    const boosts = cloneBoostState(boostState);

    if (boosts.activeBoosts[boostId] !== undefined) {
        return {
            status: boosts.activeBoosts[boostId].isSuspended ? 'suspended' : 'already_active',
            boosts,
            events: [],
        };
    }

    const cooldown = boosts.cooldowns[boostId];
    if (cooldown !== undefined && cooldown.remainingSeconds > 0) {
        return {
            status: 'cooldown',
            boosts,
            events: [],
            remainingCooldownSeconds: cooldown.remainingSeconds,
        };
    }

    delete boosts.cooldowns[boostId];
    boosts.activeBoosts[boostId] = {
        boostId,
        remainingSeconds: durationSeconds,
        cooldownSeconds,
        source,
        requestId,
        effect: {
            type: 'productionMultiplier',
            multiplier,
        },
        isSuspended: false,
        suspendedByBoostId: null,
    };

    return {
        status: 'activated',
        boosts,
        events: [{
            type: 'temporaryBoostActivated',
            boostId,
            source,
            multiplier,
            durationSeconds,
            cooldownSeconds,
            requestId,
        }],
    };
}

export function advanceTemporaryBoosts(boostState: BoostState, elapsedSeconds: number): AdvanceTemporaryBoostsResult {
    let remainingElapsedSeconds = readElapsedSeconds(elapsedSeconds);
    const boosts = cloneBoostState(boostState);
    const events: TemporaryBoostEvent[] = [];

    normalizeElapsedZeroTimers(boosts);

    while (remainingElapsedSeconds > 0) {
        const nextTransitionSeconds = getSecondsUntilNextTemporaryBoostTransition(boosts);
        const stepSeconds = nextTransitionSeconds === null
            ? remainingElapsedSeconds
            : Math.min(remainingElapsedSeconds, nextTransitionSeconds);

        if (stepSeconds <= 0) {
            normalizeElapsedZeroTimers(boosts);
            break;
        }

        decrementActiveTemporaryBoosts(boosts, stepSeconds);
        decrementBoostCooldowns(boosts, stepSeconds);
        remainingElapsedSeconds = clampRemainingSeconds(remainingElapsedSeconds - stepSeconds);

        for (const event of expireElapsedTemporaryBoosts(boosts)) {
            events.push(event);
        }
        normalizeElapsedZeroTimers(boosts);
    }

    return {
        boosts,
        events,
    };
}

export function suspendTemporaryBoost(
    boostState: BoostState,
    boostId: string,
    suspendedByBoostId: string,
): TemporaryBoostTransitionResult {
    const targetBoostId = readNonEmptyString(boostId, 'boostId');
    const suspender = readNonEmptyString(suspendedByBoostId, 'suspendedByBoostId');
    const boosts = cloneBoostState(boostState);
    const boost = boosts.activeBoosts[targetBoostId];

    if (boost === undefined) {
        return { status: 'missing', boosts, events: [] };
    }

    if (boost.isSuspended) {
        return { status: 'already_suspended', boosts, events: [] };
    }

    boost.isSuspended = true;
    boost.suspendedByBoostId = suspender;

    return {
        status: 'changed',
        boosts,
        events: [{
            type: 'temporaryBoostSuspended',
            boostId: targetBoostId,
            suspendedByBoostId: suspender,
            remainingSeconds: boost.remainingSeconds,
        }],
    };
}

export function resumeTemporaryBoost(
    boostState: BoostState,
    boostId: string,
    suspendedByBoostId?: string,
): TemporaryBoostTransitionResult {
    const targetBoostId = readNonEmptyString(boostId, 'boostId');
    const expectedSuspender = suspendedByBoostId === undefined
        ? undefined
        : readNonEmptyString(suspendedByBoostId, 'suspendedByBoostId');
    const boosts = cloneBoostState(boostState);
    const boost = boosts.activeBoosts[targetBoostId];

    if (boost === undefined) {
        return { status: 'missing', boosts, events: [] };
    }

    if (!boost.isSuspended) {
        return { status: 'already_active', boosts, events: [] };
    }

    if (expectedSuspender !== undefined && boost.suspendedByBoostId !== expectedSuspender) {
        return { status: 'suspender_mismatch', boosts, events: [] };
    }

    boost.isSuspended = false;
    boost.suspendedByBoostId = null;

    return {
        status: 'changed',
        boosts,
        events: [{
            type: 'temporaryBoostResumed',
            boostId: targetBoostId,
            remainingSeconds: boost.remainingSeconds,
        }],
    };
}

export function getEffectiveTemporaryProductionMultiplier(boostState: BoostState): number {
    let effectiveMultiplier = 1;

    for (const boost of Object.values(boostState.activeBoosts)) {
        if (boost.isSuspended) {
            continue;
        }

        if (boost.effect.type === 'productionMultiplier') {
            effectiveMultiplier = Math.max(effectiveMultiplier, readPositiveFiniteNumber(
                boost.effect.multiplier,
                `boost ${boost.boostId} production multiplier`,
            ));
        }
    }

    return effectiveMultiplier;
}

export function createTemporaryBoostModifierSet(boostState: BoostState): ModifierSet {
    const multiplier = getEffectiveTemporaryProductionMultiplier(boostState);
    if (multiplier === 1) {
        return ModifierSet.empty();
    }

    return ModifierSet.fromProductionMultipliers([
        createGlobalProductionMultiplier(multiplier),
    ]);
}

export function getSecondsUntilNextTemporaryBoostTransition(boostState: BoostState): number | null {
    let nextSeconds: number | null = null;

    for (const boost of Object.values(boostState.activeBoosts)) {
        if (!boost.isSuspended) {
            nextSeconds = minPositiveTransition(nextSeconds, boost.remainingSeconds);
        }
    }

    for (const cooldown of Object.values(boostState.cooldowns)) {
        nextSeconds = minPositiveTransition(nextSeconds, cooldown.remainingSeconds);
    }

    return nextSeconds;
}

function decrementActiveTemporaryBoosts(boosts: BoostState, elapsedSeconds: number): void {
    for (const boost of Object.values(boosts.activeBoosts)) {
        if (!boost.isSuspended) {
            boost.remainingSeconds = clampRemainingSeconds(boost.remainingSeconds - elapsedSeconds);
        }
    }
}

function decrementBoostCooldowns(boosts: BoostState, elapsedSeconds: number): void {
    for (const cooldown of Object.values(boosts.cooldowns)) {
        cooldown.remainingSeconds = clampRemainingSeconds(cooldown.remainingSeconds - elapsedSeconds);
    }
}

function expireElapsedTemporaryBoosts(boosts: BoostState): TemporaryBoostExpiredEvent[] {
    const events: TemporaryBoostExpiredEvent[] = [];

    for (const boostId of Object.keys(boosts.activeBoosts).sort()) {
        const boost = boosts.activeBoosts[boostId];
        if (boost.remainingSeconds > 0) {
            continue;
        }

        delete boosts.activeBoosts[boostId];
        if (boost.cooldownSeconds > 0) {
            boosts.cooldowns[boostId] = {
                remainingSeconds: boost.cooldownSeconds,
            };
        }

        events.push({
            type: 'temporaryBoostExpired',
            boostId,
            source: boost.source,
        });
    }

    return events;
}

function normalizeElapsedZeroTimers(boosts: BoostState): void {
    for (const cooldownId of Object.keys(boosts.cooldowns)) {
        if (boosts.cooldowns[cooldownId].remainingSeconds <= 0) {
            delete boosts.cooldowns[cooldownId];
        }
    }
}

function minPositiveTransition(current: number | null, value: number): number | null {
    if (value <= 0) {
        return current ?? 0;
    }

    if (current === null || value < current) {
        return value;
    }

    return current;
}

function cloneBoostState(boostState: BoostState): BoostState {
    return clonePlainData(boostState);
}

function readElapsedSeconds(value: number): number {
    return readNonNegativeFiniteNumber(value, 'elapsedSeconds');
}

function readPositiveFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TemporaryBoostInputError(`${label} must be a positive finite number.`);
    }

    return value;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new TemporaryBoostInputError(`${label} must be a non-negative finite number.`);
    }

    return value;
}

function readNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TemporaryBoostInputError(`${label} must be a non-empty string.`);
    }

    return value;
}

function readNullableString(value: unknown, label: string): string | null {
    if (value === null) {
        return null;
    }

    return readNonEmptyString(value, label);
}

function clampRemainingSeconds(value: number): number {
    if (!Number.isFinite(value)) {
        throw new TemporaryBoostInputError('remaining seconds exceeded JavaScript Number range.');
    }

    if (value <= 0) {
        return 0;
    }

    return value;
}
