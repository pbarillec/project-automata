export {
    TimeServiceInputError,
    calculateMonotonicElapsedMilliseconds,
    calculateMonotonicElapsedSeconds,
    calculateUtcElapsedSeconds,
    createMonotonicSessionTimeFromMilliseconds,
    createSaveEnvelopeMetadataFromClock,
    createUtcInstantFromIso,
    createUtcInstantFromUnixMilliseconds,
    requireNonNegativeFinite,
} from './TimeService.ts';

export {
    DefaultTimeService,
} from './DefaultTimeService.ts';

export {
    ManualTimeService,
} from './ManualTimeService.ts';

export {
    LifecycleTimeTracker,
} from './LifecycleTime.ts';

export type {
    MonotonicSessionMilliseconds,
    MonotonicSessionSeconds,
    MonotonicSessionTime,
    SaveMetadataClockInput,
    TimeService,
    UtcElapsedSecondsResult,
    UtcElapsedStatus,
    UtcInstant,
    UtcTimestampIsoString,
} from './TimeService.ts';

export type {
    ManualTimeServiceOptions,
} from './ManualTimeService.ts';

export type {
    LifecycleResumeBoundary,
    LifecycleSuspendBoundary,
    LifecycleTimeSnapshot,
} from './LifecycleTime.ts';
