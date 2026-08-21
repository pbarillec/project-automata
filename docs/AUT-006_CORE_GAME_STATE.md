# AUT-006 Core Game State

## State Shape

`GameState` is a pure TypeScript data object composed of:

- `run`: resettable civilization-scoped state.
- `meta`: persistent state retained across future Reboot transactions.
- `boosts`: temporary boost timers, cooldowns and consumed-charge counters.
- `monetization`: local pending/request/cache state for later ad and purchase flows.
- `settings`: player preference values.
- `lifetime`: lifetime counters and highest civilization reached.

The contracts live in `assets/scripts/state/GameState.ts`. They intentionally use plain objects, arrays, numbers, strings, booleans and nulls so future save serialization can copy them without engine objects.

## Fresh State Defaults

`createFreshGameState()` builds a valid Civilization #1 state without requiring producer, Breakthrough, upgrade or monetization product data. Defaults are zero, empty object, empty array, `false` or `null` except for Civilization numbering:

- `meta.civilizationNumber = 1`
- `lifetime.highestCivilizationReached = 1`

No producer IDs, Breakthrough IDs, permanent upgrade IDs, boost IDs, product IDs or era IDs are invented by this task.

## Validation Contract

`validateGameState()` returns deterministic diagnostics sorted by path and code. It validates:

- top-level and nested object structure.
- non-finite numbers.
- negative values where balances/counters/timers cannot be negative.
- positive integer Civilization numbering.
- malformed records, arrays and duplicate ID arrays.
- accidental storage of derived authoritative fields such as production/sec, next cost, can-afford flags, Next Goal, visual tier and effective temporary multiplier.

Validation does not apply future economy rules, config references, producer baselines, purchase rules, Reboot eligibility or progression decisions.

## Clone Semantics

`cloneGameState()` recursively copies plain nested objects and arrays. Mutating nested records or arrays in the clone does not alias the source state.

## Deferred Fields

The following remain intentionally deferred to later tasks and data:

- producer definitions and economy baselines.
- Breakthrough definitions and effects.
- permanent upgrade definitions.
- monetization product and entitlement IDs.
- runtime commands, purchases, Reboot transactions and persistence envelopes.
- derived economic/UI values, including production/sec, next producer cost, milestone multipliers, can-afford flags, Next Goal, visual tier and effective temporary multiplier.

