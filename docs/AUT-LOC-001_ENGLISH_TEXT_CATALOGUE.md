# AUT-LOC-001 Minimal English Text Catalogue

The Core HUD and the Producer Panel now show readable English. The text comes from one keyed
catalogue. View models stay key-based. A pure composition layer turns them into label
strings, and the controllers only display those strings. Layout, nodes, fonts and touch
handling did not change; that work belongs to AUT-R-036.

**Wording status: approved by the Game Designer (desk review, 2026-11-10)**, with three changes applied: "Select a producer" → "Tap a producer", and the generic fallbacks lower-cased to "Unlock next breakthrough" / "Reach next era". On-device readability is still pending (AUT-R-036, checked at the AUT-UI-001 combined gate). Every term comes from an
existing source:
- producer names: `producers.json` `name`;
- breakthrough names: ECONOMY §8 B1–B6 headings;
- era names: GAME_DESIGN §10 / ECONOMY §9;
- goal verbs ("Build …", "Unlock …", "Reach …", "Reboot Civilization"): GAME_DESIGN §16;
- ×1/×10/×MAX: GAME_DESIGN §7.1;
- "Industrial Output", "Free Overclock" and "×2": GAME_DESIGN §4.1/§15, ART_DIRECTION
  §19.3/§22.

Short connective phrases ("to go", "Not affordable", "Paused", "Tap a producer", "All
goals complete") were written for this task and approved in the same review.

## What was built

- **`localization/en.json`** (repository root) has the shape `{ kind: "localization",
  schemaVersion: 1, locale: "en", entries: { key: string } }` with simple `{param}`
  placeholders. It lives outside `data/` because the `data/` scanners (config validation,
  pacing regression, config tests) treat every `*.json` there as economy config.
- **`assets/scripts/localization/EmbeddedTextCatalogue.ts`** (generated, engine-free) embeds the exact
  text of `localization/*.json`, with line endings normalized to LF. Regenerate it with:

  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/config/embed_text_catalogue.ts`

  `tests/embedded_text_catalogue.test.ts` fails when the module drifts from `localization/`.
- **`assets/scripts/localization/TextCatalogue.ts`** (engine-free):
  - `parseTextCatalogueDocument` validates the shape. Values must be non-empty, and every
    `{`/`}` must belong to a `{name}` placeholder.
  - `TextCatalogue.resolveText(key, params?)` never throws. A missing key returns the key
    itself, and a missing parameter keeps its `{param}`. Both are reported to an injectable
    `MissingTextSink`, which can be set at construction or with `setMissingTextSink`. A sink
    that throws is contained.
- **`assets/scripts/localization/index.ts`** provides `getDefaultTextCatalogue()`: one shared English
  catalogue built from the embedded `localization/en.json`. Language selection and settings
  belong to AUT-052.
- **`presentation/PresentationText.ts`** (engine-free, pure):
  - `formatHudTexts(vm, displayNames)`:
    - Industrial Output caption and the per-second value.
    - Next Goal from `semanticKey`, `objective` and the producer, breakthrough or era
      `displayNameKey`, looked up through `DisplayNameSource =
      Pick<GameConfigRepository, 'getProducer' | 'getBreakthrough' | 'getEra'>`.
    - Next Goal context: progress, then cost plus affordability, then blocking state.
    - Free Overclock state and timer.
    - With no name source, or an unknown id, it shows the generic `<semanticKey>.generic`
      text. An unknown category shows `next_goal.unknown`. It never shows a raw key.
  - `formatPanelTexts(vm)` builds the panel strings:
    - the name, from the view model's `displayNameKey`;
    - `Lv {level}` and `{value}/s`;
    - the next milestone, with its `×N production` benefit from `descriptorKey`, or the
      "complete" text;
    - the actions: `{label} {cost}`, plus "Unavailable" when the action is disabled.
  - `defaultHudTexts`, `defaultPanelTexts` and `pendingSelectionPanelTexts` supply the
    pre-snapshot texts. A pending selection shows `—`, with no name lookup.
- **Controllers** (`CoreHudController`, `ProducerPanelController`): `refresh`,
  `replaceSelection` and the `ensureLayout` default texts now come only from
  `PresentationText`. Each controller exposes `displayNames: DisplayNameSource | null`.
  - On the HUD it is an accessor. Assigning it re-renders the latest snapshot, because
    `binding.init()` renders the first snapshot before the names are assigned. Without the
    re-render, the generic Next Goal text would stay until the next domain event.
  - Node names, positions, content sizes, font sizes, colours, touch handling and Buttons
    are unchanged.
- **`FactoryWorldBootstrap`** (narrow exception approved by the Technical Lead):
  `result.configRepository` is carried in `pendingBinding`. `activateSessionBinding`
  assigns `hud.displayNames` and `panel.displayNames` immediately before the two
  `commandEmitter` lines. Nothing else changed.

## Key list (`localization/en.json`, 51 entries)

| Key | English |
|---|---|
| `producer.fabricator.name` | Fabricator |
| `producer.assembly_station.name` | Assembly Station |
| `producer.robot_line.name` | Robot Line |
| `producer.automated_cell.name` | Automated Cell |
| `producer.advanced_robotics_complex.name` | Advanced Robotics Complex |
| `breakthrough.auto_feeder.name` | Auto Feeder |
| `breakthrough.worker_bot.name` | Worker Bot |
| `breakthrough.robotic_logistics.name` | Robotic Logistics |
| `breakthrough.factory_control_system.name` | Factory Control System |
| `breakthrough.automated_cell_architecture.name` | Automated Cell Architecture |
| `breakthrough.advanced_robotics.name` | Advanced Robotics |
| `era.manual_workshop.name` | Manual Workshop |
| `era.automated_factory.name` | Automated Factory |
| `era.robotics_complex.name` | Robotics Complex |
| `hud.industrial_output` | Industrial Output: {value} |
| `hud.production_per_second` | {value}/s |
| `hud.free_overclock.locked` | Free Overclock: Locked |
| `hud.free_overclock.ready` | Activate Overclock |
| `hud.free_overclock.active` | Free Overclock: ×{multiplier} |
| `hud.free_overclock.cooldown` | Free Overclock: Cooldown |
| `hud.free_overclock.suspended` | Free Overclock: Paused |
| `hud.free_overclock.timer` | {seconds}s |
| `next_goal.producer_build` | Build {name} |
| `next_goal.producer_build.generic` | Build next producer |
| `next_goal.producer_milestone` | Reach {name} Lv {level} |
| `next_goal.producer_milestone.generic` | Reach producer Lv {level} |
| `next_goal.breakthrough` | Unlock {name} |
| `next_goal.breakthrough.generic` | Unlock next breakthrough |
| `next_goal.era` | Reach {name} |
| `next_goal.era.generic` | Reach next era |
| `next_goal.reboot_ai_core` | Reboot Civilization |
| `next_goal.none` | All goals complete |
| `next_goal.unknown` | Next Goal |
| `next_goal.progress` | {current}/{required} |
| `next_goal.cost` | {cost} • {state} |
| `next_goal.affordability.affordable` | Affordable |
| `next_goal.affordability.unaffordable` | Not affordable |
| `next_goal.blocking.unblocked` | Ready |
| `next_goal.blocking.requirement_locked` | Locked |
| `producer_panel.none_selected` | Tap a producer |
| `producer_panel.level` | Lv {level} |
| `producer_panel.production_per_second` | {value}/s |
| `producer_panel.milestone.next` | Next milestone Lv {threshold} ({remaining} to go) |
| `producer_panel.milestone.next_with_benefit` | Next milestone Lv {threshold}: {benefit} ({remaining} to go) |
| `producer_panel.milestone.production_multiplier` | ×{multiplier} production |
| `producer_panel.milestone.complete` | All milestones reached |
| `producer_panel.buy_1` | Buy ×1 |
| `producer_panel.buy_10` | Buy ×10 |
| `producer_panel.buy_max` | Buy ×MAX |
| `producer_panel.action` | {label} {cost} |
| `producer_panel.action.unavailable` | {label} {cost} • Unavailable |
| `producer_panel.action.max` | {label} (×{quantity}) {cost} |
| `producer_panel.action.max.unavailable` | {label} (×{quantity}) {cost} • Unavailable |

`next_goal.affordability.not_applicable` is deliberately absent. With no cost, the
context falls back to the progress or blocking text, so that state never reaches the
catalogue.

Sample outputs:
- fresh save: "Build Fabricator";
- Fabricator Lv 1: "Reach Fabricator Lv 10";
- Fabricator Lv 15: "Unlock Auto Feeder";
- Auto Feeder owned: "Build Assembly Station".

## Tests

- `text_catalogue.test.ts`:
  - substitution, missing key / missing parameter reporting, the sink contract and parse
    rejection;
  - `en.json` structure: unique keys (raw-text duplicate check), non-empty values,
    well-formed placeholders, and no value that looks like a key;
  - the catalogue modules are engine-free.
- `embedded_text_catalogue.test.ts`:
  - drift guard;
  - embedded text equals the files on disk, and callers receive copies;
  - the default catalogue equals `en.json`;
  - the catalogue is not under `data/`.
- `presentation_text.test.ts`:
  - no key pattern (`/\b[a-z_]+(\.[a-z0-9_]+)+\b/`) and zero missing-text reports in these
    states: fresh, Fabricator Lv1, Lv15 (Auto Feeder eligible), Auto Feeder owned (Assembly
    Station build goal), no selection, and each producer selected (with and without names);
  - coverage of:
    - every `displayNameKey`;
    - every Next Goal semanticKey × category (named, unnamed, unknown id, unknown category);
    - every affordability and blocking state;
    - every Overclock state, including real ready/active/cooldown snapshots;
    - every panel `labelKey` and milestone key;
  - template parameters exactly match what `PresentationText` supplies;
  - every catalogue key is reachable;
  - engine-free.
- `presentation_text_wiring.test.ts`:
  - the controllers render only through `PresentationText`, with no key or English
    literals;
  - layout constants are unchanged;
  - the bootstrap assigns `displayNames` only in `activateSessionBinding`, and the
    `commandEmitter =` count is still 2;
  - `.meta` files have unique UUIDs.

## Validation

- `npm run check`: PASS.
- `npm run android:build`: PASS.
- `npm run device:gate-build -- --label loc001`: PASS. Then two consecutive runs each of C3
  and INT-001 on NE2215 (the second run with `--skip-install`): all PASS, with zero error
  events. The INT-001 warning "pm clear refused → run-as fallback" is expected.
- `npm run device:restore-build-config`: the tracked build config diff is empty.

## Not covered

On-device legibility of the strings is not checked here: the HUD and panel are not yet
visible on the landscape build (AUT-R-036). Wording approval rests with the Game Designer.

## AUT-051 additions

AUT-051 added 9 `offline.*` keys for the Offline Factory Report card (`offline.title`, `offline.time_away`, `offline.cap_reached`, `offline.reward`, `offline.robots`, `offline.explain.manual`, `offline.explain.more`, `offline.collect`, `offline.collect_failed`), composed by the pure `presentation/OfflineReportText.ts`. `localization/en.json` now holds 64 entries (the 51-entry table above predates the Assembly batch, Overclock and AUT-051 keys). The placeholder and no-dead-key tests in `tests/presentation_text.test.ts` cover them. AUT-051b copy: `offline.cap_reached` is "Offline cap reached ({duration})", `offline.explain.manual` is "Automated producers kept working. Manual: {names}.", and `offline.robot_single` ("+1 Robot Built", count exactly 1) was added, so `localization/en.json` holds 65 entries.

## AUT-050 additions

AUT-050 added 29 keys for the AI Upgrades chip and panel: `permanent_upgrade.<id>.name` x8 (the ECONOMY section 17 titles the permanent upgrade configs already referenced through `displayNameKey`), `upgrades.title`, `upgrades.chip`, `upgrades.balance`, `upgrades.close`, `upgrades.branch.production|automation|expansion`, `upgrades.rank`, `upgrades.buy`, `upgrades.max`, `upgrades.locked`, `upgrades.needs`, `upgrades.purchase_failed` and the eight `upgrades.effect.*` templates (`global_production`, `milestone_power`, `automated_multiplier`, `breakthrough_sooner`, `breakthrough_cost`, `starts_automated`, `construction_cost`, `major_requirement`). They are composed by the pure `presentation/PermanentUpgradePanelViewModel.ts`; the placeholder and no-dead-key tests in `tests/presentation_text.test.ts` cover them. `localization/en.json` now holds 94 entries; `EmbeddedTextCatalogue.ts` was regenerated. Glossary: "AI Cores" and "Reboot" (never "reset"); wording approval rests with the Game Designer.

## AUT-052 additions

AUT-052 moved the remaining player-facing strings into the catalogue and added the settings keys (24 keys, `localization/en.json` now holds 118 entries; `EmbeddedTextCatalogue.ts` regenerated):

- `toast.*` x12 (identical wording to the former `MILESTONE_TEXT_TEMPLATES`, which no longer exists): `producer_milestone` ("{name} Lv {level}"), `automation` ("{name} automated"), `producer_constructed` ("{name} built"), `breakthrough_subtitle`, `breakthrough_generic`, `robots_built_title` ("Robots built: {count}"), `robots_built_subtitle`, `producer_generic`, `extra` ("{text} +{count}"), `reboot_title` ("REBOOT"), `reboot_ai_core` ("AI CORE ×{count}"), `reboot_civilization` ("CIVILIZATION #{number}"). Composed by `presentation/MilestoneToastText.ts` through `catalogue.resolveText(`toast.${key}`)`.
- `era.automated_factory.title_card` ("AUTOMATED FACTORY") and `era.robotics_complex.title_card` ("ROBOTICS COMPLEX ONLINE"), all caps in the catalogue; `EraTransitionSpec.title` became `titleKey`.
- `settings.*` x10: `title` ("Settings"), `chip` ("SET"), `music`, `sfx`, `vibration`, `language`, `on` ("ON"), `off` ("OFF"), `language.en` ("English"), `close` ("CLOSE"). Composed by the pure `presentation/SettingsViewModel.ts`.
- `localization/index.ts` gained `listAvailableLanguages()` (`['en']`), `getTextCatalogue(language, sink?)` (unknown language: English fallback reported to the sink as `unknown_language`) and `DEFAULT_LANGUAGE`; `getDefaultTextCatalogue()` is unchanged for callers. `localization/PseudoLocale.ts` (`makePseudoLocaleCatalogue`, about +40%, `{params}` preserved) backs the pseudo-long-string smoke test.
- The no-dead-keys and exact-params tests in `tests/presentation_text.test.ts` now also compose the toast, era card and settings keys. `tests/no_hardcoded_player_strings.test.ts` scans `presentation/*.ts` and `app/*.ts` (explicit allowlist: the AUT-032 spike status line and the AUT-004 "Runtime OK" smoke label). Wording approval rests with the Game Designer.
