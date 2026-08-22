# AUT-029 Reboot Civilization Transaction

## Eligibility

Reboot preview and confirmation use the AUT-018 Prestige Power and AI Core APIs. The current source contract defines no separate cooldown or arbitrary threshold, so Reboot is eligible when the projected AI Core reward is positive.

```text
eligible = preview.aiCoresToGain > 0
```

## Preview

`createRebootPreview(repository, state)` is pure and does not mutate `GameState`.

It exposes:

- current Civilization number;
- resulting Civilization number;
- stored current-run Prestige Power;
- current eligible durable production per second;
- projected AI Cores to gain;
- current and resulting AI Core wallet;
- the underlying AUT-018 prestige preview.

## Confirmed Transaction

Confirmed execution requires `confirmed: true` through `rebootCivilizationConfirmed()` or the `rebootCivilization` command. Confirmation recalculates preview from current authoritative state before applying the transaction, so stale preview data cannot grant stale rewards.

Successful execution:

- grants exactly the recalculated AI Core reward;
- increments Civilization by exactly one;
- resets `RunState` with `createFreshRunState()`;
- resets `BoostState` with `createFreshBoostState()`;
- increments `lifetime.rebootsCompleted`;
- updates `lifetime.highestCivilizationReached`;
- preserves persistent meta/settings/lifetime/monetization data as described below.

Duplicate execution against the already rebooted state is rejected because the fresh run has `prestigePowerPeak = 0`, producing a zero AI Core reward.

## Reset / Preserve Matrix

Reset:

- Industrial Output;
- producer levels/build state;
- automation state;
- purchased run Breakthroughs;
- current Era;
- Robots Built;
- run statistics;
- current-run Prestige peak;
- run progression flags;
- active boosts, cooldowns and boost charge state.

Preserved:

- AI Core wallet, plus newly granted Reboot reward;
- permanent upgrade ranks;
- account feature unlocks;
- durable entitlements;
- cosmetic ownership;
- settings;
- persistent monetization state;
- lifetime statistics, except Reboot counters that increment.

Civilization #2+ behavior is not special-cased in the transaction. Existing fresh-state and progression rules apply after the meta Civilization number increments, including Free Overclock availability.

## Events

Successful in-memory Reboot emits deterministic domain events in this order:

1. `aiCoresGranted`
2. `civilizationChanged`

These events describe the committed authoritative state change, but they are not sufficient for presentation to treat Reboot as complete.

`LifecycleSessionCoordinator.rebootCivilizationConfirmed()` appends `rebootCompleted` only on the durable `reboot_saved` path after the critical save succeeds. The resulting durable event order is:

1. `aiCoresGranted`
2. `civilizationChanged`
3. `rebootCompleted`

`reboot_persistence_failed` keeps the in-memory state change and the grant/change events, but does not expose `rebootCompleted`.

## Critical Save Boundary

The pure/domain transaction does not write storage files directly.

`LifecycleSessionCoordinator.rebootCivilizationConfirmed()` applies the in-memory runtime transaction and then requests a critical save through `PersistenceCoordinator` with reason `reboot`.

Results distinguish:

- `reboot_saved`: in-memory transaction committed and critical save succeeded;
- `reboot_persistence_failed`: in-memory transaction committed but critical save failed;
- `reboot_rejected`: no state change occurred;
- `pending_offline_preview`: Reboot was not attempted because a pending offline preview must be resolved first.

If persistence fails after the in-memory transaction succeeds, the authoritative session state is not rolled back. Callers must not present Reboot as durably completed unless the lifecycle result is `reboot_saved`.

## AUT-030 Deferral

AUT-029 only grants AI Cores. It does not spend AI Cores, buy permanent upgrades, respec permanent upgrades, add UI confirmation, or start any AUT-030 permanent-upgrade purchase flow.
