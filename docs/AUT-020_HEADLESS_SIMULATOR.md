# AUT-020 Headless Reference Simulator

## Purpose

AUT-020 adds a deterministic, reusable headless simulator around the real `GameRuntime`. It is intended for balancing automation and regression checks, not for a second economy implementation.

The simulator uses:

- the same JSON-backed `GameConfigRepository`;
- the same `GameState` model;
- the same `GameRuntime` command layer;
- the same economy, Breakthrough, Era, Robots Built, boost, permanent-upgrade, Next Goal and Prestige systems.

## Runtime Boundary

`HeadlessSimulator` owns simulated elapsed seconds and delegates gameplay changes to `GameRuntime`.

Supported simulator operations:

- `execute(command)`: submits a public runtime command and records command/events.
- `advanceTime(seconds)`: advances deterministic active-session time through `GameRuntime.advanceActiveSession`.
- `advanceUntil(condition, guard)`: advances deterministic time until a supplied condition becomes true or a guard fails.

The runtime command `advanceActiveSession` is active-session time. It grants authoritative online production for all producers, advances temporary boost timers and advances Robots Built through the existing runtime path. The older `advanceAutomation` command remains automated-only.

No wall-clock APIs are used in deterministic simulation logic. There is no `Date.now`, `setTimeout`, animation frame, scene, UI, platform, native or Cocos import in the simulator.

## Command-Only Policy

The reference scenario does not mutate authoritative run state to simulate purchases, Breakthroughs, production, boosts or progression.

Direct state reads are used only for:

- choosing the next legal command;
- checking deterministic wait conditions;
- recording metrics and assertions;
- constructing the initial fresh-state fixture.

Gameplay actions go through runtime commands:

- `manualProduce`;
- `advanceActiveSession`;
- `buyProducerLevels`;
- `purchaseBreakthrough`;
- `activateFreeOverclock`.

The policy uses `resolveNextGoal` wherever practical. A small policy layer handles affordability waits, producer-level blockers, Robots Built blockers, and the configured AUT-020 prestige frontier of Advanced Robotics Complex level 25.

## Time Advancement And Guards

`advanceUntil` requires:

- a deterministic condition;
- `maxSimulatedSeconds`;
- `maxIterations`;
- a fixed or computed step size.

If the condition cannot be reached within the guard, `SimulationGuardError` is thrown and the CLI exits non-zero.

The reference policy advances in deterministic chunks. It activates Free Overclock only through the real runtime command when unlocked and available. Boost expiry and cooldown are advanced by runtime boost logic.

## Metrics Schema

`SimulationMetricsCollector` is independent of presentation/UI and records:

- timestamped observations;
- one-shot checkpoints;
- command trace entries;
- domain event trace entries;
- final scenario summary.

Each observation includes:

- simulated active time;
- Industrial Output;
- online production per second;
- automated production per second;
- Robots Built;
- Robots Built per second;
- Era;
- Prestige Power;
- projected AI Core reward;
- configured P0;
- producer levels.

Major checkpoints are recorded at most once:

- Fabricator Level 10;
- Auto Feeder;
- Assembly Station;
- Worker Bot / First Robot;
- Robotic Logistics;
- Robot Line / Era II;
- Factory Control System;
- Automated Cell;
- Advanced Robotics / Robotics Complex Era III;
- first prestige frontier.

## Reference Scenario

Scenario ID: `civilization_1_active_reference`

The scenario starts from `createFreshGameState()` and progresses through Civilization #1 to the first-prestige frontier. It does not execute Reboot because the Reboot transaction belongs to AUT-029.

The AUT-020 frontier is:

```text
current era = robotics_complex
advanced_robotics_complex level >= 25
```

The report exposes the resulting Prestige Power and projected AI Core reward using the AUT-018 formula and the configured P0. The simulator never writes those results back into config.

Representative ECONOMY.md baseline timings are emitted in `representativeBaselineSeconds` for later comparison. They are report metadata, not economy logic or assertions.

## Reproducibility

Repeated runs from the same repository config and initial state produce structurally equivalent final summaries, checkpoint ordering and metrics. No random decision affects the reference scenario.

Changing the deterministic wait partition preserves final producer levels, checkpoint ordering and Prestige Power. Active timing can vary within the documented tolerance because command opportunities are evaluated at deterministic partition boundaries.

## CLI

Run the reference simulation headlessly:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\simulation\run_reference.ts --pretty
```

CI wrapper:

```powershell
.\tools\ci\simulate.ps1
```

By default the CLI prints JSON to stdout and does not write generated reports into source-controlled paths. To write a report explicitly:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\simulation\run_reference.ts --out .\temp\reference-report.json --pretty
```

## P0 Calibration Boundary

AUT-020 records the reference Prestige Power and projected AI Core reward. It does not rebalance P0, producer values, Breakthrough values, milestone multipliers, robot rate, permanent upgrades or prestige coefficients.

If the configured P0 is temporary or produces an unexpected comparison, the report still exposes the reference Prestige Power independently so later balancing work can calibrate P0 without changing simulator code.
