# Project Automata

Godot 4.6.3 bootstrap for Project Automata.

This repository currently contains only the AUT-001 project skeleton. It is intentionally limited to a loadable Godot project, approved directory boundaries, and a minimal main scene used for smoke validation.

## Requirements

- Godot 4.6.3 Standard
- GDScript
- Mobile renderer

The local Windows development environment currently uses:

```powershell
C:\dev\tools\godot-4.6.3\Godot_v4.6.3-stable_win64.exe
C:\dev\tools\godot-4.6.3\Godot_v4.6.3-stable_win64_console.exe
```

These absolute paths are not required by committed project files.

## Smoke Checks

Confirm the Godot version:

```powershell
& 'C:\dev\tools\godot-4.6.3\Godot_v4.6.3-stable_win64_console.exe' --version
```

Load the project headlessly:

```powershell
& 'C:\dev\tools\godot-4.6.3\Godot_v4.6.3-stable_win64_console.exe' --headless --path . --quit
```

Start the configured main scene and exit after it loads:

```powershell
& 'C:\dev\tools\godot-4.6.3\Godot_v4.6.3-stable_win64_console.exe' --headless --path . -- --automata-smoke-exit
```

## Scope Notes

- Gameplay, economy, progression, UI systems, platform plugins, monetization, and Android export setup are intentionally not implemented in AUT-001.
- Generated Godot caches and build outputs are ignored by Git.

