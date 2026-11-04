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
