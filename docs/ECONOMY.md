# Project Automata --- ECONOMY

**Status:** Economy Design candidate for Economy/Monetization Gate\
**Date:** 2026-08-15\
**Phase owner:** Economy & Monetization Designer\
**Primary gameplay reference:** `GAME_DESIGN.md`

> This document is the economy source of truth for the current Project
> Automata MVP candidate. Numerical values marked as balancing baselines
> are simulation-supported starting points and remain tunable after
> implementation and playtesting.

------------------------------------------------------------------------

## 1. Economy Goals

Project Automata must make the player feel:

> **"I am constantly progressing, my decisions matter, my factory
> becomes exponentially more powerful, and I always want to reach the
> next objective."**

The economy protects the core design rule:

> **Automate labor, not decisions.**

Automation removes repetitive operational work. It must not autonomously
choose producer investments, Breakthroughs, era transitions, Reboot
timing, or permanent upgrades.

The MVP economy supports:

1.  rapid early acceleration;
2.  visible short-term goals;
3.  meaningful investment trade-offs;
4.  increasingly automated production;
5.  three complete MVP eras;
6.  a substantial first Reboot;
7.  permanent acceleration through AI Cores;
8.  viable Active, Normal, and Passive play patterns;
9.  data-driven balancing.

------------------------------------------------------------------------

## 2. Status Vocabulary

### APPROVED DESIGN DIRECTION

Inherited from validated project/game design:

-   one primary run currency;
-   five producers;
-   Levels + Milestones + Breakthroughs;
-   Manual Workshop → Automated Factory → Robotics Complex;
-   visible robots without complex robot management;
-   Free Overclock;
-   automated-only offline production;
-   Reboot Civilization;
-   AI Cores;
-   Production / Automation / Expansion permanent progression;
-   Growth Runs and Push Runs;
-   player-triggered prestige;
-   no automatic major progression decisions offline.

### SIMULATION-SUPPORTED BASELINE

The numerical values in this document are the current
implementation/balancing baseline. They are not immutable and should
remain configurable.

------------------------------------------------------------------------

## 3. Core Resources

### 3.1 Industrial Output

**Working name:** Industrial Output (`IO`)

Industrial Output is the single primary run currency.

Primary sinks:

-   producer construction;
-   producer levels;
-   Breakthroughs;
-   automation;
-   progression toward new production tiers.

The MVP does not introduce intermediate authoritative resources.

### 3.2 AI Cores

AI Cores are the permanent prestige resource.

They are:

-   earned through Reboot Civilization;
-   retained through Reboots;
-   spent on permanent upgrades;
-   not directly purchasable with real money in the MVP economy;
-   not generated automatically offline.

------------------------------------------------------------------------

## 4. Core Production Formula

Conceptually:

``` text
producerOutput =
    baseProductionPerLevel
    × level
    × milestoneMultiplier
    × breakthroughMultipliers
    × permanentUpgradeMultipliers
    × temporaryMultiplier
```

Total production:

``` text
totalProductionPerSecond =
    sum(all active producer outputs)
```

Producer level purchase cost:

``` text
cost(nextLevel) =
    baseCost × costGrowth^(currentLevel)
```

Exact indexing (`level` vs `level - 1`) must be standardized by
Technical Design. The balancing tool and runtime must use the same
convention.

------------------------------------------------------------------------

## 5. Number Presentation

Use compact notation:

``` text
1K
1M
1B
1T
1Qa
1Qi
...
```

MVP UI should prefer approximately 3--4 significant digits where
practical.

Examples:

``` text
1,240        → 1.24K
18,530,000   → 18.5M
2,610,000,000 → 2.61B
```

Full precision is unnecessary on the main factory screen.

------------------------------------------------------------------------

## 6. Producer Baseline

  ------------------------------------------------------------------------------
  Producer     Era             Base Cost   Cost Growth          Base Initial
                                                        Production / State
                                                               Level 
  ------------ ----------- ------------- ------------- ------------- -----------
  Fabricator   Manual                 10          1.14        1 IO/s Manual
               Workshop                                              

  Assembly     Manual               1.5K          1.15       12 IO/s Assisted
  Station      Workshop                                              

  Robot Line   Automated             50K          1.16      150 IO/s Automated
               Factory                                               

  Automated    Automated              5M          1.17     2.5K IO/s Automated
  Cell         Factory                                               

  Advanced     Robotics             500M          1.18     500K IO/s Automated
  Robotics     Complex                                               
  Complex                                                            
  ------------------------------------------------------------------------------

These values are **simulation-supported baselines**, not hard-coded
constants.

### Producer roles

**Fabricator**\
Introduces production, levels, milestones, and first automation. It
remains economically relevant through milestones and early Breakthrough
synergies.

**Assembly Station**\
Introduces assisted production and the First Robot payoff. It becomes
automated through Worker Bot.

**Robot Line**\
Marks the transition to Automated Factory and generates the cumulative
Robots Built progression.

**Automated Cell**\
Represents self-automating industrial architecture. It begins automated
and creates a major scale increase.

**Advanced Robotics Complex**\
Frontier producer of the MVP. It drives late Robotics Complex
progression and the first prestige frontier.

------------------------------------------------------------------------

## 7. Milestones

Shared MVP producer milestones:

    Level               Reward
  ------- --------------------
       10   ×2 producer output
       25   ×2 producer output
       50   ×3 producer output
      100   ×5 producer output

Cumulative maximum milestone multiplier at Level 100:

``` text
2 × 2 × 3 × 5 = ×60
```

Milestones are intentionally large. They must create visible short-term
targets and occasionally make pushing an existing producer rational
instead of saving exclusively for the next producer.

------------------------------------------------------------------------

## 8. Breakthroughs

### B1 --- Auto Feeder

``` yaml
unlock:
  FabricatorLevel: 15
cost: 1.5K IO
effects:
  FabricatorAutomated: true
  FabricatorOutputMultiplier: 1.25
  FabricatorOfflineEligible: true
target_first_run: 1.5–2.5 min
```

Primary reward: first automation.

### B2 --- Worker Bot

``` yaml
unlock:
  AssemblyLevel: 10
cost: 75K IO
effects:
  AssemblyAutomated: true
  AssemblyOutputMultiplier: 1.50
  FirstRobot: true
target_first_run: 6.5–9 min
```

Primary reward: First Robot and removal of assisted labor.

### B3 --- Robotic Logistics

``` yaml
unlock:
  WorkerBotOwned: true
  FabricatorLevel: 25
  AssemblyLevel: 15
cost: 250K IO
effects:
  FabricatorOutputMultiplier: 2.0
  AssemblyOutputMultiplier: 2.0
target_first_run: 12–18 min
```

Purpose: renew the value of early producers before the factory-scale
transition.

### Era II Construction --- Robot Line

``` yaml
requirements:
  AutoFeeder: true
  WorkerBot: true
  RoboticLogistics: true
  FabricatorLevel: 50
  AssemblyLevel: 25
constructionCost: 500K IO
effect:
  constructRobotLineLevel1: true
  enterEra: Automated Factory
target_first_run: 15–25 min
```

The producer construction itself is the Era transition. No duplicate
"technology unlock + producer purchase" payment should be introduced.

### B4 --- Factory Control System

``` yaml
unlock:
  RobotLineLevel: 10
  RobotsBuilt: 10
cost: 3M IO
effects:
  GlobalProductionMultiplier: 2.0
target_first_run: 25–40 min
```

### B5 --- Automated Cell Architecture

``` yaml
unlock:
  RobotLineLevel: 25
  RobotsBuilt: 100
cost: 25M IO
effects:
  constructAutomatedCellLevel1: true
target_first_run: 40–75 min
```

### B6 --- Advanced Robotics

``` yaml
unlock:
  RobotLineLevel: 50
  AutomatedCellLevel: 25
  RobotsBuilt: 1000
cost: 1B IO
effects:
  constructAdvancedRoboticsLevel1: true
  enterEra: Robotics Complex
target_first_run_active: 2–3.5 h
```

**Important balancing history:** the earlier 25B construction / 5B
producer-cost configuration produced an unacceptable late-game wall in
simulation. The 1B construction and 500M producer base cost are
deliberate corrections.

### B7-class Event --- Reboot Civilization

Reboot is treated economically as the prestige frontier rather than a
normal run upgrade. See Section 14.

------------------------------------------------------------------------

## 9. Era Structure

### Era I --- Manual Workshop

Fantasy:

> I work → my machines work.

Key progression:

``` text
Fabricator
→ Auto Feeder
→ Assembly Station
→ Worker Bot
→ Robotic Logistics
→ Robot Line
```

### Era II --- Automated Factory

Fantasy:

> Automated machines → automated industrial systems.

Key progression:

``` text
Robot Line
→ Factory Control System
→ Automated Cell
→ Advanced Robotics
```

### Era III --- Robotics Complex

Fantasy:

> My factory builds its own workers and prepares the next civilization.

Key progression:

``` text
Advanced Robotics levels
→ milestones
→ higher Prestige Power
→ Reboot Civilization
```

### Era IV --- AI Megafactory

Teaser only in MVP. Full gameplay is POST-MVP.

------------------------------------------------------------------------

## 10. Robots Built

Robots are a cumulative run milestone, not a spendable currency and not
individually managed.

Baseline:

``` text
robotsBuiltPerSecond =
    0.005 × RobotLineLevel
```

Examples:

    Robot Line Level   Robot Rate
  ------------------ ------------
                   1    1 / 200 s
                  10     1 / 20 s
                  25      1 / 8 s
                  50      1 / 4 s
                 100      1 / 2 s

Key thresholds:

``` text
1      First Robot exceptional event
10     Factory Control eligibility
100    Automated Cell eligibility
1,000  Advanced Robotics eligibility
```

`Robots Built` resets on Reboot.

The thresholds should contribute to anticipation without normally
becoming the sole bottleneck.

------------------------------------------------------------------------

## 11. Pacing Targets

### First-session / first-run targets

  Event                                                          Target
  -------------------------------- ------------------------------------
  First meaningful milestone                                    \<1 min
  Auto Feeder                                              1.5--2.5 min
  Assembly Station                                             3--5 min
  First Robot                                                6.5--9 min
  Robotic Logistics                                          12--18 min
  Automated Factory / Robot Line                             15--25 min
  Factory Control                                            25--40 min
  Automated Cell                                             40--75 min
  Robotics Complex                                      2--3.5 h active
  First Reboot                       4--7 h active economic progression

The first hour should maintain meaningful events approximately every
3--10 minutes. Minor milestones may occur more frequently.

### Dead-zone rule

If the player has:

-   no meaningful decision;
-   no nearby visible unlock;
-   no useful interaction;

for several minutes, treat the segment as a dead zone.

First tuning levers:

1.  costs;
2.  production;
3.  milestone placement;
4.  Breakthrough multipliers;
5.  unlock requirements;
6.  Overclock;
7.  offline tuning.

Do not add a new feature as the first solution.

------------------------------------------------------------------------

## 12. Free Overclock

Baseline:

``` yaml
multiplier: 2.0
durationSeconds: 60
cooldownSeconds: 240
stacking: false
```

Cycle:

``` text
60 s active + 240 s cooldown = 300 s
```

Maximum sustained production advantage under perfect usage:

``` text
(4 min ×1 + 1 min ×2) / 5 min
= ×1.20 average
```

### Unlock

Civilization #1:

``` text
unlock after First Worker Bot
```

Civilization #2+:

``` text
available from civilization start
```

### App close behavior

If the application closes during Free Overclock:

``` text
pause remaining Overclock timer
```

Do not allow Free Overclock to produce ×2 offline.

------------------------------------------------------------------------

## 13. Offline Progression

### Formula

``` text
offlineEarnings =
    automatedProductionPerSecond
    × min(timeAway, 8h)
    × 0.75
```

Baseline:

``` yaml
efficiency: 0.75
capHours: 8
automatedOnly: true
```

### Rules

Offline may:

-   generate Industrial Output from automated producers;
-   advance Robots Built when Robot Line is automated;
-   advance cumulative production statistics.

Offline may not:

-   buy producer levels;
-   construct producers;
-   buy Breakthroughs;
-   trigger major era transitions;
-   Reboot Civilization;
-   spend AI Cores;
-   choose permanent upgrades.

This restriction is strategically important: a player may return with
enough IO to unlock a frontier, but the player must return and make that
decision.

### Return flow

Factory Report should show:

-   time away;
-   effective time used;
-   Industrial Output generated;
-   Robots Built if useful;
-   Collect;
-   immediately surface the newly reachable Next Goal.

First educational return should explicitly show which producers were
automated and which were not.

------------------------------------------------------------------------

## 14. Reboot Civilization

### Appearance

Reboot becomes visible around entry into late Robotics Complex.

The UI should preview:

-   AI Cores earned now;
-   progress toward next AI Core;
-   reset consequences;
-   permanent upgrades available.

### First viable Reboot

Baseline target:

``` text
Advanced Robotics Complex ≈ Level 25
Prestige reward ≈ 5 AI Cores
```

Expected first-run timing:

``` text
Active optimized: ~4–5 h
Active less optimized: ~5–5.5 h
Normal: ~30–36 h calendar time
Passive: ~2–3 calendar days
```

### Reset

Reset:

-   Industrial Output;
-   producer levels;
-   producer unlocks;
-   Breakthroughs;
-   run automation states;
-   Robots Built;
-   current Era;
-   temporary boosts;
-   run-specific Next Goal progression.

Persist:

-   AI Cores;
-   permanent upgrade ranks;
-   Civilization number;
-   account-level feature unlocks such as known Free Overclock;
-   lifetime statistics/settings.

No automatic Reboot offline.

------------------------------------------------------------------------

## 15. Prestige Power & AI Core Formula

### Prestige Power

``` text
PrestigePower =
    highest sustained base production/sec
    reached during the current Civilization
```

Include:

-   producer levels;
-   milestones;
-   run Breakthroughs;
-   gameplay-earned permanent upgrades.

Exclude temporary effects:

-   Free Overclock;
-   rewarded Extended Overclock;
-   purchased temporary Factory Surge.

This prevents a temporary boost immediately before Reboot from directly
inflating AI Core reward.

### Baseline

Define:

``` text
P0 =
PrestigePower produced by the reference first-Reboot state
around Advanced Robotics Level 25 in Civilization #1
```

`P0` should be generated/recorded by the balancing simulation using the
exact runtime formula.

### AI Core reward

``` text
AI Cores =
floor(
    5 × sqrt(PrestigePower / P0)
)
```

First eligible Reboot should yield at least approximately 5 AI Cores.

Examples:

    Prestige Power   AI Cores
  ---------------- ----------
             1× P0          5
             2× P0          7
             4× P0         10
             9× P0         15
            16× P0         20
            25× P0         25
           100× P0         50

### Next Core requirement

For target `N` AI Cores:

``` text
requiredPrestigePower(N) =
    P0 × (N / 5)^2
```

This enables an exact "Next Core progress" UI.

------------------------------------------------------------------------

## 16. Growth Runs vs Push Runs

### Growth Run

Reboot relatively early to acquire permanent acceleration.

Best suited to:

-   Automation;
-   Expansion;
-   rapid AI Core accumulation.

### Push Run

Remain in the current Civilization longer to:

-   increase Prestige Power;
-   reach higher milestones;
-   pursue records/frontier progress;
-   earn a larger future Core reward.

The square-root reward curve creates diminishing returns without an
artificial prestige cooldown.

### Mature Growth Run floor

Balancing target:

``` text
Growth Run should generally not fall below ~60–90 minutes
within the MVP content.
```

This is not a hard cooldown. If permanent upgrades compress mature runs
below this range, tune late upgrade strength/costs.

------------------------------------------------------------------------

## 17. Permanent AI Core Upgrades

MVP: **8 upgrade types / 19 total ranks**.

Respec:

``` text
free only between Civilizations
```

No mid-run respec, to prevent constant Automation → Expansion →
Production swapping.

### Production Branch

#### P1 --- Optimized Fabrication

``` yaml
maxRank: 3
costs: [1, 2, 4]
effectPerRank:
  globalProductionMultiplier: 1.25
```

Cumulative:

``` text
R1 ×1.25
R2 ×1.5625
R3 ×1.953125
```

#### P2 --- Industrial Scaling

``` yaml
unlock: P1 Rank 1
maxRank: 3
costs: [2, 4, 7]
effectPerRank:
  milestonePowerBonus: +20%
```

At maximum rank, producer milestone effects are strengthened by 60%
relative to baseline. Exact multiplier composition must be explicit in
Technical Design.

#### P3 --- Autonomous Optimization

``` yaml
unlock: P1 Rank 2
maxRank: 2
costs: [5, 10]
effectPerRank:
  automatedProducerMultiplier: 1.5
```

Max cumulative: ×2.25 to automated producers.

### Automation Branch

#### A1 --- Cached Procedures

``` yaml
maxRank: 2
costs: [2, 5]
rank1:
  AutoFeederRequiredFabricatorLevel: 10
  AutoFeederCostMultiplier: 0.50
rank2:
  AutoFeederAvailableImmediately: true
  AutoFeederCostMultiplier: 0.20
```

The player still chooses to buy Auto Feeder.

#### A2 --- Worker Templates

``` yaml
unlock: A1 Rank 1
maxRank: 2
costs: [3, 7]
rank1:
  WorkerBotRequiredAssemblyLevel: 7
  WorkerBotCostMultiplier: 0.50
rank2:
  WorkerBotRequiredAssemblyLevel: 5
  WorkerBotCostMultiplier: 0.25
```

#### A3 --- Inherited Automation

``` yaml
unlock: A2 Rank 2
maxRank: 1
cost: 12
effect:
  AssemblyStartsAutomatedOnceConstructed: true
```

This permanently removes an old operational chore while preserving
construction/investment decisions.

### Expansion Branch

#### E1 --- Compact Blueprints

``` yaml
maxRank: 3
costs: [2, 4, 8]
effectPerRank:
  newProducerConstructionCostMultiplier: 0.85
```

Cumulative:

``` text
R1 85.0%
R2 72.25%
R3 61.41%
```

Applies to producer construction, not every producer level.

#### E2 --- Era Compression

``` yaml
unlock: E1 Rank 2
maxRank: 3
costs: [4, 8, 15]
effectPerRank:
  majorRequirementReduction: 10 percentage points
```

Examples:

``` text
Fabricator Lv50 → 45 → 40 → 35
Robots 1000 → 900 → 800 → 700
```

Final Technical Design must specify integer rounding consistently.

------------------------------------------------------------------------

## 18. Expected Multi-Reboot Compression

Indicative active Growth Run targets:

  Meta maturity       Expected Growth Run
  ----------------- ---------------------
  Civilization #1                4--5.5 h
  \~5 Cores                        3--4 h
  \~10 Cores                   2.5--3.5 h
  \~20 Cores                     2--2.5 h
  \~40+ Cores                      1--2 h
  Mature MVP             floor \~1--1.5 h

The exact Civilization number is less important than AI Core allocation.

Automation-heavy builds should compress early labor more strongly.
Production-heavy builds should perform better in Push Runs. Expansion
should accelerate major frontiers.

------------------------------------------------------------------------

## 19. Simulation Results

### Initial baseline failure

Earlier late-game parameters:

``` text
Advanced Robotics Breakthrough: 25B
Advanced Robotics baseCost: 5B
```

produced approximately:

``` text
Robotics Complex: ~11 h active
First Reboot: >20 h
```

This violated pacing and dead-zone targets.

### Corrected baseline

``` text
Advanced Robotics Breakthrough: 1B
Advanced Robotics baseCost: 500M
```

Representative Active simulation:

  Event                 Approx. result
  ------------------- ----------------
  Fabricator Lv10                 0:38
  Auto Feeder                     1:28
  Assembly                        3:11
  Worker Bot                      8:09
  Robotic Logistics              14:23
  Robot Line                     17:56
  Factory Control                25:26
  Automated Cell                 41:23
  Robotics Complex                2h58
  Prestige frontier               4h24

Real human play is expected to be slower than a deterministic agent due
to reading, animations, imperfect purchasing, and exploration.

------------------------------------------------------------------------

## 20. Player Profile Simulation

### Active

Characteristics:

-   frequent purchases;
-   efficient Next Goal pursuit;
-   effective Free Overclock.

First Reboot:

``` text
~4–5 h
```

### Normal

Representative pattern:

``` text
~15 min initial session
~2 h away
~10 min session
~6 h away
~10 min session
short returns thereafter
```

Indicative first Reboot:

``` text
~30–36 h calendar time
```

### Passive

Representative pattern:

``` text
~5 min initial session
then ~3 min every ~8 h
```

Indicative first Reboot:

``` text
~2–3 calendar days
```

Offline efficiency therefore must not be interpreted as total
progression efficiency. Missing player decisions naturally slows
technological progression.

------------------------------------------------------------------------

## 21. Sensitivity Analysis

### Very high sensitivity

#### Producer `costGrowth`

A change of `+0.01` compounds strongly at higher levels. Never treat it
as a minor tweak.

#### Advanced Robotics base cost

Observed late-run sensitivity:

``` text
500M → ~4h24 prestige frontier
1B   → ~6h30
5B   → >20h
```

Initial tuning range:

``` text
400M–750M
```

#### Milestone multipliers

They compound with multiple systems and affect investment decisions
across the entire run.

#### Prestige formula

Changes the whole meta economy and Growth/Push relationship.

### High/medium sensitivity

-   offline efficiency;
-   offline cap;
-   producer base production;
-   Factory Control ×2;
-   Automated Cell cost;
-   rewarded offline multiplier.

### Moderate sensitivity

-   Free Overclock duty cycle;
-   Advanced Robotics construction cost around 1B;
-   Auto Feeder ×1.25;
-   Worker Bot ×1.5.

### Recommended sensitivity test grid

``` text
global production: -10% / baseline / +10%
costGrowth: -0.01 / baseline / +0.01
offline efficiency: 60% / 75% / 90%
offline cap: 4h / 8h / 12h
Overclock: ×1.5 / ×2 / ×3
Advanced Robotics baseCost: 400M / 500M / 750M
rewarded offline: ×1.5 / ×2
```

------------------------------------------------------------------------

## 22. Data-Driven Balancing Parameters

Expose at minimum:

### Producers

``` text
id
era
baseCost
costGrowth
baseProduction
initialAutomationState
milestones
unlockRequirements
```

### Breakthroughs

``` text
id
cost
requirements
effects
era
```

### Robots

``` text
robotBuildFactor
robotMilestones
```

### Offline

``` text
efficiency
capSeconds
automatedOnly
```

### Overclock

``` text
multiplier
durationSeconds
cooldownSeconds
unlockRule
```

### Prestige

``` text
prestigeMetric
P0
coefficient
exponent
minimumReward
resetRules
persistentRules
```

### Permanent upgrades

``` text
id
branch
maxRank
rankCosts
unlockRequirements
effectsPerRank
```

No important balancing value should require code modification.

------------------------------------------------------------------------

## 23. Analytics / Balancing Hooks

Measure at minimum:

``` text
time_to_fabricator_l10
time_to_auto_feeder
time_to_assembly
time_to_first_robot
time_to_robot_line
time_to_factory_control
time_to_automated_cell
time_to_robotics_complex
time_to_first_reboot

first_reboot_core_reward
civilization_2_first_robot_time
civilization_2_reboot_time

robots_built_at_major_unlock
offline_duration
offline_reward
offline_cap_hit

free_overclock_uses_per_session

prestige_upgrade_allocation
growth_run_duration
push_run_duration

current_next_goal_at_session_end
current_next_goal_at_churn
```

The last two are especially important for identifying dead zones.

------------------------------------------------------------------------

## 24. Open Balancing Questions

These are not reasons to block Technical Design, but must remain
configurable/testable:

1.  Does Automated Cell arrive too quickly in human play?
2.  Does the Automated Cell → Advanced Robotics segment remain engaging
    for 1--2+ hours?
3.  Is `0.005 × RobotLineLevel` the correct visible Robot Build Rate?
4.  Does Automation become disproportionately attractive with the first
    5--10 AI Cores?
5.  Does mature Growth Run pacing stay above approximately 60--90
    minutes?
6.  Should offline remain 75% after real retention data?
7.  Does `P0` derived from the reference first-Reboot state yield the
    intended 5-Core reward under the exact runtime formula?
8.  Are the milestone multipliers too strong once permanent Production
    upgrades compound with them?

------------------------------------------------------------------------

## 25. Economy Verdict

**GO to Technical/Art phases with configurable balancing values.**

The current economy:

-   meets the intended early cadence;
-   produces a meaningful first automation and First Robot;
-   creates three distinct MVP eras;
-   avoids the original late-game cost wall after simulation correction;
-   supports Active, Normal, and Passive play;
-   gives Reboot a strong permanent payoff;
-   preserves meaningful decisions after automation;
-   is compact enough for a small studio;
-   is suitable for data-driven implementation.

The economy should not be considered final live balancing until human
playtests and soft-launch telemetry validate the targets.
