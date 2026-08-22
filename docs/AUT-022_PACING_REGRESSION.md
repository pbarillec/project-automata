# AUT-022 Pacing Regression

AUT-022 adds deterministic pacing measurement around the existing AUT-020 simulator and AUT-021 strategies. It does not define economy formulas and does not modify economy values.

## Target Data

The default target set lives at:

```text
data/simulation/pacing_targets.json.sim
```

The file contains JSON but uses the `.json.sim` extension so the existing gameplay config loader does not treat it as authoritative economy config. It is validated by `parsePacingTargetConfig`.

Each target declares:

- `id`: stable target identifier.
- `metric.metricId`: stable simulator metric, such as `checkpoint.time_seconds`.
- `metric.checkpointId`: required for checkpoint metrics emitted by AUT-020/AUT-021.
- `scope`: scenario IDs or strategy IDs the target applies to.
- `windows.pass`: deterministic numeric PASS bounds.
- `windows.warning`: wider deterministic WARNING bounds.
- `violationPolicy`: WARNING or FAILURE when the value falls outside the warning window.
- `source`: the source reference for the target.

Malformed target definitions, non-finite values and inverted windows are rejected before simulation.

## Policy Semantics

Target evaluation is independent from baseline diffing.

- Inside `pass`: `PASS`
- Outside `pass` but inside `warning`: `WARNING`
- Outside `warning`: target `violationPolicy`

`baselineDiffPolicy` defaults to `WARNING`, so a changed baseline is visible but does not fail the command when current pacing still passes configured targets.

Default `warningsBlockExit` is `false`; PASS and WARNING-only reports exit zero. Any FAILURE target exits non-zero.

## Baselines

Canonical baselines live under:

```text
data/simulation/baselines/*.baseline.json.sim
```

Baselines include only deterministic data: scenario ID, strategy ID/config, content version, checkpoint snapshots and final metrics. They intentionally omit timestamps, local paths and wall-clock metadata.

Normal regression runs never rewrite baselines. To update canonical baselines deliberately:

```powershell
.\tools\ci\pacing_regression.ps1 --update-baselines --pretty
```

The human summary reports changed checkpoint times with previous value, current value and earlier/later delta.

## Dead Zones

Dead-zone detection is objective and trace-based. It scans the simulator report for intervals without meaningful markers:

- progression checkpoints;
- successful manual production;
- successful producer purchases;
- successful Breakthrough purchases;
- successful Free Overclock activation;
- scenario start/end boundaries.

An interval is reported when it exceeds:

```text
max(deadZone.minDurationSeconds,
    strategyConfig.decisionIntervalSeconds * deadZone.intentionalDecisionCadenceMultiplier)
```

This accounts for Passive strategy cadence. A sparse Passive decision interval is not automatically an economy dead zone.

Reports include start, end, duration, threshold, neighboring marker labels, nearby checkpoint/command context, producer levels, era, robots built and production/sec.

## Default Matrix

The default matrix evaluates all built-in AUT-021 strategy IDs against the same target set:

| Scenario | Strategy |
|---|---|
| `civilization_1_active_v1` | `active.v1` |
| `civilization_1_normal_v1` | `normal.v1` |
| `civilization_1_passive_v1` | `passive.v1` |
| `civilization_1_optimized_v1` | `optimized.v1` |

Scripted/custom strategies remain supported by AUT-021, but they are not part of the canonical AUT-022 matrix.

## Commands

Default pacing regression:

```powershell
.\tools\ci\pacing_regression.ps1 --pretty
```

Project simulation wrapper:

```powershell
.\tools\ci\simulate.ps1
```

Report output defaults to:

```text
temp/pacing_regression/latest_report.json
```

Use `--out <path>` for another ad-hoc report path. Use `--fail-on-warning` only when a stricter local gate is needed.

## M1 Gate

AUT-022 answers what changed in pacing and whether configured regression policies pass. It does not replace the M1 human pacing gate. Subjective approval that the first Civilization feels good remains a separate product decision after AUT-022.
