# AUT-025 Save Migrations

## Registry Design

Save migrations are centralized in `assets/scripts/persistence/SaveMigrations.ts`.
The registry maps each supported source `saveVersion` to exactly one migration step.
Each step declares:

- `sourceVersion`
- `targetVersion`
- `id`
- `migrate(envelope)`

Registry construction rejects duplicate source versions and any step whose target is
not the immediately following version. The default production registry is currently
empty because the shipped persistence schema is still `saveVersion: 1` and no older
production save format exists.

## Sequential Guarantees

`deserializeGameStateFromSaveJson` parses JSON, runs the configured migration
pipeline, then validates the result through the existing AUT-023 current
`SaveEnvelope` and `GameState` validation.

Migration executes one version at a time until the current save version is reached.
The pipeline rejects future versions and older versions without a complete path to
the current version. Current-version saves bypass transformation and continue
through normal validation.

Migration operates on controlled plain-data copies. The caller-provided parsed
legacy object is not mutated.

## Legacy Fixture Policy

The fixtures under `tests/fixtures/save_migrations/` are synthetic test schemas.
They are not claimed to be released production save formats.

Current synthetic fixtures:

- `synthetic_v0_missing_reduced_motion.json` proves a newly required field can be
  introduced with a deterministic default.
- `synthetic_v0_progress.json` proves non-default durable progress survives
  migration.
- `synthetic_chain_v0.json` proves the generic registry executes multiple
  sequential steps in order when a test registry represents multiple versions.

## Deterministic Defaulting

Synthetic v0 fixtures intentionally omit `settings.reducedMotion`. The test-only
v0-to-v1 migration adds `reducedMotion: false`, matching fresh/current state
semantics.

No migration fabricates `gameVersion`, `contentVersion`, or `savedAtUtc` when a
legacy envelope lacks them. Missing metadata remains invalid during final
current-version validation.

Migrations must not use wall-clock time, random values, machine paths, device data,
or embedded economy/config definitions.

## Failure And Fallback Behavior

AUT-024 repository reads use the same configured migration pipeline for main,
backup, and temp verification. A migratable main save can load as authoritative
state. If main migration fails, backup recovery remains possible when backup is
valid or migratable.

Successful migration of main does not write the migrated envelope back to disk by
itself. Writes still occur only through the existing AUT-024 save/recovery flow.

## Deferred Work

AUT-025 does not implement TimeService or offline rewards. AUT-026 owns wall-clock
handling, and AUT-027 owns offline calculation.
