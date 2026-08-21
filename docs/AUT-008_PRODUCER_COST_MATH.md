# AUT-008 Producer Cost Math

## Scope

AUT-008 adds the pure TypeScript producer purchase-cost API used by later runtime, UI preview and simulator code. It does not mutate `GameState`, execute purchases, calculate production, resolve milestones or start AUT-009.

## Level Convention

The implementation follows `TECHNICAL_DESIGN.md`:

```text
Level 0 = producer unconstructed
Level 1 = producer constructed
next-level cost from current level L = baseCost * costGrowth^L
```

Buying Level 1 from Level 0 therefore costs exactly `baseCost`.

## Bulk Formula

For `baseCost = C`, `costGrowth = g`, current level `L` and purchase quantity `n`:

```text
bulkCost = C * g^L * (g^n - 1) / (g - 1)
```

`x1`, `x10`, arbitrary `n` and MAX all route through the same shared geometric implementation in `assets/scripts/economy/ProducerCost.ts`.

## MAX Algorithm

`calculateMaxAffordableProducerPurchase` first checks whether the next level is affordable. If not, it returns quantity `0` and cost `0`.

When at least one level is affordable, it estimates the maximum quantity with the analytical inverse:

```text
n <= log(1 + balance * (g - 1) / (C * g^L)) / log(g)
```

The estimate is then corrected with bounded growth and binary search. This avoids one-level-at-a-time iteration across large level ranges while preserving exact boundary behavior.

## Numerical Policy

Inputs are rejected deterministically when levels are negative or non-integer, quantities are non-positive or non-integer, balances are negative or non-finite, or producer cost config is invalid.

The API uses JavaScript `Number` as required for the MVP. Calculations that overflow to `NaN` or `Infinity` fail explicitly with `ProducerCostInputError`. A small affordability comparison tolerance is limited to boundary correction:

```text
absolute tolerance = 1e-12
relative tolerance = 32 * Number.EPSILON
```

This tolerance exists only to avoid rejecting mathematically exact boundaries because of floating-point representation. It is not used to hide invalid inputs or materially unaffordable purchases.

## Deferred Work

Purchase-state mutation, command execution, milestone effects, production math, UI affordability state and runtime orchestration are intentionally deferred to later AUT tasks.
