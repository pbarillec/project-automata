# AUT-013 Game Runtime Command Boundary

## Purpose

AUT-013 introduces the pure, headless command boundary for the implemented economy. Callers submit typed commands to `GameRuntime`; they do not mutate authoritative `GameState` directly.

The runtime coordinates existing state, economy and progression modules. Producer cost/MAX math remains owned by `assets/scripts/economy/ProducerCost.ts`; milestone crossing remains owned by `ProducerMilestones.ts`; production math and elapsed production remain owned by `ProducerProduction.ts`; Breakthrough eligibility, purchase and effects remain owned by `assets/scripts/progression/Breakthroughs.ts`.

## Commands

Command contracts live in `assets/scripts/domain/Commands.ts`.

Implemented command types:

- `manualProduce`
- `buyProducerLevels`
- `buyMaxProducerLevels`
- `purchaseBreakthrough`

Commands use discriminated unions with explicit payload fields. Unknown command types, invalid producer IDs, invalid quantities, missing Breakthrough IDs and non-object payloads reject deterministically.

## Results

`GameRuntime.execute(command)` returns:

- `ok: true`, the normalized command and immutable domain events when committed.
- `ok: false`, a deterministic rejection reason, message, optional details and no events when rejected.

Rejected commands never commit state. Duplicate Breakthroughs, locked Breakthroughs, insufficient balance, invalid producer IDs, invalid quantities and malformed payloads return rejection results.

## State Ownership And Atomicity

`GameRuntime` owns the current `GameState` value. It clones and validates initial state on construction.

For state-changing commands, execution uses clone/apply/validate/commit semantics:

1. validate command payload;
2. delegate calculations or transactions to existing domain modules;
3. apply changes to a cloned draft;
4. validate the resulting `GameState`;
5. replace the runtime-owned state only after success.

`getStateSnapshot()` returns a deep clone. Mutating a snapshot cannot mutate runtime-owned state through shared references.

Persistence is intentionally not implemented in AUT-013.

## Manual Production

The only manual action modeled at this stage is `manualProduce`, which grants `1` Industrial Output per command. It updates run and lifetime production/action counters and emits production events. It does not implement automation, tick loops, offline progress or frame-count assumptions.

## Production Query

`GameRuntime.getProductionPerSecond()` is a read-only derived query. It composes existing AUT-009, AUT-010, AUT-011 and AUT-012 modules:

- producer base output;
- milestone-adjusted output;
- Breakthrough `ModifierSet`;
- elapsed production through `calculateElapsedProduction`.

The query does not persist derived values.

## Event Taxonomy

Domain event contracts live in `assets/scripts/domain/Events.ts`. Events are immutable descriptive outputs for future UI, presentation, audio, analytics and dirty-save tracking. They do not contain Cocos objects or presentation references.

Current event types:

- `productionGranted`
- `industrialOutputChanged`
- `producerLevelsPurchased`
- `producerConstructed`
- `producerMilestoneReached`
- `breakthroughPurchased`
- `automationStateChanged`
- `eraChanged`
- `progressionFlagChanged`
- `firstRobotProduced`

Events are emitted only for successful state changes that actually occurred.

## Event Ordering

Event order is deterministic per command.

Manual production:

1. `productionGranted`
2. `industrialOutputChanged`

Producer purchase and buy MAX:

1. `industrialOutputChanged`
2. `producerLevelsPurchased`
3. `producerConstructed`, only when the command constructs an unbuilt producer
4. `producerMilestoneReached` events in ascending milestone threshold order

Breakthrough purchase:

1. `industrialOutputChanged`
2. `breakthroughPurchased`
3. effect events in configured effect order, emitted only when the effect changed state

For `setProgressionFlag` effects, `progressionFlagChanged` is emitted first. If the changed flag is `first_robot: true`, `firstRobotProduced` follows immediately.

## Deferred Systems

AUT-013 does not implement:

- persistence or save transactions;
- automation ticking or full Era progression;
- Robots Built accumulation;
- boosts or Overclock commands;
- offline simulation;
- UI, scene behavior, Cocos imports, platform services or native integrations.
