# AUT-026 TimeService

## Responsibility Split

Project Automata now has one clock boundary under `assets/scripts/time`.

- UTC wall-clock time is represented as canonical SaveEnvelope UTC ISO-8601 timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`) and Unix milliseconds.
- Monotonic session time is represented as active-session seconds or milliseconds since the injected clock's session origin.
- Runtime active elapsed calculations use monotonic session time only.
- Persisted save and lifecycle timestamps use UTC only.

UTC may move backwards when the device clock changes. Monotonic elapsed helpers clamp negative elapsed durations to zero. Cross-process or app-close absence candidates are computed from UTC timestamps, not monotonic session time.

## Implemented Boundary

- `TimeService` exposes current UTC and current monotonic session time.
- `DefaultTimeService` is the production implementation behind the abstraction and uses native wall-clock/current monotonic APIs internally.
- `ManualTimeService` is deterministic for tests and supports explicit UTC control plus explicit monotonic advancement without timers or sleeping.
- `LifecycleTimeTracker` records suspend and resume boundaries and exposes UTC timestamps for future absence calculation.

The lifecycle primitives do not grant resources and do not calculate offline production rewards.

## Persistence Contract

Time helpers reuse the AUT-023 SaveEnvelope timestamp contract:

- `createSaveTimestampUtcIsoFromUnixMilliseconds`
- `parseSaveTimestampUtcIsoToUnixMilliseconds`
- `isSaveTimestampUtcIsoString`
- `assertSaveTimestampUtcIsoString`

`createSaveEnvelopeMetadataFromClock` lets orchestration create save metadata from an injected `TimeService`. Serialization still receives explicit metadata; persistence serialization does not call a clock directly.

## Runtime Contract

`GameRuntime.advanceActiveSessionFromClock()` is available when a `TimeService` is injected into `GameRuntime`. It advances gameplay from monotonic active-session elapsed time and is unaffected by UTC clock jumps.

Pure economy, domain and progression math continues to receive `elapsedSeconds` and does not import `TimeService`.

## AUT-027 Deferral

AUT-026 intentionally does not implement:

- offline production rewards;
- offline eligibility rules;
- offline caps;
- pending offline report persistence;
- Cocos lifecycle event subscriptions;
- native platform lifecycle code.

AUT-027 can consume `savedAtUtc`, suspend UTC timestamps and resume UTC timestamps to calculate a candidate absence interval, then apply offline production rules separately.
