# AUT-011 Modifier Set

## Scope

AUT-011 adds a pure TypeScript `ModifierSet` boundary for production multipliers only. It does not implement Breakthrough resolution, permanent upgrade source logic, temporary boost state, commands, persistence, UI, or runtime ticks.

## Identity

An empty `ModifierSet` has no production multiplier entries. Resolving it returns:

```text
globalMultiplier = 1
producerMultipliers = {}
```

Any producer without a producer-specific entry also resolves to multiplier `1` before the global multiplier is applied.

## Composition Semantics

Supported production modifiers are intentionally explicit:

```text
globalProductionMultiplier
producerProductionMultiplier
```

Composition is multiplicative:

```text
effectiveProducerMultiplier =
    globalMultiplier
    * producerSpecificMultiplier
```

Modifier aggregation sorts cloned modifier entries before multiplication, so equivalent modifier sets produce deterministic effective results regardless of insertion order. `combineModifierSets` creates a new `ModifierSet` from cloned entries and does not mutate its inputs.

## Validation Rules

All multiplier values must be finite and strictly positive. `NaN`, `Infinity`, zero, and negative values are rejected with `ModifierSetInputError`.

Base production passed to `applyProductionMultiplier` must be finite and non-negative. Arithmetic that produces a non-finite result fails explicitly instead of returning `Infinity` or `NaN`. Applying any valid multiplier to zero base production returns zero.

## Milestone Integration

Milestones remain owned by AUT-010. The generic modifier path consumes the cumulative milestone multiplier returned by `calculateCumulativeMilestoneMultiplier` as a `producerProductionMultiplier`; it does not duplicate milestone threshold detection or milestone effect rules.

Representative path:

```text
AUT-009 calculateProducerBaseOutput
* AUT-010 calculateCumulativeMilestoneMultiplier
through ModifierSet producerProductionMultiplier
= modified producer output
```

## Deferred Sources

Breakthrough effects, permanent upgrades, temporary boosts, cost modifiers, automation modifiers, offline modifiers, and configuration-driven effect resolution are deferred to later tasks. They should feed typed modifier entries into this boundary when those systems are implemented.
