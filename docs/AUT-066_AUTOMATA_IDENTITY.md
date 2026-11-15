# AUT-066 - Automata Identity Asset Integration

Minimal MVP identity set, authored procedurally in the repository (Art Director brief): opaque primitives only, no external generation, no new asset file, no PNG atlas (recorded deviation, see `ASSET_MANIFEST.md` AUT-066 records). Presentation only: no design, economy, monetization or save change.

## What was built

- `presentation/AutomataIdentity.ts` (pure): `IDENTITY_PALETTE` (graphite 24,29,32 / off-white 232,236,236 / cyan 88,170,184 / amber 224,168,72 / Founder gold kept out of every identity colour), `IDENTITY_SOURCE_RECORD`, `decalPartsFor(producerId, level)`, `AI_CORE_PARTS`, `ICON_SHAPES` (8 convex polygon icons), `SEVEN_SEG`, `numberPlateBoxes(n)`, `ringArcBoxes(r, segs, gapIndex)`, `mergeBoxGeometry`, the icon slot functions and `PLACEHOLDER_WORDMARK`. The hexagon comes from the existing `aiMarkGeometry` (no duplicated constants).
- `AutomataIdentityMesh.ts` / `AutomataDecalApplier.ts` (thin `cc`): boxes are baked into ONE merged unlit mesh per colour (builtin-unlit, USE_COLOR, 4 cached materials), so a producer costs <= 4 renderers (<= 5 allowed, 20 of 30 used) and the AI Core 3.
- `IdentityGraphics.ts` (thin `cc`): `drawAiMark(g, cx, cy, size)` (single consumer for the HUD AI chip, Reboot chip / modal and the AI Upgrades screen; the two bespoke copies were removed) and `drawIcon(g, name, cx, cy, size)`. Fills only, never `stroke()`.
- Decals: under each `Zone_X` (the producer root), on the permanent foundation near the camera-near corner (default camera yaw 135): `symbol` (graphite tile, 6 cyan bars around the AI mark hexagon, off-white diamond), `numberPlate` (seven-segment "01".."05"), `hazardStripe` (5 alternating amber / graphite boxes), `zoneTag` (plate + 1..5 amber pips). Thickness 0.004, 0.01 above the surface height from `floorHeightAt`; sizes are the brief values x1.5 (`DECAL_SCALE`) to stay above ~24 px.
- AI Core: replaces the placeholder cube at the SAME `REBOOT_SOCKET` (node `RebootCore` now holds an `AiCoreModel`). Persistent size 0.20 -> 0.28, reveal peak 0.55 -> 0.80, the whole model scales together (authored at scale 1 = 0.28). AUT-049 timing and diagnostics unchanged (`effect_applied` core gains `aiCoreParts`).
- UI icons, inside existing rows / chips only (text rects, hit rects, tap targets unchanged): HUD Industrial Output row (left edge), Overclock button (bolt, amber / graphite on the active pill), producer panel header (per producer), milestone toast (per kind), Founder chip (Robot icon, off-white / amber; gold stays on the Founder robot). Reboot chip, AI chip and AI panel keep the AI mark. Settings keeps the gear.
- Logo: NO final logo (`PLACEHOLDER_WORDMARK`, wired nowhere). Adv. Robotics hero core: NOT created.

## Diagnostics and device tooling

- DEBUG `identity` event: `{ decals: [{ producerId, parts, rect }], aiCore: {...summary, built, modelRenderers}, icons: [{ slot, icon, rect }], screen }`, emitted with each `ui_layout`.
- `tools/device/identity_checks.ts` (unit-tested) + scenarios `aut066-factory` (AUT-047 seed) and `aut066-ai-core` (AUT-049 reboot seed), wired through `cli.ts` and `reveal_capture.ts` (`evaluateRevealTimeline`).
- Capture: `npm run device:reveal-capture -- --scenario aut066-factory` and `... --scenario aut066-ai-core` (DEBUG FactoryWorld APK; checks are wiring / budgets only, pixel sizes are information).

## Not verified / open

- Device visual QA: whether the decals read at the normal camera (stripe / symbol / plate pixel sizes), whether any decal sits under a machine (placement is blind to prefab geometry), and the AI Core silhouette at persistent size.
- Draw calls: +20 decal renderers and +3 AI Core renderers (AUT-067 baseline should include them).
- Final logo, brand typography, app icon and store art: owner-level, OPEN.
- `RebootPresentation.ts` mirrors four `AI_CORE_*` literals (a direct import would be a module cycle); `tests/automata_identity.test.ts` pins them equal.

## Tuning pass (visual QA CHANGES_REQUESTED on 562a2ae)

- Decal placement (`DECAL_PLACEMENT`, `clusterAnchors`): the plate and the zone tag moved OUTSIDE the footprint (>= 0.15, `DECAL_OUTSIDE_MARGIN`) on the ground strip: in front of the -Z edge for the Fabricator, Assembly Station, Robot Line and Advanced Robotics Complex, beside the +X edge for the Automated Cell (its front strip is the Robot Line lane). The tag sits one plate-height toward the camera from the plate. The symbol and the stripe stay on the foundation, except the complex stripe: 3 boxes, on the ground in front of the lip (a barrel stood at the end of the 5-box stripe). Footprints come from the layout modules and the device captures, not from prefab bounds at runtime. Tests pin: plate / tag clear of their footprint, of every other zone, the spine and the opening foundation, inside the site; each stripe box takes the surface height under itself (the Robot Line stripe straddles a slab edge).
- Legibility: `PLATE_SCALE` 2.2 (separate from `DECAL_SCALE` 1.5, which still drives the symbol): plate 0.66 x 0.264, digits 0.154 tall, tag plate 0.8 x 0.18 with 0.10 pips on a 0.15 pitch (5 pips = 0.70). Symbol and stripe unchanged.
- AI Core: persistent size 0.28 -> 0.36 (node scale 0.36 / 0.28 = 1.286; reveal peak stays 0.8 = scale 2.857, `RebootPresentation.ts` literals updated). Upper shell layer is now an off-white rim (lower layer graphite), the diamond edge 0.10 -> 0.12, the cyan cap 0.06 -> 0.10, halo boxes 0.065 x 0.028 -> 0.08 x 0.04. Still 3 renderers, palette unchanged; AUT-049 timing and diagnostics untouched.
- Founder chip icon slot 26 -> 36 design units (x inset 24; hit rect and text rect unchanged).
- Producer 3 symbol vs the "Tap a producer" label: the label is the producer panel header (a UI row over the translucent panel); the world decal is seen through the panel, so there is nothing to nudge without moving the panel text. Not changed. The cyan stripe seen at producer 3 is NOT a decal part: the stripe is amber / graphite only (pinned by test); it is an existing machine light.
