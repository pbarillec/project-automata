import type { SaveEnvelopeMetadata } from '../persistence/SaveEnvelope.ts';
import {
    CURRENT_SAVE_VERSION,
    assertSaveTimestampUtcIsoString,
    createSaveTimestampUtcIsoFromUnixMilliseconds,
    parseSaveTimestampUtcIsoToUnixMilliseconds,
} from '../persistence/SaveEnvelope.ts';

export type UtcTimestampIsoString = string;
export type MonotonicSessionSeconds = number;
export type MonotonicSessionMilliseconds = number;

export interface UtcInstant {
    readonly unixMilliseconds: number;
    readonly iso: UtcTimestampIsoString;
}

export interface MonotonicSessionTime {
    readonly seconds: MonotonicSessionSeconds;
    readonly milliseconds: MonotonicSessionMilliseconds;
}

export interface TimeService {
    nowUtc(): UtcInstant;
    nowUtcIso(): UtcTimestampIsoString;
    nowMonotonic(): MonotonicSessionTime;
    nowMonotonicSeconds(): MonotonicSessionSeconds;
    nowMonotonicMilliseconds(): MonotonicSessionMilliseconds;
    elapsedMonotonicSecondsSince(previousSeconds: MonotonicSessionSeconds): number;
    elapsedMonotonicMillisecondsSince(previousMilliseconds: MonotonicSessionMilliseconds): number;
}

export type UtcElapsedStatus =
    | 'valid'
    | 'missing_start'
    | 'missing_end'
    | 'invalid_start'
    | 'invalid_end'
    | 'backwards';

export interface UtcElapsedSecondsResult {
    readonly status: UtcElapsedStatus;
    readonly elapsedSeconds: number;
    readonly rawElapsedSeconds: number | null;
    readonly startUtcIso: UtcTimestampIsoString | null;
    readonly endUtcIso: UtcTimestampIsoString | null;
}

export interface SaveMetadataClockInput {
    readonly gameVersion: string;
    readonly contentVersion: string;
}

export class TimeServiceInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TimeServiceInputError';
    }
}

export function createUtcInstantFromUnixMilliseconds(unixMilliseconds: number): UtcInstant {
    const iso = createSaveTimestampUtcIsoFromUnixMilliseconds(unixMilliseconds);
    return Object.freeze({
        unixMilliseconds,
        iso,
    });
}

export function createUtcInstantFromIso(iso: UtcTimestampIsoString): UtcInstant {
    const unixMilliseconds = parseSaveTimestampUtcIsoToUnixMilliseconds(iso);
    if (unixMilliseconds === undefined) {
        assertSaveTimestampUtcIsoString(iso);
    }

    return Object.freeze({
        unixMilliseconds: unixMilliseconds as number,
        iso,
    });
}

export function createMonotonicSessionTimeFromMilliseconds(milliseconds: number): MonotonicSessionTime {
    const validMilliseconds = requireNonNegativeFinite(milliseconds, 'milliseconds');
    return Object.freeze({
        milliseconds: validMilliseconds,
        seconds: validMilliseconds / 1000,
    });
}

export function calculateMonotonicElapsedSeconds(
    previousSeconds: MonotonicSessionSeconds,
    currentSeconds: MonotonicSessionSeconds,
): number {
    return Math.max(0, requireNonNegativeFinite(currentSeconds, 'currentSeconds') - requireNonNegativeFinite(previousSeconds, 'previousSeconds'));
}

export function calculateMonotonicElapsedMilliseconds(
    previousMilliseconds: MonotonicSessionMilliseconds,
    currentMilliseconds: MonotonicSessionMilliseconds,
): number {
    return Math.max(
        0,
        requireNonNegativeFinite(currentMilliseconds, 'currentMilliseconds') -
            requireNonNegativeFinite(previousMilliseconds, 'previousMilliseconds'),
    );
}

export function calculateUtcElapsedSeconds(
    startUtcIso: UtcTimestampIsoString | null | undefined,
    endUtcIso: UtcTimestampIsoString | null | undefined,
): UtcElapsedSecondsResult {
    if (startUtcIso === null || startUtcIso === undefined) {
        return utcElapsed('missing_start', 0, null, null, normalizeNullableUtc(endUtcIso));
    }

    if (endUtcIso === null || endUtcIso === undefined) {
        return utcElapsed('missing_end', 0, null, normalizeNullableUtc(startUtcIso), null);
    }

    const startMs = parseSaveTimestampUtcIsoToUnixMilliseconds(startUtcIso);
    if (startMs === undefined) {
        return utcElapsed('invalid_start', 0, null, startUtcIso, endUtcIso);
    }

    const endMs = parseSaveTimestampUtcIsoToUnixMilliseconds(endUtcIso);
    if (endMs === undefined) {
        return utcElapsed('invalid_end', 0, null, startUtcIso, endUtcIso);
    }

    const rawElapsedSeconds = (endMs - startMs) / 1000;
    if (rawElapsedSeconds < 0) {
        return utcElapsed('backwards', 0, rawElapsedSeconds, startUtcIso, endUtcIso);
    }

    return utcElapsed('valid', rawElapsedSeconds, rawElapsedSeconds, startUtcIso, endUtcIso);
}

export function createSaveEnvelopeMetadataFromClock(
    timeService: TimeService,
    input: SaveMetadataClockInput,
): SaveEnvelopeMetadata {
    return Object.freeze({
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: input.gameVersion,
        contentVersion: input.contentVersion,
        savedAtUtc: timeService.nowUtcIso(),
    });
}

export function requireNonNegativeFinite(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new TimeServiceInputError(`${label} must be a non-negative finite number.`);
    }

    return value;
}

function utcElapsed(
    status: UtcElapsedStatus,
    elapsedSeconds: number,
    rawElapsedSeconds: number | null,
    startUtcIso: UtcTimestampIsoString | null,
    endUtcIso: UtcTimestampIsoString | null,
): UtcElapsedSecondsResult {
    return Object.freeze({
        status,
        elapsedSeconds,
        rawElapsedSeconds,
        startUtcIso,
        endUtcIso,
    });
}

function normalizeNullableUtc(value: UtcTimestampIsoString | null | undefined): UtcTimestampIsoString | null {
    return value === undefined ? null : value;
}
