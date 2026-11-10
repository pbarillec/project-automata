# AUT-R-036 HUD & Producer Panel Landscape Visibility

The Core HUD and the Producer Panel now render on the landscape Android build. They are
anchored inside the safe area and keep ownership of their own touches. Before this task, the
HUD and panel were invisible on device: no camera rendered `UI_2D`, and the controllers'
label/Button rows were left on the `DEFAULT` layer.

**Readability human gate: PENDING.** It is deferred to the combined human gate of AUT-UI-001
(Orchestrator sequencing, 2026-11-10). The automated checks below do not validate readability,
mobile legibility or visual quality.

## What was built

- **Design resolution** (`settings/v2/packages/project.json`, `general.designResolution` only).
  - Before: 720×1280 with no fit keys, which built as policy 4 (FIXED_WIDTH).
  - After: `width 1280, height 720, fitWidth false, fitHeight true`.
  - The built `settings.json` now reads `{"width":1280,"height":720,"policy":3}` (FIXED_HEIGHT),
    which confirms the key names Cocos 3.8.8 uses.
  - The editor did not rewrite anything else in the file.
- **`presentation/UiLayout.ts`** (new, engine-free) is the single source for the layout:
  - the card sizes, row heights and font sizes;
  - the 16-unit edge margin and the anchor corners;
  - `computeUiLayout(screenPx, safeAreaPx)`, which predicts the on-screen rects in pixels, at
    `scale = screen.h / 720`;
  - rect helpers.

  | Card | Size (design units) | Rows: height / font |
  |---|---|---|
  | CoreHUD | 460×200 (padding 10) | Industrial Output 40/32; Next Goal 28/22; four rows 28/20 |
  | ProducerPanel | 480×272 (padding 10) | Name 36/26; Level, Production, Milestone 28/20; ×1/×10/×MAX 44/22 |

  - Body text is at least 20 design units everywhere.
  - At 16:9 the two cards cover 24.15% of the screen (budget 30%). On the NE2215 (2412×1080)
    they cover 19.2%, which is also the measured figure.
  - Retry 1 widened the panel from 440 to 480. The longest representative milestone line,
    "Next milestone Lv 100: ×5 production (50 to go)", needs about 451 units at font 20, and the
    row is 460 units wide.
  - `computeUiLayout` also returns every row rect (`rows.hud` / `rows.panel`).
- **UI root** (`FactoryWorldBootstrap.createUiRoot`, built at runtime; `FactoryWorld.scene` is
  unchanged).
  - `CoreHudCanvas`: `UI_2D`; a stretch `Widget` (all edges 0, aligned immediately); `Canvas`
    with `alignCanvasWithScreen = true`. The fixed `setContentSize(720, 1280)` is gone.
  - Child `UICamera` (`UI_2D` layer):
    - `ORTHO` projection;
    - `visibility = Layers.Enum.UI_2D` exactly;
    - `clearFlags = DEPTH_ONLY`;
    - `priority = WorldCamera.priority + 1`;
    - near 1, far 2000;
    - assigned with `canvas.cameraComponent = uiCamera`.
  - The WorldCamera mask is unchanged: `ALL & ~UI_2D`.
  - Child `UiSafeArea` (`UI_2D`): a full-screen stretch `Widget` plus `cc.SafeArea` (symmetric
    by default).
  - `CoreHUD` and `ProducerPanel` are children of `UiSafeArea`.
    - Each has a `Widget` on its corner, with all margins `UI_EDGE_MARGIN` and
      `AlignMode.ALWAYS`, so safe-area or size changes re-align it.
    - The fixed `setPosition(28,560)` / `(28,150)` calls are gone.
- **Controllers** (layout only):
  - Each row node is set to `UI_2D` before it is parented.
  - Row positions, content sizes, font sizes and `lineHeight` (= row height) come from
    `UiLayout`. The root content size is `layout.width × cardHeight(layout)`.
  - Unchanged: node names, entry order, texts and commands, the 4 root `TOUCH_*` listeners
    with `swallowTouch`, and the Buttons on child rows.
  - **Overflow decision (retry 1, TL):** every HUD and panel label sets
    `overflow = Label.Overflow.SHRINK` and `enableWrapText = false` before its first string.
    - Each row node, and therefore each Button's hit area, keeps its `UiLayout` size. This
      fixes the attempt-1 issue, where under `NONE` the hit areas were text-sized: ×1/×10/×MAX
      boxes were 83 px tall on a 66 px pitch (about 17 px of overlap), and the runtime rects
      differed from the model.
    - SHRINK is only a safety net. Rows are sized so that the longest representative real
      catalogue strings fit at nominal size; `tests/ui_layout.test.ts` estimates their widths.
    - No representative string has to shrink below its nominal size, so none goes below 20
      design units. On device, the Fabricator milestone line renders unshrunk at 611 px inside
      a 690 px row.
- **DEBUG `ui_layout` diagnostic** (`DEVICE_EVENT_TYPES` + bootstrap):
  - When it fires (no-op unless diagnostics are enabled from DEBUG):
    - 2 frames after the session binding activates (`reason: session_ready`);
    - 2 frames after `view` `canvas-resize` (`screen_resize`);
    - **retry 1:** 2 frames after the panel refresh that a selection change causes
      (`selection_refresh`).
  - The selection hook is DEBUG-only and emit-only. It wraps the existing
    `selection.onSelectionChanged` handler, which is itself unchanged, from
    `reportUiLayoutAfterSelection`. Each refresh restarts the 2-frame countdown, so the event is
    debounced to once per refresh; on device exactly one `selection_refresh` was seen per tap.
  - Payload: `screen{w,h}`, `safeArea`, `corners`, `rects` for `CoreHUD`, `ProducerPanel`,
    `Action_x1`, `Action_x10` and `Action_xMax`, and (retry 1) `rows`, the rect of every row
    per card. All rects are `{x,y,w,h}`.
  - Every rect comes from the bounding-box corners passed through `uiCamera.worldToScreen`. That
    is the bottom-left window frame that `zones_projected` and touches also use, which the
    scenario's calibration step verifies.
- **Device scenario `r036_ui_layout`** (`node … tools/device/cli.ts r036 --apk <apk>`), with
  helpers in `tools/device/ui_geometry.ts`:
  1. Clear the saves (`pm clear`, falling back to `run-as rm` on the NE2215), launch, and wait for
     `scene_ready`, `session_state` ready and `ui_layout`.
  2. Check the geometry:
     - every rect is inside the screen and the safe area (1 px tolerance);
     - the HUD and the panel do not overlap;
     - they cover at most 35% of the screen;
     - each Button is inside the panel;
     - no on-screen zone centre lies under the UI;
     - the `ui_layout` and `zones_projected` screens are the same size.
  3. Take a screenshot.
  4. Calibrate on the first of a set of candidate points that sits at least 24 px clear of every
     UI rect, then tap the Fabricator. This runs the full C3 chain and expects
     `selection_state next=Fabricator`.
  4b. (Retry 1) Wait for the `selection_refresh` `ui_layout`, which shows the real Fabricator
      strings, and run the step-2 geometry checks on it again. In addition:
      - each Button rect equals its `computeUiLayout(screen, safeArea)` prediction within ±2 px
        (`buttons_match_ui_layout`);
      - ×1/×10/×MAX do not overlap each other by more than 0.5 px (`buttons_do_not_overlap`);
      - every reported row is inside its card (`rows_inside_card`).
  5. Tap the centre of the HUD and of each Button, using the rects from the post-selection
     layout. Within 1.5 s of each tap there must be no
     `selection_raycast`, no `selection_state` and no `camera_focus`. The selection must stay
     Fabricator.
  6. Check that no runtime or `error` event occurred after `scene_ready`.

  Failure classes: geometry → `MARKER_PRESENTATION`; a UI tap that leaks to the world →
  `SELECTION_STATE`; a missing diagnostic or an error → `RUNTIME_ERROR`; the environment →
  `ENVIRONMENT`.

## Anchor corners

The TL default is kept: **HUD top-left, panel bottom-right**. The zone-occlusion check passed
on device, so no swap was needed.

Caveat: the unchanged C3 calibration tap lands at 4% × 8% of the display, i.e. Cocos (96, 994)
on the NE2215. It passes only because the NE2215's symmetric safe-area inset (96 px) starts
the HUD at x = 120. On a device with no left inset, that point would fall on the HUD, the HUD
would swallow it, and C3 calibration would fail. **The Technical Lead queued this as an AUT-INFRA
harness follow-up** (C3 should choose a calibration point clear of the UI); it is not fixed here.

## Invariants (held)

- The WorldCamera excludes `UI_2D`.
- The UI camera sees exactly `UI_2D`.
- Every HUD/panel node (canvas, camera, safe area, roots, rows) is `UI_2D`.
- Each controller registers exactly 4 `TOUCH_*` listeners, on its own root.
- `swallowTouch` is unchanged.
- Buttons are added on child rows only.
- No canvas or container listeners.
- `uiBlockerNodes` is not populated. The only reference is the pre-existing pass-through of the
  camera controller's empty list.

## Tests

- New:
  - `tests/ui_layout.test.ts` covers 1280×720, 1920×1080, 2412×1080, 2772×1272, and 2412×1080
    with a 100 px left inset. It checks that each rect sits inside the safe area, that nothing
    overlaps, coverage (≤30% at 16:9, ≤35% everywhere) and that the Buttons are inside the
    panel. It also checks fonts, row stacking and order versus the controller entries, the
    corners, the helpers, and that the module is engine-free.
    - Retry 1 adds a check that each row fits its longest representative real catalogue
      strings at nominal font size. The strings are built with the default catalogue: every
      producer, breakthrough and era name in each Next Goal form; the milestone line at the
      largest threshold, gap and multiplier in `milestones.json`; and the "Unavailable" action
      rows with a 5-character compact number.
    - The width estimate is 0.48 × fontSize per character. That is a margin over the
      0.42–0.46 measured in the NE2215 gate screenshots.
  - `tests/hud_landscape_wiring.test.ts` checks:
    - the UI camera wiring;
    - the stretch Widget on the Canvas and `UiSafeArea` + `SafeArea`;
    - every created UI node is `UI_2D`;
    - the touch and Button invariants, and that `uiBlockerNodes` is not populated;
    - the `ui_layout` scheduling;
    - (retry 1) every label in both controllers sets `Label.Overflow.SHRINK` and
      `enableWrapText = false` before its string, and no other overflow mode is used;
    - (retry 1) the DEBUG `selection_refresh` wrapper and the `rows` payload;
    - `FactoryWorld.scene` has no UI nodes, and `project.json` deep-equals the expected design
      resolution.
  - `tests/device_r036_scenario.test.ts` runs the scenario against a simulated NE2215: PASS, the
    `pm clear` fallback, and leak, overlap, button-outside, zone-under-UI, missing `ui_layout`
    and error modes. Retry 1 adds a post-selection `ui_layout` to the mock stream, emitted
    mid-camera-focus, plus the modes button-mismatch, button-overlap (2 px, inside the model
    tolerance), row-outside-card and missing post-selection `ui_layout`. It also unit-tests the geometry helpers.
- Amended, as authorized:
  - `tests/ui_input_routing.test.ts`:
    - **T2** now expects two cameras. The WorldCamera keeps `(ALL & ~UI_2D) >>> 0`, the UI
      camera has exactly `Layers.Enum.UI_2D`, and only the WorldCamera sees `DEFAULT`. The
      no-OR/no-ALL scan is kept.
    - **T3**: card sizes come from `UiLayout` (`layout.width, cardHeight(layout)`), with no fixed
      canvas size and not the old 720×1280 / 640×310 / 600×330. The root-listener,
      Button-on-child and no-canvas-listener assertions are kept.
    - **T5**:
      - "no explicit layer, DEFAULT buttons" is replaced by "every controller-created node is
        `UI_2D`".
      - Part (a) still reproduces the original bug, now with the historical pre-R-036 panel
        geometry (centre (28,150), 600×330) inlined, because the live layout no longer sits at
        the world origin.
      - Part (b): the world mask claims 0 samples for the historical root and for the real
        roots and rows on three screens.
    - **T1** and **T4** are unchanged. The unused `numbersFrom` helper was removed.
  - `tests/factory_world_session_wiring.test.ts`: only "HUD and panel layout constants are
    unchanged (layout belongs to AUT-R-036)" changed. It is replaced by assertions on the
    Widget/`UiLayout` wiring: `anchorCard`, the corners, `UI_EDGE_MARGIN`, `ALWAYS`, the
    `UiSafeArea` parent, and no fixed positions or canvas size.
  - `tests/presentation_text_wiring.test.ts` ("layout constants are unchanged"): only the
    position, content-size and font-size assertions changed; they now match the
    `UiLayout`-driven expressions. The `fontSize` count now counts `.fontSize = ` assignments
    (still 1), because `row.fontSize` adds a second token. Entry names and order, the
    `setContentSize` count per controller (2) and the Button count (1) are kept.
- All other tests are unmodified and green, including `camera_scene_smoke`,
  `asset_robot_spike`, `first_automation_*`, `presentation_text*` and `device_*`.
  `npm run check` (retry 1): 461 tests pass, plus config, Ads and pacing.

## Builds and device runs (NE2215, Android 15)

- `npm run android:build` with the tracked config (start scene CameraSpike, attempt 1): OK.
  Retry 1 did not change `settings/` or any spike code.
- CameraSpike smoke: install, launch, wait 10 s.
  - The app is alive, and logcat shows `Success to load scene: db://assets/scenes/camera/CameraSpike.scene`.
  - No `FATAL EXCEPTION` and no JS `Error`/`TypeError`.
  - Evidence: `temp/r036/camera_spike_smoke.png` and `temp/r036/camera_spike_smoke_logcat.txt`.
- AssetRobotSpike is covered by its tests only.
- **Retry 1** (current evidence):
  - `npm run device:gate-build -- --label r036-retry1` produced
    `temp/gate/ProjectAutomata-r036-retry1-343098b-dirty-factoryworld.apk` (sha256 `9302017c…`).
  - Afterwards `npm run device:restore-build-config` ran, and `git diff` on
    `tools/ci/cocos_android_debug_build.json` is empty.
  - Gate runs, all PASS:

  | Scenario | Run 1 (installs) | Run 2 (`--skip-install`) |
  |---|---|---|
  | r036 | `r036-ui-layout-20261110T100426Z-9302017c` | `r036-ui-layout-20261110T100458Z-9302017c` |
  | c3 | `c3-producer-selection-20261110T100513Z-9302017c` | `c3-producer-selection-20261110T100531Z-9302017c` |
  | int001 | `int001-session-persistence-20261110T100543Z-9302017c` | `int001-session-persistence-20261110T100605Z-9302017c` |

  - The post-selection `ui_layout` matches the model exactly:
    - panel 720×408 at (1572, 24);
    - ×1, ×10 and ×MAX are each 690×66, at y = 171, 105 and 39 (adjacent, no overlap);
    - every row is 690 px wide and inside its card;
    - HUD 690×300 at (120, 756).
- Attempt 1 (superseded): label `r036`, APK `94ab6ac1…`. All PASS ×2:

  | Scenario | Run 1 (installs) | Run 2 (`--skip-install`) |
  |---|---|---|
  | r036 | `r036-ui-layout-20261110T095133Z-94ab6ac1` | `r036-ui-layout-20261110T095213Z-94ab6ac1` |
  | c3 | `c3-producer-selection-20261110T095228Z-94ab6ac1` | `c3-producer-selection-20261110T095246Z-94ab6ac1` |
  | int001 | `int001-session-persistence-20261110T095302Z-94ab6ac1` | `int001-session-persistence-20261110T095325Z-94ab6ac1` |

- **Screenshot for the deferred readability gate:**
  `temp/device/r036-ui-layout-20261110T100426Z-9302017c/screenshots/01-ui_layout.png`. A
  version with the Fabricator selected and real strings is `02-fabricator_selected.png` in the
  same run.

## Notes

- `Main.scene` (protected, not edited) serializes a 720×1280 Canvas with a stretch Widget and
  `alignCanvasWithScreen`. At runtime its Widget and Canvas realign it to the visible size of the
  new 1280×720 fit-height resolution. It was not run on device; the Technical Lead accepted that.
- Out of scope and unchanged: styling (no sprites, colours or fonts), the Manual Produce / Next
  Goal actions (AUT-UI-001), wording, `uiBlockerNodes`, camera input code, and spike UI.
- Remaining composition or readability polish goes to AUT-UI-001's gate. If that gate fails, a
  presentation-only AUT-R-036-02 pass follows.
