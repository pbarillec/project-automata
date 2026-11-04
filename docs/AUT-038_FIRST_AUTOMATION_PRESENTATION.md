# AUT-038 First Automation Presentation

`AutomationPayoffViewModel` is a pure projection over the authoritative Fabricator
automation state and `automationStateChanged`/Auto Feeder event evidence. It never
executes a command or changes `GameState`. A save with Auto Feeder already owned
reconstructs the final feeder, input-conveyor, and autonomous-indicator composition
without replaying a payoff.

`FirstAutomationPresentationController` applies that projection to the existing
AUT-034 `FabricatorVisualController`, pulses the existing autonomous-cycle indicator,
and requests a short focus through the existing bounded
`MobileCameraController.focusOnWorldTarget` API. Camera gesture input remains the
owner of interruption; interruption cannot remove the authoritative automated
composition.

Identical event delivery is deduplicated. The breakthrough purchase and its related
automation event can arrive together but produce at most one first-automation focus
beat. No economy, progression, persistence, or simulation implementation is changed.

Presentation/wiring changes made for the Android device pass:

- `FabricatorVisualController` instantiates the approved AUT-032 Factory Kit modules
  from prefab references serialized on `FactoryWorldBootstrap` (`factoryPrefabs`,
  index-aligned with `SERIALIZED_PREFAB_MODULES`) instead of loading them at runtime,
  and toggles module visibility by scale so Android native never deactivates imported
  3D nodes.
- `MobileCameraController` gains scene-configurable `defaultFocusX`/`defaultFocusZ`,
  an optional `focusDistance` used by `focusOnWorldTarget`, and
  `applyConfiguredInitialView()`. Gesture handling, clamping and focus-transition
  logic are unchanged; `FactoryWorldBootstrap` sets the FactoryWorld framing values.

Remaining visual composition/polish is out of scope for AUT-038 and tracked
separately as `AUT-VIS-001`.

Visual correction (post device review): the automated state read as loose
assets because the modules ignored the measured AUT-032 geometry. All pivots
are bottom-centre, yet the press, hopper and product block were placed as if
centred (~0.5 above the floor). The conveyor travels along local X, but it was
lengthened on Z and rotated 71° off the press tunnel axis (also local X). The
output tray sat beside the press rather than at a tunnel mouth, and both status
panels were buried inside the press body. The Fabricator line is now composed
on one axis (rotation Y 90): feeder hopper resting on the upstream end of a
1.8-long input belt → input belt entering the press's input mouth → press on
the floor → output tray leaving the opposite mouth carrying the product block,
with both indicators on the press roof. The hopper is scaled to 0.9 so the
press stays the dominant silhouette. The reveal focus anchor targets the line
centre, and `focusDistance` pushes in to 9.5 (previously zoomed out to 16.5). A
stray `FactoryWorldRoot` offset (-0.35, 0, -0.1), introduced with AUT-038, was
restored to the AUT-033 origin. `tests/fabricator_composition_geometry.test.ts`
guards floor contact, axis alignment, mouth entry, hopper-on-belt and roof
placement against the real GLB bounds. Later-milestone module transforms
(Lv25+) still use the previous layout and need their own AUT-VIS pass. Device
readability remains a human gate.
