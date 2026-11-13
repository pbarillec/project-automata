# AUT-048 Era Transition Presentation

**Human gate: PENDING** (vision-capable visual QA of device screenshots first; owner only for the subjective items below). Automated checks prove timing envelopes, ordering offsets, subsumption, replay / dedupe, silent load, Reboot cancel, focus gating, wording / accent, layout geometry, wiring and the tooling only.
Presentation only: no economy, runtime, data, save, camera-API, design, monetization or art-direction change; no new asset, no new scene node, no new light / particle. AUT-049 (Reboot presentation), sound, Era IV and any "Enter Era" action are out of scope.

## What was built

One layer on top of the AUT-045 environment fade (which is NOT re-implemented): **a title card + an optional focus beat**, as a new Exceptional tier of the AUT-046 toast band (same pill / label / accent underline, same `MilestonePresentationController`, no parallel UI). The era card is inert (no touch listener) and nothing blocks input.

- `EraTransition.ts` (new, pure, engine-free): `ERA_TRANSITION_SPECS` (one row per presented era), `buildEraTrigger` (the `e:<eraId>` fact trigger, kind `era_title`, tier `exceptional`, no pulse / sparks), `eraFactKey`, `resolveEraFocus` (focus gating).
- `MilestoneToastQueue.ts`: tier `exceptional` timing `0.3 s in / 2.2 s hold / 0.5 s out = 3.0 s` hard cap (underline wipe like Major); the card pre-empts every visible and waiting Minor / Major (`preempted`), a Minor arriving while it shows is dropped (`exceptional_active`), a Major waits behind it.
- `MilestoneToastLayout.ts`: `exceptional` layout 680 x 112, single title line (font 32, line 44), no subtitle, 5-unit underline inset 28; `eraUnderline` colours (amber 240,176,64 / cyan 59,112,121 = AUT-045 environment cyan, never brighter than the lamps 82,206,224); title text off-white; `milestoneToastFitsFactoryBand` takes a tier.
- `MilestoneToastText.ts`: era title from the era table (English, all caps, `AUTOMATED FACTORY` / `ROBOTICS COMPLEX ONLINE`; AUT-052 moves it to the catalogue, no catalogue churn).
- `MilestonePresentationViewModel.ts`: `e:<newEraId>` fact (from the snapshot era id and from `eraChanged`), pending era card on the shared clock (`tick` offers it when its delay elapsed), `replayEra`, Reboot cancel, subsumption.
- `MilestonePresentationController.ts`: era card start (`era_transition` events, era focus beat through the existing `focusOnRevealTarget`), `replayEraTransition(eraId)`, underline colour / off-white title for era cards, `title_applied` proof event. Both toast start paths are handled (offer path in `consumeDomainEvents` and tick path in `update`; the delayed card arrives through `tick.started`).
- `DeviceDiagnostics.ts`: `era_transition` event type. Wiring: unchanged bootstrap (the existing band, camera, construction and anchor resolver are reused); `PresentationController` order unchanged (environment observes the era change before the milestone controller).

## Behaviour (as implemented)

| Era | Card | Delay after t0 | Underline | Focus |
|---|---|---|---|---|
| II `automated_factory` | AUTOMATED FACTORY | 0.6 s | amber | Robot Line anchor; skipped while any construction sequence runs (`reveal_active`) or a camera focus is active (`camera_busy`) |
| III `robotics_complex` | ROBOTICS COMPLEX ONLINE | 0.4 s | cyan (59,112,121) | Robotics Complex anchor; skipped when within 2.5 world units of the camera focus (`on_centre`) |

- t0 = `eraChanged` observed (event or snapshot); the AUT-045 fade starts at t0 in its own view model; the card never waits for the fade and vice versa (no coupling in code).
- The card + camera focus use `Zone_<Zone>/<Zone>_FocusAnchor` (`producerZoneName`). A touch / pan cancels the focus inside the camera (no re-snap); the card and the fade continue. Never a pan to the teaser (the teaser stays sealed and unlabelled; no Era IV text).
- Subsumption: every other toast of the same batch (Robot Line built, Advanced Robotics, automation chips) is `subsumed`, so ONE card shows. A Major in a later batch still toasts (it waits behind the card). Era focus is therefore the only focus of the batch.
- Replay: decision from the snapshot era id and `eraChanged` with dedupe key `e:<newEraId>`; snapshot-before-event and event-before-snapshot each fire once. Workshop -> Era III shows ONE card (Era III). The first sync (load) is silent (no card, no focus; the environment snaps as AUT-045). The era key is a "current era" fact: II -> III is not mistaken for a Reboot.
- Reboot (`rebootCompleted` event or a snapshot returning to Workshop): cancels a pending or visible card, clears the fact keys, re-baselines silently (no card back in the Workshop) and lets the eras present again in the next run.
- `replayEra(eraId)` / `replayEraTransition` re-show only the card (and its focus decision) from the era id; they hold no state, submit no command, never read or write the save and do not touch the environment.
- Restraint: no tint / flash / shake / vignette / letterbox, no new lights / particles / objects, red never used, no work outside the 3 s window (an idle tick is empty; only a pending delay or a visible card does work).

## Diagnostics / seed / capture

DEBUG `[AUT-DEVICE]` event `era_transition`: phases `synced` (era id on load), `scheduled` (era id, card delay, subsumed keys), `title_started` (era id, title, accent), `title_applied` (first full-alpha frame: band scale, label text / font, underline rgb, pill world position), `title_finished` (`elapsedSeconds`, about 3.0), `focus_requested` / `focus_skipped` (reason, `anchorResolved`, `worldPos`), `cancelled` (reason `reboot`).

- `npm run device:seed-aut048 [-- --variant era2|era3]` (`tools/device/seed_aut048.ts`): one step before the transition. `era2` = the AUT-042 `unbuilt` state (Robot Line unbuilt, affordable). `era3` = the AUT-044 `unbuilt` state with the NATURAL era `automated_factory` (not the AUT-044 pre-entered `robotics_complex`), Advanced Robotics affordable.
- `npm run device:reveal-capture -- --scenario aut048` (Era II): new trigger `robot-line-build` = tap the projected Robot Line zone, wait for the selection `ui_layout` refresh, tap the panel `Action_x1` (both existing player tap paths; no DEBUG trigger, no HUD action). Checks: no errors, `era_synced_on_load`, `era_title_started` (correct era, exactly one, none before the trigger), `era_title_finished` (`elapsedSeconds <= 3.5`), `era_focus_decision`, `era_environment_fade_started`, plus the construction checks.
- `--scenario aut048-era3`: **no existing tap path triggers Era III** (the Next Goal is an `era` goal, the owner deliberately has no era-goal HUD action, and the breakthrough is not a producer-panel purchase). The scenario only proves the silent load at the natural era (`era_no_title_on_load`). The live Era III card is covered by unit tests only. If a live capture is wanted, the owner / Technical Lead must decide how to trigger it (not done here).
- Pins updated: `Object.keys(REVEAL_SCENARIOS)` in `tests/era_environment.test.ts` and `tests/reveal_capture.test.ts`, the cli usage regexes in `tests/boost_presentation.test.ts` and `tests/overclock_hud_action.test.ts`, and the AUT-046 view-model test that asserted the Robot Line / Advanced Robotics Major toasts of an era batch (now subsumed, deliberately).

## Tests (`tests/era_transition.test.ts`, 17)

Tier timing envelope (0.3 / 2.2 / 0.5, 3.0 s hard cap, wipe), layout on 5 screens (never over HUD / Next Goal / buttons / panel, fonts >= 24, no subtitle), text / accent / cyan = environment cyan <= lamps / no Era IV, queue pre-emption, offsets (0.6 / 0.4 s on the shared clock, fade independent), subsumption (Major + Minor, both eras), replay both orders, `replayEra` (no state / save), silent load, Workshop -> III, II -> III is not a Reboot, Reboot cancel (event / snapshot, pending / visible, no card in Workshop, eras present again), real `GameRuntime` Robot Line build and Advanced Robotics breakthrough, focus gating, controller / wiring / no-state / no-command / no-touch / no-new-object pins, empty idle tick, seeds (round trip, silent load, one step to the card), capture checks and tooling.

## Deviations / interpretations (each to confirm)

1. **Era III focus when a construction / reveal focus is active:** the approved rule only lists the 2.5-unit on-centre skip for Era III, so the card asks for the focus even while the AUT-044 construction sequence (which has its own reveal focus beat to the same anchor) runs; the camera simply re-eases to the same target. Add `camera_busy` / `reveal_active` to the Era III rule if this should yield to the sequence.
2. **No camera cancel on Reboot:** the existing camera API has no cancel; Reboot cancels the card (pending or visible) but a focus ease already requested (0.45 s) finishes on its own. No new camera API was added.
3. **Optional Era III seam pulse at 100% for the first 1 s was not implemented** (optional; the AUT-045 seam envelope is untouched).
4. **Card title colour is off-white** (the era accent lives on the underline) so the cyan never exceeds the lamps; Major keeps accent-coloured titles.
5. **Same-batch Minors are also subsumed** (not only Majors): a Minor chip (e.g. "Robot Line automated") would otherwise flash for 0.6 s before the card pre-empts it.
6. **Implementer values for Art Director / Scene Presentation review:** title font 32 / line 44, underline 5 high / inset 28, underline wipe 0.6 s (reused from Major), card layout inside the AUT-046 band (8-unit gap below the HUD).
7. **Era II capture trigger is new capture-side tooling** (zone tap + panel button via `zones_projected` / `ui_layout`), unverified on a device; if the Robot Line zone is not on screen at launch the trigger reports it and fails `trigger_sent`.
8. The AUT-046 deviation "one Major per burst" is unchanged; the AUT-046 test of the era-batch Major toasts was updated to the subsumption rule.

## Review plan / unverified

1. Vision-capable visual QA first (no APK built here): `npm run device:seed-aut048`, then `npm run device:reveal-capture -- --scenario aut048`; stills must show the card (graphite pill, white all-caps title, amber underline) in the band below the HUD, never over Next Goal / buttons, readable, one card, nothing over the factory; the load frames must show no card. Objective event checks above.
2. Owner only for the subjective items: how the 3.0 s card and the underline wipe feel against the construction sequence and the environment fade, whether the Era II camera skip (construction owns the camera) leaves the moment satisfying, the Era III focus beat, the card wording and colour.
3. Not verified on a device or visually: any colour, card / underline motion, the focus beat (Era II is expected to be skipped; Era III cannot be triggered by tapping), touch cancel feel, Widget placement of the 680-wide card at runtime, the `robot-line-build` tap sequence.
4. Source docs untouched (`CODEX_PLAN`, `ART_DIRECTION`, `ASSET_MANIFEST`, `TECHNICAL_DESIGN`).
