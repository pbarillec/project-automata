# AUT-052 Localization, Audio & Settings Skeleton

AUT-052 adds the plumbing for language, audio / haptics and player settings, and a small Settings panel. It adds no audio asset, no Android bridge, no `GameCommand`, no save schema change and no gameplay or economy change. Localization extends the AUT-LOC-001 catalogue (no parallel system).

## Settings model and persistence

- `assets/scripts/settings/` (engine-free, explicit `.ts` imports):
  - `UserSettings.ts`: `{ schemaVersion: 1, musicEnabled, sfxEnabled, vibrationEnabled, language }`, `DEFAULT_USER_SETTINGS` (everything on, `'en'`), `AVAILABLE_LANGUAGES = ['en']`, `parseUserSettings` (never throws: corrupt JSON, a non-object or an unknown schema gives the defaults with source `corrupt`; a non-boolean flag gives its default; an unknown language gives `'en'`), `mergeUserSettings`, `serializeUserSettings` (fixed key order, 2-space, LF, trailing newline).
  - `SettingsStore.ts`: `SettingsStore(port)` with `load()` / `get()` / `update(patch)` / `subscribe()`. It writes `settings_temp.json` then moves it onto `settings.json` inside try/catch; a failed write returns `false`, keeps the in-memory change for the session, removes the temp file and reports `save_failed` through an optional sink (a read failure reports `load_failed` and gives the defaults). Listeners and the sink are contained.
- The persistence port is the existing `FileSystemPort` shape (`CocosFileSystemPort`, already instantiated in `FactoryWorldBootstrap`). The store types it as a SYNCHRONOUS slice (`SettingsFileSystemPort`) so the load can happen before the first UI paint; `CocosFileSystemPort`'s methods are synchronous and satisfy it. `SaveStorage` (closed `LogicalSaveName` union) is deliberately not used and the game save files are never touched.
- `FactoryWorldBootstrap.start()` calls `loadUserSettings()` before `createUiRoot()` / the HUD, applies the loaded values to the audio / haptics services and subscribes so later changes are applied too.
- `GameState.settings` (`SettingsState`, save v2: music / SFX volume, `vibrationEnabled` default false, `languageCode`, `reducedMotion`) stays UNTOUCHED and DORMANT: nothing reads or writes it. Its defaults differ from the user settings (vibration is off there, on here); a later schema task may retire it. A test pins that the shape and the fresh default are unchanged.

## Audio and haptics (interfaces and silent / mock providers only)

- `services/AudioService.ts`: `AudioCue = purchase | milestone | robot_built | era_transition | overclock | reboot | ui_tap`; `AudioService { playSfx, setMusicEnabled, setSfxEnabled, applySettings, startMusic, stopMusic }`. `platform/noop/SilentAudioService` (production default: does nothing, never throws) and `platform/mock/MockAudioService` (records cues, honours the flags). `services/HapticsService.ts`: `vibrate('light' | 'medium' | 'heavy')`, `setEnabled`; `NoOpHapticsService` and `MockHapticsService`. All exported through `platform/{mock,noop}/index.ts` and `services/index.ts` like the Ads providers.
- `presentation/AudioCueMapper.ts` (pure): `mapEventToCue(event)` / `mapEventsToCues`. Mapping: `producerLevelsPurchased`, `breakthroughPurchased`, `permanentUpgradePurchased` -> `purchase`; `producerMilestoneReached`, `producerConstructed` -> `milestone`; `firstRobotProduced`, `robotsBuiltThresholdReached` -> `robot_built`; `eraChanged` -> `era_transition`; `temporaryBoostActivated` -> `overclock`; `rebootCompleted` -> `reboot`; everything else null. `ui_tap` is UI-driven (not event-driven) and has no caller yet.
- Presentation observes: the bootstrap's `observeDomainEvents` plays the mapped cues on the `SilentAudioService` (the callback is now always installed; the DEBUG `assembly_batch` reporting stays DEBUG-gated). The runtime and every gameplay module know nothing about audio (a test scans them). No `cc` AudioSource, no clip, no asset, no bridge.

## Language and strings

- `localization/index.ts` gained `listAvailableLanguages()` (`['en']`, derived from the embedded `localization/<lang>.json` files), `getTextCatalogue(language, sink?)` (one shared catalogue per language; an unknown language falls back to English and reports `{ kind: 'unknown_language', locale: 'en', language }` through the sink) and `DEFAULT_LANGUAGE`; `getDefaultTextCatalogue()` still works and returns the same shared English instance. `MissingTextReport` gained the `unknown_language` kind.
- `localization/PseudoLocale.ts` (pure): `makePseudoLocaleCatalogue(catalogue)` accents the text and pads each entry by about 40% while preserving `{params}`; used by the pseudo-long-string smoke test, never shipped as a language.
- Migrated player-facing strings (en.json 94 -> 118 entries, `EmbeddedTextCatalogue.ts` regenerated):
  - the 12 `MILESTONE_TEXT_TEMPLATES` -> `toast.*` (identical wording); `MilestoneToastText.ts` now resolves them through the catalogue and the private `fill` and the constant are gone;
  - the two era title cards -> `era.automated_factory.title_card` / `era.robotics_complex.title_card` (all caps in the catalogue); `EraTransitionSpec.title` became `titleKey` (the spec stays pure-testable; `MilestoneToastText` resolves it);
  - 10 `settings.*` keys: `title`, `chip` ("SET"), `music`, `sfx`, `vibration`, `language`, `on`, `off`, `language.en` ("English"), `close`.
- Re-scan of `presentation/*.ts` and `app/*.ts`: no other player-facing literal was found. Explicit allowlist (in `tests/no_hardcoded_player_strings.test.ts`): `AssetRobotSpike.ts` (AUT-032 spike status line) and `AppStartup.ts` ("Runtime OK" smoke label). DEBUG `[AUT-DEVICE]` events and `Error` messages are not player-facing. The `CameraSpikeBootstrap` scene passes its labels as arguments (engineering scene, no `.string = '<literal>'`).
- The selected language does not yet drive the in-game catalogue: the language row is informational and only `en` exists, so the HUD / panel / toast composers keep using `getDefaultTextCatalogue()`. The Settings chip and panel already read `getTextCatalogue(settings.language)`. Wiring the setting into the other composers is a follow-up when a second language exists.

## Settings UI (AUT-050 panel language, no asset)

- Pure `presentation/SettingsLayout.ts` and `SettingsViewModel.ts`, thin `SettingsController.ts`; the root (full-screen backdrop + safe-area container) is built by `FactoryWorldBootstrap.createSettings()` after `createPermanentUpgrades()` and before `createOfflineReport()`, so the offline report root stays the last Canvas child.
- Chip: 112 x 64 design units (gear drawn with Graphics polygons + "SET", font 26), Widget-anchored top / LEFT with the same top offset formula as the AI chip and the toast band (`UI_EDGE_MARGIN + HUD height + 8`), placed behind the HUD cards and toast band (sibling 0). It is narrow enough to stay clear of the centred Minor toast (440 wide) and of the AI chip on all six test screens; a wider Major / era / Reboot card passes over it for a moment, like the AI chip (the toast is never moved). Hidden by scale 0 and inert while the offline report card or the Reboot title card is up (`setSuppressed`, polled by the bootstrap each frame from `OfflineReportController.isVisible()` and the new read-only `MilestonePresentationController.isRebootCardActive()`); an open panel closes when suppressed.
- Panel: 640 wide, centred in the factory band like the AI panel, over a full-screen black backdrop (alpha 150, redrawn on resize) that swallows touches; a backdrop tap closes it. Header "Settings" (30), four 72-tall rows (font 28, the whole row is one Button node whose hit rect is the drawn rect): Music / SFX / Vibration with an ON / OFF pill (cyan fill + dark "ON", graphite + cyan outline + "OFF": the text carries the state, never colour alone) and an informational Language row ("English", dimmed, `Button.interactable = false`). CLOSE 64 tall, font 30. Fonts use SHRINK with margins; Graphics fills only; scale-based visibility (no `node.active`).
- A toggle calls `SettingsStore.update(patch)`; the bootstrap's subscription applies it to `audio.applySettings` / `haptics.setEnabled`. No `GameCommand`, no runtime access, no `commandEmitter` added.

## DEBUG diagnostics

New allow-listed event `settings`: `{ phase: chip_shown | chip_hidden | opened | closed | toggled | loaded | saved | save_failed | load_failed | missing_text, setting, value, saved, source (file | default | corrupt), settings, missingText, chipRect, panelRect, rowRects, closeRect, suppressed, scale }`. `ui_layout` rects gained `SettingsChip`, `SettingsPanel`, `SettingsClose`, `SettingsRow0..3` (null while hidden). `missingText` is the running count of catalogue missing-text reports (the capture requires 0). The `chip_shown` report is delayed a few frames so the rect is real. Release builds never emit.

## Device tooling

- `npm run device:seed-aut052` (`tools/device/seed_aut052.ts`): the AUT-050 `mixed` post-Reboot save (both chips visible, `savedAtUtc` 5 s old so no offline card) after removing stale saves, `debug_command.json`, `settings.json` and `settings_temp.json` (the run starts from the defaults).
- Reveal scenario `aut052` (`npm run device:reveal-capture -- --scenario aut052`, trigger `none`, `expectSettings: 'toggle_persist'`): baseline screenshot with both chips, REAL tap on the gear chip, panel screenshot, REAL tap on the Music row (OFF), screenshot, REAL tap on CLOSE, force-stop + relaunch WITHOUT reseeding, screenshot, then the same pass again (toggle Music back ON, close). `expectSettings` is passed through BOTH `cli.ts` and `reveal_capture.ts` (the AUT-050 omission is pinned against).
- Objective checks (`tools/device/settings_checks.ts`): first launch loads the defaults (source `default`); the chip is shown with a rect; the Settings chip does not overlap the AI chip in any `ui_layout`; the panel opened with panel / 4 row / close rects; Music toggled OFF and saved; no `save_failed`; closed; after the relaunch `loaded` has source `file` with music off (SFX / vibration still on); toggled back ON; no missing-text report.
- Pins updated legitimately: `Object.keys(REVEAL_SCENARIOS)` (`tests/era_environment.test.ts`, `tests/reveal_capture.test.ts`), the CLI usage regexes (`...aut051-short|aut052]` in the boost, era transition, Overclock HUD, Reboot presentation and offline report tests), the catalogue entry count (118) in `tests/offline_report.test.ts`, the era title card assertions in `tests/era_transition.test.ts` (key + catalogue instead of `spec.title`), and the template-params / no-dead-keys tests in `tests/presentation_text.test.ts` (toast and settings keys). The submit / `commandEmitter` counts did not change.

## Tests

`user_settings`, `settings_store` (in-memory sync port fake: missing file, round trip, write failure contained, temp-then-move, read failure, corrupt file, listeners), `audio_service` (mock honours flags, silent never throws, cue table, gameplay modules do not import audio), `haptics_service`, `settings_layout` (six screens: >= 64 targets, no overlap with the AI chip / HUD / Overclock rows / Minor toast, inside the safe area), `settings_view_model`, `localization_languages` (`['en']`, unknown fallback + sink), `pseudo_locale_smoke` (placeholders intact, +40%, every composer resolves, per-label length heuristic), `no_hardcoded_player_strings` (explicit allowlist; `MILESTONE_TEXT_TEMPLATES` gone), `settings_wiring` (settings load before the UI, controller only observes, metas, device tooling and checks).

## Decisions made by default (MVP, owner autonomy policy)

- Defaults: music, SFX and vibration ON, language English.
- Separate `settings.json` (+ `settings_temp.json`) via the file port, not the save; the dormant `GameState.settings` stays unused (documented above).
- The store takes a synchronous port slice so settings load before the first UI paint.
- Chip label "SET" with a procedural gear (PLACEHOLDER, no asset); 112 x 64 so it stays clear of the Minor toast; wider toasts pass over it.
- Language row is informational ("English"); no language picker until a second catalogue exists.
- Selecting a language does not yet re-resolve the HUD / panel / toast composers (only English exists).
- `ui_tap` cue exists in the interface but has no caller yet (no audio ships); the settings toggles do not play it.
- `unknown_language` was added as a third `MissingTextReport` kind (the existing two are unchanged).

## Not verified here (human / device)

Real rendering of the chip (gear polygon, "SET" legibility), panel density and pill legibility on a device, real-tap behaviour of the row Button hit rects on Android, that touch swallowing keeps the camera and selection from receiving taps on the chip / panel, a Major / era / Reboot card passing over the chip, the `aut052` capture itself (no gate build in this task), and any audio / haptics behaviour (none ships). Subjective feel is pending human review. Copy ("Settings", "SET", "Music", "SFX", "Vibration", "Language", "ON", "OFF", "English") needs Game Designer wording approval.
