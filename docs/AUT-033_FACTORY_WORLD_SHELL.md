# AUT-033 FactoryWorld Shell

FactoryWorld is one persistent, predetermined-layout diorama with stable groups for Fabricator, Assembly Station, Robot Line, Automated Cell, and Advanced Robotics Complex.

Each zone exposes `{ProducerId}_CompositionAnchor` and `{ProducerId}_FocusAnchor`. The opening Fabricator area uses `OpeningWorkshopFoundation`; later areas are represented by inactive foundations, dark shells, barriers, and disconnected logistics. These are composition placeholders only; producer milestone, selection, economy, progression, HUD, and robot behavior remain outside this task.

`FactoryWorldBootstrap` adds the neutral shell, the validated AUT-031 `MobileCameraController` under `CameraRig`, neutral key lighting, and the presentation-only `PresentationController`.
