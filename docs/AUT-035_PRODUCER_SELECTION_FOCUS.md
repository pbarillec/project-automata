# AUT-035 Producer Selection and Focus

FactoryWorld creates one presentation-only selectable target for each of the five
stable producer zones. `ProducerSelectionController` owns the selected identifier,
reuses one `ProducerHighlight` component per target, and requests focus through the
existing `MobileCameraController.focusOnWorldTarget` API and the zone's existing
`<ProducerId>_FocusAnchor`.

Selection is emitted only from the shared tap-vs-drag gesture contract. Drag/orbit,
multi-touch, and UI-consumed touches are ignored. The controller does not import or
mutate authoritative game state and does not open a producer panel.

## AUT-R-035 correction

The selection marker cylinder now uses the Cocos 3.8.8 positional signature
`primitives.cylinder(0.92, 0.92, 0.035, { radialSegments: 32 })`. The previous
options-object call was received as `radiusTop`, so the intended radius, height and
segment count were ignored. A text-level regression test in
`tests/producer_selection.test.ts` guards the signature for presentation/camera code.

## AUT-R-035-02 correction

- `ProducerSelectionController` builds its gesture tracker and target index in `start()`: `onLoad` runs inside `addComponent`, before the bootstrap assigns `selectableTargets`, so the index was empty and taps never selected a producer.
- `CoreHudController` and `ProducerPanelController` register `TOUCH_START/MOVE/END/CANCEL` on their own root node (640x310 HUD card, 600x330 panel card, not full-screen) and stop propagation, so HUD/panel touches no longer reach the camera or selection; child panel Buttons still receive their clicks first.
- The selection marker is scaled `(0.5, 1, 0.5)` and placed at local y `-0.03`, so its footprint fits inside the zone and its bottom stays above module bases (world y 0.14).

## AUT-R-035-03 correction

- On device, taps did not select and camera orbit/pinch were dead: `FactoryWorldBootstrap` gave the only (perspective) `WorldCamera` `visibility = Layers.Enum.ALL`, so it included `UI_2D`. Cocos `UITransform.hitTest` tests a node through every camera whose visibility includes its layer; the WorldCamera's `screenToWorld` near-plane point (about the camera position, y 3.5-21.2) always fell inside the 600x330 ProducerPanel root rect at (28, 150), so the panel's AUT-R-035-02 touch blocker claimed every touch and the global camera/selection input listeners never ran.
- The WorldCamera visibility is now `(Layers.Enum.ALL & ~Layers.Enum.UI_2D) >>> 0`. No UI camera was added. `tests/ui_input_routing.test.ts` models the near-plane hit test over the camera envelope: with `ALL` the panel root claims 864/864 samples; with the new mask the UI_2D roots and the DEFAULT-layer panel Buttons claim 0.
- The HUD and producer panel are currently not visible on device (there is no camera rendering `UI_2D`). UI-bounds touch swallowing and panel-button behaviour are therefore unverified on device and deferred to a UI-visibility task.
