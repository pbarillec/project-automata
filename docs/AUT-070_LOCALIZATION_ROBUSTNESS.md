# AUT-070 Localization and UI Robustness Pass

Goal: no player-facing hardcoded string, no untranslated raw key on the release path, and no critical clipping or overlap for long strings or different phone sizes.
Routine QA hardening: no game design, economy, monetization or copy-meaning change, no save-schema change, no new asset, no new dependency, no wording change (the English catalogue `localization/en.json` is byte-identical).

## 1. Hardcoded-string audit (findings)

Scanned every `assets/scripts/{presentation,app,platform,services}/**` literal that can reach a Label or a player-visible property (`.string =`, Label helpers, `label|text|title|caption|tag|subtitle|message|hint|description|displayName|note` properties, template literals) plus the Settings, Founder, offline, Reboot, AI Upgrades, toast, era title card, consent privacy row, Extended Overclock chip and identity-icon paths.

Result: **no player-facing UI copy was hardcoded**; AUT-LOC-001 / AUT-052 had already moved it all into `en.json`. Only the following literals remain and are documented exceptions (none is UI copy), pinned by `tests/no_hardcoded_player_strings.test.ts`:

| Literal | File | Why it is not UI copy |
| --- | --- | --- |
| `AUTOMATA` | `presentation/AutomataIdentity.ts` | wordmark of the brand identity decal painted on 3D surfaces (ART_DIRECTION identity) |
| `UNIT 0001` | `presentation/FounderRobotVariant.ts` | serial plate on the Founder Robot (in-world decal, ART_DIRECTION 16) |
| `AUT-032 ...` status line | `presentation/AssetRobotSpike.ts` | engineering spike scene, never in the player flow (pre-existing exception) |
| spike labels | `presentation/CameraSpikeBootstrap.ts` | engineering camera spike (labels passed as arguments, pre-existing) |
| `Runtime OK` | `app/AppStartup.ts` | baseline smoke scene (pre-existing exception) |
| `reason: ... 'exception'` | `presentation/DebugCommandExecutor.ts` | DEBUG-only command record, never rendered |

Also excluded by pattern, not by file: `console.*` logs, `[AUT-DEVICE]` events, `Error` / `RangeError` messages, node names. Store prices (Founder) are the store's own string rendered verbatim by design (AUT-059), and the Settings language pill falls back to the language code only when a language has no `settings.language.<code>` entry. No accessibility-label strings exist in the code base (no `aria` / accessibility API is used), so there is nothing to localize there yet.

Test additions (`tests/no_hardcoded_player_strings.test.ts`): the audit now covers `presentation`, `app`, `platform` and `services` at every depth, text-like property literals, Label-helper calls under `platform/` and `services/`, and asserts the exception list is justified and still needed.

## 2. Key integrity and fallback (`tests/localization_keys.test.ts`)

- Every key referenced by code (literal or computed `${...}` family) or by `data/economy/*.json` exists in `en.json` (two non-key literals documented: `settings.json`, the `hud.free_overclock` prefix).
- No dead key beyond a documented allow-list: the four `next_goal.*.generic` keys, resolved through the computed `${semanticKey}.generic` in `PresentationText`.
- Call sites with a literal key and a literal params object supply exactly the placeholders of that key (spread params resolved), 60+ sites checked.
- Plural paths: `offline.robot_single` / `offline.robots`, `reboot.reward_single` / `reboot.reward`; compact numbers stay <= 6 characters.
- **Missing-key policy (decision, implemented):** `TextCatalogue` gains an optional fallback catalogue and a missing-key display. Order: fallback language (English for any future translation) -> otherwise key (`'key'`, default of a bare catalogue, used by tests and DEBUG) or empty string (`'blank'`). The shared catalogues from `getTextCatalogue` default to **blank** (release path: a raw dotted key is never shown), `FactoryWorldBootstrap.onLoad` calls `setShowMissingKeys(DEBUG === true)` so DEBUG builds show the key. Every miss is still reported to the sink. Non-English catalogues built by `getTextCatalogue` fall back to English. Pinned: bare / blank / fallback / unknown language / every composer surviving an entirely empty catalogue with no raw key and no throw.

## 3. Text fit and pseudo-locale robustness

New pure module `presentation/TextFit.ts` (+ cc shim `presentation/LabelFit.ts`, both with `.ts.meta`) implements one rule, applied before a string reaches a Label: wrap at the nominal font; if it does not fit the line budget, shrink one unit at a time down to the readable minimum (20 body, 28 primary button captions); if it still does not fit, truncate and end the last line with an ellipsis. Text that fits at its nominal font is returned untouched, so English wording and the device-proven geometry do not change. Wide (East-Asian / full-width) glyphs count a full em, Latin glyphs 0.48 em (the estimate the UiLayout tests already use).

Wired (single call at the point each controller assigns `label.string`, after the rect, font and line height are set): `SettingsController`, `RebootController`, `PermanentUpgradeController`, `FounderShopController`, `ExtendedOverclockController`, `OfflineReportController`, `MilestonePresentationController`, `CoreHudController` (`setText`), `ProducerPanelController` (`setText`), `AssemblyBatchActionController`. Previously a long translation relied on Label SHRINK alone, which can drop below the readable minimum or spill.

`tests/ui_robustness_text.test.ts` maps **every** `en.json` key to the slot it renders in (rect width from the layout modules, nominal and minimum font, line count; a new key without a slot fails) and renders it with worst-case parameters in four variants: English, pseudo +40%, pseudo +100%, and a new wide-glyph variant (`makeWideGlyphPseudoLocaleCatalogue`, full-width letters, no expansion). Results of the last run:

| Variant | Slot renderings truncated | Shrunk below nominal |
| --- | --- | --- |
| English | 0 (pinned: untouched text, never below minimum) | 7 (existing Label SHRINK behaviour) |
| pseudo +40% | 17 (all long sentences / long names; no short button, tab, chip or ON/OFF label is truncated: pinned) | 33 |
| pseudo +100% | 48 | 61 |
| wide glyph | 46 | 58 |

In every variant the fitted text satisfies: lines <= slot lines, each line within the rect width at the chosen font, font >= the slot minimum, no raw key, no unresolved placeholder. An RTL variant was not built (bidi shaping and mirroring would need real layout support, not a cheap string transform).

## 4. Screen-size matrix (`tests/ui_robustness_geometry.test.ts`)

Pure layouts only (portrait, fixed-width 720 design units; pixels shown). Insets are top cut-out / bottom gesture bar.

| Screen | Insets (top / bottom px) |
| --- | --- |
| 1080x2412 (reference) | 0 / 0 and 130 / 63 |
| 1080x1920 | 0 / 0 and 100 / 48 |
| 720x1280 (small) | 0 / 0 and 66 / 32 |
| 1080x2640 (tall) | 0 / 0 and 150 / 63 |
| 1272x2772 (large) | 120 / 72 |

Per screen: HUD and Producer Panel inside the safe area, never overlapping, factory band >= 30% of the screen height, HUD / panel Buttons inside the safe area; the five chips (Settings, AI Upgrades, Reboot, Founder, Extended Overclock) inside the safe area, >= 64 design units tall, below the HUD, above the panel and never overlapping each other; the three toast bands inside the factory band and clear of the chips (Major / Exceptional of every chip, Minor of the Settings and AI chips); every modal (offline card in all 16 row combinations, AI Upgrades, Settings with 4 and 5 rows, Reboot, Founder) inside the safe area, card height <= 90% of the safe height, every button / tab / toggle >= 64 design units tall, inside its card and not overlapping its siblings.

Documented exception: the HUD / Producer Panel band Buttons (Next Goal, Manual Produce, x1 / x10 / xMAX, Overclock) keep their device-proven 52 design units (78 px at 1080 wide); the matrix pins >= 48 for them. Modal buttons and chips use the 64-unit rule.

## 5. Real defect found and fixed

The centred Minor toast band was 440 units wide (edges at 140 / 580) while the AI Upgrades chip, 150 wide, starts at 554 on the same first chip line: a Minor toast covered the leftmost 26 units (the AI mark) of the chip (39 px at 1080 wide). `MilestoneToastLayout.minor.width` 440 -> **384** (edges 168 / 552, clear of the chip). The title still fits at the 20-unit minimum (`TextFit` shrinks the longest `{name} Lv {level}` slightly); Major and Exceptional bands (already below every chip since AUT-066) are unchanged. The `SettingsLayout` header comment and the layout comment were updated; no pinned test depended on 440. Reference-screen geometry of everything else is unchanged.

## 6. Device smoke: skipped (decision)

A DEBUG-only pseudo-locale switch would need the `language` setting, `UserSettings.normalizeLanguage` / `AVAILABLE_LANGUAGES`, `getTextCatalogue` and every controller / view-model default catalogue (most controllers resolve through `getDefaultTextCatalogue()` implicitly) to accept a non-shipped language, plus a new scenario in `cli.ts` and `reveal_capture.ts` and `evaluateRevealTimeline`. That is large cross-cutting scaffolding for a cheap smoke test, and the pure matrices above already cover the same rect and text checks. No scenario `aut070-pseudo` was added; no device run was made. If a device pseudo pass is wanted later, the entry points are `localization/index.ts` (register a `pseudo` source built with `makePseudoLocaleCatalogue`) and the Settings language row.

## 7. Files

New: `presentation/TextFit.ts(.meta)`, `presentation/LabelFit.ts(.meta)`, `tests/localization_keys.test.ts`, `tests/ui_robustness_geometry.test.ts`, `tests/ui_robustness_text.test.ts`, this record.
Changed: `localization/TextCatalogue.ts`, `localization/index.ts`, `localization/PseudoLocale.ts`, `presentation/MilestoneToastLayout.ts`, `presentation/SettingsLayout.ts` (comment), `presentation/FactoryWorldBootstrap.ts` (`setShowMissingKeys(DEBUG)`), the ten controllers listed in section 3, `tests/no_hardcoded_player_strings.test.ts`.

## 8. Unverified

Real-device appearance of the Minor toast at 384 wide and of any truncated pseudo text; the 0.48 em glyph estimate is an estimate (the Label SHRINK stays as a safety net). Subjective readability of long translations is out of scope until a second language exists.

## Device evidence and visual QA (2026-11-15)

Gate APK `aut070`; `npm run check` 1503 tests green. 15 regression captures PASS (0 errors): aut043, aut044, aut046, aut047, aut049, aut050, aut051, aut052, rbt001, aut055-success, aut056-success, aut059-available, aut066-factory, aut066-panel, aut066-toast-breakthrough.
- Visual regression QA (scene-presentation, stills): **PASS**. English labels unchanged (not truncated/ellipsised/shrunk), chips/buttons same pixel rects, no overlaps; Major toasts clear of the chips.
- Evidence gap (accepted, layout-test-backed): no captured frame contains a Minor toast, so the 440 -> 384 narrowing and its clearance of the AI Upgrades chip (x>=554 vs chip at x=831 px) is proven by the pure geometry tests only; capture one Minor-toast scenario when convenient. The device pseudo-locale scenario was not built (pure matrices cover it).
