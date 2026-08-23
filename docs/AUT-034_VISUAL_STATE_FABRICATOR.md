# AUT-034 Visual State / Fabricator

`VisualStateResolver` is a pure presentation boundary. It reads the Fabricator producer and automation records from `GameState` and returns a deterministic `VisualStateDescriptor`; it never calculates economy values or mutates state.

`FabricatorVisualController` owns only Cocos composition. It creates reusable named module groups under `Fabricator_CompositionAnchor`, then applies the descriptor by visibility. The base press and tray are cumulative with Lv10, logistics are cumulative from Lv25, the dual module is cumulative from Lv50, and the integrated feeder/robotic-arm treatment is cumulative at Lv100. Auto Feeder adds its hopper, input conveyor, and autonomous-cycle indicator independently of level.

The controller starts empty for an unconstructed Fabricator. Development forcing is presentation-only: `forceDebugState('lv1' | 'lv10' | 'auto_feeder' | 'lv25' | 'lv50' | 'lv100')` changes resolver output and never writes to authoritative state.

The module names intentionally map to reusable composition roles. Their current placeholder geometry preserves the AUT-033 sparse workshop silhouette; AUT-032 Kenney GLB references can be assigned to these roles by the scene composition without changing source assets or importer metadata.

