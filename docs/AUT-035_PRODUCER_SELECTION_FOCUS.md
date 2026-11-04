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
