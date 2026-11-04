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
