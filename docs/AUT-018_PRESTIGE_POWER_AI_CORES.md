# AUT-018 Prestige Power & AI Cores

AUT-018 implements headless Prestige Power peak tracking and AI Core reward math only. It does not grant AI Cores, increment Civilization, reset `RunState`, or implement the confirmed Reboot transaction; AUT-029 owns that transaction.

## Prestige Power

`PrestigePower` is the highest durable sustained production per second reached during the current Civilization.

Included contributors:

- producer levels;
- producer milestones;
- run Breakthrough production effects;
- gameplay-earned permanent production upgrades.

Excluded contributors:

- Free Overclock;
- future rewarded Extended Overclock;
- future purchased Factory Surge;
- one-shot/manual Industrial Output grants.

Runtime peak tracking is monotonic. Updating with a lower or equal current eligible production value leaves `RunState.prestigePowerPeak` unchanged.

## P0

`P0` is loaded from `data/economy/prestige.json` as `p0PrestigePower`. It is not stored in player save state.

The current config value is a calibration fixture based on Advanced Robotics Complex Level 25 with Level 10/25 milestones and Factory Control scaling. AUT-020/AUT-022 simulation work must replace it with the exact reference first-Reboot baseline produced by the shared runtime formula.

## AI Core Formulas

Reward:

```text
AI Cores = floor(5 * sqrt(PrestigePower / P0))
```

Required Prestige Power for target `N` AI Cores:

```text
requiredPrestigePower(N) = P0 * (N / 5)^2
```

The preview API exposes current stored Prestige Power, current eligible production per second, current AI Core reward, the next AI Core target, required Prestige Power, remaining Prestige Power, progress to next core, and the P0 source value without mutating state.
