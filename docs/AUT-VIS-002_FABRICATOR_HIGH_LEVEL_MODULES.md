# AUT-VIS-002 Fabricator High-Level Module Placement

**Human gate result (2026-11-11): PASS.** The owner confirmed on the NE2215 that the Lv25 → Lv50 → Lv100 progression reads correctly and the machine is coherent enough for this stage. Mechanical logic and visual flow can improve later; that is polish, not a blocker. The PENDING note below is historical.

**Visual human gate: PENDING.** The owner has to confirm on the phone that the Lv25, Lv50 and
Lv100 modules read as one coherent machine. The automated checks below do not validate visual
quality, readability or composition.

Owner observation: at high Fabricator levels the milestone modules looked mispositioned. They
were. The nine Lv25+ modules still used the pre-AUT-038 placeholder layout: wrong pivot heights,
no shared axis, the 1.3-tall `machine-bed` corner gantry (`shared_industrial_base`) placed at the
origin, swallowing the press, a 3.2-tall robot arm, and `logistics_connection` with no position.

## What was built

Presentation only: the position, rotation and scale tables in `FabricatorVisualController.ts`.
There is no state, economy, camera, asset, mapping or resolver change. The Lv1–Lv10 and Auto
Feeder transforms are byte-identical to AUT-038.

**Measured layout constraint.** The approved portrait view (yaw 135, pitch 48, distance 14,
focus (-2.5, 0)) looks at the Fabricator from world +X/-Z, with the zone near the right screen
edge. Content on the zone's -X or -Z side leaves the screen at the default view. The expansion
therefore grows on the free +X (camera) side. All coordinates below are Fabricator-local; the line
flows toward -Z, and the floor is at 0.14.

| Tier | Module (asset) | Placement |
|---|---|---|
| Lv25 | `output_conveyor` (conveyor, 1.4 × 0.9 × 0.66, Y 0) | Leaves the tray's +X side over the tray part outside the press (x 0.45..1.85, z -1.6..-0.94) at the tray belt height. |
| Lv25 | `storage_buffer` (box-large, 0.8) | On the floor at the belt end (x 1.85..2.73). |
| Lv25 | `logistics_connection` (pipe-large, 0.6, Y 0) | Connection-ready stub leaving the bin's far face toward Assembly (x 2.73..3.33). |
| Lv50 | `dual_fabrication_module` (machine, 0.8, Y 90) | Twin press beside the primary press, tunnel parallel (x 0.80..2.00, z -0.16..0.80). Smaller than the primary (1.05). |
| Lv50 | `shared_industrial_base` (machine-bed, 0.64, Y 180) | Corner gantry: its outlet mouth sits on the twin's input mouth, and its inlet faces +X on open floor (x 0.92..2.42, z 0.80..2.30). |
| Lv100 | `automated_input_output` (conveyor, 0.93 × 0.9 × 0.76, Y 90) | Transfer belt from 0.15 inside the twin's output mouth onto the shared output belt. |
| Lv100 | `integrated_feeder` (hopper-square, 0.45) | Seated on the gantry's inlet-section roof (y 0.94). |
| Lv100 | `small_robotic_arm` (robot-arm-a, 0.4) | On the floor beside the twin and the storage bin (2.2, -0.42). Top 1.42. |
| Lv100 | `advanced_indicators` (screen-panel-wide, 0.3, Y -90) | On the twin roof, facing the camera side. |

Every Lv25+ module stays below the primary press (top 1.505), so the first Fabricator remains the
dominant, recognizable silhouette (ART_DIRECTION §11/§13).

## Tests

`tests/fabricator_composition_geometry.test.ts` (AUT-038 approach: real GLB POSITION bounds, plus
the node hierarchy for `robot-arm-a.glb`, against the controller tables) adds 9 tests:

- asset mapping, upright and grid-aligned;
- floor contact, on the opening foundation, clear of `MainLogisticsSpine` and the Assembly shell;
- no interpenetration in the full Lv100 + Auto Feeder composition, with five declared contacts (belt in mouth, add-on on roof);
- Lv25 belt → storage → pipe chain;
- twin parallel and subordinate, fed by the gantry outlet (measured mouths);
- Lv100 transfer belt mouth entry and landing;
- add-ons seated on their hosts, with the primary press tallest;
- AUT-038 Lv1–Lv10 / Auto Feeder snapshot;
- every module corner on screen at the default portrait camera (bootstrap values, 1080 × 2412).

## Findings for other owners (not changed here)

- **Art Director (IMPORTANT):** `shared_industrial_base` maps to `machine-bed.glb`, which is a
  90° corner gantry, not a base. "Dual fabrication module on shared base" (ART_DIRECTION §14.1)
  cannot be built literally with it. It is used here as the twin's shared infeed gantry. Confirm
  this reading, or choose another mapping.
- **POLISH:** `robot-arm-a.glb` has no pose or animation, so it stands straight. Posing its joints is
  a separate visual or animation task.
- The 5 × 4 Fabricator zone is nearly full at Lv100. Any further Fabricator growth needs a zone or
  footprint decision (Orchestrator).

## Validation

- `npm run check`: green (546 tests, pacing regression PASS).
- Device: see below.
- Device (NE2215, portrait 1080 × 2412): the gate APK
  `temp/gate/ProjectAutomata-vis002-8ffc424-dirty-factoryworld.apk` (sha256 `38da67c5…`) was built
  with `device:gate-build`. The tracked build config was restored byte-identical (SHA-256 checked;
  `git status` clean for it).
  - Seeded, valid save envelopes were pushed with `run-as`: Fabricator Lv25, Lv50 and Lv100,
    with Auto Feeder owned. They were built with the INT-001 runtime helpers by
    `temp/vis002/seed.ts`.
  - Each launch reported `session_state loaded_main` and `autoFeederOwned: true`, with no
    `[AUT-DEVICE]` error event.
  - Screenshots are in `temp/vis002/device/`:
    - `lv25_default.png`, `lv50_default.png`, `lv100_default.png`: default view;
    - `lv100_focus.png`: Fabricator tapped and focused; the panel shows Lv 100.
  - In all of them every module is on screen and on the Fabricator pad. That is a presence check
    only, not a readability verdict.
- **Pending human gate:** the higher-level modules read as one coherent machine on the phone; the
  primary press stays the focal point; Lv25 → Lv50 → Lv100 read as progression; the dark Kenney
  modules are readable at arm's length.
