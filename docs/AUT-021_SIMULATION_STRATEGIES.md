# AUT-021 Simulation Strategies

AUT-021 adds deterministic policy strategies on top of the AUT-020 headless simulator. Strategies choose legal commands and time advancement. They do not mutate `GameState` directly and they do not duplicate economy, Breakthrough, milestone, boost, prestige, or Next Goal formulas.

## Interface

`SimulationStrategy<TConfig>` is exported from `assets/scripts/simulation/index.ts`.

Each strategy exposes:

- `id`: stable strategy id suitable for later reports.
- `family`: `active`, `normal`, `passive`, `optimized`, or `scripted`.
- `config`: typed assumptions that affect decisions.
- `assumptions`: human-readable notes describing the policy.
- `run(context)`: executes against a `HeadlessSimulator`.

`runSimulationStrategy(repository, strategy, options)` creates or consumes a `HeadlessSimulator`, runs the strategy, and returns a normal AUT-020 `SimulationReport`. All strategy reports share the same core metric schema as existing simulator reports.

## Built-In Strategy IDs

- `active.v1`
- `normal.v1`
- `passive.v1`
- `optimized.v1`
- `scripted.v1:<scriptId>`

## Shared Built-In Configuration

Built-in progression strategies expose these assumptions as typed config:

- `target`: progression target. Defaults to Advanced Robotics Complex Level 25, the current first prestige frontier.
- `maxSimulatedSeconds`: hard simulated-time guard.
- `maxPolicyDecisions`: hard decision-count guard.
- `decisionIntervalSeconds`: simulated active time between checks while waiting.
- `manualActionSeconds`: simulated time cost per manual production command when no automatic production exists.
- `maxLevelsPerPurchase`: purchase batch cap, or `null` for max legal affordable batches.
- `maxPurchaseBatchesPerDecision`: number of purchase batches allowed during one decision.
- `actionDelaySeconds`: simulated delay after a successful command.
- `useFreeOverclock`: whether the policy tries the real Free Overclock command.
- `reactToBoostTransitions`: whether waiting splits on boost active/cooldown transitions.

These values are simulation assumptions only. They are not authoritative economy or balance constants.

## Strategy Behavior

`active.v1` represents a highly engaged active player. It checks frequently, uses max legal purchases toward the current target, promptly satisfies Next Goal blockers, and uses Free Overclock whenever legally available.

`normal.v1` represents a regular active player. Defaults use a slower check cadence, modest purchase batches, and a short post-action delay. It uses Free Overclock only when available at a decision check.

`passive.v1` represents sparse active-session decisions. It advances active-session simulator time between checks, but does not invoke `advanceAutomation`, offline reports, or AUT-027-style app-close rewards. Passive in AUT-021 means infrequent active decisions, not real offline progression.

`optimized.v1` targets the configured progression state with legal commands only. It uses Next Goal, affordability, and runtime snapshots to satisfy blockers and push the frontier with maximum legal purchases. It does not mutate state, bypass costs, or copy economy formulas.

`scripted.v1:<scriptId>` executes a caller-provided deterministic sequence. Supported actions are:

- `executeCommand`
- `advanceTime`
- `advanceUntil`

Supported typed conditions include Industrial Output, producer level, Breakthrough ownership, Robots Built, Era reached, simulated time, and production/sec thresholds. Scripted strategy intentionally does not include a general scripting language or expression DSL.

## Determinism

No AUT-021 strategy uses `Math.random`, wall-clock time, timers, animation frames, or real waiting. Decision cadence is always simulated time.

Tie-breaking is deterministic:

- Next Goal order comes from the existing resolver and repository ordering.
- Breakthrough and producer choices follow existing config/repository order.
- Stable id sorting is used only where existing helper APIs already require it.

No stochastic behavior is currently introduced, so there is no seed parameter in AUT-021 defaults. If randomness is added later, it must use an explicit deterministic seed.

## AUT-022 Boundary

AUT-021 provides comparable strategy result structures. It does not add pacing thresholds, baseline pass/fail policy, or regression artifacts. AUT-022 owns pacing targets, baseline comparison, report diffing, and failure policy.
