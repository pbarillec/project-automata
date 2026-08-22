# AUT-027 Offline Progress

## Scope

AUT-027 adds the headless offline preview and collection boundary only.
It does not add UI popups, rewarded doubling, ad eligibility, native
lifecycle hooks, or direct persistence writes.

## Absence Calculation

Offline absence is calculated from a persisted UTC ISO timestamp and an
injected current UTC timestamp from `TimeService`.

The baseline configuration is centralized in `assets/scripts/offline`:

```text
efficiency = 0.75
capSeconds = 8 * 60 * 60
```

The effective offline duration is:

```text
effectiveOfflineSeconds = min(validAbsenceSeconds, capSeconds)
```

Zero, negative, backwards, missing, or malformed UTC intervals never
produce negative progress. Malformed and missing timestamps return a
typed invalid preview result. Backwards UTC clock skew returns a no-reward
preview with raw negative absence exposed for diagnostics.

## Producer Eligibility

Offline Industrial Output is calculated from durable production only.
Temporary production boosts are excluded.

Producer output reuses the existing production-rate path:

- producer base production;
- milestone multipliers;
- Breakthrough production modifiers;
- permanent upgrade modifiers.

Only producers whose effective automation state is both automated and
offline-eligible contribute to offline Industrial Output. Auto Feeder
therefore makes Fabricator eligible, while Worker Bot automation for
Assembly Station remains ineligible according to the current
Breakthrough data.

## Robots Built

Robots Built advances offline only when Robot Line is built and
automated. The same capped offline progress window and baseline
efficiency are applied to the existing Robots Built rate calculation:

```text
0.005 * RobotLineLevel
```

Offline collection does not buy Breakthroughs, levels, producers,
permanent upgrades, boosts, or Reboots.

## Preview

`createOfflineProgressPreview` is pure and does not mutate `GameState`.
It exposes:

- raw absence seconds;
- effective capped seconds;
- cap-applied status;
- per-producer contribution records using stable producer IDs;
- total eligible durable production per second;
- total Industrial Output reward;
- Robots Built delta.

## Collection

`collectOfflineProgress` applies exactly the supplied or freshly
calculated preview to a cloned state. On success it returns:

- the new authoritative state;
- the collected-through UTC timestamp;
- a critical-save request boundary for the persistence coordinator.

The offline module does not write storage directly and does not bypass
the atomic save repository. Reusing the returned collected-through UTC
timestamp as the next persisted absence cursor prevents collecting the
same represented absence twice.

Invalid and failed collections return no critical-save request and leave
the caller's authoritative state unchanged.

## Deferred Integrations

Deferred to later tasks:

- Factory Report UI;
- pending-report persistence across crash/reload;
- rewarded offline doubling;
- ad eligibility and quotas;
- native app hide/show lifecycle bindings.
