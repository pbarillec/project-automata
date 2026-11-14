# AUT-RBT-001 Reboot Entry and Confirmation UI

AUT-RBT-001 gives the player a way to Reboot: a small "REBOOT +N" chip (visible only while the Reboot is eligible) and a two-step confirmation modal (RESETS / KEEPS, AI Cores to gain, progress to the next Core). It adds no runtime, economy, save, schema or Reboot-flow change, no `GameCommand`, no session or port method. The confirm button submits the existing `{ type: 'rebootCivilization', confirmed: true }` through `binding.submit`, which already routes it to the AUT-049 Reboot transaction.

## Flow

- `FactoryWorldStateBindingOptions.reboot` is a new optional sink (like `permanentUpgrades`), refreshed from every fresh snapshot in `refreshViews`.
- Pure modules (no `cc`, explicit `.ts` imports): `RebootPanelViewModel.ts`, `RebootLayout.ts`. Thin `RebootController.ts` builds nodes, draws Graphics fills and submits the view model's own command through `commandEmitter`. Metas use `a0b10000-0000-4000-8000-00000000000{1,2,3}`.
- `FactoryWorldBootstrap.createReboot()` builds a full-screen root (backdrop + safe-area container) after `createSettings()` and before `createOfflineReport()`, so the offline card stays the last, topmost Canvas child. The chip is built under the HUD safe-area container, first among its siblings (behind toasts). `wiring.reboot.commandEmitter = (command) => binding.submit(command);` is the sixth `binding.submit` site.
- `updateSettingsSuppression()` also calls `reboot.setSuppressed(offlineReport.isVisible() || isRebootCardActive())`: chip hidden (scale), idle modal closed.

## View model (`createRebootPanelViewModel(repository, state, catalogue?)`)

`{ visible, aiCoresToGain, currentAiCores, resultingAiCores, currentCivilization, resultingCivilization, progressRatio, progressPercent, texts, resets[], persists[], command }`.

- Availability is exactly `createRebootPreview().eligibility === 'eligible'` (positive reward only; no era check; the HUD Next Goal's stricter rule is untouched). `command` exists only while eligible.
- Cheap stage every call: `createPrestigePreview(...).currentAiCoreReward > 0` (no clone). The full `createRebootPreview` runs only when that says eligible and is memoized on (`run.prestigePowerPeak`, `meta.aiCores`, `meta.civilizationNumber`) plus repository / catalogue identity; the not-eligible model is memoized too. Test: config reads per call show no full preview while ineligible and none on repeated eligible calls.
- The percent is `Math.round(progressToNextCore * 100)` (formatting only; pinned: no `Math.pow`, `**`, `5 *`, `p0`, no `remainingPrestigePowerForNextCore`). The UI never touches the reward formula.
- `resolveRebootResult(result, blockedByPendingOffline)` (pure, unit-tested) maps the submit result: accepted + `save.ok` not false -> `rebooted` (close; the AUT-049 sequence starts from the durable `rebootCompleted` event); accepted + `save.ok === false` -> `rebooted_persistence_failed` (close, no sequence, no durability claim); `null` with the bootstrap flag (set by `onRebootBlockedByPendingOffline`) -> `blocked_pending_offline` (close so the offline card is not stacked); `null` without the flag (exception) -> `error` (stay open, note); `execution.ok === false` -> `rejected` (stay open, note). `LifecycleCommandResult.save` is `null` for a rejection and `{ ok }` otherwise.

## UI (AUT-050 / 051 language, no new asset)

Chip: 200 x 64, font 26, "REBOOT +5" with the procedural cyan AI mark (`aiMarkGeometry` reused, PLACEHOLDER like the AI chip), right-aligned at `UI_EDGE_MARGIN`, top offset = AI chip top + 64 + 8 (a fixed second slot under the AI chip, so nothing shifts). Hidden by scale when not eligible, suppressed, or the modal is open.

Modal: 640 wide, 556 tall (under the 75% band cap, about 585 at 1280), centred with `offlineReportCardCenterOffsetY()`, black backdrop alpha 150, graphite pill, off-white text, cyan accent; no amber, no red; no scrolling. Rows: "REBOOT CIVILIZATION" (30), AI mark + cyan "+5 AI CORES" / "+1 AI CORE" (42), "Civilization #1 to #2" (24; also the failure-note slot), an opaque cyan progress bar + "Next AI Core 45%" (22), RESETS (dim dash markers) and KEEPS (cyan dot markers) columns of 300 wide with a 16 gap (22 / lines 28, shrink floor 20, not colour-only), a full-width cyan "REBOOT" (64, font 30) and a "CANCEL" (graphite + cyan outline, 64, font 30), Confirm on top, 10 gap. Two-step confirm, no hold-to-confirm. CANCEL and a backdrop tap both cancel and submit nothing; both are inert while the Reboot is in flight (buttons dimmed by alpha). The word "reset" is never used for the action.

Redraws happen only when a view signature changes (the sink fires about once per frame). While open the sink keeps numbers live; an idle modal closes when the Reboot is no longer eligible, an in-flight one waits for its result.

### Decisions made by default (MVP, owner autonomy policy)

- RESETS / KEEPS lists verified against GAME_DESIGN section 12 and ECONOMY section 14 and adopted as briefed. ECONOMY also lists "account-level feature unlocks such as known Free Overclock" under Persist; it is not shown (five lines per column, and "Settings and purchases" / "Records and statistics" cover the account level). Revisit with the Game Designer if the list should be exhaustive.
- GAP vs GAME_DESIGN section 12 ("concrete preview of permanent benefits"): the modal does not list concrete upgrade effects; the AI chip opens the AUT-050 panel for those. A later polish task can add it.
- Closed reasons: `cancel | backdrop | confirmed | no_longer_eligible | blocked_pending_offline`, plus `suppressed` (the offline card / Reboot title card took the screen while the modal was idle). A persistence failure closes with reason `confirmed` (status `rebooted_persistence_failed`).
- A result `ok` without `rebootCompleted` (a port without the Reboot transaction falls back to `execute`) still maps to `rebooted` when the save did not fail.
- The Reboot chip hides while the modal is open (brief), so `chip_hidden` / `chip_shown` events appear around each open / cancel; they carry `modalOpen`.
- A major toast (620 wide, 96 tall) may pass over the chip for a moment (the chip is placed behind toasts, same as the AI chip); Minor toast (first line) never overlaps. The Next Goal row stays unchanged and not tappable.
- 21 new localization keys (`reboot.*`); `localization/en.json` now holds 139 entries, `EmbeddedTextCatalogue.ts` regenerated. Copy needs Game Designer wording approval.

## DEBUG diagnostics and device tooling

- New event `reboot_ui` (allow-list + reveal event types): phases `chip_shown | chip_hidden | opened | cancel_tapped | closed | confirm_tapped | result` with the fields of the brief. `ui_layout` rects gained `RebootChip`, `RebootPanel`, `RebootConfirm`, `RebootCancel` (null while hidden). Release builds never emit.
- `npm run device:seed-rbt001` (`tools/device/seed_rbt001.ts`): the AUT-049 `reboot` state with `prestigePowerPeak` = 1.2 x p0 (reward stays 5, progress about 45%: (1.2 - 1) / (1.44 - 1)), `savedAtUtc` 5 s old, stale saves and `debug_command.json` removed, NO command file written.
- Scenario `rbt001` (`npm run device:reveal-capture -- --scenario rbt001`, trigger `none`, expectation `expectRebootUi: 'confirm_flow'` passed through both `reveal_capture.ts` and `cli.ts`): baseline with the chip, REAL tap chip, modal frame, REAL tap CANCEL, frame, REAL tap chip again, REAL tap REBOOT, frames at about 0.5 / 1.5 / 2.5 / 3.5 / 5 s plus one after, force-stop and relaunch without reseeding, frame.
- Objective checks (`tools/device/reboot_ui_checks.ts`): chip shown with reward > 0; modal opened with the reward text and 5 + 5 lines; buttons >= 64 design units at the capture scale; cancel path submits nothing; confirm accepted with `aiCoresGranted` / `civilizationChanged` / `rebootCompleted`, saved result; `sequence_started.aiCoresGranted` equals the announced reward and Civilization number; `closed(confirmed)` within 1.5 s of `sequence_started`; one sequence finished <= 4.05 s with the REBOOT / AI CORE x5 / CIVILIZATION #2 beats; modal and chip hidden after; AI chip balance equals the new balance; after the relaunch no Reboot chip, no sequence, balance persisted; the generic 0-errors check.
- Pins updated legitimately: scenario lists and CLI usage regexes (`...|aut052|rbt001]`), `binding.submit(` count 5 -> 6 plus an explicit pin of the emitter line, `commandEmitter =` counts, the `sessionWiring` pin, the catalogue entry count (139), placeholder and reachability pins in `presentation_text.test.ts`.

## Tests

`tests/reboot_ui.test.ts` (27): view model from the real config (ineligible, eligible equals `createRebootPreview`, singular, lists, no-math source pins, memoization), result mapping, real `LifecycleSessionCoordinator` + `FactoryWorldStateBinding.submit` (success, persistence failure, pending offline, rejection), controller guard pins, layout on the six offline-report screens, source pins (Graphics, no `node.active`, Buttons on child nodes, metas, bootstrap wiring, no new `GameCommand`, HUD untouched), seed round trip, scenario / CLI registration and the device checks.

## Not verified here (human / device)

No gate build in this task. Rendering on device (legibility, fills, hexagon mark, column density, progress bar), real-tap behaviour of the Button hit rects, touch swallowing so camera / selection do not receive chip or modal taps, the chip under a Major toast, the `rbt001` capture itself, and subjective feel (is the confirmation clear and calm, is the chip discoverable) are pending review. The controller itself is `cc` code and is covered by source pins only.
