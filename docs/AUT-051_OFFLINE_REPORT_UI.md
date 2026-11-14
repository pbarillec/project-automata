# AUT-051 Offline Factory Report UI

AUT-051 shows the offline report the session already computes (AUT-027 / AUT-028) as a single card and wires the normal Collect flow. It adds no economy value, no offline formula, no `GameCommand` and no rewarded / ad affordance (the rewarded x2 flow is AUT-055).

## Flow

- The engine-free session owns the report: `session.getPendingOfflinePreview()` (kept only for a `preview_ready` preview) and `session.collectPendingOffline()` (idempotent, critical save with the collection cursor). There is no `PendingOfflineReport` / report id: the pending preview is the report.
- `FactoryWorldSessionPort` gained two OPTIONAL methods (`getPendingOfflinePreview`, `collectPendingOffline`), same pattern as `rebootCivilizationConfirmed?`. `FactoryWorldStateBinding` exposes `getPendingOfflinePreview()` and `collectOfflineReport()` (guarded; refreshes the HUD / panel views from the fresh snapshot after an applied collection; emits no domain event, so no milestone toast, camera focus or fanfare can start from Collect). It also takes an optional `onRebootBlockedByPendingOffline` callback.
- `FactoryWorldBootstrap` shows the card after the session is ready (`startup`), after `binding.resume()` (`resumed`, a second resume refreshes the same card, no stacking) and when a Reboot was blocked by a pending report (`reboot_blocked`: DEBUG event plus the card is re-surfaced). A `no_reward` / invalid / null preview shows no card.
- Collect outcomes (pure `resolveOfflineCollectOutcome`): `collected_saved` / `no_reward_saved` close the card; `collected_persistence_failed` / `no_reward_persistence_failed` close it and report the status in the DEBUG event (durability is never claimed); `collect_failed` keeps the card with Collect enabled and the secondary line "Couldn't collect. Tap to try again."; `no_pending_preview` closes a stale card. While a collection is in flight the button is dimmed by alpha and a second tap is ignored.

## D1: the report survives a reload (no schema change)

Cause: ordinary saves (about 1 per second) stamped `savedAtUtc = now`, overwriting the absence start while a preview was pending, so killing the app before Collect lost the reward.

Fix (`LifecycleSessionCoordinator`): the coordinator keeps the absence-start cursor of the pending preview (`load.envelope.savedAtUtc` at startup, the suspend boundary when `resume` creates the preview). All its saves go through one private `requestSave`: while a preview is pending, every save except the `offline_collect` one (ordinary saves, the suspend save, the permanent-upgrade save) is written with that original `savedAtUtc`. The collect critical save still sets the collection cursor, and with no pending preview nothing changes. A relaunch therefore recomputes an equivalent report from the same absence start (slightly larger by the time since); after Collect the cursor is the collection time and a relaunch has nothing to collect. Saved `GameState` is unchanged, the envelope schema is unchanged.

## D2 (pending owner decision, one-line change)

The educational line ("Automated producers kept working. Not automated: {names}.", max 2 names then "and N more") is derived from the preview: it appears only when at least one built producer has the contribution reason `not_automated`. `OFFLINE_REPORT_SHOW_EDUCATIONAL_LINE` (`OfflineReportViewModel.ts`) is the single boolean policy input (`createOfflineReportViewModel(preview, { showEducationalLine })`). Nothing is persisted, so as built it appears on every report that qualifies, not only on the first return; restricting it to a first return needs an owner decision (and a persisted flag).

## Card (AUT-046 / 048 / 049 language, no new asset)

Pure modules (no `cc`): `OfflineReportViewModel.ts` (preview to fields, collect outcome mapping), `OfflineReportText.ts` (duration formatter, composition from the catalogue), `OfflineReportLayout.ts` (rows, card, COLLECT, colours, screen rects through `computeUiLayout`). Thin `OfflineReportController.ts` builds the nodes and draws Graphics fills.

Top to bottom: "FACTORY REPORT" (30); "Away 3h 20m" (26, the effective time); "Offline limit 8h reached" (22, cyan, only when the cap applied); the hero reward "+1.2M Industrial Output" (amber 42, via `formatCompactNumber`); "+N Robots Built" (26, only when `robotsBuiltDelta > 0`); the note slot (educational line, or the retry line after a failed collect; 22, 2 lines); COLLECT (amber fill, dark text, 30, 64 units tall, card content width). Absent rows are omitted and the card shrinks. Card width 640, height 240 to 350 design units (at most 30% of the screen height), centred in the factory band between the HUD band and the Producer Panel (never over Next Goal / Overclock rows or panel buttons). Graphite pill (24,29,32,245), off-white text, amber reward / COLLECT, cyan secondary, never red. A full-screen black backdrop (alpha 150 of 255) swallows every touch except COLLECT (no tap-outside dismiss).

Android lessons applied: Graphics fills (no spriteFrame-less Sprite); scale-based visibility (never `node.active`); label font sizes with margin, explicit line heights, bounded widths with SHRINK; COLLECT is a Button on its own child node whose hit rect is the drawn rect (AssemblyBatchActionController pattern); the dim backdrop is redrawn when its Widget-driven size changes.

## Localization

`localization/en.json` gained 9 keys (`offline.title`, `offline.time_away`, `offline.cap_reached`, `offline.reward`, `offline.robots`, `offline.explain.manual`, `offline.explain.more`, `offline.collect`, `offline.collect_failed`); the file now holds 64 entries. `EmbeddedTextCatalogue.ts` was regenerated. Duration units ("h", "m", "<1m") are symbols in the pure formatter.

## DEBUG diagnostics

New event `offline_report` (added to the `DeviceDiagnostics` allow-list): `{ phase: shown | refreshed | collect_tapped | collect_result | hidden | skipped | reboot_blocked, status, effectiveSeconds, rawSeconds, capApplied, reward, robotsDelta, notAutomatedProducerIds, explainShown, cardRect, collectRect, scale, saveOk, texts }`. `ui_layout` rects gained `OfflineReportCard` / `OfflineReportCollect` (null while hidden). Release builds never emit.

## Device tooling

- `npm run device:seed-aut051 [-- --variant first|compact|cap|reload]` (`tools/device/seed_aut051.ts`): valid save, Fabricator automated (Auto Feeder), Assembly Station built and left manual (`first`, `cap`, `reload`); `compact` has every built producer automated (no educational line); envelope `savedAtUtc` = host UTC now minus 3 h (10 h for `cap`); removes stale saves and `debug_command.json`. Requires the FactoryWorld DEBUG APK.
- Reveal scenarios: `aut051` (screenshot with the card, tap COLLECT at the rect reported by `ui_layout` / `offline_report`, screenshot after, force-stop and relaunch WITHOUT reseeding: no card, collect saved) and `aut051-reload` (launch with the seed, force-stop BEFORE Collect, relaunch: the card shows again with an equivalent reward). Objective checks live in `tools/device/offline_report_checks.ts`. The CLI usage line and the pinned scenario lists were updated.

## Tests

`tests/offline_report.test.ts`: view model, text (keys, duration edge cases, name cap), layout on six screens (inside safe area and factory band, no overlap with HUD / panel rects, COLLECT >= 64 units and font >= 28), binding / session integration with the real `LifecycleSessionCoordinator` (startup pending, collect, double collect, persistence failure, collect_failed, resume without stacking, no_reward never retained, Reboot blocked then allowed, no domain events), D1 reload persistence, source pins (Graphics, no `node.active`, no ad words, metas, allow-list), seed and device checks. `presentation_text.test.ts` covers the new placeholders and key reachability.

## Not verified here (human / device)

Rendering on a real device (card legibility, backdrop dim, COLLECT feel), that the node-level touch swallowing blocks the camera / selection input exactly like the HUD, the tap-through of COLLECT on the Android build, and the device scenarios `aut051` / `aut051-reload` are not run in this task (no gate build). The "IO persisted" proof of the capture is a proxy (saved collect plus no card after the relaunch).

## Device evidence and visual QA (2026-11-14)

DEBUG APK from a5c910a (gate label aut051). Collect: `npm run device:reveal-capture -- --scenario aut051` (`temp/reveal/aut051-offline-report-2026-11-14T112915/`): all checks PASS, 0 errors; card shown on launch (+304K, Away 3h, explain line), Collect tapped, `collected_saved`, card hidden, 0 toast/camera/era/reboot events after the tap; after relaunch the original report is not re-granted (only a small genuine relaunch-gap report appears). Check fixed in b3e8735 (the first run failed only because the strict check treated the legitimate ~8 s relaunch-gap report as a failure). Reload: `--scenario aut051-reload` (`temp/reveal/aut051-offline-reload-2026-11-14T112937/`): force-stop before Collect, relaunch shows the same card (reward 303844 -> 304035): the D1 fix (pending absence start preserved across ordinary saves, no schema change) is proven on device.

Vision QA (stills): PASS. Card centred clear of HUD/panel, hero reward largest, COLLECT 64 units amber, no white rectangles, no ad/x2 affordance, card gone and HUD IO increased after Collect, no fanfare.
Non-blocking POLISH: explain line ~20 px above COLLECT; backdrop dim (alpha 150) leaves little factory context; small-number format "+217.8" vs "+304K" to confirm against formatCompactNumber; Next Goal change not evidenced (goal is level-based).
Pending human / product: card feel and dismissal; whether sub-minute relaunch reports should be suppressed (minimum threshold = product/economy decision); D2 educational line repeats while a producer is manual (persisted first-return flag needs owner decision); copy needs Game Designer wording approval; backdrop touch-swallowing on device not verified from stills.
