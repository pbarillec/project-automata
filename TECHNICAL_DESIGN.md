# Project Automata — TECHNICAL_DESIGN

**Status:** Technical Design — APPROVED CANDIDATE for Technical Gate  
**Date:** 2026-08-15  
**Phase owner:** Technical Lead / Codex Prompt Engineer  
**Engine decision:** Godot — CONDITIONAL GO pending Android monetization spike; recommended stack is locked for implementation planning  
**Primary implementation target:** Android  
**Secondary target:** iOS, architecture-ready but not Android-MVP blocking

## 0. Source of Truth and Decision Semantics

This document consolidates the approved product, economy, monetization and art decisions from:

- `STUDIO_CONTEXT.md`
- `FACTORY_WORKFLOW.md`
- `PROJECT_AUTOMATA_BRIEF.md`
- `GAME_DESIGN.md`
- `ECONOMY.md`
- `MONETIZATION.md`
- `ART_DIRECTION.md`
- `ASSET_MANIFEST.md`

It must not silently redefine those documents. Numerical economy values described as baselines remain data-driven and tunable. Technical invariants described here are implementation constraints unless the Orchestrator explicitly reopens the Technical Gate.

Decision vocabulary:

- **APPROVED** — accepted direction for implementation.
- **MVP** — required for the first releasable commercial scope.
- **CONDITIONAL** — approved if a named technical gate passes.
- **POST-MVP** — intentionally deferred.
- **REJECTED** — out of scope unless explicitly reconsidered.

## 1. Executive Technical Decision

### 1.1 Stack verdict

**GODOT — CONDITIONAL GO, strong recommendation to proceed.**

Recommended production baseline:

```text
Engine: Godot 4.6.3 Standard
Language: GDScript
Renderer: Mobile
3D runtime format: GLB / glTF 2.0
Android export: Gradle-enabled
Android target SDK: API 36 for Google Play submissions from 2026-08-31
Android native compatibility: 16 KB page-size compliant
Primary store: Google Play
Ads: Godot AdMob integration behind AdsService
Android IAP: Godot Google Play Billing integration behind PurchaseService
iOS IAP: StoreKit 2 provider behind PurchaseService, medium integration risk
Backend: none required
Networking: optional only for platform services
```

Godot 4.6.3 is a stable release dated 2026-05-20. The Godot AdMob v6 line explicitly supports Godot 4.6, and the Google Play Billing plugin 3.3.0 was released 2026-07-27 with Google Play Billing Library 9.1. StoreKit 2 integration is available but its public repository still describes the API as under development; iOS commerce therefore remains a dedicated release gate rather than an Android-MVP blocker.

### 1.2 Why Godot for Automata

Project Automata is not an authoritative factory simulation. Its production model is mathematical and deterministic; conveyors, machines and robots are presentation. The project therefore benefits from:

- concise GDScript;
- small scene composition units;
- native 3D and UI;
- straightforward GLB import;
- deterministic headless logic;
- CLI export and testing;
- low licensing and lock-in cost;
- a repository that is easy for Codex to inspect and modify.

Unity has a stronger commercial SDK ecosystem but adds complexity and cost that are not justified by this scope. Cocos Creator remains a credible fallback, especially given studio familiarity, but Godot provides the cleaner fit for the 3D composed-scene architecture chosen here.

### 1.3 Blocking stack gate

Before large-scale visual production, execute an Android viability spike containing:

1. Godot 4.6.3 Gradle export;
2. Android device install/launch;
3. simple 3D scene;
4. basic touch camera;
5. AdMob rewarded test ad;
6. Google Play Billing test product flow;
7. background/resume around native overlays.

If the Ads/Billing path fails structurally rather than through a fixable integration issue, reopen the engine decision and compare Cocos Creator before proceeding further.

## 2. Architectural Principles

The architecture optimizes:

**Implementation Speed × Reliability × Codex Suitability × Testability × Reuse × Mobile Performance**

The following invariants are non-negotiable:

1. **The economic model is authoritative. The visible factory is not.**
2. **The economy must run without loading the 3D scene.**
3. **Runtime, tests and simulator use the same formulas and configuration.**
4. **Balancing values live in data, not UI or scene scripts.**
5. **UI observes state and submits commands; it does not own GameState.**
6. **Platform SDKs are isolated behind services/providers.**
7. **External failures must not corrupt progression.**
8. **Save migrations exist from the first persistent MVP version.**
9. **Robots and conveyor items are visual abstractions, not economic entities.**
10. **Build for Automata first; extract reusable Factory modules only after reuse is proven.**

## 3. High-Level System Architecture

```text
                         GameConfig
                             │
                             ▼
Player / UI ────────► Command Layer
                             │
                             ▼
                       GameRuntime
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     EconomyCore       ProgressionSystem     Meta/Boosts
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                         GameState
                             │
                        Domain Events
        ┌───────────────┬────┴─────┬─────────────────┐
        ▼               ▼          ▼                 ▼
  Factory 3D            UI       Audio           Analytics

Side services:
SaveService · TimeService · OfflineService · AdsService · PurchaseService
EntitlementService · LocalizationService · PlatformLifecycleCoordinator
```

`GameRuntime` coordinates commands and state transitions but is not a giant manager. Domain modules remain small and specialized.

## 4. Application and Session Boundary

### 4.1 App layer

`App` owns process-wide lifecycle concerns:

- configuration loading and validation;
- save loading/migration;
- platform service initialization;
- localization/settings initialization;
- scene/session startup;
- background/suspend/exit hooks;
- build/version metadata.

### 4.2 GameSession

A `GameSession` owns the currently active civilization/run:

- `GameState`;
- `GameRuntime`;
- economy/progression services;
- domain event bus;
- offline pending report;
- presentation synchronization.

Platform SDK initialization may continue asynchronously. Core gameplay must not block on Ads, Purchases or Analytics.

## 5. State Model

### 5.1 Rule

State objects contain data. Domain systems contain rules.

Avoid methods such as:

```text
state.producer.buy_level()
```

Prefer explicit domain calls/commands operating on state and config.

### 5.2 GameState

Conceptual structure:

```text
GameState
├── run: RunState
├── meta: MetaState
├── boosts: BoostState
├── monetization: MonetizationState
├── settings: SettingsState
└── lifetime: LifetimeState
```

### 5.3 RunState

Run-scoped fields include at minimum:

- Industrial Output balance;
- producer levels;
- producer unlock/build state;
- automation state;
- purchased run Breakthrough IDs;
- current Era;
- Robots Built progress;
- current run statistics required for progression;
- `prestigePowerPeak`;
- temporary boost state;
- run-specific onboarding/progression flags where non-derivable.

### 5.4 MetaState

Persistent fields include:

- Civilization number;
- AI Core balance;
- lifetime AI Cores earned;
- permanent upgrade ranks;
- account-level feature unlocks;
- durable entitlements or a local entitlement cache;
- persistent cosmetic ownership.

### 5.5 Derived values

Do not persist values that are safely derivable from state + current config:

- total production/sec;
- next producer cost;
- milestone multipliers;
- `canAfford` flags;
- Next Goal;
- visual tier;
- effective temporary multiplier.

Historical extrema such as `prestigePowerPeak` are persisted because they are not necessarily reconstructible after balancing/content changes.

## 6. Commands, Results and Domain Events

### 6.1 Commands

Use a small explicit command layer, not enterprise CQRS. MVP commands include:

- `ManualProduce`
- `BuyProducerLevels`
- `BuyMaxProducerLevels`
- `BuyBreakthrough`
- `ActivateOverclock`
- `CollectOffline`
- `RebootCivilization`
- `BuyPermanentUpgrade`
- `RespecPermanentUpgrades` only if exposed
- monetization-triggered commands after validated external callbacks.

Commands never contain presentation logic.

### 6.2 Results

Important transactions return explicit result objects, for example:

```text
BuyResult
- success
- producerId
- levelsBought
- oldLevel
- newLevel
- amountSpent
- milestonesReached
```

```text
RebootResult
- coresEarned
- oldCivilization
- newCivilization
- resetSummary
- events
```

### 6.3 Events

Representative domain events:

- `IndustrialOutputChanged`
- `ProductionRateChanged`
- `ProducerUnlocked`
- `ProducerLevelChanged`
- `ProducerMilestoneReached`
- `AutomationUnlocked`
- `BreakthroughPurchased`
- `EraReached`
- `FirstRobotProduced`
- `OverclockStarted`
- `OverclockEnded`
- `RebootAvailable`
- `RebootCompleted`
- `PermanentUpgradePurchased`
- `OfflineReportCreated`
- `OfflineRewardCollected`

Events are consumed by UI, presentation, audio, analytics and save-dirty tracking. Economy code never imports scene or platform implementations.

## 7. Economy Core

### 7.1 Deterministic rule

Economy functions accept state/config/input and produce deterministic values or controlled transactions. Randomness is not required for MVP economy.

### 7.2 Level convention

Technical Design resolves the Economy document indexing ambiguity as follows:

```text
Level 0 = producer not constructed
Level 1 = producer constructed
cost of buying next level from current level L:
baseCost × costGrowth^L
```

Thus buying Level 1 from Level 0 costs exactly `baseCost`.

Producer construction that conceptually creates a producer sets it to Level 1. Do not introduce a redundant “technology unlock then separate producer purchase” when Economy defines construction itself as the transition.

### 7.3 Production formula

Authoritative concept:

```text
producerOutput =
    baseProductionPerLevel
    × level
    × milestoneMultiplier
    × breakthroughMultipliers
    × permanentUpgradeMultipliers
    × temporaryMultiplier
```

```text
totalProductionPerSecond =
    sum(active producer outputs)
```

All components must come from one shared implementation.

### 7.4 Geometric purchase costs

For base cost `C`, growth `g`, current level `L`, buying `n` levels:

```text
bulkCost = C × g^L × (g^n - 1) / (g - 1)
```

`×1`, `×10` and `×MAX` use the same math. `×MAX` determines the largest affordable `n` using an analytical inverse or bounded/binary search; never iterate thousands of levels one by one.

### 7.5 Economy tick

The economy is time-based, not frame-count-based. Runtime may aggregate updates at roughly 5–10 Hz for UI/event efficiency while always calculating from elapsed `delta`:

```text
produced = productionPerSecond × elapsedSeconds
```

The exact runtime tick frequency is an implementation tuning value and must not change economic output.

### 7.6 Producer baselines

Current simulation-supported data baseline:

| Producer | Era | Base Cost | Growth | Base Production/Level |
|---|---|---:|---:|---:|
| Fabricator | Manual Workshop | 10 | 1.14 | 1 IO/s |
| Assembly Station | Manual Workshop | 1.5K | 1.15 | 12 IO/s |
| Robot Line | Automated Factory | 50K | 1.16 | 150 IO/s |
| Automated Cell | Automated Factory | 5M | 1.17 | 2.5K IO/s |
| Advanced Robotics Complex | Robotics Complex | 500M | 1.18 | 500K IO/s |

These values live in JSON and remain tunable.

### 7.7 Milestones

Shared MVP milestone thresholds:

| Level | Reward |
|---:|---|
| 10 | ×2 producer output |
| 25 | ×2 producer output |
| 50 | ×3 producer output |
| 100 | ×5 producer output |

Cumulative milestone multiplier at 100 is ×60. Thresholds and effects are data, not hardcoded branches.

### 7.8 Breakthrough baseline

The current MVP baseline contains:

1. Auto Feeder;
2. Worker Bot;
3. Robotic Logistics;
4. Factory Control System;
5. Automated Cell Architecture;
6. Advanced Robotics;
7. Reboot Civilization as prestige frontier rather than a standard Breakthrough.

Exact costs, requirements and effects come from `ECONOMY.md` and JSON data. The implementation must support requirements such as producer level, owned Breakthrough, Robots Built, Era and Civilization.

### 7.9 Modifier system

Do not build a universal expression engine. Use a limited typed `ModifierSet` supporting only current product needs, e.g.:

```text
productionMultiplier
producerMultipliers
costMultiplier
producerCostMultipliers
startingLevels
automationCostMultiplier
offlineEfficiencyBonus
offlineCapBonusSeconds
eraUnlockCostMultiplier
```

Unknown modifier/effect types are configuration errors.

## 8. Progression

### 8.1 ProgressionSystem responsibilities

- producer unlock/build eligibility;
- milestone detection;
- Breakthrough eligibility;
- Era eligibility/transitions;
- automation availability;
- Robots Built thresholds;
- Reboot availability;
- Next Goal resolution;
- first-time progression events.

Automation may remove labor but may not automatically choose producer investments, Breakthroughs, Era transitions, Reboot timing or permanent upgrades.

### 8.2 Robots Built economy

Robots Built is cumulative run progression, not a spendable currency and not individually modeled.

Baseline:

```text
robotsBuiltPerSecond = 0.005 × RobotLineLevel
```

Thresholds:

- 1 — First Robot event;
- 10 — Factory Control eligibility;
- 100 — Automated Cell eligibility;
- 1,000 — Advanced Robotics eligibility.

Internally maintain fractional progress in a float and display the floored count to avoid progress loss across sessions.

### 8.3 Next Goal

`NextGoalSystem` returns a small value object such as:

```text
Goal
- id
- type
- titleKey
- targetId
- currentValue
- requiredValue
- rewardKey
- focusTarget
```

UI displays it and may request camera focus using `focusTarget`. Goal logic must never be hardcoded in screen scripts.

## 9. Data-Driven Architecture

### 9.1 Source of truth choice

**JSON is the authoritative source for gameplay/balancing configuration.**

Godot Resources/scenes are used for Godot-native presentation references and authored assets.

Rationale:

- easy Git diffs;
- Codex-friendly generation/editing;
- headless simulation support;
- engine-independent inspection;
- explicit schema validation;
- no fragile scene serialization for balancing;
- simple localization-key separation.

### 9.2 Directory model

```text
data/
├── economy/
│   ├── producers.json
│   ├── milestones.json
│   ├── breakthroughs.json
│   ├── eras.json
│   ├── robots.json
│   ├── prestige.json
│   ├── permanent_upgrades.json
│   ├── boosts.json
│   └── offline.json
├── progression/goals.json
├── monetization/
│   ├── rewarded.json
│   └── shop_offers.json
├── presentation/visual_states.json
├── analytics/events.json
└── balancing/pacing_targets.json
```

### 9.3 Typed runtime configs

JSON is parsed into typed GDScript configuration classes. Domain code should prefer `producer.base_cost` over raw dictionary indexing.

### 9.4 Config validation

Validation pipeline:

```text
parse
→ structural/schema validation
→ cross-reference validation
→ semantic validation
→ typed configuration repository
```

Hard errors include duplicate IDs, unknown referenced IDs, non-positive costs, invalid growth, duplicate milestones, prerequisite cycles, invalid modifier/effect types, invalid offline values and missing required presentation bindings.

### 9.5 Data vs rules

Parameters are data; fundamental algorithms are code.

Good:

```text
baseCost, growth = DATA
geometric pricing rule = CODE
```

Rejected:

```text
"formula": "base * pow(growth, level)"
```

No dynamic expression DSL in MVP.

### 9.6 Version semantics

Keep distinct:

- `gameVersion` — product release;
- `saveVersion` — persistence schema;
- `contentVersion` / `economyVersion` — configuration baseline;
- Android `versionCode` — Play build number.

## 10. Large Numbers

MVP economic values use 64-bit floating-point behavior available through Godot numeric types; levels and discrete counts use integers.

Do not build a custom BigNumber system for the MVP. Centralize arithmetic/formatting enough that a mantissa+exponent representation can be introduced later if post-MVP eras exceed practical float precision.

Number presentation uses compact notation (`K`, `M`, `B`, `T`, `Qa`, `Qi`, …), typically 3–4 significant digits.

## 11. Simulator

### 11.1 Non-negotiable rule

The simulator is not a second economy implementation.

```text
Same JSON
+ Same GameState
+ Same Economy Core
+ Same Progression Core
= Runtime and Simulator
```

### 11.2 Simulator API

Conceptual capabilities:

- `advance_seconds(seconds)`;
- `advance_until(condition)`;
- `execute_command(command)`;
- `go_offline(seconds)`;
- `collect_offline()`;
- metrics/event trace recording.

### 11.3 Analytical stepping

When production is constant between decisions:

```text
timeUntilAffordable =
(requiredCost - currentIO) / currentProductionPerSecond
```

Jump directly to the next relevant decision/event. Never simulate hours at frame rate.

### 11.4 Strategies

Required simulation strategies:

- Active;
- Normal;
- Passive;
- Optimized;
- Scripted/custom.

Strategies select commands through the same interfaces as runtime. They may not mutate GameState directly.

### 11.5 Regression metrics

Track at minimum:

- first meaningful milestone;
- Auto Feeder;
- Assembly Station;
- First Robot;
- Robotic Logistics;
- Robot Line / Era II;
- Factory Control;
- Automated Cell;
- Robotics Complex;
- first Reboot;
- AI Cores at Reboot;
- longest meaningful-event gap.

Current pacing target windows are defined in `ECONOMY.md` / `pacing_targets.json` and are treated as balancing assertions, not hardcoded constants.

### 11.6 CLI

Expected commands:

```text
godot --headless --path . --script tools/config/validate_config.gd
godot --headless --path . --script tools/simulation/simulate.gd --all
```

CI wrappers should provide stable PowerShell commands for the Windows-first development environment.

## 12. 3D Presentation Architecture

### 12.1 One persistent evolving factory

MVP uses one 3D industrial site, not separate Era maps. The opening Workshop remains physically identifiable in Robotics Complex.

### 12.2 FactoryWorld

Recommended composition:

```text
FactoryWorld
├── WorldEnvironment
├── LightingRoot
├── FactorySite
│   ├── WorkshopFoundation
│   ├── ProducerZones
│   │   ├── FabricatorZone
│   │   ├── AssemblyZone
│   │   ├── RobotLineZone
│   │   ├── AutomatedCellZone
│   │   └── AdvancedRoboticsZone
│   ├── SharedLogistics
│   ├── FutureZones
│   └── EnvironmentProps
├── RobotPopulation
├── WorldVFX
├── InteractionRoot
├── CameraRig
└── FactoryPresentationController
```

Each producer zone is its own composable scene.

### 12.3 Presentation synchronization

At scene load:

```text
FactoryPresentationController.sync_from_state(state)
```

During play, incremental updates consume domain events. The scene must always be reconstructible from GameState + config.

### 12.4 VisualStateResolver

Economic/progression state is converted to a presentation descriptor:

```text
VisualStateDescriptor
- producerId
- milestoneTier
- automationActive
- eraId
- technologyVariant
- activityTier
```

The economy never references `.tscn` paths.

### 12.5 Producer milestone visuals

Each zone supports Lv1 / Lv10 / Lv25 / Lv50 / Lv100 through additive/replacement modules. Example structure:

```text
FabricatorZone
├── Base_Lv1
├── Module_Lv10
├── Module_Lv25
├── Module_Lv50
├── Module_Lv100
└── Automation_AutoFeeder
```

No unique model is required for every level.

### 12.6 Era progression

Environment progression is additive:

```text
Era1Modules
Era2Expansion
Era3Expansion
Era4Teaser
```

AI Megafactory is teaser-only in MVP.

## 13. Camera and World Interaction

### 13.1 Camera rig

Recommended hierarchy:

```text
CameraRig
└── PivotRoot
    └── YawPivot
        └── PitchPivot
            └── Camera3D
```

Logical camera state:

- focus target/pivot;
- yaw;
- pitch;
- distance.

### 13.2 Gesture model baseline

- one-finger drag → orbit/rotate;
- two-finger pinch → zoom;
- two-finger translation → pan;
- tap → select producer;
- double-tap → optional, not required for MVP.

UI consumes input first. World/camera input receives only unconsumed touches.

### 13.3 Bounds

Yaw, pitch, zoom and pan are bounded. Exact values are intentionally not frozen until the real-device camera spike. Bounds expand as the factory expands through Eras.

Auto-focus transitions are interruptible immediately by player input.

### 13.4 Interaction

Each producer zone exposes a simple interaction collider/Area3D carrying `producerId`. Tap performs a camera raycast and selects the ID. Use simple boxes/capsules/convex shapes; detailed mesh colliders are unnecessary.

Selection highlight should prefer a cheap floor/base indicator and emissive emphasis. Outline shaders are optional only if visually clean and inexpensive.

## 14. Robots and Conveyor Presentation

### 14.1 Robots

Robots are visual. `Robots Built = 1,000+` does not imply 1,000 live nodes.

Use:

- `RobotPopulationController`;
- instance pool;
- predefined routes;
- `Path3D` / `PathFollow3D` where suitable;
- lightweight animation variation;
- population tiers.

Do not use NavigationAgent3D unless a future concrete need appears. No worker job AI or autonomous decision system in MVP.

Art baseline around 1,000 Robots Built is roughly 10–14 visible live robots plus optional background fakes. Profile 1 / 8 / 14 / 20 / 30 robot cases on device.

### 14.2 Conveyors/items

Conveyor items are pooled visual tokens only. No authoritative intermediate-resource simulation. Assembly may be faked through occlusion/state swaps.

## 15. Performance Strategy

Target mid-range Android first.

### 15.1 Runtime goals

- preferred: stable 60 FPS;
- acceptable fallback on weaker supported devices: stable 30 FPS;
- stable frame pacing is more important than unstable peak FPS.

### 15.2 Practices

- cap live robots;
- reuse meshes/materials;
- limited real-time dynamic lights;
- emissive indicators instead of many lights;
- limited transparent particles;
- object pooling for robots/visual items;
- minimal dynamic shadows;
- MultiMesh only where repeated geometry warrants it;
- LOD/occlusion only after profiling shows value.

### 15.3 Worst-case benchmark

Create a debug scenario containing:

- Era III Robotics Complex;
- all five producers visible at high milestone state;
- active automation;
- baseline maximum visible robots;
- conveyors;
- Overclock VFX;
- HUD.

Record FPS/frame time, CPU/GPU bottleneck, memory and draw calls on a representative mid-range Android device.

## 16. Asset Pipeline

### 16.1 Approved external stack

Primary runtime sources:

- `KENNEY_FACTORY_01` — core factory;
- `QUAT_ROBOT_01` — primary animated robot;
- `KENNEY_MODSPACE_01` — limited advanced technology use;
- `KENNEY_UI_SCIFI_01` — raw UI component library;
- `KENNEY_PARTICLE_01` — small VFX subset.

Candidate gap fillers remain unimported until a concrete gap exists.

### 16.2 Runtime import rule

Do not import complete libraries. Only selected assets required by the game enter runtime/source control.

Normalize 3D runtime assets to GLB where practical. For Quaternius animated robot content, verify rig/animations in Blender and export a controlled GLB. Avoid storing duplicate FBX/OBJ/GLB copies of the same runtime model.

### 16.3 Source documentation

Maintain `docs/licenses/ASSET_SOURCES.md` recording:

- internal asset ID;
- original pack/source URL;
- author;
- license;
- commercial-use status;
- modifications;
- runtime destination.

### 16.4 Project identity assets

MVP custom requirements include:

- AI Core model + icon;
- Automata decals/numbering/warnings;
- coherent 10–15 icon UI set;
- Founder Robot / UNIT 0001 if mobile readability passes;
- logo before store production lock;
- Advanced Robotics hero module only if approved packs fail to create enough silhouette identity.

## 17. UI Architecture

### 17.1 Rule

UI receives view models/snapshots and submits commands. It does not own GameState or duplicate economy formulas.

### 17.2 Main components

```text
UIRoot
├── HUD
│   ├── ResourceBar
│   ├── ProductionRate
│   ├── NextGoal
│   └── Overclock
├── ProducerPanel
├── BreakthroughPanel
├── PermanentUpgradePanel
├── OfflineReport
├── RebootScreen
├── ShopPanel
├── SettingsPanel
└── ToastLayer
```

### 17.3 View models

Example `ProducerPanelViewModel`:

- producer ID/name key;
- level;
- production/sec;
- next-level cost;
- ×10/×MAX cost;
- affordability;
- automation status;
- next milestone/progress.

All values come from state/config/shared economy functions.

## 18. Localization, Audio and Settings

### 18.1 Localization

All visible strings use localization keys. Numeric/economic config does not embed localized prose.

Include keys for:

- producers;
- Breakthroughs;
- upgrades;
- UI;
- shop;
- errors;
- system messages.

Use a pseudo-locale/debug long-string mode to catch rigid UI layouts.

### 18.2 Audio

Keep architecture lightweight:

```text
AudioService
- music
- SFX
- settings
```

High-value moments: purchase, milestone, robot, Era transition, Overclock, Reboot.

### 18.3 Settings

MVP settings:

- music;
- SFX;
- vibration;
- language if user-selectable;
- quality only if device testing justifies it.

No PC-style graphics menu.

## 19. Boost System

All temporary production boosts use one system.

Conceptual state:

```text
Boost
- id
- source
- multiplier
- remainingActiveSeconds
- cooldown/eligibility metadata where relevant
```

Current baselines:

- Free Overclock: ×2, 60 s active, 240 s cooldown, non-stacking;
- Rewarded Extended Overclock: ×2 for 10 min, max 3/24h, minimum 60 min interval;
- Founder Factory Surge: ×2 for 30 min, two initial charges from pack.

Effective temporary production multiplier is the highest applicable active multiplier, not multiplication of overlapping boosts. Free Overclock is suspended while Extended Overclock is active and resumes afterward.

For MVP persistence, active gameplay boost timers pause when the app is genuinely backgrounded; temporary boosts do not contribute to offline production or Prestige Power.

## 20. Persistence

### 20.1 Save format

Use versioned local JSON.

```text
SaveEnvelope
- saveVersion
- gameVersion
- contentVersion
- savedAtUtc
- integrity metadata
- payload
```

Payload contains run, meta, boost, monetization, settings and lifetime state.

### 20.2 Atomic write strategy

```text
serialize
→ validate payload
→ write save_temp.json
→ flush/close
→ verify readable
→ rotate current main to backup
→ promote temp to main
```

Never destroy the last valid save before validating the replacement.

### 20.3 Recovery

Load order:

1. valid `save_main.json`;
2. valid `save_backup.json` and recover main;
3. fresh game only if neither is valid.

### 20.4 Save triggers

Immediate critical save after:

- Reboot;
- permanent upgrade purchase/respec;
- durable entitlement grant/reconciliation;
- other permanent-value transactions.

Dirty/debounced save after ordinary gameplay changes, plus periodic dirty save approximately every 20–30 seconds and lifecycle save on app background/suspend.

Do not depend on app-close callbacks.

### 20.5 Save migration

Every save has `saveVersion` from the first persistent prototype.

Sequential migration model:

```text
v1 → v2 → v3 → ... → current
```

Each migration transforms a valid version N raw save into valid N+1 and is independently fixture-tested.

Balancing changes do not automatically require save migration. Internal ID renames/removals do.

### 20.6 Integrity/anti-editing

Optional checksum can detect accidental corruption; it is not a security boundary. Do not build encryption/obfuscation as fake anti-cheat for a local single-player MVP.

## 21. Time Handling and Offline Progression

### 21.1 TimeService

Use two clocks:

- monotonic/session time while app is active;
- UTC wall clock between sessions/processes.

Store UTC timestamps, never locale-formatted dates.

### 21.2 Offline calculation

Authoritative baseline:

```text
offlineEarnings =
    automatedProductionPerSecond
    × min(validatedTimeAway, 8h)
    × 0.75
```

Only automated producers are eligible. Offline may also progress Robots Built when Robot Line is automated and cumulative production statistics where applicable.

Offline must never:

- buy levels;
- build producers;
- buy Breakthroughs;
- auto-enter major Eras;
- Reboot;
- spend AI Cores;
- choose permanent upgrades.

### 21.3 Analytical calculation

Compute from the saved state/config; never simulate frame-by-frame.

### 21.4 Offline report transaction

Loading after absence creates a `PendingOfflineReport` containing a unique `reportId`, elapsed/effective time, eligible production, IO reward and Robots Built delta.

Calculating the report does not mutate GameState. Collection is a separate idempotent command.

A pending report is saved so crashes do not duplicate or erase the opportunity. Resolve the pending report before allowing Reboot to avoid ambiguous cross-run rewards.

### 21.5 Clock manipulation compromise

Without a backend:

- negative/backwards elapsed time → offline 0, log suspicious time;
- huge forward jumps → normal economic cap still limits reward to 8h;
- no player punishment for timezone/clock anomalies;
- monotonic time prevents active-session boost/cooldown manipulation from ordinary wall-clock changes.

This is sufficient for a local idle MVP.

## 22. Reboot Civilization and Permanent Progression

### 22.1 Prestige Power

```text
PrestigePower =
highest sustained base production/sec reached in current Civilization
```

Include durable/gameplay production contributors; exclude temporary boosts such as Free Overclock, rewarded Extended Overclock and Founder Factory Surge.

### 22.2 AI Core formula

Current baseline:

```text
AI Cores = floor(5 × sqrt(PrestigePower / P0))
```

`P0` is generated/recorded by the reference simulation around the first viable Reboot state and lives in configuration, not save data.

### 22.3 Reboot transaction

Preview is pure and non-mutating. On confirmation:

1. validate eligibility;
2. recalculate reward from current state;
3. clone/build transaction state;
4. grant AI Cores;
5. increment Civilization;
6. create fresh RunState;
7. retain MetaState/account unlocks;
8. commit new GameState;
9. perform critical atomic save;
10. only then emit `RebootCompleted` and begin presentation.

If critical save fails, do not present Reboot as completed.

### 22.4 Permanent upgrades

Current branches:

- Production;
- Automation;
- Expansion.

Config supports IDs, ranks, costs, prerequisites and typed effects. Avoid a generic skill-tree engine. Purchasing permanent upgrades is a critical persistent transaction with immediate save.

## 23. Platform Services and Monetization Boundary

### 23.1 Architecture

```text
Gameplay / UI
      │
      ▼
Project rules / transactions
      │
      ▼
Platform service interface
      │
      ▼
Provider implementation
```

### 23.2 AdsService

Conceptual interface:

- initialize;
- availability check;
- preload rewarded;
- request rewarded by internal placement ID.

MVP internal placement IDs:

- `rewarded.offline_double`;
- `rewarded.extended_overclock`.

AdsService reports a validated result; it never grants IO/boosts directly.

There is intentionally no interstitial gameplay API in MVP.

### 23.3 Reward authority and idempotence

A rewarded transaction requires:

1. valid gameplay opportunity;
2. eligible monetization rule;
3. AdMob reward callback, not just ad close;
4. unique request/opportunity ID;
5. domain transaction exactly once;
6. save where necessary.

Duplicate callbacks are no-ops after the transaction is consumed.

### 23.4 Double Offline

Baseline:

- minimum qualifying absence: 30 min;
- max 3 rewarded claims per rolling 24h;
- multiplier ×2;
- free reward remains the full normal 75% offline reward.

If ad is unavailable/fails, normal collection remains available.

### 23.5 Extended Overclock

Baseline:

- ×2 production;
- 10 min;
- max 3 per 24h;
- minimum 60 min between uses.

Eligibility rules live in Project Automata monetization logic, not AdsService.

### 23.6 PurchaseService

Common interface:

- initialize/query products;
- purchase;
- restore/reconcile purchases.

Provider implementations:

- Google Play Billing Android;
- StoreKit iOS;
- mocks for tests/editor.

Gameplay does not know purchase tokens, acknowledgement internals or StoreKit classes.

### 23.7 Founder’s Factory Pack

Single non-repeatable durable entitlement. Current product direction:

- Founder robot visual identity;
- two Factory Surge charges;
- no permanent production multiplier;
- no AI Cores;
- no premium currency.

Track entitlement ownership separately from “initial consumable rewards granted”. Restore must never grant another two Surges.

Store-localized price is always displayed from the platform product metadata, not hardcoded UI text.

### 23.8 Offline entitlement cache

A last-known valid durable entitlement remains active offline. Store reconciliation can restore missing local ownership, but network failure must not remove a previously valid entitlement.

### 23.9 Platform overlays

Ads/IAP fullscreen native UI can trigger focus/lifecycle callbacks. `PlatformLifecycleCoordinator` distinguishes a platform overlay from a genuine user absence so a 30-second ad does not create an offline Factory Report.

## 24. Analytics and Crash Reporting

### 24.1 AnalyticsService

```text
AnalyticsService.track(eventId, params)
```

Domain events map through an `AnalyticsEventMapper`; domain logic does not depend on a provider.

Central event catalogue prevents inconsistent strings/parameter names.

Core events include:

- producer unlock/milestone;
- Breakthrough purchase;
- Era reached;
- First Robot;
- Reboot preview/completed;
- offline report/collection;
- rewarded opportunity/start/completion/failure;
- purchase start/completion/cancel/failure/restore.

Provider is not locked for initial development. Start with Debug/NoOp providers, select production provider before release analytics validation.

Analytics failure never blocks gameplay.

### 24.2 Crash reporting

Keep a light abstraction (`record_error`, context, breadcrumb) but do not build a custom crash platform. Provider choice is a release-stage decision.

## 25. Consent and Privacy Integration

AdMob integration must support consent handling (UMP where applicable). iOS may additionally require ATT depending on actual tracking behavior/provider configuration.

Consent logic belongs to a platform/privacy coordinator. Gameplay continues if ads are unavailable; never make core progression depend on consent or network availability.

Privacy/store compliance is finalized with QA/Release using the exact release SDK configuration.

## 26. Android

### 26.1 Build

- Gradle-enabled Godot Android export;
- target API 36 for submissions from 2026-08-31;
- verify all native/plugin libraries are 16 KB page-size compatible;
- AAB for Play production;
- stable package identifier chosen once before store setup;
- signing credentials external to Git.

### 26.2 Min SDK

Do not freeze `minSdk` independently of pinned plugin/SDK requirements. Google Play Billing plugin 3.2+ raised practical requirements (including minSdk 23 in that release line). Final minSdk is chosen during AUT-004/AUT-005 after all pinned native dependencies are known, then recorded in dependencies/build docs.

### 26.3 Release testing

At minimum through Play Internal Testing:

- install from Play;
- save/relaunch;
- background/kill/offline;
- rewarded placement;
- Founder purchase;
- purchase pending/cancel where testable;
- entitlement reconciliation;
- 16 KB native-library validation.

## 27. iOS

Architecture must not block iOS, but final native validation requires macOS/Xcode.

Windows can implement and test:

- economy;
- simulator;
- UI;
- 3D;
- save/offline;
- platform interfaces;
- mocks.

Mac/iPhone required for:

- Godot iOS export/Xcode;
- signing/provisioning;
- AdMob iOS native smoke tests;
- StoreKit sandbox/restore;
- ATT/consent validation;
- TestFlight/App Store submission.

StoreKit provider remains a medium-risk integration because the current community plugin API is still described as evolving. Keep all StoreKit specifics isolated.

## 28. Error Handling

External/system errors must degrade safely.

| Failure | Required behavior |
|---|---|
| Main save corrupt | attempt backup; never silently overwrite valid backup |
| Backup corrupt too | new game with explicit log/recovery path |
| Ad unavailable/load/show fail | normal gameplay/reward remains available |
| Duplicate ad callback | reward applied at most once |
| Purchase cancelled | no state change; normal user-facing status |
| Purchase pending | no entitlement until confirmed |
| Duplicate purchase callback | idempotent no-op after processed transaction |
| Restore fail/no network | keep last-known valid local entitlement |
| Invalid/backwards timestamp | offline reward clamped to zero for negative interval |
| Huge time jump | normal offline cap applies |
| Missing visual asset | log and use safe visual fallback; economy continues |
| Analytics failure | ignore for gameplay; bounded logging only |
| Reboot critical save fail | do not present transaction as complete |

## 29. Logging

Minimal categories:

- `GAME`
- `ECONOMY`
- `PROGRESSION`
- `SAVE`
- `MIGRATION`
- `OFFLINE`
- `TIME`
- `REBOOT`
- `ADS`
- `IAP`
- `ENTITLEMENT`
- `ANALYTICS`
- `CAMERA`
- `ASSET`

Debug builds may be verbose. Production should retain only useful warnings/errors and limited lifecycle/business diagnostics without sensitive data.

## 30. Repository Structure

```text
project-automata/
├── project.godot
├── assets/
│   ├── factory/
│   ├── robots/
│   ├── advanced/
│   ├── ui/
│   ├── vfx/
│   ├── audio/
│   └── branding/
├── data/
│   ├── economy/
│   ├── progression/
│   ├── monetization/
│   ├── presentation/
│   ├── analytics/
│   └── balancing/
├── scenes/
│   ├── app/
│   ├── world/
│   ├── robots/
│   ├── ui/
│   └── effects/
├── scripts/
│   ├── app/
│   ├── config/
│   ├── state/
│   ├── runtime/
│   ├── commands/
│   ├── events/
│   ├── economy/
│   ├── progression/
│   ├── boosts/
│   ├── offline/
│   ├── persistence/
│   ├── time/
│   ├── presentation/
│   ├── ui/
│   ├── platform/
│   ├── audio/
│   └── localization/
├── addons/
├── tests/
│   ├── unit/
│   ├── simulation/
│   ├── integration/
│   ├── scene/
│   ├── fixtures/
│   └── baselines/
├── tools/
│   ├── simulation/
│   ├── config/
│   ├── assets/
│   └── ci/
└── docs/
```

Naming:

- GDScript/scenes: `snake_case` filenames;
- classes: `PascalCase`;
- data IDs: stable `snake_case`;
- constants: `UPPER_SNAKE_CASE`.

Avoid generic `utils/` or `common/` dumping grounds.

## 31. Testing Strategy

### 31.1 Unit tests

Mandatory critical domains:

- producer cost and bulk purchase math;
- production formula;
- milestones;
- Breakthrough conditions/effects;
- modifiers;
- boosts/stacking;
- Next Goal;
- offline calculation;
- Prestige Power;
- AI Core formula;
- permanent upgrades.

Use approximate comparisons for floating calculations and strict equality for discrete state.

### 31.2 Simulation tests

Run Active, Normal, Passive and Optimized first-civilization scenarios. Compare against data-defined pacing windows and baseline reports. Flag dead-zone candidates.

### 31.3 Integration tests

- runtime + economy/progression;
- save/load;
- migrations;
- offline report/collection;
- Reboot transaction;
- permanent upgrade transaction;
- mocked rewarded flow;
- mocked purchase/restore flow.

### 31.4 Scene tests

- world/producer scenes instantiate;
- no missing scripts/resources/NodePaths;
- VisualStateResolver activates correct modules;
- interaction colliders expose producer IDs;
- camera numeric clamps;
- robot scene has required animation/path integration.

### 31.5 Device tests

Human/device validation remains mandatory for:

- camera feel;
- touch conflicts;
- readability/safe areas;
- robot readability;
- worst-case performance;
- Android lifecycle;
- AdMob native lifecycle;
- Google Play Billing;
- iOS native integrations when activated.

No automated test may claim that touch camera “feels good”.

## 32. CI and Build Automation

### 32.1 Standard developer commands

Provide stable PowerShell wrappers:

```text
.\tools\ci\validate.ps1
.\tools\ci\test.ps1
.\tools\ci\simulate.ps1
.\tools\ci\check.ps1
.\tools\ci\build_android.ps1
```

`check` = validate + automated tests + mandatory simulation regressions.

### 32.2 CI minimum

`ci.yml` on PR/push:

- checkout;
- pinned Godot setup;
- import/parse;
- config validation;
- unit/integration/scene tests;
- simulation regression.

`android-build.yml` on main/manual/release-relevant changes:

- Android debug build;
- artifact upload.

Any change to `addons/`, platform code, export configuration or Android native integration requires an Android build gate.

Do not build an elaborate production deployment pipeline before manual release flow is stable.

### 32.3 Secrets

Never commit:

- keystores/passwords;
- App Store signing secrets;
- service-account credentials;
- private API keys.

Public app/ad/product IDs remain central environment-specific configuration, not scattered constants.

## 33. Git and Codex Development Rules

Use `main` + short-lived feature branches. Keep `main` buildable with passing automated checks.

A Codex task must:

1. inspect repository state;
2. read relevant source-of-truth docs;
3. preserve architecture;
4. avoid unrelated refactors;
5. avoid new dependencies without justification;
6. add/update relevant tests;
7. run required validation/build commands;
8. report changed files, assumptions and remaining risks.

Codex must not make product decisions or silently alter `GAME_DESIGN`, `ECONOMY`, `MONETIZATION` or `ART_DIRECTION` decisions.

## 34. Reuse Strategy for Mobile Game Factory

Likely future reusable candidates after Automata proves them:

- ConfigLoader/validation pattern;
- SaveService + migrations;
- Time/offline foundations where generic;
- AdsService/provider boundary;
- PurchaseService/EntitlementService;
- AnalyticsService;
- Audio/localization bootstrap;
- test and CI bootstrap.

Automata-specific systems remain local unless reuse is demonstrated:

- producer economy;
- Reboot Civilization;
- AI Cores;
- RobotPopulationController;
- specific factory presentation.

No separate “Factory SDK” is built during Automata MVP.

## 35. Technical Spikes and Gates

### Gate A — Android platform viability — BLOCKING

Godot Android export + AdMob rewarded + Play Billing test. Failure can reopen engine choice.

### Gate B — 3D asset pipeline

Kenney Factory + Quaternius Robot imported and rendered on Android. Validate materials, scale, rig/animation and memory.

### Gate C — camera — PRODUCT/UX BLOCKING

Real-device rotate/pan/zoom/tap/focus test. If free manipulation harms readability/UX, progressively constrain the camera rather than immediately reverting to fixed view.

### Gate D — robot readability/performance

Quaternius robot, Founder variant concept and 1/8/14/20+ live robots on device.

### Gate E — worst-case visual

Era III/high-level factory benchmark before final art polish.

### Gate F — iOS native path

Before iOS release: export, AdMob, StoreKit sandbox/restore, lifecycle and consent on Mac/iPhone.

## 36. Known Risks

| Risk | Level | Mitigation |
|---|---|---|
| Godot mobile plugins | Medium | pin versions; adapters; Android viability spike |
| StoreKit plugin maturity | Medium | isolate provider; iOS gate; alternative native wrapper possible |
| Camera touch UX | Medium | early real-device spike; bounded fallback modes |
| 3D performance | Medium | asset discipline; robot cap; worst-case benchmark |
| Save corruption | Medium | atomic writes; backup; versioned migrations |
| Offline double grants | Medium | pending report ID + idempotent transaction |
| Balancing dead zones | High product risk | shared simulator + pacing regression |
| Scope creep | High product risk | source-of-truth status + Codex task boundaries |
| Monetization dependence | Product risk | free baseline preserved; bounded rewarded opportunities |

## 37. POST-MVP Architecture Considerations

Deferred systems must not contaminate MVP implementation:

- Factory Rush / leaderboards / Play Games;
- AI Strategy;
- full AI Megafactory;
- orbital/planetary/stellar/Dyson content;
- premium currency;
- battle pass/subscription;
- cloud save;
- backend receipt verification;
- large live-offer system;
- extensive cosmetics/live events.

Factory Rush, if built, must use normalized competitive state that disables AI Core effects, permanent progression, paid/rewarded boosts and Founder Surges.

## 38. Technical Definition of MVP Success

The architecture is successful when all of the following are true:

1. A producer cost/rate/milestone/Breakthrough/prestige parameter can be changed in JSON and immediately revalidated/simulated without changing gameplay scripts.
2. The complete economic game can run headless without 3D scenes.
3. Save/offline/Reboot behavior is deterministic and covered by automated tests.
4. The visible factory can be unloaded/rebuilt from GameState.
5. Ads/IAP can be replaced/mocked without changing core gameplay logic.
6. Android builds remain continuously verifiable.
7. Codex tasks can implement features without re-deciding architecture.
8. The project remains small enough for one developer to understand end-to-end.

## 39. Technical Gate Recommendation

**Recommendation: TECHNICAL GO, conditional only on the Android Godot monetization viability spike.**

No currently identified issue justifies changing the approved game, economy or art scope. The primary implementation risks are contained by early spikes and explicit service boundaries.

The recommended next step after this Technical Design is to execute `CODEX_PLAN.md` beginning with project/bootstrap and Android viability tasks, then proceed through deterministic economy, simulation, persistence, vertical slice, full F2P core, monetization and release hardening.

---

## Appendix A — Current External Technical Validation (2026-08-15)

Primary external references verified during Technical Design:

- Godot download archive: Godot 4.6.3 stable, 2026-05-20 — https://godotengine.org/download/archive/
- Godot AdMob integration — https://github.com/godot-sdk-integrations/godot-admob
- Godot Google Play Billing — https://github.com/godot-sdk-integrations/godot-google-play-billing
- Godot StoreKit 2 — https://github.com/godot-sdk-integrations/godot-storekit2
- Android target API requirements — https://developer.android.com/google/play/requirements/target-sdk
- Android 16 KB page-size requirements — https://developer.android.com/guide/practices/page-sizes

Plugin versions must be pinned in the repository once AUT-005 passes. Do not silently upgrade them during unrelated Codex tasks.
