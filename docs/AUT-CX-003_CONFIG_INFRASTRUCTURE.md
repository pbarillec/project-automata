# AUT-CX-003 Config Infrastructure

## Public API

The pure TypeScript entry point is `assets/scripts/config/ConfigLoader.ts`.

- `loadGameConfigFromSources(sources)` parses and validates JSON text sources, then returns a `GameConfigRepository` or throws `ConfigValidationError`.
- `validateConfigSources(sources)` runs the same pipeline and returns diagnostics without throwing.
- `parseConfigSources`, `validateConfigStructure`, `validateConfigReferences`, `validateConfigSemantics`, and `buildGameConfigRepository` expose the pipeline stages separately for tests and future tooling.
- `GameConfigRepository` is the typed repository boundary. Callers use typed getters/lists for eras, producers, and breakthroughs instead of raw JSON dictionaries.

The Node-only validation command is `tools/config/validate_config.ts`, wrapped by `tools/ci/validate_config.ps1`.

## Validation Stages

The pipeline stops at the first stage with diagnostics:

1. `parse`: JSON text must parse successfully.
2. `structural`: envelope fields, schema version, required item fields, field types, unknown fields, and duplicate IDs are checked.
3. `cross-reference`: producer era/prerequisite IDs and breakthrough producer/breakthrough/effect references must resolve.
4. `semantic`: content versions, numeric constraints, prerequisite cycles, and effect type support are checked.
5. `repository`: the typed repository is constructed only after all validation passes.

## Typed Model Conventions

Every JSON file is an envelope with:

- `kind`
- `schemaVersion`
- `contentVersion`
- `items`

Initial supported config kinds are `eras`, `producers`, and `breakthroughs`. This is intentionally representative infrastructure, not the final MVP economy dataset.

Unknown fields are rejected consistently at structural validation time. JSON remains authoritative, but runtime/domain code should consume the typed repository.

## Version Semantics

`schemaVersion` is the shape version for this config envelope and currently must be `1`.

`contentVersion` identifies the authored content baseline and must be a non-empty string. All loaded config files must use the same `contentVersion`.

This task does not implement save migration, save versions, Android versioning, or product release versioning.

## Diagnostic Conventions

Diagnostics include:

- validation `stage`
- stable `code`
- offending `filePath`
- JSON/config path where practical
- actionable message

Diagnostics are sorted deterministically by file path, config path, and code.

## Dependency Status

No dependencies were added or updated. The implementation uses Node 24 built-in TypeScript execution for tests/tooling and pure TypeScript in the config module.

## Known Unsupported Schema Cases

The initial model does not represent full MVP economy data, milestones, prestige, boosts, permanent upgrades, offline config, monetization config, presentation bindings, localization, analytics, or save data. It also intentionally does not support dynamic formulas or expression DSLs.

Future config kinds should extend the same staged validator and repository boundary rather than exposing raw JSON to gameplay/domain code.
