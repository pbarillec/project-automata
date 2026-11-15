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
