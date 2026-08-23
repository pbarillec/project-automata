# AUT-032 3D Asset Import & Robot Spike

This isolated Cocos Creator 3.8.8 spike validates the approved representative Factory Kit GLBs beside the normalized Quaternius robot. It is not FactoryWorld and contains no gameplay, economy, persistence, progression, population, or production workflow.

## Runtime entry point

Open `assets/scenes/spikes/AssetRobotSpike.scene`. The attached `AssetRobotSpike` component instantiates the serialized GLB prefabs at a fixed inspection layout and cycles the robot clips every three seconds in this deterministic order:

1. `Robot_Idle`
2. `Robot_Walking`
3. `Robot_Running`
4. `Robot_ThumbsUp`

The status label and console output expose the discovered clips. The robot is intentionally scaled against the factory pieces for a quick silhouette/material comparison.

## Imported runtime inventory

Kenney Factory Kit selection: `assets/art/aut032/factory/` contains only `box-large.glb`, `conveyor-corner.glb`, `conveyor-junction-t.glb`, `conveyor.glb`, `hopper-square.glb`, `machine-bed.glb`, `machine.glb`, `pipe-large.glb`, `robot-arm-a.glb`, `robot-arm-b.glb`, `screen-panel-wide.glb`, and `structure-high.glb`.

Quaternius: `assets/art/aut032/robot/Robot.glb` is the canonical normalized source. SHA-256: `BC4F886BA8660B5C658DBFDBCECFF1F2260F6E29DAE12CDC6BA578C2C7D34BD1` (623504 bytes). `Robot.blend` and `Robot.fbx` are not retained.

## Provenance and license

Both source packs are CC0. The original license text is retained in `docs/licenses/kenney-factory-kit.txt` and `docs/licenses/quaternius-animated-robot.txt`. The Quaternius normalization provenance is recorded in the external source archive; the runtime repository contains only the normalized GLB and this audit record.

## Validation boundary

Automated smoke coverage checks the isolated scene, exact asset inventory, robot hash, provenance files, required clip names, and presentation-only source boundaries. Cocos Creator 3.8.8 import/build validation and real-device review remain Factory-owned checks. Real-device acceptance must cover mobile silhouette, animation playback, Kenney/Quaternius visual compatibility, and memory/performance.
