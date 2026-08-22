import {
    createMonotonicSessionTimeFromMilliseconds,
    createUtcInstantFromUnixMilliseconds,
    calculateMonotonicElapsedMilliseconds,
    calculateMonotonicElapsedSeconds,
} from './TimeService.ts';
import type {
    TimeService,
    MonotonicSessionMilliseconds,
    MonotonicSessionSeconds,
    MonotonicSessionTime,
    UtcInstant,
    UtcTimestampIsoString,
} from './TimeService.ts';

export class DefaultTimeService implements TimeService {
    private readonly monotonicOriginMilliseconds: number;

    constructor() {
        this.monotonicOriginMilliseconds = readNativeMonotonicMilliseconds();
    }

    nowUtc(): UtcInstant {
        return createUtcInstantFromUnixMilliseconds(Date.now());
    }

    nowUtcIso(): UtcTimestampIsoString {
        return this.nowUtc().iso;
    }

    nowMonotonic(): MonotonicSessionTime {
        return createMonotonicSessionTimeFromMilliseconds(this.nowMonotonicMilliseconds());
    }

    nowMonotonicSeconds(): MonotonicSessionSeconds {
        return this.nowMonotonicMilliseconds() / 1000;
    }

    nowMonotonicMilliseconds(): MonotonicSessionMilliseconds {
        return Math.max(0, readNativeMonotonicMilliseconds() - this.monotonicOriginMilliseconds);
    }

    elapsedMonotonicSecondsSince(previousSeconds: MonotonicSessionSeconds): number {
        return calculateMonotonicElapsedSeconds(previousSeconds, this.nowMonotonicSeconds());
    }

    elapsedMonotonicMillisecondsSince(previousMilliseconds: MonotonicSessionMilliseconds): number {
        return calculateMonotonicElapsedMilliseconds(previousMilliseconds, this.nowMonotonicMilliseconds());
    }
}

function readNativeMonotonicMilliseconds(): number {
    const performanceLike = globalThis.performance;
    if (performanceLike !== undefined && typeof performanceLike.now === 'function') {
        return performanceLike.now();
    }

    throw new Error('DefaultTimeService requires a native monotonic performance.now implementation.');
}
