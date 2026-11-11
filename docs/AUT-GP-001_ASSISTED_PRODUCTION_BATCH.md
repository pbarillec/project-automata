# AUT-GP-001 — Assisted Assembly production batch

**Economy sign-off (2026-11-12): APPROVED.** `floorFraction` 0.5 and `batchDurationSeconds` 15 are kept. Simulator re-run by Economy: all 4 profiles PASS, 0 dead zones, worker_bot 13:21 active/optimized (inside 6:00–15:00). Offline single in-flight payout at the durable rate is accepted. Human gate (batch feel, felt pacing) is pending, combined with the AUT-039 product gate.

Status: implemented, `npm run check` green, device scenarios PASS on NE2215 (2026-11-11). **Human gate pending**, combined with the AUT-039 product gate. **Economy sign-off pending** on the starting values. **Game Designer approval pending** on the wording.

## Owner decision implemented (2026-11-11)

- Before Worker Bot, the Assembly Station produces `floorFraction × rate` continuously.
- `launchAssemblyBatch` runs one batch at a time (no queue). When it completes it pays `rate × batchDurationSeconds × (1 − floorFraction)`.
- After Worker Bot (or A3 Inherited Automation, which starts Assembly automated), Assembly runs at the full rate and the batch is unavailable.
- At Assembly level 0 the batch is unavailable.

## Values (data, `data/economy/producers.json` → `assembly_station.assistedProduction`)

| Parameter | Value |
|---|---|
| `floorFraction` | 0.5 |
| `batchDurationSeconds` | 15 |

These are the owner's starting values. ConfigLoader validates them: `floorFraction` must be in [0, 1) and the duration must be > 0. Economy has not signed off yet.

## What was built

- **Formulas** (`economy/AssistedProduction.ts`): floor rate, batch payout, config validation. They are shared by the runtime, offline and the simulator.
- **Rules** (`progression/AssistedProduction.ts`): availability (`available | running | not_assisted | not_built | automated`), launch, advance, completion timing, and the payout at the full (floor-free) rate. `ProductionRates` applies the floor to an assisted producer only while it is not automated.
- **Runtime** (`GameRuntime`):
  - New command `launchAssemblyBatch`. Rejection reasons: `assisted_batch_unavailable` and `assisted_batch_already_running`.
  - Events: `assistedBatchLaunched` and `assistedBatchCompleted`, plus `productionGranted` with source `assisted_batch`.
  - Active-session production is split at a batch's completion. Payouts use the rate at completion, including active boosts.
- **State/save**:
  - `run.assistedBatches` stores `{ durationSeconds, remainingSeconds }` per producer, with strict validation.
  - `CURRENT_SAVE_VERSION` 1 → 2. Migration `v1-to-v2-assisted-batches` adds an empty record and never re-hashes a corrupted v1 payload.
- **Offline**:
  - No batch is relaunched offline. At most the one in-flight batch is paid on resume, at the durable full rate without offline efficiency. If it does not complete, its timer advances.
  - Collect applies the settlement only if the batch is unchanged since the preview.
- **Simulator**:
  - `BuiltInStrategies` relaunches the batch at every decision and wait step.
  - `PacingRegression` counts `launchAssemblyBatch` as a meaningful manual action.
- **UI**:
  - `AssemblyBatchViewModel` (pure) and `AssemblyBatchActionController` (thin; emits only the command the view model enables).
  - The Button sits in the bottom thumb zone of the Producer Panel. It is shown only while the Assembly Station is selected and the batch is available or running. It shares the primary row with Manual Produce (`UiLayout.cardPrimaryActionSplitRects`), and the card size is unchanged.
  - Progress is shown in the caption (percent and seconds). Text comes from the catalogue: `producer_panel.assembly_batch.ready` / `.running`.
- **Device harness**:
  - DEBUG `assembly_batch` events (`ui` / `launched` / `completed`), and `ui_layout` reports the `AssemblyBatchAction` rect and state.
  - Scenario `gp001` (`npm run device:gp001 -- --apk <apk>`).

## Pacing (all 4 profiles PASS; dead zones 0 before and after)

| Profile | worker_bot before | worker_bot after | Window 6:00–15:00 |
|---|---|---|---|
| active.v1 | 12:21 | 13:21 | inside |
| optimized.v1 | 12:21 | 13:21 | inside |
| normal.v1 | 35:10 | 35:10 | unchanged |
| passive.v1 | 507:20 | 507:20 | unchanged |

Baselines were updated with `--update-baselines` (plan accept-diff procedure):

- **active / optimized**:
  - robotic_logistics, robot_line_era_ii and factory_control_system: +1:00 each
  - automated_cell and robotics_complex_era_iii: +50 s each
  - prestige_frontier: +40 s (5:14:11 → 5:14:51)
  - robots_built: 3932.8 → 3928.15
- **normal**:
  - automated_cell, factory_control_system, robotics_complex_era_iii and prestige_frontier: +30 s each (frontier 7:28:40 → 7:29:10)
  - robots_built: +0.75
- **passive**:
  - robotics_complex_era_iii and prestige_frontier: +3:00 each (frontier 41:48:20 → 41:51:20)
  - robots_built: +39.6
- **all 4 profiles**: the Manual Workshop checkpoint `productionPerSecond` / `prestigePower` goes from 49.5 to 43.5. This is the expected floor effect on Assembly Lv1 (12/s × 0.5). The `finalSummary` `simulatedActiveSeconds` and `industrialOutput` shift with the timings above.

Sensitivity of active worker_bot (temporary data copies, not committed):

| Variant | worker_bot |
|---|---|
| floor 0.5 / 10 s | 12:21 |
| floor 0.5 / 20 s | 12:31 |
| floor 0.4 / 15 s | 13:31 |
| floor 0.6 / 15 s | 13:11 |

The result depends on the strategy's 10 s decision cadence: at 15 s, batch uptime is about 75%.

## Device (NE2215, FactoryWorld DEBUG gate APK, build config restored byte-identical)

`gp001` PASS:

- Seeded save with Assembly Lv1 → tap the Assembly Station → the batch shows "Launch batch +90".
- Tap → `command_result launchAssemblyBatch` ok.
- Progress is shown from 0% to 90% ("Batch 40% • 9s").
- A tap while the batch is running issues no command.
- `completed` pays 90, and the Button is ready again.
- No errors.

Regressions: `ui001`, `r036`, `int001`, `c3` and `r031` all PASS.

The first `gp001` run (`20261111T155939Z`, same APK) failed `batch_ready_again`. This was a harness false positive: the binding emits `ui ready` before the `completed` event. The harness now waits from the launch cursor, and the rerun (`20261111T160030Z`) passed with no code change.

## Assumptions (for review)

- A batch already in flight still pays if Worker Bot is bought mid-batch.
- Batches advance only in the active session (`advanceActiveSession`), not in `advanceAutomation`.
- Offline: a `no_reward` preview is not kept pending by the lifecycle, so a partial timer advance is dropped and the batch is effectively paused. No reward is ever duplicated.
- The wording "Launch batch +{payout}" and "Batch {percent}% • {seconds}s" is the Implementer's proposal.

## Pending

- Human gate, combined with AUT-039: feel of the batch loop, readability of the split row, and felt pacing.
- Economy sign-off on 0.5 / 15 s.
- Game Designer approval of the wording.
- Possible `AUT-VIS-xxx` follow-up for the Button's styling and placement.
