# AUT-015 Robots Built

## Formula

Robots Built is run-scoped authoritative state stored on `RunState.robotsBuilt`.

```text
robotsBuiltPerSecond = 0.005 * RobotLineLevel
robotsBuiltDelta = robotsBuiltPerSecond * elapsedSeconds
```

Robot Line Level 0 returns exactly 0 Robots Built per second. Levels must be non-negative safe integers.

## Runtime Integration

`advanceAutomation` advances Robots Built from the current Robot Line level using elapsed seconds. The runtime mutates a cloned draft and commits only after state validation, preserving the existing atomic mutation semantics.

Breakthrough requirements continue to read `RunState.robotsBuilt`; crossing 10, 100, or 1000 Robots Built only makes the relevant Breakthrough eligible when all other requirements and IO cost are satisfied. It does not purchase Breakthroughs automatically.

## Precision Policy

Authoritative Robots Built remains fractional. Runtime and economy code do not round accumulated values. Partitioned ticks over the same elapsed time are considered equivalent within:

```text
max(1e-12, 32 * Number.EPSILON * max(1, abs(left), abs(right)))
```

## Deferred Behavior

Offline Robots Built simulation is not implemented in AUT-015. Boost multipliers, prestige reset behavior, permanent upgrades, UI display rounding, scene robots, and Cocos scene behavior remain deferred to later scoped tasks.
