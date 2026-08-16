# Project Automata

Godot 4.6.3 bootstrap for Project Automata.

This repository currently contains the AUT-001 project skeleton and AUT-002 test runner bootstrap. It is intentionally limited to a loadable Godot project, approved directory boundaries, a minimal main scene, and automated smoke validation.

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

## Automated Checks

Run the GUT test suite:

```powershell
.\tools\ci\test.ps1
```

Run the current aggregate check:

```powershell
.\tools\ci\check.ps1
```

The wrappers resolve Godot from `GODOT_BIN`, then from the local factory tools directory, then from `PATH`.
If local PowerShell policy blocks script execution, run the same wrapper with process-scoped bypass:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\test.ps1
```

## Scope Notes

- Gameplay, economy, progression, UI systems, platform plugins, monetization, and Android export setup are intentionally not implemented in AUT-001.
- Generated Godot caches and build outputs are ignored by Git.

