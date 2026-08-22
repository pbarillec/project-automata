# AUT-010 Milestones

## Data

Producer milestones are shared by all MVP producers and are loaded from `data/economy/milestones.json` through the existing config pipeline.

| ID | Level | Production multiplier |
|---|---:|---:|
| `level_10` | 10 | x2 |
| `level_25` | 25 | x2 |
| `level_50` | 50 | x3 |
| `level_100` | 100 | x5 |

The cumulative multiplier is multiplicative:

```text
Level < 10: x1
Level 10: x2
Level 25: x4
Level 50: x12
Level 100: x60
```

## Validation

Milestone config records require:

- non-empty `id`;
- positive integer `threshold`;
- positive finite `productionMultiplier`;
- unique IDs;
- unique thresholds;
- strictly ascending thresholds.

Malformed records and unsupported envelope data fail during the same parse, structural, semantic and repository validation stages used by the rest of the game config.

## Runtime Semantics

`calculateCumulativeMilestoneMultiplier` returns the product of all milestone effects whose threshold is less than or equal to the producer level.

`resolveCrossedProducerMilestones` detects newly crossed thresholds for a transition:

```text
oldLevel < threshold <= newLevel
```

Results are deterministic and ordered by ascending threshold. A transition from 9 to 50 returns levels 10, 25 and 50. A transition from 10 to 25 returns only level 25. Equal-level transitions and transitions that cross no threshold return an empty array.

Resolver functions are pure. They do not mutate config, producer records, level maps or any game state.

## Production Composition

Milestone-adjusted producer output is calculated by multiplying the existing AUT-009 base producer output by the authoritative cumulative milestone multiplier. The base formula remains owned by `ProducerProduction.ts`; milestone code does not duplicate it.

## Deferred Behavior

AUT-010 intentionally does not implement:

- generic `ModifierSet` aggregation, owned by AUT-011;
- purchase commands, state mutation, events or milestone-earned persistence, owned by AUT-013 and later runtime tasks;
- milestone UI, visual tiers, scene behavior or presentation timing.
