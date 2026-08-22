# AUT-016 Unified Boost System

## Baseline

Free Overclock is implemented as a temporary production boost:

- boost id: `free_overclock`
- multiplier: `2.0`
- active duration: `60` active-session seconds
- cooldown: `240` active-session seconds
- stacking: false for the same boost id

## Unlock Rule

Civilization 1 unlocks Free Overclock after the existing Worker Bot / First Robot progression state is reached. The implementation reads the existing `first_robot` progression flag and the existing `worker_bot` breakthrough ownership rather than adding another ownership flag.

Civilization 2 and later treat Free Overclock as unlocked from the start of the civilization.

## Timer And Cooldown Semantics

Temporary boost timers advance from active-session elapsed seconds through the runtime `advanceAutomation` path. Elapsed time is deterministic and validated as non-negative finite seconds.

Free Overclock uses distinct active and cooldown phases:

1. activation creates exactly 60 seconds of active x2 production;
2. expiration removes the temporary multiplier and creates a 240 second cooldown;
3. elapsed time beyond the active boundary continues into cooldown progression;
4. remaining active and cooldown timers are clamped at zero and zero cooldown records are removed.

Activation while locked, already active, suspended, or cooling down is rejected without mutating state.

## Multiplier Resolution

Temporary production boosts share one typed representation. Each boost has a production multiplier effect and the effective temporary production multiplier is:

```text
max(active unsuspended temporary production multipliers)
```

No active unsuspended boost resolves to the identity multiplier `1`. Two simultaneous x2 boosts resolve to x2, not x4. A higher future boost supersedes lower active values through the same resolver.

The resolved temporary multiplier is converted into the existing AUT-011 `ModifierSet` path as a global production multiplier. Production formulas are not duplicated.

## Suspension And Resume

Temporary boosts support suspension and resume primitives. Suspending Free Overclock preserves its exact remaining active duration and excludes it from effective multiplier resolution. Active-session time advanced while suspended does not consume the suspended remaining duration. Resuming restores normal active countdown from the preserved value.

These primitives are intended for future Extended Overclock behavior, where a higher-priority temporary boost suspends Free Overclock and Free Overclock resumes afterward.

## Deferred Integration

AUT-016 does not implement:

- rewarded Extended Overclock eligibility, quota, ad flow, or activation transaction;
- Founder Factory Surge inventory or purchase flow;
- offline catch-up, wall-clock lifecycle, or TimeService integration;
- UI, scene, platform, native, AdsService, or purchase code.

Application close behavior is represented by the suspension/resume primitives only. Later lifecycle/offline tasks own app backgrounding, wall-clock, save, and offline production integration.
