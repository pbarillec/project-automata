# AUT-009 Producer Production Math

## Scope

AUT-009 implements only pure deterministic base production math before milestones, breakthroughs, permanent upgrades, temporary boosts, runtime ticks, commands, state mutation, UI, Cocos integration or native/platform behavior.

## API Contract

The economy API in `assets/scripts/economy/ProducerProduction.ts` exposes:

- `calculateProducerBaseOutput(producer, level)`
- `calculateTotalProductionPerSecond(producers, levelsByProducerId)`
- `calculateElapsedProduction(productionPerSecond, elapsedSeconds)`
- `calculateElapsedProductionFromProducers(producers, levelsByProducerId, elapsedSeconds)`
- `isProductionApproximatelyEqual(left, right)`

`ProducerConfig.baseProductionPerLevel` from AUT-007 is the authoritative input. The implementation does not duplicate producer baseline constants.

## Base Production Formula

For AUT-009 only:

```text
producerBaseOutput = baseProductionPerLevel * level
```

Level 0 returns exactly 0. Level 1 returns exactly `baseProductionPerLevel`. Higher levels scale linearly.

Milestone multipliers, breakthrough multipliers, permanent upgrade multipliers and temporary multipliers are intentionally deferred to AUT-010, AUT-011 and later tasks.

## Total Production

Total production is the sum of base outputs for the supplied producer configs:

```text
totalProductionPerSecond = sum(producerBaseOutput)
```

The producer collection defines the authoritative set being evaluated. Missing entries in `levelsByProducerId` are treated as level 0. Extra level-map entries for unknown producer IDs are rejected.

## Elapsed Production

Elapsed production is time-based:

```text
produced = productionPerSecond * elapsedSeconds
```

The calculation depends only on elapsed seconds, not frame count or tick frequency. Partitioning the same total elapsed time into different tick sizes produces equivalent output within the exported floating tolerance.

## Validation Semantics

Invalid input is rejected with `ProducerProductionInputError`.

Rejected inputs include:

- missing or malformed producer configs;
- non-positive or non-finite `baseProductionPerLevel`;
- negative, non-integer or unsafe producer levels;
- malformed producer-level mappings;
- unknown producer IDs in level mappings;
- duplicate producer configs in total calculations;
- negative or non-finite `productionPerSecond`;
- negative or non-finite `elapsedSeconds`;
- calculations that exceed JavaScript `Number` range.

The functions do not mutate producer configs, producer collections, level mappings or state-like inputs.

## Deferred Behavior

AUT-009 deliberately does not implement:

- AUT-010 milestone thresholds or milestone effects;
- AUT-011 `ModifierSet` or advanced modifier aggregation;
- AUT-013 runtime ticks, commands, GameState mutation or domain events.
