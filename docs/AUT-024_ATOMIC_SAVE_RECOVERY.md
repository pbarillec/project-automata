# AUT-024 Atomic Save Recovery

## Atomic Save Order

`AtomicSaveRepository.save` uses the AUT-023 `SaveEnvelope` serializer and deserializer as the only save format.

The save order is:

1. Serialize the replacement `GameState` with caller-supplied metadata.
2. Validate the serialized replacement by deserializing it through AUT-023 validation.
3. Write `save_temp.json` through the injected storage interface.
4. Read and validate `save_temp.json`.
5. Read `save_main.json`.
6. If the current main is valid, copy it to `save_backup.json`.
7. Promote `save_temp.json` to `save_main.json` through storage `replaceText`.

If serialization, replacement validation, temp write, temp verification, main read, backup rotation, or main promotion fails, the result is a typed failure reason. The repository does not rotate a corrupted main into backup.

## Recovery Precedence

`AtomicSaveRepository.load` ignores stale/interrupted temp files during normal loading.

Load precedence is:

1. Valid `save_main.json`.
2. Valid `save_backup.json`.
3. Explicit fresh state only when main and backup are both missing or invalid.

When backup is used because main is missing or invalid, the repository attempts deterministic recovery by writing the validated backup text to temp, verifying it, then promoting temp to main. If that rewrite fails, the already validated backup state is still returned to the caller. If a storage read error prevents determining whether a save is valid, load returns a typed failure instead of silently starting fresh.

## Storage Abstraction

Storage is isolated behind `SaveStorage`:

- `readText(name)`
- `writeText(name, text)`
- `copyText(fromName, toName)`
- `replaceText(fromName, toName)`

The logical save names are stable:

- `save_temp.json`
- `save_main.json`
- `save_backup.json`

The interface does not assume platform rename semantics are universally atomic. Backup preservation uses copy semantics for the valid current main, and promotion is isolated behind `replaceText` for later Cocos/native storage implementation.

`InMemorySaveStorage` provides deterministic headless tests with injected failures for temp write, temp verification, backup rotation, and main promotion, including a destructive promotion failure mode.

## Failure Guarantees

The implemented guarantees are:

- Main and backup are untouched if serialization or replacement validation fails.
- Main and backup are untouched if temp write or temp verification fails.
- Valid main is copied to backup before replacement promotion.
- Invalid main is never copied over a valid backup.
- Promotion failure preserves at least one previously valid main/backup copy when one existed and storage can provide it.
- Valid backup recovery does not overwrite backup with corrupted main data.
- Stale temp does not take precedence over main or backup.
- Fresh start is explicit through `fresh_started`.

## Dirty Scheduling

`DirtySaveTracker` tracks whether authoritative state changed since the last successful ordinary save. Marking dirty repeatedly is idempotent and preserves the first dirty elapsed time.

`shouldSaveDirtyState` is a pure decision primitive that accepts caller-supplied elapsed session time deltas. The default policy uses:

- debounce: 5 seconds
- periodic dirty save: 25 seconds

Critical save requests return an immediate save decision and bypass ordinary dirty delay. Scheduling does not call `Date.now`, does not use wall-clock timestamps, and does not depend on frame counts.

## Deferred Work

AUT-024 intentionally does not implement:

- save migrations;
- `TimeService`;
- offline rewards;
- lifecycle/background wiring;
- app-close callbacks;
- Reboot transaction wiring;
- permanent upgrade transaction wiring.

Those integrations remain deferred to AUT-025 and later tasks.
