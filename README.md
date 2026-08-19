# Project Automata

Cocos Creator 3.8.8 baseline for Project Automata.

This repository is intentionally limited to the AUT-CX-001 bootstrap scope: Cocos project metadata, approved directory boundaries, and one minimal startup scene/component that proves the runtime can load.

## Requirements

- Cocos Creator 3.8.8
- TypeScript
- Standard mobile 3D project workflow

The expected local editor path is a normal Cocos Creator 3.8.8 installation. No absolute editor path is committed.

## Open The Project

Open this repository root in Cocos Dashboard or Cocos Creator 3.8.8. The startup scene is:

```text
assets/scenes/app/Main.scene
```

When the scene runs it should display:

```text
Automata
Runtime OK
```

The startup component logs exactly:

```text
AUTOMATA_RUNTIME_OK
```

## Directory Policy

- `assets/` contains Cocos-authored scenes, scripts, metadata, and future presentation assets.
- `data/` is reserved for future authored game configuration. AUT-CX-001 does not add gameplay data or config loading.
- `native/engine/` is reserved for project-owned native/engine source and must remain trackable.
- `build/`, `temp/`, `library/`, `local/`, editor caches, and generated native/platform output are generated and must not be committed.
- `tests/` and `tools/` are reserved for later tasks; this bootstrap does not claim a test framework, CI runner, or Android build automation.

## Current Smoke Check

Manual runtime check in Cocos Creator 3.8.8:

1. Open the project root.
2. Open `assets/scenes/app/Main.scene`.
3. Press Preview.
4. Confirm the scene displays `Automata` and `Runtime OK`.
5. Confirm the console contains exactly `AUTOMATA_RUNTIME_OK` from `AppStartup`.

