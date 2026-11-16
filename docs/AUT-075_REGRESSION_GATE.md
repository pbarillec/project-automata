# AUT-075 — Full Automated Regression Gate

Status: implemented and verified locally (clean pass + 7-case intentional-break drill). Cocos Creator 3.8.8 (plan's Godot wording obsolete).

## `npm run check` (tools/ci/check.ps1) — the authoritative automated pre-merge gate

Stages (all always run, so one run reports every regression): `config` (data validation) → `ads` (AUT-CX-005 manifest/Gradle) → `billing` (AUT-060) → `tests` (all `tests/**/*.test.ts`: unit, integration, scene/wiring) → `pacing` (headless simulation vs baselines).
Deterministic reporting: per-stage PASS/FAIL summary on stdout and `temp/ci/check_report.json` (gitignored; uploaded by CI). Exit 0 only if every stage passes; otherwise the first failing stage's non-zero exit code. Behaviour change vs before: no fail-fast.

## Intentional-break drill (`npm run check:drill`, tools/ci/gate_drill.ps1)

Requires a clean tree; mutates one file per case, asserts the gate FAILs in the expected stage, restores bytes, ~3.5 min. Run 2026-11-16: **7/7 PASS**.

| Subsystem | Mutation | Failing stage |
|---|---|---|
| config schema | `producers.json` kind → invalid | config |
| economy values | first producer `baseCost` 10 → 100000 | pacing |
| economy formula | `ProducerCost.ts` `Math.pow` → `Math.sqrt` | tests |
| persistence | `PersistenceCoordinator` saveVersion → 0 | tests |
| scene wiring | `FactoryWorld.scene` node `Zone_AutomatedCell` renamed | tests |
| Android ads | manifest `tools:node="remove"` → `merge` | ads |
| Android billing | Billing dependency coordinate corrupted | billing |

Clean tree: `npm run check` PASS (1580 tests, pacing baselines PASS).

## Not covered by the gate (manual / pending)

Release-safety checks (`npm run android:release:check`, need a built AAB/APK, self-hosted runner), device/visual evidence, game feel, pacing "fun", monetization, store release. The gate cannot detect regressions in behaviour that no test or baseline encodes; the drill proves coverage only for the listed subsystems.
