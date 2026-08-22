import {
    calculateMonotonicElapsedMilliseconds,
    calculateMonotonicElapsedSeconds,
    createMonotonicSessionTimeFromMilliseconds,
    createUtcInstantFromIso,
    createUtcInstantFromUnixMilliseconds,
    requireNonNegativeFinite,
} from './TimeService.ts';
import type {
    TimeService,
    MonotonicSessionMilliseconds,
    MonotonicSessionSeconds,
    MonotonicSessionTime,
    UtcInstant,
    UtcTimestampIsoString,
} from './TimeService.ts';

export interface ManualTimeServiceOptions {
    readonly utcIso?: UtcTimestampIsoString;
    readonly utcUnixMilliseconds?: number;
    readonly monotonicSeconds?: number;
    readonly monotonicMilliseconds?: number;
}

export class ManualTimeService implements TimeService {
    private utcUnixMilliseconds: number;
    private monotonicMilliseconds: number;

    constructor(options: ManualTimeServiceOptions = {}) {
        if (options.utcIso !== undefined && options.utcUnixMilliseconds !== undefined) {
            throw new Error('Specify either utcIso or utcUnixMilliseconds, not both.');
        }

        if (options.monotonicSeconds !== undefined && options.monotonicMilliseconds !== undefined) {
            throw new Error('Specify either monotonicSeconds or monotonicMilliseconds, not both.');
        }

        this.utcUnixMilliseconds = options.utcIso === undefined
            ? readUtcMilliseconds(options.utcUnixMilliseconds ?? 0)
            : createUtcInstantFromIso(options.utcIso).unixMilliseconds;
        this.monotonicMilliseconds = options.monotonicSeconds === undefined
            ? requireNonNegativeFinite(options.monotonicMilliseconds ?? 0, 'monotonicMilliseconds')
            : requireNonNegativeFinite(options.monotonicSeconds, 'monotonicSeconds') * 1000;
    }

    nowUtc(): UtcInstant {
        return createUtcInstantFromUnixMilliseconds(this.utcUnixMilliseconds);
    }

    nowUtcIso(): UtcTimestampIsoString {
        return this.nowUtc().iso;
    }

    setUtcIso(utcIso: UtcTimestampIsoString): UtcInstant {
        const instant = createUtcInstantFromIso(utcIso);
        this.utcUnixMilliseconds = instant.unixMilliseconds;
        return instant;
    }

    setUtcUnixMilliseconds(unixMilliseconds: number): UtcInstant {
        this.utcUnixMilliseconds = readUtcMilliseconds(unixMilliseconds);
        return this.nowUtc();
    }

    advanceUtcMilliseconds(milliseconds: number): UtcInstant {
        const advance = requireNonNegativeFinite(milliseconds, 'milliseconds');
        return this.setUtcUnixMilliseconds(this.utcUnixMilliseconds + advance);
    }

    advanceUtcSeconds(seconds: number): UtcInstant {
        const advance = requireNonNegativeFinite(seconds, 'seconds');
        return this.advanceUtcMilliseconds(advance * 1000);
    }

    nowMonotonic(): MonotonicSessionTime {
        return createMonotonicSessionTimeFromMilliseconds(this.monotonicMilliseconds);
    }

    nowMonotonicSeconds(): MonotonicSessionSeconds {
        return this.monotonicMilliseconds / 1000;
    }

    nowMonotonicMilliseconds(): MonotonicSessionMilliseconds {
        return this.monotonicMilliseconds;
    }

    setMonotonicMilliseconds(milliseconds: number): MonotonicSessionTime {
        this.monotonicMilliseconds = requireNonNegativeFinite(milliseconds, 'milliseconds');
        return this.nowMonotonic();
    }

    setMonotonicSeconds(seconds: number): MonotonicSessionTime {
        return this.setMonotonicMilliseconds(requireNonNegativeFinite(seconds, 'seconds') * 1000);
    }

    advanceMonotonicMilliseconds(milliseconds: number): MonotonicSessionTime {
        const advance = requireNonNegativeFinite(milliseconds, 'milliseconds');
        return this.setMonotonicMilliseconds(this.monotonicMilliseconds + advance);
    }

    advanceMonotonicSeconds(seconds: number): MonotonicSessionTime {
        const advance = requireNonNegativeFinite(seconds, 'seconds');
        return this.advanceMonotonicMilliseconds(advance * 1000);
    }

    elapsedMonotonicSecondsSince(previousSeconds: MonotonicSessionSeconds): number {
        return calculateMonotonicElapsedSeconds(previousSeconds, this.nowMonotonicSeconds());
    }

    elapsedMonotonicMillisecondsSince(previousMilliseconds: MonotonicSessionMilliseconds): number {
        return calculateMonotonicElapsedMilliseconds(previousMilliseconds, this.nowMonotonicMilliseconds());
    }
}

function readUtcMilliseconds(value: number): number {
    return createUtcInstantFromUnixMilliseconds(value).unixMilliseconds;
}
