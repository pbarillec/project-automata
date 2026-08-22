# AUT-030 Permanent Upgrade Purchase Transaction

AUT-030 connects the persistent AI Core wallet to AUT-017 permanent upgrade ranks. The transaction is headless TypeScript and does not add UI, respec, refund, monetization, new upgrade definitions, or cached permanent-effect state.

## Result taxonomy

The pure progression transaction returns:

- `success`
- `unknown_upgrade`
- `prerequisite_locked`
- `max_rank`
- `insufficient_ai_cores`
- `invalid_state`

Runtime command rejection reasons mirror those outcomes with command-facing names: `unknown_permanent_upgrade`, `permanent_upgrade_prerequisite_locked`, `permanent_upgrade_max_rank`, `insufficient_ai_cores`, and `invalid_permanent_upgrade_state`.

## Atomic state change

`purchasePermanentUpgrade(repository, state, upgradeId)` validates the current `GameState`, validates permanent rank records through AUT-017, resolves the target rank through `evaluatePermanentUpgradeRankState`, and uses the authoritative `nextRankCost`.

On success it mutates only cloned persistent `MetaState` fields:

- deducts exactly the next-rank AI Core cost from `meta.aiCores`;
- increments exactly one rank for exactly one upgrade ID in `meta.permanentUpgradeRanks`.

The transaction then validates the resulting state before returning it. Rejected purchases return before any committed state is exposed. `RunState` is not reset or mutated by permanent-upgrade purchase.

## Event order

Successful runtime purchases emit deterministic events in this order:

1. `aiCoreBalanceChanged`
2. `permanentUpgradePurchased`

These events describe the committed in-memory state change and are sufficient for future UI to show wallet and rank updates without duplicating effect math.

## Durability boundary

The pure transaction does not write files. `LifecycleSessionCoordinator.purchasePermanentUpgrade()` commits the runtime command in memory, marks persistence dirty, and requests a critical save through `PersistenceCoordinator` with reason `permanent_upgrade_purchase`.

Lifecycle results distinguish state success from durability success:

- `permanent_upgrade_saved`: in-memory purchase committed and critical save succeeded;
- `permanent_upgrade_persistence_failed`: in-memory purchase committed but critical save failed;
- `permanent_upgrade_rejected`: no in-memory purchase was committed and no save was requested.

If critical persistence fails after the in-memory purchase commits, the session state is not rolled back because the current persistence architecture does not provide cross-runtime/storage rollback.

## Derived effects

Permanent effects remain derived from `MetaState.permanentUpgradeRanks` through AUT-017. No duplicate effect cache is written to authoritative state. Production, Automation, and Expansion branch purchases affect subsequent production, Breakthrough automation, construction-cost, and major-requirement resolution through existing AUT-017/AUT-011 paths.

Deferred concerns remain out of AUT-030: upgrade-tree UI, respec/refund, bulk purchase, Discord, payments/IAP, and monetization around AI Cores.
