# Project Automata — CODEX_PLAN

**Status:** Implementation Plan — APPROVED CANDIDATE for Technical Gate  
**Date:** 2026-08-15  
**Owner:** Technical Lead / Codex Prompt Engineer  
**Companion document:** `TECHNICAL_DESIGN.md`

## 0. Purpose

This document converts the approved Project Automata design into bounded Codex implementation tasks. It is intentionally not a collection of giant prompts. Each task defines a stable implementation contract; the final prompt for a task must be generated immediately before execution after Codex has inspected the current repository.

The objective is that each task can normally be:

```text
implemented
→ validated
→ reviewed
→ committed
→ reverted independently
```

Codex does not own product decisions. If the repository or source-of-truth documents conflict with a task, Codex must report the conflict instead of silently choosing a new game/economy/art direction.

## 1. Source-of-Truth Order

Before any task, inspect the current repository and read the relevant subset of:

1. `TECHNICAL_DESIGN.md`
2. `CODEX_PLAN.md`
3. `GAME_DESIGN.md`
4. `ECONOMY.md`
5. `MONETIZATION.md`
6. `ART_DIRECTION.md`
7. `ASSET_MANIFEST.md`
8. `PROJECT_AUTOMATA_BRIEF.md`
9. `FACTORY_WORKFLOW.md`
10. `STUDIO_CONTEXT.md`

When ownership differs, domain documents retain their authority: Economy owns balancing, Art Direction owns visual decisions, Technical Design owns implementation architecture.

## 2. Common Guardrails for Every Codex Task

Every task prompt must include these instructions:

1. Inspect `git status`, repository structure, existing related code and tests before changing anything.
2. Preserve the architecture defined in `TECHNICAL_DESIGN.md`.
3. Do not modify unrelated files.
4. Do not introduce a dependency without explaining why it is necessary and verifying license/compatibility.
5. Do not hardcode balancing values that belong in data.
6. Do not duplicate economy formulas.
7. Do not add gameplay logic to visual scenes/UI.
8. Do not call native Ads/IAP plugins directly from gameplay/domain scripts.
9. Do not make new product/economy/art decisions.
10. Add or update relevant tests.
11. Run required validation/build commands.
12. Review the final diff for accidental changes.
13. Report changed files, tests, build result, assumptions and remaining risks.
14. Explicitly say when real-device behavior has not been verified.

## 3. Common Definition of Done

Unless a task explicitly narrows a gate, completion requires:

- requested behavior implemented;
- source-of-truth architecture respected;
- relevant tests added/updated;
- relevant existing tests passing;
- config validation passing;
- simulation regression passing when economy/progression/data changes;
- Android build passing when build/platform/native integration changes;
- no unrelated diff;
- no undocumented dependency;
- final Codex report supplied.

Expected final report template:

```text
SUMMARY
FILES CHANGED
BEHAVIOR IMPLEMENTED
TESTS / COMMANDS RUN
BUILD RESULT
SIMULATION IMPACT (if applicable)
ASSUMPTIONS
DEPENDENCIES ADDED/UPDATED
MANUAL DEVICE CHECKS STILL REQUIRED
REMAINING RISKS / FOLLOW-UPS
```

## 4. Standard Commands

The exact executable path may be resolved during bootstrap, but stable project wrappers must converge toward:

```powershell
.\tools\ci\validate.ps1
.\tools\ci\test.ps1
.\tools\ci\simulate.ps1
.\tools\ci\check.ps1
.\tools\ci\build_android.ps1
```

`check.ps1` must ultimately perform validation + automated tests + mandatory simulation regressions.

---

# WAVE 0 — FOUNDATION & STACK GATES

Goal: establish the repository, test/build loop and validate that Godot is viable for the actual Android commercial stack before large-scale implementation.

## AUT-001 — Project Bootstrap

**Objective:** Create the Godot 4.6.3 project and repository skeleton defined by Technical Design.

**Dependencies:** none.

**Scope:** `project.godot`, minimal app/main scene, top-level `assets/`, `data/`, `scenes/`, `scripts/`, `tests/`, `tools/`, `docs/`, `addons/`, `.gitignore`, developer README.

**Constraints:** Mobile renderer; no gameplay, plugins or full external asset packs; generated caches/builds ignored.

**Tests/commands:** headless project load; main scene smoke load.

**Acceptance:** project opens in Godot 4.6.3; headless startup succeeds; repository matches approved boundaries.

**Expected report:** engine/project settings created, file tree, commands used, any environment assumptions.

## AUT-002 — Test Runner & CI Script Bootstrap

**Objective:** Introduce one Godot 4.6-compatible test framework after a micro-validation and create stable local test wrappers.

**Dependencies:** AUT-001.

**Scope:** test addon only if required, `tests/`, `tools/ci/test.ps1`, `tools/ci/check.ps1` baseline.

**Constraints:** framework must support headless CI and remain outside domain code; no custom test framework.

**Tests:** one real project smoke test plus framework self-check.

**Acceptance:** test command exits non-zero on intentional failure and zero on passing suite.

**Expected report:** selected framework/version/license/compatibility rationale.

## AUT-003 — Config Loading & Validation Infrastructure

**Objective:** Implement JSON loading, typed config models, version fields and structural/cross-reference/semantic validation infrastructure.

**Dependencies:** AUT-002.

**Scope:** `scripts/config/**`, `tools/config/**`, initial schemas/fixtures.

**Constraints:** no dynamic formula DSL; no gameplay balancing beyond small test fixtures.

**Tests:** malformed JSON, required fields, duplicate IDs, invalid references, valid repository.

**Acceptance:** invalid config fails deterministically with actionable diagnostics before gameplay startup.

**Expected report:** config API, validation stages, known unsupported schema cases.

## AUT-004 — Android Export Baseline

**Objective:** Create a reproducible Gradle-enabled Android debug export path.

**Dependencies:** AUT-001.

**Scope:** export presets, Android project/export config, `tools/ci/build_android.ps1`, build artifact naming.

**Constraints:** target API 36; no secrets in Git; final minSdk only after pinned native dependencies are known; verify path for 16 KB page-size compatibility.

**Tests:** build APK/AAB, install/launch on Android device.

**Acceptance:** reproducible Android artifact generated and launched on device.

**Expected report:** SDK/JDK/Gradle assumptions, artifact path, unresolved store/signing values.

## AUT-005 — Android AdMob + Billing Viability Spike

**Objective:** Close the Godot CONDITIONAL GO with real native SDK integration.

**Dependencies:** AUT-004.

**Scope:** technical spike scene only; pin Godot AdMob 4.6-compatible release and Google Play Billing plugin; buttons for rewarded test ad, product query and test purchase.

**Constraints:** no production gameplay reward logic; isolate native plugin calls even in spike where practical.

**Device tests:** rewarded load/reward/fail, Billing init/query/purchase/cancel/pending where test environment permits, app resume after native overlay.

**Acceptance:** rewarded callback and test Billing transaction path both operate in an Android build without structural blocker.

**Decision:** PASS → Godot GO. Structural FAIL → stop major implementation and reopen engine gate.

**Expected report:** exact plugin versions, SDK versions, issues encountered, GO/NO-GO evidence.

---

# WAVE 1 — DETERMINISTIC ECONOMY CORE

Goal: complete the authoritative mathematical run economy with no dependency on UI or 3D scenes.

## AUT-006 — Core Game State Models

**Objective:** Implement `GameState`, `RunState`, `MetaState`, `BoostState`, `MonetizationState`, `SettingsState`, lifetime state and safe fresh-state construction.

**Dependencies:** AUT-003.

**Constraints:** data only; no economy methods embedded in state; distinguish resettable run data from persistent meta data.

**Tests:** fresh defaults, validation, clone/copy behavior, run/meta boundary.

**Acceptance:** headless test can create a valid Civilization #1 state independent of scenes.

## AUT-007 — Producer Configuration & MVP Data

**Objective:** Encode the five MVP producers and typed `ProducerConfig` contract.

**Dependencies:** AUT-003.

**Source data:** Economy producer baseline and Game Design producer IDs/names.

**Scope:** `producers.json`, producer config model, references to era/milestone/visual profile IDs.

**Tests:** config validation, unique/stable IDs, base values, valid references.

**Acceptance:** no producer economic baseline exists only in code.

## AUT-008 — Producer Cost & Bulk Purchase Math

**Objective:** Implement authoritative next-level and bulk-purchase cost calculations including ×MAX.

**Dependencies:** AUT-007.

**Constraints:** Level 0 = unconstructed; buying Level 1 costs baseCost; use geometric formula; no UI.

**Tests:** ×1, ×10, arbitrary N, insufficient balance, MAX boundaries, large reasonable levels, floating tolerance.

**Acceptance:** one shared API supports runtime/UI preview/simulator.

## AUT-009 — Producer Production Math

**Objective:** Implement base producer output and total production functions before advanced modifiers.

**Dependencies:** AUT-007.

**Constraints:** pure/deterministic functions; no frame-count dependency.

**Tests:** level 0/1/multiple levels, producer totals, elapsed production from delta.

**Acceptance:** production can run headless from state + config.

## AUT-010 — Milestone Configuration & Resolution

**Objective:** Implement Lv10/Lv25/Lv50/Lv100 milestone data, threshold detection and cumulative production effects.

**Dependencies:** AUT-008, AUT-009.

**Constraints:** thresholds/effects from data; buying multiple levels can cross multiple milestones in one command.

**Tests:** edge transitions, multiple crossings, cumulative ×60 at Level 100 baseline.

**Acceptance:** milestone calculation has one authoritative implementation.

## AUT-011 — Typed ModifierSet

**Objective:** Introduce the intentionally limited modifier aggregation required by Breakthroughs/permanent upgrades/boosts.

**Dependencies:** AUT-009, AUT-010.

**Constraints:** no generic expression/effect engine; only approved typed modifier categories.

**Tests:** producer/global multipliers, cost modifiers where present, deterministic composition order.

**Acceptance:** new baseline values normally require data changes, not conditional branches scattered through economy code.

## AUT-012 — Breakthrough Conditions & Effects

**Objective:** Implement MVP Breakthrough configuration, requirement evaluation, purchase transaction and typed effects.

**Dependencies:** AUT-011.

**Source:** Auto Feeder, Worker Bot, Robotic Logistics, Factory Control, Automated Cell Architecture, Advanced Robotics.

**Constraints:** construction effects directly create Level 1 producer when Economy says construction is the transition; no duplicate technology + purchase charge.

**Tests:** locked/eligible/insufficient/duplicate purchase, composite requirements, resulting automation/production/build state.

**Acceptance:** all run Breakthroughs function in headless tests using data-defined baselines.

## AUT-013 — Commands, GameRuntime & Domain Events

**Objective:** Introduce command execution, result types, controlled state mutation and domain events for the implemented economy.

**Dependencies:** AUT-006 through AUT-012.

**Scope:** manual production, buy levels, buy max, purchase Breakthrough, core events.

**Constraints:** no UI/scene/plugin imports; GameRuntime coordinates rather than owning formulas.

**Tests:** micro-run from fresh state through first milestone/Breakthrough; invalid commands leave state unchanged.

**Acceptance:** a headless client can interact only through commands/results/events.

---

# WAVE 2 — PROGRESSION & SIMULATION

Goal: complete automation/eras/meta math and make pacing continuously measurable before significant art production.

## AUT-014 — Automation & Era Progression

**Objective:** Implement automation state, producer build/unlock transitions and Era progression through Robotics Complex.

**Dependencies:** AUT-013.

**Constraints:** automate labor, not decisions; no automatic Breakthrough or Era purchase decisions.

**Tests:** Auto Feeder, Worker Bot, Robot Line Era II transition, Advanced Robotics Era III transition.

**Acceptance:** Era state is derived/transitioned through authoritative domain rules, not UI.

## AUT-015 — Robots Built Economy

**Objective:** Implement cumulative fractional Robots Built progression and threshold events.

**Dependencies:** AUT-014.

**Constraints:** no robot nodes; baseline `0.005 × RobotLineLevel`; resets on Reboot later.

**Tests:** fractional accumulation, level-rate examples, 1/10/100/1000 threshold crossing.

**Acceptance:** visual robot count remains entirely outside this module.

## AUT-016 — Unified Boost System

**Objective:** Implement Free Overclock and generic temporary boost state/effect resolution without ads.

**Dependencies:** AUT-011, AUT-013.

**Scope:** duration, cooldown/active remaining, highest-multiplier rule, suspension relationship support.

**Tests:** ×2 Free Overclock 60s, cooldown 240s, no stacking multiplication, active timer pause/resume primitives.

**Acceptance:** later rewarded/Founder boosts use the same system.

## AUT-017 — Permanent Upgrade Data & Core

**Objective:** Implement Production/Automation/Expansion upgrade definitions, ranks, costs, prerequisites and permanent modifier resolution.

**Dependencies:** AUT-011.

**Constraints:** only required 6–9 MVP style nodes; no universal skill-tree engine.

**Tests:** rank purchase eligibility, max rank, prerequisite chain, modifiers.

**Acceptance:** permanent upgrades can affect fresh run calculations headlessly.

## AUT-018 — Prestige Power & AI Core Calculation

**Objective:** Implement current Civilization Prestige Power peak and AI Core reward formula.

**Dependencies:** AUT-017, AUT-016.

**Constraints:** exclude all temporary boosts; `P0` comes from config/simulation.

**Tests:** temporary boost invariance, peak tracking, reference reward ~5 cores, sqrt scaling examples.

**Acceptance:** one formula used by preview, transaction, tests and simulator.

## AUT-019 — Next Goal Resolver

**Objective:** Implement deterministic Next Goal selection and focus target metadata.

**Dependencies:** AUT-014, AUT-018.

**Scope:** milestone, Breakthrough, build/producer, Era, Reboot/core progression goals.

**Tests:** representative states across first Civilization and post-Reboot start.

**Acceptance:** no screen-specific `if era == ...` progression script is needed.

## AUT-020 — Headless Simulation Runner

**Objective:** Build the reusable simulator around the same GameState/GameRuntime/economy/progression code.

**Dependencies:** AUT-013 through AUT-019.

**Scope:** advance seconds, advance until condition, command execution, trace/metrics collection.

**Constraints:** no duplicated formulas; analytical stepping where state is constant between decisions.

**Tests:** simulator result matches equivalent direct runtime transitions for controlled cases.

**Acceptance:** hours of economic progression can be evaluated quickly without frame simulation.

## AUT-021 — Simulation Strategies

**Objective:** Implement Active, Normal, Passive, Optimized and Scripted strategy interfaces/implementations.

**Dependencies:** AUT-020.

**Constraints:** strategies choose commands; never mutate state directly; assumptions must be explicit/configurable.

**Tests:** deterministic scenario outputs; seeded behavior if any randomness is introduced.

**Acceptance:** all required player patterns can be compared from the same economy.

## AUT-022 — Pacing Targets & Regression Reports

**Objective:** Encode pacing windows, baseline snapshots and dead-zone reporting.

**Dependencies:** AUT-021.

**Scope:** `pacing_targets.json`, baseline scenario artifacts, CLI/PowerShell simulation command.

**Tests:** deliberate baseline change produces readable diff and failure/warning according to target policy.

**Acceptance:** any economy data change can answer “what did this do to pacing?” automatically.

---

# WAVE 3 — PERSISTENCE, OFFLINE & PRESTIGE TRANSACTIONS

Goal: make the complete headless game durable and safe before full visual production.

## AUT-023 — SaveEnvelope Serialization

**Objective:** Serialize/deserialize the authoritative state into versioned JSON.

**Dependencies:** AUT-006 plus current domain models.

**Scope:** envelope metadata, payload serialization, validation hooks.

**Constraints:** do not persist safely derived values.

**Tests:** round-trip equality on persisted fields, version/content metadata, invalid payload rejection.

**Acceptance:** fresh and representative mid-run saves round-trip headlessly.

## AUT-024 — Atomic Save, Dirty Scheduling & Backup Recovery

**Objective:** Implement temp/main/backup atomic save workflow and dirty-save scheduling.

**Dependencies:** AUT-023.

**Tests:** successful rotate, corrupted main + valid backup, interrupted temp write, backup preservation.

**Acceptance:** last valid save is never destroyed before replacement validation.

## AUT-025 — Save Migration Framework

**Objective:** Introduce sequential `vN → vN+1` migration infrastructure and fixtures from save v1.

**Dependencies:** AUT-024.

**Constraints:** no monolithic “if old version patch everything” function.

**Tests:** migration fixture pipeline, validation after every current path.

**Acceptance:** a future v2 migration can be added without redesign.

## AUT-026 — TimeService

**Objective:** Implement monotonic active-session time and UTC wall-clock absence calculation.

**Dependencies:** AUT-024.

**Tests:** forward interval, backwards time, huge jump, invalid/missing timestamp, timezone-independent behavior.

**Acceptance:** negative elapsed time never produces negative rewards or invalid boost behavior.

## AUT-027 — OfflineService & PendingOfflineReport

**Objective:** Calculate analytical offline progress from saved state.

**Dependencies:** AUT-014, AUT-015, AUT-026.

**Rules:** automated only; 75%; cap 8h; eligible Robots Built progress; no decisions; temporary boosts excluded.

**Tests:** 0/1/8/12h, automated/manual mix, robot line automated/not automated, cap and precision.

**Acceptance:** report calculation does not mutate GameState.

## AUT-028 — Idempotent Offline Collection

**Objective:** Implement unique report ID and `CollectOffline` transaction.

**Dependencies:** AUT-027.

**Tests:** normal collect once, duplicate collect rejected, crash/reload pending report fixture.

**Acceptance:** one absence interval can credit state at most once.

## AUT-029 — Reboot Plan & Atomic Transaction

**Objective:** Implement non-mutating Reboot preview and safe confirmed transaction.

**Dependencies:** AUT-018, AUT-024, AUT-028.

**Scope:** recalculate at confirm, AI Core grant, civilization increment, new RunState, persisted MetaState, immediate save.

**Tests:** exact reset/persist matrix, temporary boost exclusion, stale preview recalculation, critical-save failure behavior.

**Acceptance:** Reboot presentation cannot occur before successful state commit/save.

## AUT-030 — Permanent Upgrade Purchase Transaction

**Objective:** Connect AI Core wallet to permanent upgrade ranks with critical persistence.

**Dependencies:** AUT-017, AUT-029.

**Tests:** insufficient cores, rank cost, prerequisites, max rank, post-purchase modifiers, save/reload.

**Acceptance:** no partial AI Core spend state is possible.

---

# WAVE 4 — FIRST PLAYABLE VERTICAL SLICE

Goal: validate the tactile/visual hypothesis using the smallest meaningful player journey before building the entire factory.

## AUT-031 — Mobile Camera Spike

**Objective:** Validate bounded touch camera behavior on a real Android device using placeholders.

**Dependencies:** AUT-004.

**Scope:** pivot rig, one-finger orbit, pinch zoom, two-finger pan, tap-vs-drag threshold, bounded focus, UI input consumption.

**Constraints:** placeholder scene only; exact angles/ranges remain spike output.

**Automated tests:** numeric zoom/pitch/pan clamps and focus target math.

**Manual gate:** real-device control must feel clear and not like a 3D editor.

**Acceptance:** developer approves camera model or documents simplified fallback.

**Superseded (owner decision 2026-11-10):** AUT-R-031-02 replaces this gesture set for FactoryWorld. The game is tap-first: one-finger bounded pan only, with no orbit, no pinch zoom and no two-finger pan. The CameraSpike scene keeps the original spike behaviour.

## AUT-032 — 3D Asset Import & Robot Spike

**Objective:** Validate Kenney Factory + Quaternius Robot runtime pipeline.

**Dependencies:** AUT-004.

**Scope:** selected assets only; Blender normalization to GLB for robot if required; material/scale/animation test scene.

**Device tests:** silhouette, animation, visual compatibility, basic memory/performance.

**Acceptance:** approved packs are technically usable; otherwise reopen only the failed asset category.

## AUT-033 — FactoryWorld Shell

**Objective:** Create the persistent diorama world skeleton with five predetermined producer zones and future-zone foreshadowing.

**Dependencies:** AUT-031, AUT-032.

**Scope:** lighting/environment, Workshop foundation, zone anchors, future areas, CameraRig, PresentationController skeleton.

**Constraints:** one evolving world; no full producer detail.

**Tests:** scene smoke load, required anchors/groups exist.

**Acceptance:** all future visual systems have stable composition points.

## AUT-034 — VisualStateResolver + Fabricator States

**Objective:** Implement the full visual-state pipeline using Fabricator as the reference producer.

**Dependencies:** AUT-010, AUT-033.

**Scope:** resolver descriptor, Fabricator Lv1/10/25/50/100 modules, Auto Feeder state, debug state forcing.

**Constraints:** no economy math in scene/controller.

**Tests:** descriptor resolution and expected module visibility.

**Acceptance:** arbitrary valid Fabricator state can be reconstructed from GameState.

## AUT-035 — Producer Selection, Highlight & Camera Focus

**Objective:** Implement world tap selection through simple Area3D/raycast and focus anchors.

**Dependencies:** AUT-031, AUT-034.

**Tests:** collider IDs, tap selection flow, focus target, focus interrupt logic where automatable.

**Manual:** verify touch does not conflict with orbit/pan/UI.

**Acceptance:** scene knows only producer ID; selection does not change economy.

## AUT-036 — Core HUD & View Models

**Objective:** Implement Industrial Output, production/sec, Next Goal and Free Overclock HUD through view models.

**Dependencies:** AUT-013, AUT-016, AUT-019.

**Constraints:** no duplicated economic calculations; localization keys only.

**Tests:** view models from representative state; command emission.

**Acceptance:** HUD updates from state/events without owning GameState.

## AUT-037 — Producer Panel

**Objective:** Implement selected producer information and ×1/×10/×MAX purchase controls.

**Dependencies:** AUT-008 through AUT-013, AUT-035.

**Tests:** affordability/view model, button commands, milestone preview.

**Acceptance:** UI purchase results match authoritative domain math.

## AUT-038 — First Automation Presentation

**Objective:** Connect Auto Feeder domain event/state to the exceptional first-automation visual payoff.

**Dependencies:** AUT-034, AUT-037.

**Scope:** feeder/conveyor module, indicator/animation, short interruptible focus/feedback.

**Manual gate:** before/after must be visually obvious on phone.

**Acceptance:** presentation never performs the automation transaction itself.

## AUT-INT-001 — Runtime → FactoryWorld State Bridge

**Objective:** Drive FactoryWorld from the single authoritative persistent session (`LifecycleSessionCoordinator` → `GameRuntime` + `persistence/`). On launch, the world, HUD and panel are rebuilt from the loaded save; after that, runtime events and commands keep them up to date.

**Dependencies:** AUT-024, AUT-028, AUT-034, AUT-036, AUT-037, AUT-038.

**Scope:**
- A device-backed `SaveStorage` adapter.
- Bundle the economy config into the app from `data/economy`, guarded against drift.
- Session startup, load and recovery in FactoryWorld.
- Sync the initial state without replaying the first-automation payoff.
- Advance the active session every frame and save when dirty or on a timer.
- Route HUD and panel commands to the session and refresh them afterwards.
- Selection → panel view model.
- Suspend/resume hooks, with a critical save on suspend.

**Constraints (owner decision 2026-11-10):**
- The existing persistent runtime/save state is the only source of truth; no separate in-memory one.
- No economy, progression or formula change.
- No HUD/panel layout or visibility change; that work is AUT-R-036.
- No offline-collection UI (AUT-051).
- Presentation never mutates state.

**Tests:**
- Engine-free session bootstrap: fresh, loaded, recovered and load-failed paths.
- Storage adapter parity with `InMemorySaveStorage`.
- Config drift guard.
- Binding: fan-out, command routing, no payoff replay.
- Background time is not credited as active time after resume.
- Bootstrap wiring text tests.

**Device check (automated, no human gate):**
- Fresh launch → suspend → relaunch reports `loaded_main`.
- A seeded save that owns Auto Feeder rebuilds the automated Fabricator without a focus beat.
- No regression in C3.

**Acceptance:** after a relaunch, FactoryWorld reflects the persisted save, and only the runtime changes state.

## AUT-LOC-001 — Minimal English Text Catalogue

**Objective:** Replace every localization key and hard-coded English fragment that the Core HUD and Producer Panel currently show with readable English from one keyed catalogue.

**Dependencies:** AUT-019, AUT-036, AUT-037, AUT-INT-001. Required before AUT-039: raw keys are not acceptable for its gate (owner decision 2026-11-10).

**Scope:**
- `localization/en.json` at the repository root (key → string, simple `{param}` placeholders), embedded into the build with a drift guard. It lives outside `data/` because every `data/` scanner (config validation, pacing regression and the config-loading tests) treats each `*.json` there as economy config.
- An engine-free lookup.
- Pure helpers that compose HUD and panel strings from the existing view models. This covers the Next Goal text (built from `semanticKey`, `objective` and the producer, breakthrough or era name) and captions merged into the existing labels.

**Constraints:**
- View models stay key-based.
- No layout, node or font change; that work is AUT-R-036.
- No language selection, settings or pseudo-locale; AUT-052 extends this catalogue later.
- The Game Designer approves the wording.

**Tests:**
- Catalogue structure and placeholders.
- Every key reachable from config, Next Goal, Overclock and panel states resolves.
- Composed strings contain no key pattern in representative states.
- Drift guard.
- Controller text tests.

**Device check (automated, regression only):** the C3 and INT-001 scenarios pass.

**Acceptance:** no raw key or hard-coded English remains in HUD or panel text. No human gate.

## AUT-R-036 — HUD & Producer Panel Device Visibility (Landscape)

**Orientation superseded:** the owner corrected the product orientation to **portrait** on 2026-11-10; see AUT-R-036-02. The UI camera, safe area, `ui_layout` diagnostic and touch ownership built here are reused unchanged.

**Objective:** Make the existing Core HUD and Producer Panel visible, readable and correctly anchored on the landscape Android build.

**Dependencies:**
- AUT-036, AUT-037, AUT-INT-001.
- AUT-LOC-001, so the layout is sized to the real strings.
- Orientation is **landscape** (owner decision 2026-11-10).
- Kept separate from AUT-INT-001 (owner decision 2026-11-10).
- Scheduled before AUT-039, the first task that depends on a visible HUD.

**Scope:**
- Landscape design resolution: 720×1280 → 1280×720 in `settings/v2/packages/project.json`. The spike scenes share this setting, so check that CameraSpike and AssetRobotSpike still load.
- Fit policy.
- A dedicated UI camera: orthographic, UI_2D only, rendered above the WorldCamera with a depth-only clear.
- Widget and safe-area anchoring for the HUD and the panel.
- Keep the AUT-R-035-02/03 touch-ownership rules.
- A DEBUG `ui_layout` diagnostic that reports the screen rectangles of the HUD, the panel and their Button nodes.

**Constraints:**
- No view-model, economy or command changes.
- No styling pass.
- The factory keeps about 65–75% of the screen (ART_DIRECTION §19.2).

**Tests:**
- Scene/wiring text tests: UI camera, visibility masks, anchors, design resolution.
- Extend `ui_input_routing` to cover the UI camera.

**Device check (automated):**
- The HUD and panel rectangles sit inside the viewport and don't overlap.
- Together they cover no more than 35% of the screen.
- The button rectangles are inside the viewport.
- No regression in C3 or INT-001.
- Tapping a panel button does not change the world selection.

**Manual gate:** readability on a phone at arm's length is **deferred to the combined human gate of AUT-UI-001** (Orchestrator sequencing, 2026-11-10). If it fails there, a presentation-only AUT-R-036-02 pass follows.

**Acceptance:** the automated device checks pass, and the readability gate is passed at AUT-UI-001.

## AUT-UI-001 — Core Loop Player Input (Manual Production + Next Goal Breakthrough)

**Objective:** Let the player run the first loop on the device: an explicit Manual Produce action, and buying breakthroughs from the HUD Next Goal.

**Dependencies:**
- AUT-013, AUT-019, AUT-INT-001, AUT-LOC-001, AUT-R-036.
- Owner decisions (2026-11-10): the Fabricator world tap stays selection only; manual production is an explicit, permanent HUD Manual Produce button (always visible, also after automation); breakthrough purchases go through the HUD Next Goal flow. GAME_DESIGN §9 updated accordingly.
- Next Goal action scope (Technical Lead default, 2026-11-10): breakthrough goals only, enabled when eligible and affordable, one tap, no confirmation; producer builds stay in the Producer Panel.

**Scope:**
- A Manual Produce control that emits `manualProduce`.
- A Next Goal action for eligible, affordable breakthrough goals that emits `purchaseBreakthrough{breakthroughId}`.
- Enabled/disabled states from view-model data.
- New catalogue keys.

**Constraints:**
- No economy, Next Goal or command changes.
- Every command goes through `FactoryWorldStateBinding.submit`.
- Keep the existing touch ownership.

**Tests:**
- View-model → action mapping.
- Command emission.
- Wiring text tests.
- A UI tap does not change the world selection.

**Device check (automated):**
- Manual Produce tapped N times raises Industrial Output.
- On a seeded save that is eligible for `auto_feeder`, the Next Goal action buys it once, the automated Fabricator payoff plays, and the purchase survives a relaunch.
- No regression in C3 or INT-001.

**Manual gate (combined, single stop):** on the phone:
- the HUD and panel are readable (the gate deferred from AUT-R-036);
- Manual Produce and the Next Goal purchase are comfortable to use;
- a fresh player reaches "Automate Fabricator" without help.

**Acceptance:** the automated checks pass and the combined human gate passes.

**Status note:** the human gate passed on 2026-11-10 in landscape, and the task stack was merged to `main` (afe93b6). The portrait correction (AUT-R-036-02) re-judges readability and tap comfort.

## AUT-R-031-02 — Tap-First Camera Input

**Objective:** Restrict FactoryWorld camera input to the owner's tap-first model: tap to select, one-finger drag to pan within bounds, and no player rotation, zoom or multi-touch.

**Dependencies:**
- AUT-031, AUT-035, AUT-038, AUT-INT-001.
- Owner decisions of 2026-11-10: portrait, tap-first, a one-finger drag is a bounded pan clamped to the unlocked zones and never a tap, no pinch, no two-finger pan, no free orbit. Automatic focus and reveal beats stay allowed.

**Scope:**
- `MobileCameraController` capability flags: a one-finger mode (`orbit` | `pan` | `none`) and a multi-touch switch. The defaults keep the CameraSpike behaviour.
- FactoryWorld enables one-finger pan only, with multi-touch off.
- Gestures that are switched off neither move the camera nor cancel a focus beat.
- Pan bounds come from the unlocked producer zones, resolved engine-free from the session state and refreshed when the state changes.
- Focus distance policy: a selection focus keeps (and restores) the default distance; only the reveal beat pushes in to `focusDistance`.

**Constraints:**
- No change to the tap-vs-drag threshold or to selection.
- No new framing values; portrait framing belongs to AUT-R-036-02.
- No economy or progression change.

**Tests:**
- Flag behaviour and defaults.
- One-finger pan clamped to the bounds.
- Multi-touch ignored.
- A switched-off gesture does not interrupt a focus beat.
- Pan-bounds resolver over representative states.
- Selection focus versus reveal focus distance.
- Wiring text tests.

**Device check (automated, no human gate):** a new scenario where:
- a one-finger swipe pans the camera without changing yaw, pitch or distance, and stays within the bounds;
- a long swipe is clamped at the bounds;
- a tap still selects, and the selection focus uses the default distance.

Also no regression in C3, INT-001, R-036 or UI-001. Multi-touch cannot be driven through ADB, so it is covered by the unit tests and by the AUT-R-036-02 human gate.

**Acceptance:** the automated checks pass. Camera feel is judged at the AUT-R-036-02 combined gate.

**Status note:** camera feel passed at the AUT-R-036-02 combined gate on 2026-11-11; merged to `main` (ac61f32).

## AUT-R-036-02 — Portrait Orientation, Layout & Framing

**Objective:** Make the game portrait-only and re-lay out the HUD, panel and default framing for portrait, reusing the AUT-R-036 UI infrastructure.

**Dependencies:**
- AUT-R-036, AUT-UI-001, AUT-R-031-02.
- Owner decision of 2026-11-10: strict portrait lock on every device.

**Scope:**
- `android:screenOrientation="portrait"` in the tracked `native/engine/android` manifests, including the instant-app manifest.
- Portrait-only orientation keys in `tools/ci/cocos_android_debug_build.json`.
- `designResolution` 720×1280 with a fixed width.
- `UiLayout` reflow: the HUD as a full-width top band and the panel as a full-width bottom band, with ×1/×10/×MAX in one row.
- Portrait default framing and focus values from Scene Presentation: horizontal field-of-view axis, default and focus distances, pan bounds and pan speed.
- C3 calibration moved to a point outside the UI rectangles.

**Constraints:**
- No view-model, command or economy change.
- No styling pass.
- The UI covers 35% of the screen or less, and the factory band takes 65% or more (ART_DIRECTION §19.2).

**Tests:**
- Layout tests on portrait screens, including a top safe-area inset.
- Orientation and manifest text tests.
- Framing values.
- Updated device-scenario tests.

**Device check (automated):**
- At the default view, the Fabricator, Assembly, RobotLine and AdvancedRoboticsComplex zone centres are inside the factory band, and none sits under the UI. AutomatedCell may sit just off the left edge and is reached by panning once unlocked (owner decision 2026-11-11: keep yaw 135°, Option A).
- The reveal target is on screen.
- R-036, C3, INT-001, UI-001 and R-031-02 each pass twice in a row.
- CameraSpike launch smoke.

**Manual gate (combined, single stop):** on the phone, in portrait:
- the HUD and panel are readable at arm's length;
- the default framing shows the factory and the Fabricator line clearly;
- Manual Produce, ×1/×10/×MAX and Next Goal are comfortable to tap;
- the camera never fights the player, and the focus and reveal beats read well.

**Acceptance:** the automated checks pass and the combined human gate passes.

**Status note:** the combined portrait / tap-first human gate passed on 2026-11-11 (owner, OnePlus NE2215, gate APK `05f75b1a`), and both tasks were merged to `main` (b37644d). The provisional framing values (fov 55, distance 14, pan 0.001) are kept. The debug FPS overlay covering part of the bottom panel is debug-only and not a product blocker.

## AUT-VIS-002 — Fabricator High-Level Module Placement

**Objective:** Place the Fabricator modules for the higher milestone levels (Lv25 and above, 8 modules) on the composed production line, the way AUT-038 did for Lv1–Lv10.

**Dependencies:** AUT-R-036-02, so the portrait framing is locked first.

**Scope:** `FabricatorVisualController` module positions and rotations, with composition geometry tests against the real GLB bounds.

**Constraints:** presentation only; no state or economy change.

**Manual gate:** a visual check on the phone. Scene Presentation owns the role.

**Acceptance:** the higher-level modules read as one coherent machine.

## AUT-039 — Assembly + First Worker Bot Vertical Slice

**Objective:** Complete the first playable validation path through Assembly Station and First Robot.

**Dependencies:** AUT-014, AUT-015, AUT-032, AUT-038, AUT-INT-001, AUT-LOC-001, AUT-R-036, AUT-UI-001, AUT-R-031-02, AUT-R-036-02. The Orchestrator decides whether AUT-039 also waits for AUT-VIS-002.

**Scope:** Assembly visual states needed for slice, Worker Bot reveal, one predefined robot route/work loop.

**Tests:** scene/state smoke; FirstRobot event creates presentation but no economic worker entity.

**Manual product gate:** comprehension, automation relief, Next Goal clarity, first visual growth, First Robot payoff.

**Acceptance:** vertical slice is approved before full Era II/III production.

---

# WAVE 5 — FULL F2P FACTORY & CORE LOOP

Goal: complete the full free MVP through Reboot/Civilization #2 before adding commercial acceleration.

## AUT-040 — Reusable Construction Presentation

**Objective:** Create a generic 1.5–3s construction/reveal sequence usable by producers/modules.

**Dependencies:** AUT-033.

**Scope:** ghost/hologram or staged reveal, sparks, lights, activation hook.

**Constraints:** reusable; not five bespoke cinematics.

**Acceptance:** presentation can be invoked from domain events without mutation.

## AUT-041 — RobotPopulationController

**Objective:** Map Robots Built to capped visible population using pooling and predefined paths.

**Dependencies:** AUT-015, AUT-032.

**Scope:** population tiers, pool, Path3D/PathFollow3D routes, small visual variation.

**Constraints:** no NavigationAgent/job AI; no 1:1 robot mapping.

**Tests:** tier mapping/pool behavior; scene smoke.

**Device benchmark:** 1/8/14/20/30 robots.

## AUT-042 — Robot Line Visual & Era II Reveal

**Objective:** Implement Producer #3 visual pipeline and Robot Line construction transition into Automated Factory.

**Dependencies:** AUT-040, AUT-041.

**Scope:** line silhouette, conveyors/assembly points, fake robot production, Era II reveal hook.

**Acceptance:** old Workshop remains visible; no separate Era map.

## AUT-043 — Automated Cell Visual

**Objective:** Implement Producer #4 as compact enclosed multi-arm automation cell with milestone states.

**Dependencies:** AUT-042.

**Tests:** visual state binding/scene smoke.

**Acceptance:** silhouette clearly contrasts with Robot Line.

## AUT-044 — Advanced Robotics Complex Visual

**Objective:** Implement Producer #5 and Era III frontier visual states.

**Dependencies:** AUT-043.

**Asset rule:** first attempt approved Kenney Factory + limited Modular Space + Automata materials/decals; create custom hero core only if still insufficient.

**Acceptance:** building-scale/vertical silhouette communicates frontier producer on mobile.

## AUT-045 — Era Environment Progression

**Objective:** Implement additive Manual Workshop → Automated Factory → Robotics Complex environment evolution.

**Dependencies:** AUT-042 through AUT-044.

**Scope:** expansion modules, lighting/palette progression, vertical structures, AI Megafactory teaser.

**Constraints:** no separate maps; Era IV teaser only.

**Tests:** state→environment visibility.

## AUT-046 — Milestone & Breakthrough Presentation Layer

**Objective:** Connect domain events to tiered minor/major/exceptional feedback.

**Dependencies:** AUT-034, AUT-040, AUT-045.

**Scope:** reusable toast/VFX/focus triggers; avoid unique cinematic per milestone.

**Acceptance:** presentation importance matches Art Direction without delaying player control unnecessarily.

## AUT-047 — Overclock Presentation

**Objective:** Render active temporary boost state through animation/VFX/HUD without making visuals authoritative.

**Dependencies:** AUT-016, AUT-036.

**Rules:** visual machine speed can be ~1.25–1.4× while economy is ×2; amber activity language.

**Tests:** boost state/view model; active/end presentation events.

## AUT-048 — Era Transition Presentation

**Objective:** Implement reusable Era I→II and Era II→III reveals with interruptible/recoverable camera control.

**Dependencies:** AUT-045, AUT-046.

**Acceptance:** transitions can replay safely from domain state/event without altering progression.

## AUT-049 — Reboot Presentation

**Objective:** Implement shutdown → scan/archive → AI Core → new Civilization presentation after successful transaction.

**Dependencies:** AUT-029, AUT-045.

**Critical constraint:** `RebootCompleted`/successful save must precede presentation.

**Tests:** presentation syncs new RunState and persistent meta visuals.

## AUT-050 — Permanent Upgrade UI

**Objective:** Implement Production/Automation/Expansion upgrade UI using view models/commands.

**Dependencies:** AUT-030.

**Tests:** cost/prerequisite display, purchase command, insufficient/max rank states.

**Acceptance:** UI contains no AI Core math/effect duplication.

## AUT-051 — Offline Factory Report UI

**Objective:** Display PendingOfflineReport and normal Collect flow.

**Dependencies:** AUT-028.

**Scope:** time away/effective time, IO, Robots Built when useful, educational automated/manual producer explanation on first return.

**Constraints:** rewarded button deferred.

**Acceptance:** report survives reload and normal collection is always available.

## AUT-052 — Localization, Audio & Settings Skeleton

**Objective:** Add localization keys/catalogue, AudioService and MVP settings persistence/UI. Localization extends the AUT-LOC-001 catalogue (no parallel system).

**Dependencies:** core UI exists.

**Scope:** music/SFX/vibration/language; quality only if device need already identified.

**Tests:** missing-key detection, settings save/load, pseudo-long-string smoke.

**Acceptance:** no significant player-facing strings hardcoded in gameplay scenes/scripts.

---

# WAVE 6 — PLATFORM SERVICES & MONETIZATION

Goal: add optional commercial acceleration only after the free game is complete and satisfying.

## AUT-053 — Production Platform Service Interfaces & Mocks

**Objective:** Formalize AdsService, PurchaseService, EntitlementService and AnalyticsService boundaries using AUT-005 findings.

**Dependencies:** AUT-005 plus core game.

**Scope:** provider interfaces, mock providers, platform capability model, lifecycle overlay hooks.

**Tests:** mock success/failure/duplicate callbacks; no gameplay plugin import.

**Acceptance:** editor/CI can exercise monetization without network/native SDK.

## AUT-054 — Rewarded Eligibility Rules

**Objective:** Implement Project Automata rewarded opportunity rules independently of AdMob.

**Dependencies:** AUT-053, AUT-026.

**Data/rules:** Offline Double min 30m/max 3 rolling 24h; Extended Overclock max 3/24h/min 60m interval.

**Tests:** eligibility, quota pruning, next-eligible reason/time, backwards/suspicious wall time safe behavior.

**Acceptance:** Ad availability and player eligibility are separate concepts.

## AUT-055 — Double Offline Reward Mock Flow

**Objective:** Connect Factory Report to mock rewarded flow and idempotent ×2 collection.

**Dependencies:** AUT-051, AUT-053, AUT-054.

**Tests:** reward success ×2 exactly once, close-without-reward, failure/unavailable leaves normal Collect, duplicate callback no-op.

**Acceptance:** free 75% reward is never reduced/withheld for monetization.

## AUT-056 — Extended Overclock Mock Flow

**Objective:** Connect rewarded result to BoostSystem activation using mocks.

**Dependencies:** AUT-016, AUT-053, AUT-054.

**Tests:** eligible success, failure, quota, interval, duplicate callback, Free Overclock suspension/resume.

**Acceptance:** AdsService never modifies production multiplier directly.

## AUT-057 — Android AdMob Production Provider

**Objective:** Integrate the pinned AUT-005 AdMob provider behind AdsService.

**Dependencies:** AUT-055, AUT-056.

**Scope:** init, preload, availability, show, reward/failure/close events, app overlay lifecycle, test/production IDs separation.

**Tests:** mocks + Android build; real device test ads.

**Acceptance:** both MVP placements work on device and failure never blocks core gameplay.

## AUT-058 — Founder Offer Domain & Entitlement Model

**Objective:** Implement Founder offer availability and durable ownership independently of store SDK.

**Dependencies:** AUT-030, AUT-053.

**Rules:** unlock after First Worker Bot; availability per Monetization source; one durable purchase; two Factory Surges granted exactly once; cosmetic entitlement.

**Tests:** unlock states, ownership, initial grant-once, save/reload, restore-style reconciliation input.

**Acceptance:** entitlement and consumable grant flags are distinct.

## AUT-059 — Founder Shop UI

**Objective:** Implement locked/available/pending/owned Founder offer UI.

**Dependencies:** AUT-058.

**Scope:** localized contents, store localized price field, purchase command/request.

**Constraints:** never hardcode `€2.99` in UI; store metadata is price truth.

**Tests:** view states with mock product metadata.

## AUT-060 — Google Play Billing Production Provider

**Objective:** Integrate pinned Google Play Billing provider behind PurchaseService.

**Dependencies:** AUT-005, AUT-058, AUT-059.

**Scope:** initialize/query/purchase, purchased/pending/cancel/fail handling, acknowledgement according to plugin/store semantics, transaction IDs.

**Tests:** mock integration + Android build + Play test account/device.

**Acceptance:** successful purchase creates entitlement once; pending/cancel do not.

## AUT-061 — Purchase Restore & Entitlement Reconciliation

**Objective:** Reconcile durable Founder ownership from store state and restore path.

**Dependencies:** AUT-060.

**Tests:** local false/store true, local true/no network, duplicate transaction, reinstall-style restore, restore never regrants Surges.

**Acceptance:** previously valid local entitlement is not removed because network/store query is unavailable.

## AUT-062 — Founder Robot / UNIT 0001

**Objective:** Implement Founder cosmetic variant on standard robot if mobile readability passes.

**Dependencies:** AUT-041, AUT-058.

**Scope:** graphite/gold material variant, small crest/antenna, UNIT 0001 marking; ensure a Founder robot is visible when practical.

**Manual gate:** visible at normal camera distance on phone.

**Fallback:** if unreadable, report and replace with more visible low-scope Founder factory cosmetic only after Art/Orchestrator approval.

## AUT-063 — Analytics Event Layer

**Objective:** Implement central event catalogue, mapper and Debug/NoOp Analytics providers.

**Dependencies:** stable domain events.

**Scope:** progression, offline, rewarded, purchase events and validated parameters.

**Tests:** event mapping, missing/invalid params in debug validation, provider failure non-authoritative.

**Acceptance:** no direct external analytics call in domain/UI scripts.

## AUT-064 — Monetization Analytics Coverage

**Objective:** Add the measurements required by Monetization without creating analytics-driven gameplay dependencies.

**Dependencies:** AUT-063, AUT-055 through AUT-061.

**Scope:** rewarded opportunities/start/completion/failure and Founder impression/purchase/restore context.

**Acceptance:** metrics needed for opt-in, use frequency and conversion can be derived from clean events.

## AUT-065 — Consent / Privacy Bootstrap for Ads

**Objective:** Integrate consent flow required by the pinned AdMob setup and keep ads optional.

**Dependencies:** AUT-057.

**Scope:** UMP path where applicable, provider personalization state, non-blocking fallback.

**Tests:** consent-required/not-required/unavailable states as far as provider mocks permit; device smoke test.

**Acceptance:** core game starts/plays even if consent/Ads initialization fails or network is absent.

---

# WAVE 7 — MVP HARDENING

Goal: finish identity, performance, error handling, release build and automated gates.

## AUT-066 — Automata Identity Asset Integration

**Objective:** Integrate/create MVP custom identity assets required by Art/Asset Manifest.

**Dependencies:** full factory stable enough for placement.

**Scope:** AI Core 3D/icon, Automata decals/numbering/warnings, core UI icon set, logo when ready; optional Advanced Robotics hero core only if approved asset composition failed.

**Constraints:** source/license records mandatory; no large bespoke asset wave.

**Acceptance:** game no longer reads as an untouched asset pack.

## AUT-067 — Worst-Case Performance Scene & Baseline

**Objective:** Create reproducible Era III/high-level benchmark state and capture baseline on representative Android device.

**Dependencies:** AUT-044 through AUT-048.

**Scope:** all producers high state, automation, ~14 baseline robots, conveyors, Overclock VFX, HUD.

**Metrics:** FPS/frame time, CPU/GPU indication, memory, draw calls.

**Acceptance:** documented baseline exists before optimization.

## AUT-068 — Profile-Guided Performance Pass

**Objective:** Fix measured bottlenecks only.

**Dependencies:** AUT-067.

**Priority order:** material reuse, shadows/lights, robot animation/shadows, repeated static meshes/MultiMesh if justified, particles, other profiler evidence.

**Constraints:** no speculative full LOD/occlusion rewrite.

**Acceptance:** stable performance improvement on reference device with no material visual regression.

## AUT-069 — Debug / QA Toolkit

**Objective:** Add debug-only controls for rapid state and platform-flow testing.

**Dependencies:** most domain systems.

**Scope:** grant IO, producer level/state, Breakthrough/Era, Robots Built, AI Cores, pending offline, Reboot preview, mock ad success/failure, mock Founder ownership.

**Constraints:** excluded/inaccessible in production; gameplay debug should use commands where feasible.

**Acceptance:** QA can reach all major MVP states without hours of play.

## AUT-070 — Localization & UI Robustness Pass

**Objective:** Remove remaining player-facing hardcoded strings and validate long-string/screen-size behavior.

**Dependencies:** final MVP UI.

**Tests:** missing keys, pseudo-locale, common tall phone/smaller phone layouts, safe areas.

**Acceptance:** no critical UI clipping or untranslated key in release candidate path.

## AUT-071 — Error Handling & Recovery Pass

**Objective:** Verify all defined failure behaviors across save, time, assets, Ads and IAP.

**Dependencies:** all corresponding systems.

**Test matrix:** corrupt save, backup restore, ad unavailable/show fail, purchase cancelled/pending/fail, restore fail, no network, duplicate callbacks, invalid time, missing visual asset.

**Acceptance:** failures cannot corrupt progression or deadlock the game.

## AUT-072 — Logging & Build Metadata

**Objective:** Standardize logging categories and expose debug build identity.

**Dependencies:** core systems.

**Scope:** game/build/save/content/Godot versions and optional Git short SHA; production log reduction.

**Acceptance:** a QA screenshot/log can identify exact build/config baseline.

## AUT-073 — Android Release Configuration

**Objective:** Finalize production Android export configuration for Play.

**Dependencies:** AUT-057, AUT-060, AUT-068.

**Scope:** final package, target SDK 36, minSdk recorded from pinned dependencies, version code, signing injection, AAB, production AdMob IDs/product ID, 16 KB validation.

**Constraints:** no credentials committed.

**Acceptance:** release AAB installs via controlled Play testing track and native libraries satisfy current requirements.

## AUT-074 — CI Workflow Finalization

**Objective:** Stabilize mandatory PR/main checks and Android artifact build.

**Dependencies:** all automated test/tooling systems.

**Scope:** `ci.yml`, `android-build.yml`, cached/pinned Godot where appropriate, reports/artifacts.

**Acceptance:** clean runner executes validation/tests/simulation; relevant main build produces Android artifact.

## AUT-075 — Full Automated Regression Gate

**Objective:** Make `check.ps1` the authoritative pre-merge automated gate and document manual follow-ups.

**Dependencies:** AUT-074.

**Scope:** config validation, unit/integration/scene tests, simulation regressions, deterministic exit codes/reporting.

**Acceptance:** intentional break in each critical subsystem fails the gate; clean repository passes.

---

# WAVE 8 — OPTIONAL iOS ACTIVATION (NOT ANDROID-MVP BLOCKING)

## AUT-IOS-001 — iOS Export Baseline

**Objective:** Export current Godot project to Xcode and launch on physical iPhone.

**Dependencies:** commercial core stable, Mac/Xcode available.

**Acceptance:** signing/provisioning documented; app launches and save/lifecycle basics work.

## AUT-IOS-002 — iOS AdMob Provider Validation

**Objective:** Validate the shared AdsService through native iOS AdMob build.

**Dependencies:** AUT-IOS-001, AUT-057 architecture.

**Tests:** rewarded lifecycle, consent/ATT path as applicable, background/native overlay behavior.

## AUT-IOS-003 — StoreKit 2 Purchase Provider

**Objective:** Implement/validate StoreKit provider behind PurchaseService.

**Dependencies:** AUT-IOS-001, AUT-058/059.

**Tests:** product info/localized price, sandbox purchase, cancel/pending where possible, restore/sync, relaunch.

**Risk:** plugin API maturity; isolate all changes to provider boundary.

## AUT-IOS-004 — iOS Persistence/Lifecycle Device Pass

**Objective:** Validate background, suspension, process termination, offline report and critical saves on iOS.

**Dependencies:** AUT-IOS-001.

## AUT-IOS-005 — TestFlight Release Candidate

**Objective:** Produce controlled TestFlight build and complete iOS-specific smoke matrix.

**Dependencies:** AUT-IOS-002 through AUT-IOS-004.

---

# 5. Development Milestones / Gates

## M0 — Stack Gate

**Tasks:** AUT-001 → AUT-005.  
**Exit:** Godot Android project builds; AdMob rewarded and Play Billing are viable.  
**Human decision:** confirm final Godot GO.

## M1 — Headless Economy

**Tasks:** AUT-006 → AUT-022.  
**Exit:** first Civilization progression can be simulated through Reboot eligibility with measurable pacing.  
**Human decision:** economy/pacing baseline is sane enough for visual production.

## M2 — Headless Complete Game

**Tasks:** AUT-023 → AUT-030.  
**Exit:** economy, save, offline, Reboot, AI Cores and permanent upgrades operate without 3D.  
**Human decision:** persistence/prestige architecture accepted.

## M3 — Vertical Slice

**Tasks:** AUT-031 → AUT-039 (incl. AUT-INT-001, AUT-LOC-001, AUT-R-036, AUT-UI-001, AUT-R-031-02, AUT-R-036-02, AUT-VIS-002).  
**Exit:** real Android slice, in portrait, demonstrates manual production → first automation → Assembly → First Robot.  
**Human product gate:** comprehension, camera framing, bounded pan and automatic focus/reveal beats, automation payoff, visual progression, Next Goal and First Robot must feel convincing.

Do not blindly continue if M3 fails. Rework the existing economy/presentation first.

## M4 — Full F2P MVP

**Tasks:** AUT-040 → AUT-052.  
**Exit:** full free Civilization #1 → Robotics Complex → Reboot → Civilization #2 loop is playable and visually coherent.  
**Human product gate:** the free game is worth accelerating before monetization is activated.

## M5 — Commercial Android MVP

**Tasks:** AUT-053 → AUT-065.  
**Exit:** optional rewarded placements + Founder Pack operate safely through platform abstractions and device tests.

## M6 — Release Candidate Technical Gate

**Tasks:** AUT-066 → AUT-075.  
**Exit:** identity, performance, recovery, production Android config and CI are complete enough for QA/Release handoff.

---

# 6. Task Parallelization Guidance

Default dependency order is authoritative, but selected spikes can run in parallel:

- AUT-031 Camera Spike may run shortly after AUT-004 while economy work AUT-006+ continues.
- AUT-032 Asset/Robot Spike may run in parallel with headless economy.
- Platform spike AUT-005 should remain early because it can reopen the engine gate.
- Final production AdMob/Billing integration should remain after the F2P core so monetization does not shape an unproven free economy.

Avoid parallel Codex tasks that modify the same domain/files unless the developer explicitly coordinates branches.

# 7. Branch and Commit Strategy

Use short-lived branches such as:

```text
feat/aut-008-producer-costs
feat/aut-031-camera-spike
fix/offline-double-grant
```

Recommended commit convention:

```text
feat(config): add typed producer configuration
feat(economy): implement producer bulk purchases
test(prestige): cover reboot persistence boundary
feat(camera): add bounded mobile orbit controls
fix(offline): prevent duplicate report collection
```

A task may use more than one commit when it improves reviewability, but avoid mixing architecture, UI, ads and unrelated assets in one commit.

# 8. Extra Gates by Change Type

### Economy/data change

Required:

- unit tests;
- config validation;
- simulation regression;
- pacing diff in final report.

### Save/offline/prestige change

Required:

- save/load tests;
- migration fixture if schema changes;
- transaction/idempotence tests;
- recovery behavior where relevant.

### Presentation/camera/robot change

Required:

- scene smoke tests;
- structural state-binding tests;
- explicit manual device checks listed in report.

### Platform/addon/export change

Required:

- mock/integration tests where possible;
- Android export/build;
- explicit real-device validation state.

# 9. Debug Versus Production Discipline

Debug-only tooling may force state for presentation/QA, but production code must remain command/state-driven. Mock Ads/Purchases must never be silently enabled in production. Test ad unit IDs and production IDs are separate configuration. Debug cheats, state inspector and mock platform controls must be unavailable in release builds.

# 10. Dependency Policy

Before adding/upgrading any dependency, Codex must report:

- package/plugin name;
- exact version;
- license;
- Godot/platform compatibility;
- maintenance status relevant to the task;
- why existing project code/standard Godot features are insufficient.

Critical plugins are pinned. Do not update “to latest” during unrelated tasks.

# 11. Explicitly Out of MVP Implementation Plan

Do not create tasks or scaffolding for these unless the Orchestrator changes scope:

- Factory Rush implementation;
- Play Games leaderboard;
- free construction/conveyor editor;
- authoritative physical resources;
- complex robot navigation/job AI;
- multiplayer/backend;
- full AI Megafactory;
- Orbital/Planetary/Stellar/Dyson Eras;
- premium currency;
- generic consumable shop;
- forced interstitials;
- Remove Ads;
- battle pass/subscription;
- live events/daily systems;
- cloud save;
- server receipt validation;
- large cosmetic catalogue.

# 12. Reuse Extraction Checkpoints

Do not create a shared Mobile Game Factory SDK during these tasks. At M4/M6, review whether the following have proven generic enough to extract in a future project:

- config loader/validator;
- save + migration infrastructure;
- AdsService provider boundary;
- Purchase/Entitlement service boundary;
- Analytics service/event catalogue pattern;
- localization/audio bootstrap;
- CI/test wrappers.

Producer economy, AI Cores/Reboot and robot/factory presentation remain Automata-specific by default.

# 13. Technical Lead Review Checklist Before Launching a Task

Before generating the detailed Codex prompt for any AUT ID:

1. Is the dependency task actually merged/current?
2. Did a source-of-truth decision change since this plan was written?
3. What files currently implement the relevant system?
4. Can scope be made smaller without losing a coherent testable result?
5. What exact tests prove the task?
6. Is a device/manual check needed that Codex cannot claim automatically?
7. Would the task introduce a dependency or product decision requiring human approval?

The final prompt should then expand the task with current repository paths and exact commands rather than blindly copying an old prompt template.

# 14. Final Implementation Recommendation

Begin with:

```text
AUT-001 Project Bootstrap
AUT-002 Test Runner & CI Bootstrap
AUT-003 Config Infrastructure
AUT-004 Android Export Baseline
AUT-005 AdMob + Billing Viability Spike
```

After the Godot gate passes, prioritize the deterministic headless product through AUT-030. Camera and asset spikes may proceed in parallel, but full 3D content production should wait until pacing and the vertical-slice gates justify it.

This sequence intentionally produces evidence at every stage:

```text
Can it build?
→ Can the economy work?
→ Can we measure pacing?
→ Can progression survive save/offline/Reboot?
→ Is the first slice enjoyable on phone?
→ Is the full free game worth monetizing?
→ Do Ads/IAP integrate safely?
→ Is the build ready for QA/release?
```

That is the implementation contract for Project Automata.
