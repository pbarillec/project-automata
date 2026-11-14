# AUT-050 Permanent Upgrade UI

AUT-050 gives the player a way to spend AI Cores: a small "AI x{N}" chip and a modal AI Upgrades panel (Production / Automation / Expansion). It adds no economy value, no schema change and no `GameCommand`: purchases are the existing `purchasePermanentUpgrade` command (AUT-030). The UI contains no AI Core math or effect duplication.

## Sequencing gap (recorded, not solved here)

There is no Reboot UI yet (confirm / preview / respec are out of scope). AI Cores are only obtainable through the DEBUG-only `rebootCivilization` debug command or a seeded save until a Reboot UI task exists, so on a normal save the chip stays hidden (`shouldShowRelaySocket` is false until AI Cores or Civilization #2).

## Flow

- `FactoryWorldSessionPort` gained one OPTIONAL method, `purchasePermanentUpgrade?`, same pattern as `rebootCivilizationConfirmed?` and the AUT-051 offline methods. `FactoryWorldStateBinding.submit` routes `purchasePermanentUpgrade` through it when the port has it, so the purchase commits in memory and writes a CRITICAL save (`permanent_upgrade_purchase`) before the result returns, instead of the ordinary-save path every other command takes. A rejection changes nothing and requests no save; a persistence failure still fans out the in-memory change (the session does not roll back) and the result carries `save.ok === false`. A port without the method falls back to `execute`.
- `FactoryWorldStateBinding` has a new optional sink (`permanentUpgrades`), refreshed from every fresh snapshot (`refreshViews`: start, every accepted command including `aiCoreBalanceChanged`, collect), so the chip balance and an open panel stay live.
- Pure modules (no `cc`, explicit `.ts` imports): `PermanentUpgradePanelViewModel.ts` and `PermanentUpgradeLayout.ts`. Thin `PermanentUpgradeController.ts` builds nodes, draws Graphics fills and submits the view model's own row command through `commandEmitter` (the binding, which returns the result so the controller can guard and report).
- `FactoryWorldBootstrap.createPermanentUpgrades()` builds a full-screen root (backdrop + safe-area container) as a Canvas child created BEFORE the offline report root, so the AUT-051 card stays the last, topmost child. The chip is built by the controller under the HUD safe-area container (Widget top / right, ALWAYS) and placed first among its siblings (behind the HUD cards and the toast band).

## View model (`createPermanentUpgradePanelViewModel(repository, state, catalogue?)`)

Output `{ aiCores, civilization, chipVisible, texts, rows[], branches[] }`.

- Row state is derived ONLY from `evaluatePermanentUpgradeRankState` plus `aiCores >= nextRankCost`: `maxed` (`max_rank`), `locked` (`prerequisite_locked`), else `affordable` / `insufficient`. Rank, next cost and missing prerequisites are never recomputed; a locked row stays locked whatever the balance.
- `missingPrerequisites` are resolved to a display name and required rank; `lockedText` is "Needs <Name> rank N" (first missing prerequisite).
- `effectText` is the catalogue template filled with the raw per-rank number read from the config effect (formatting only: percent from `multiplier - 1`, `bonus`, `1 - multiplier`, `reduction`; no multiplying, no compounding, no cumulative totals). Breakthrough-override effects add a second line "<Breakthrough> cost x<costMultiplier>" read from the config rank the player gets next (the last rank once maxed). Pinned by tests: no `Math.pow` / `**`, no `rankCosts` / `permanentUpgradeRanks` access, no modifier-set import, and the view model imports `evaluatePermanentUpgradeRankState`.
- `chipVisible` calls the existing `shouldShowRelaySocket(aiCores, civilization)` (not duplicated).
- `row.command` is `{ type: 'purchasePermanentUpgrade', upgradeId }` only while the row is `affordable`.
- `branches[].canBuy` drives the small cyan dot on a tab.

## UI (AUT-051 offline-card language, no new asset)

Chip: 150 x 64 design units, right-aligned at `UI_EDGE_MARGIN`, 8 units under the HUD band (no HUD height added; checked with `computeUiLayout` on the six offline-report test screens: inside the safe area and the factory band, no overlap with any HUD / panel rect, so none with the Overclock rows or the Next Goal button). Procedural AI mark (cyan hexagon outline, off-white diamond; Graphics polygons, PLACEHOLDER: `CUSTOM_AI_CORE_01` is a separate task, `ASSET_MANIFEST.md` untouched) plus "AI x6". Hidden by scale 0 (never `node.active`).

Panel: modal card 640 wide, 556 tall (at most 75% of the factory band, about 585 units at 1280), centred with `offlineReportCardCenterOffsetY()`, over a full-screen black backdrop (alpha 150, redrawn when its Widget size changes) that swallows touches; a tap on the backdrop (outside the card) closes the panel, CLOSE always works (also during a purchase). Graphite pill (24,29,32,245), off-white text, cyan (88,170,184) for AI / permanent accent, amber ONLY for the buy of an affordable row, never red. Top to bottom: "AI UPGRADES" (30) left and AI mark + "x N" (32) right; three tabs 200 x 64 (font 24; selected cyan fill, others graphite with a cyan outline, small dot when the branch has something affordable); the selected branch's rows (100 tall, three fixed slots so nothing moves between tabs): name (26) + "Rank 1/3" (22) right-aligned, two lines of effect text (21, line height 24, shrink) or the cyan locked line, a 160 x 64 buy button; CLOSE (64 tall, font 30). No scrolling or paging (at most 3 rows per branch).

Buy slot per state: `affordable` amber fill, dark text "<cost> AI"; `insufficient` graphite with cyan outline and secondary-coloured cost; `maxed` flat "MAX"; `locked` dimmed "LOCKED" with a small lock mark. One tap buys one rank (no confirm dialog, no bulk). A second tap while a purchase is in flight is ignored (the button is dimmed meanwhile). On a successful purchase a brief (0.35 s) cyan ring of four opaque Graphics bars pulses on the bought row (no particles, no audio). On a failed purchase the header shows the short note "Couldn't buy that upgrade. Try again." (key `upgrades.purchase_failed`) and the panel stays open.

Android lessons applied: Graphics fills only (no spriteFrame-less Sprite), opaque shapes except the backdrop dim, scale-based visibility everywhere, fonts with margin, explicit line heights, every button a `Button` on its own child node whose hit rect is the drawn rect, redraw only when the view signature changes (the sink refreshes about once per frame).

### Decisions made by default (MVP, owner autonomy policy)

- Insufficient rows are INERT (not tappable): a tap could only produce a rejection and visual noise. Pinned: only an `affordable` row carries a command and `Button.interactable` equals that.
- Opening the panel selects the first branch with something affordable (else Production).
- The tab dot is drawn on the selected tab too (dark dot on the cyan fill) so the signal never disappears when switching.
- Tabs are three 64-unit-tall buttons, not three columns (documented deviation from ART_DIRECTION section 26 so the 20-unit minimum font fits).
- The breakthrough effect shows the cost multiplier of the NEXT rank (rank 1 = x0.5 at rank 0, x0.2 at rank 1), read from the config as is.
- 29 new localization keys instead of the roughly 35 estimated: `upgrades.insufficient` was dropped (not needed), `upgrades.balance` was added.
- Seed variant `mixed` uses Optimized Fabrication rank 2 and 4 AI Cores instead of rank 1: with rank 1, every available upgrade costs at most 2 AI, so an insufficient row can only exist next to no affordable row (an insufficient row needs a cost above the balance, an affordable row a cost at or below it). Rank 2 / 4 AI gives affordable (Optimized Fabrication 4, Industrial Scaling 2, Cached Procedures 2, Compact Blueprints 2), insufficient (Autonomous Optimization 5) and locked (Worker Templates, Inherited Automation, Era Compression) rows in one save.

## DEBUG diagnostics

New event `permanent_upgrades` (added to the `DeviceDiagnostics` allow-list and to the reveal capture event types): `{ phase: chip_shown | chip_hidden | opened | tab | row_tapped | purchase_result | closed, tab, upgradeId, rowState, aiCores, ranks, rank, cost, status, reason, saveOk, eventTypes, balanceDelta, rows, texts, chipRect, panelRect, rowRects, buyRects, scale }`. `ui_layout` rects gained `PermanentUpgradeChip`, `PermanentUpgradePanel`, `PermanentUpgradeClose`, `PermanentUpgradeTab0..2` and `PermanentUpgradeBuy0..2` (null while hidden). The binding's `reportCommandResult` also reports the purchase as a normal `command_result`. Release builds never emit.

## Device tooling

- `npm run device:seed-aut050 [-- --variant mixed|maxed]` (`tools/device/seed_aut050.ts`): post-Reboot save (Civilization #2, fresh run, no automation), `mixed` = Optimized Fabrication rank 2 + 4 AI Cores, `maxed` = Optimized Fabrication rank 3 + 6 AI Cores; `lifetimeAiCoresEarned` = wallet + AI Cores spent on the seeded ranks; the envelope `savedAtUtc` is 5 s old so no offline card appears; removes stale saves and `debug_command.json`. Requires the FactoryWorld DEBUG APK.
- Reveal scenario `aut050` (`npm run device:reveal-capture -- --scenario aut050`): baseline screenshot with the chip, REAL tap on the chip at the `ui_layout` rect, screenshot of the open panel, REAL tap on the buy rect of the cheapest affordable row, screenshots during / after the pulse, tap the Automation tab (locked row), force-stop and relaunch WITHOUT reseeding, screenshot. The scenario uses trigger `none` (the `RevealTrigger` type is unchanged); its own checks are `trigger_sent` and the objective checks below.
- Objective checks (`tools/device/permanent_upgrade_checks.ts`): chip shown on launch, panel opened with rects, an affordable row, buy tapped, the purchase cost equals the config `rankCosts` entry, balance delta equals minus the cost (`aiCoreBalanceChanged.delta` and the before / after balance), event order `aiCoreBalanceChanged` then `permanentUpgradePurchased`, saved result, rank + 1, tab switch with a locked row, and after the relaunch balance and rank match; the generic no-error check still applies.
- Pins updated legitimately: `Object.keys(REVEAL_SCENARIOS)` (`tests/era_environment.test.ts`, `tests/reveal_capture.test.ts`), the CLI usage regexes (`aut049|aut049-post|aut050|aut051...` in the boost, era transition, Overclock HUD, Reboot presentation and offline report tests), the submit / emitter counts in `core_loop_input_wiring`, `factory_world_session_wiring`, `presentation_text_wiring` and `reboot_presentation` (one new emitter: the panel), and the catalogue entry count (94) in `tests/offline_report.test.ts`.

## Localization

29 keys in `localization/en.json` (now 94 entries), `EmbeddedTextCatalogue.ts` regenerated (the drift test passes); see the AUT-050 note in `docs/AUT-LOC-001_ENGLISH_TEXT_CATALOGUE.md`. `tests/presentation_text.test.ts` covers the new placeholders and key reachability (no dead keys).

## Tests

`tests/permanent_upgrade_ui.test.ts` (30): view model for all 8 upgrades and the 4 states from the real config (missing prerequisites, max, insufficient, advancing next cost, effect text, tab dot), no-math source pins, chip visibility equals `shouldShowRelaySocket`, purchase through the real `LifecycleSessionCoordinator` and `FactoryWorldStateBinding.submit` (balance, rank, event order, critical save, sink refresh, rejections change nothing, persistence failure, fallback port), the double-tap / inert-row source pins, layout on six screens (inside safe area and factory band, no overlap with HUD / panel rects, buttons >= 64 tall, fonts, three rows, chip clear of HUD / Overclock / Next Goal), source pins (Graphics, no `node.active`, no Sprite, metas, allow-list, catalogue keys, no new `GameCommand`), seed round trip and device checks.

## Not verified here (human / device)

Rendering on a real device (legibility, backdrop dim, pulse, hexagon polygon fill, lock mark), that node-level touch swallowing keeps camera and selection from receiving taps on the chip / panel exactly like the HUD, a milestone / era / Reboot toast passing over the chip for a moment (the chip sits where the toast band starts and is placed behind it), real-tap behaviour of the Button hit rects on Android, and the `aut050` capture itself (no gate build in this task). Subjective feel (panel density, whether the chip is discoverable, pulse feel) is pending human review. Copy needs Game Designer wording approval.
