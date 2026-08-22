# AUT-023 SaveEnvelope

AUT-023 implements pure TypeScript serialization and deserialization only. It does not read or write save files, rotate backups, run migrations, calculate offline progress, or perform Reboot transactions.

## Envelope Schema

Current `saveVersion` is `1`. Only version `1` is accepted.

```ts
SaveEnvelope {
  saveVersion: 1,
  gameVersion: string,
  contentVersion: string,
  savedAtUtc: string,
  integrity: {
    algorithm: "fnv1a32-payload-v1",
    payloadHash: string
  },
  payload: GameState
}
```

The payload uses the existing canonical `GameState` model: `run`, `meta`, `boosts`, `monetization`, `settings`, and `lifetime`.

## Persisted Boundary

The save payload persists durable authoritative state only. It includes current run state, persistent meta state, active/cooldown boost state, monetization request/claim/cache state, settings, and lifetime counters.

It does not embed configuration source data such as producer definitions, Breakthrough definitions, permanent-upgrade definitions, milestone definitions, or `P0`. `contentVersion` identifies the compatible content/config baseline.

It also does not persist safely derived projections such as production per second, affordability, Next Goal, resolved modifier caches, calculated Prestige preview values, or UI/view-model values. Historical authoritative fields already in `GameState`, such as `prestigePowerPeak`, remain persisted.

## Deterministic JSON

Serialization uses canonical JSON with object keys sorted recursively. Arrays keep their stored order. Identical state and identical supplied metadata produce identical JSON and identical payload hashes.

Envelope creation accepts `saveVersion`, `gameVersion`, `contentVersion`, and `savedAtUtc` explicitly. It does not call `Date.now`.

## Timestamp Contract

`savedAtUtc` must be a canonical UTC ISO-8601 instant in this exact shape:

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

Examples: `2026-08-22T08:30:45.123Z`. Offset timestamps, local timestamps, missing milliseconds, and invalid calendar dates are rejected.

## Validation And Compatibility Policy

Save JSON is parsed as untrusted text. Invalid JSON, missing required fields, unsupported `saveVersion`, invalid metadata, malformed integrity metadata, checksum mismatch, and invalid payload domains are rejected before exposing a loaded `GameState`.

Unknown fields are rejected strictly at the envelope, integrity, and payload levels. Payload validation delegates to the existing `GameState` validator so persistence does not define a parallel authoritative model.

Deserialization deep-copies the returned envelope and loaded state so callers cannot mutate one through the other.

## Integrity Metadata

`payloadHash` is a deterministic FNV-1a 32-bit hash of canonical payload JSON. It is a non-secret accidental-corruption check only. It is not tamper-proof, cryptographic, encrypted, or an anti-cheat boundary.

## Deferred Work

AUT-024 owns atomic `save_temp` / `save_main` / `save_backup` file operations, dirty scheduling, and recovery workflow.

AUT-025 owns sequential migrations from earlier save versions.
