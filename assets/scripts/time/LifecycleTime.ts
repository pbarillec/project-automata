import {
    calculateUtcElapsedSeconds,
} from './TimeService.ts';
import type {
    TimeService,
    MonotonicSessionTime,
    UtcElapsedSecondsResult,
    UtcInstant,
    UtcTimestampIsoString,
} from './TimeService.ts';

export interface LifecycleSuspendBoundary {
    readonly type: 'suspend';
    readonly suspendedAtUtc: UtcInstant;
    readonly suspendedAtMonotonic: MonotonicSessionTime;
    readonly persistedUtcTimestamp: UtcTimestampIsoString;
}

export interface LifecycleResumeBoundary {
    readonly type: 'resume';
    readonly resumedAtUtc: UtcInstant;
    readonly resumedAtMonotonic: MonotonicSessionTime;
    readonly previousSuspendedAtUtcIso: UtcTimestampIsoString | null;
    readonly candidateAbsence: UtcElapsedSecondsResult;
}

export interface LifecycleTimeSnapshot {
    readonly lastSuspendedAtUtcIso: UtcTimestampIsoString | null;
    readonly lastResumedAtUtcIso: UtcTimestampIsoString | null;
}

export class LifecycleTimeTracker {
    private readonly timeService: TimeService;
    private lastSuspendedAtUtcIso: UtcTimestampIsoString | null = null;
    private lastResumedAtUtcIso: UtcTimestampIsoString | null = null;

    constructor(timeService: TimeService) {
        this.timeService = timeService;
    }

    recordSuspend(): LifecycleSuspendBoundary {
        const suspendedAtUtc = this.timeService.nowUtc();
        this.lastSuspendedAtUtcIso = suspendedAtUtc.iso;

        return Object.freeze({
            type: 'suspend',
            suspendedAtUtc,
            suspendedAtMonotonic: this.timeService.nowMonotonic(),
            persistedUtcTimestamp: suspendedAtUtc.iso,
        });
    }

    recordResume(previousSuspendedAtUtcIso: UtcTimestampIsoString | null = this.lastSuspendedAtUtcIso): LifecycleResumeBoundary {
        const resumedAtUtc = this.timeService.nowUtc();
        this.lastResumedAtUtcIso = resumedAtUtc.iso;

        return Object.freeze({
            type: 'resume',
            resumedAtUtc,
            resumedAtMonotonic: this.timeService.nowMonotonic(),
            previousSuspendedAtUtcIso,
            candidateAbsence: calculateUtcElapsedSeconds(previousSuspendedAtUtcIso, resumedAtUtc.iso),
        });
    }

    getSnapshot(): LifecycleTimeSnapshot {
        return Object.freeze({
            lastSuspendedAtUtcIso: this.lastSuspendedAtUtcIso,
            lastResumedAtUtcIso: this.lastResumedAtUtcIso,
        });
    }
}
