# AUT-CX-001 Cocos Bootstrap

## Engine Baseline

- Active engine: Cocos Creator 3.8.8.
- Language: TypeScript.
- Project workflow: standard mobile 3D Cocos Creator project opened from the repository root.
- Startup scene: `assets/scenes/app/Main.scene`.
- Startup component: `assets/scripts/app/AppStartup.ts`.

## Runtime Smoke Contract

Running `assets/scenes/app/Main.scene` in Cocos Creator 3.8.8 displays:

```text
Automata
Runtime OK
```

The startup component logs exactly:

```text
AUTOMATA_RUNTIME_OK
```

## Generated Versus Owned Policy

Owned and trackable:

- `assets/**` Cocos scenes, scripts, metadata, and authored assets.
- `data/**` future authored game configuration.
- `settings/**` and `profiles/**` checked-in Cocos project metadata.
- `native/engine/**` project-owned native/engine source.
- `tests/**` and `tools/**` when later tasks add real validation or tooling.

Generated and ignored:

- `build/`
- `temp/`
- `library/`
- `local/`
- `.creator/`
- `.cocos/`
- generated `native/*` output except `native/engine/**`

## Godot-Era Removal Audit

The following active Godot-era files/directories were removed because they directly conflicted with the clean Cocos Creator baseline or represented later-task implementation that depended on the old engine surface:

- `project.godot`
- `export_presets.cfg`
- `addons/gut/**`
- `scenes/**`
- `scripts/**`
- `tests/**` Godot/GUT test scripts
- `tools/**` Godot/GUT validation and build wrappers
- `android/**` Godot Android baseline notes/build output guard
- `assets/branding/icon_placeholder.png`
- `assets/branding/icon_placeholder.png.import`
- `data/config_manifest.json`
- `data/economy/eras.json`
- `data/economy/milestones.json`
- `data/economy/producers.json`

Source-of-truth documents were preserved unchanged.

## Validation Notes

Static validation performed in this task:

- Required source documents were read before implementation.
- Cocos 3.8.8 metadata format was checked against the local `C:\dev\AutomataCocosEngineSpike` project.
- Local Cocos installation assumption: `C:\ProgramData\cocos\editors\Creator\3.8.8`; bundled engine metadata reports version `3.8.8`.
- JSON project/scene/settings files were parsed after editing.
- Startup scene smoke content and script UUID linkage were checked by static inspection.
- `assets/scripts/app/AppStartup.ts` was transpiled with TypeScript using Cocos-compatible decorator syntax settings.
- TypeScript source was inspected for the exact runtime log string.
- Retry cleanup removed `tsconfig.json` from the final diff.
- `git diff --check` passed.

Manual runtime validation still required:

- Open the repository root in Cocos Creator 3.8.8.
- Open and run `assets/scenes/app/Main.scene`.
- Confirm the scene loads, displays the two smoke labels, and logs `AUTOMATA_RUNTIME_OK`.
