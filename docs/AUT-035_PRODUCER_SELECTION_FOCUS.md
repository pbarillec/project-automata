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

## AUT-R-035-04 correction

- On device, camera gestures worked but producer taps did nothing: native touch locations are raw physical pixels and Android reports `screen.devicePixelRatio = 1`, so the selection tracker's 12 px drag threshold was about 4 dp on a 2772x1272 phone. Normal finger jitter (20-40 px) marked every tap as a micro-drag and no `tap` was emitted.
- `ProducerSelectionController.start()` now builds its tracker with `selectionTapSlopPixels(dragThresholdPixels, screen.devicePixelRatio, shortSide)` from the engine-free `presentation/SelectionInput.ts`: `max(base * max(1, dpr), 0.03 * shortSide)`, with non-finite inputs falling back safely. A DPR-only scaling would be a no-op on Android, hence the screen-relative floor.
- 3% of a 1272 px short side is about 38 px, roughly 12 dp, versus Android's 8 dp system touch slop; 30 px jitter still taps, 100 px moves remain drags (`tests/selection_input.test.ts`). The camera gesture threshold is unchanged.
