# Project Automata — ART_DIRECTION

**Status:** Art Direction complete — ready for Orchestrator handoff  
**Date:** 2026-08-15  
**Phase owner:** Art Director / Asset Researcher  
**Related sources of truth:** `STUDIO_CONTEXT.md`, `FACTORY_WORKFLOW.md`, `PROJECT_AUTOMATA_BRIEF.md`, `GAME_DESIGN.md`, `ECONOMY.md`, `MONETIZATION.md`, `ASSET_MANIFEST.md`

> **Primary visual objective:** the player must feel, at a glance, that a nearly empty manual workshop has become a large autonomous robotics factory.

The art strategy optimizes:

**Visual Hook × Readability × Production Speed × Asset Reuse × Consistency**

The MVP covers:

**Manual Workshop → Automated Factory → Robotics Complex**

`AI Megafactory` is a visual teaser only. Orbital, planetary, stellar and megastructure content is POST-MVP.

---

## 1. Approved Visual Direction

### 1.1 Rendering direction

**APPROVED: 3D low-poly stylized industrial factory.**

The game uses real 3D geometry and a player-manipulable camera. It is not presented as a flat 2D or fixed-isometric game.

The 3D direction is chosen because it provides:

- stronger tactile and marketing appeal than flat 2D for this concept;
- satisfying inspection of machines and robots;
- efficient reuse of existing modular 3D asset packs;
- strong visual evolution through spatial expansion rather than bespoke illustrations;
- simple recolor/material variants;
- reusable modular construction for producer milestones;
- strong store screenshots and short-form video material.

### 1.2 Camera

**APPROVED: player-manipulable 3D camera with controlled limits.**

The player may rotate, pan and zoom enough to enjoy inspecting the factory.

The camera must nevertheless remain constrained so that:

- producer silhouettes stay readable;
- mobile UI remains usable;
- the player cannot reach visually broken or empty angles;
- excessive zoom cannot expose low-value asset detail;
- performance and clipping remain predictable;
- key unlock areas can still be automatically framed.

Recommended implementation direction:

- three-quarter default view;
- moderate perspective rather than extreme FOV;
- limited vertical rotation;
- bounded pan area that grows with the factory;
- min/max zoom;
- optional short automated focus/recenter moments for major unlocks;
- player control returned immediately after those moments.

The Technical Lead owns exact camera values.

---

## 2. Visual Pillars

### 2.1 Visible Growth

The factory itself is the primary progression display.

The player should be able to understand progression from screenshots without reading the UI.

The visual sequence is:

**one machine → small workshop → connected line → industrial system → robot population → autonomous robotics complex**

### 2.2 Automation Is Visible

Automation must create visible change:

- feeders activate;
- conveyors begin moving;
- robotic arms appear;
- robots enter the scene;
- machine cycles synchronize;
- logistics become denser;
- advanced indicators and control systems appear.

Core rule:

> **The less manual work the player performs, the more of the screen should appear to work by itself.**

### 2.3 Modular Evolution

Producer levels do not require unique models per level.

Major visual states are built from reusable modules:

- additional machine modules;
- conveyors;
- storage;
- robotic arms;
- duplicate stations;
- gantries;
- control panels;
- light/emissive states;
- robots;
- material variants.

### 2.4 Industrial Continuity

The game must not become visually disconnected between eras.

The original Workshop remains physically recognizable later in the run. The player can look back and identify the first Fabricator inside the much larger factory.

### 2.5 Asset-First Identity

Existing assets form the production base, but Project Automata must not look like an unmodified asset pack.

Identity comes primarily from:

- consistent material palette;
- controlled technological color progression;
- lighting;
- decals and numbering;
- producer silhouettes;
- camera framing;
- robot identity;
- AI Core iconography;
- VFX language;
- coherent UI.

---

## 3. Art Style

### 3.1 Geometry

Favor:

- clean low-poly geometry;
- chunky readable silhouettes;
- modular industrial forms;
- clear moving parts;
- simplified props;
- limited material count;
- reusable structural elements.

Avoid:

- photorealism;
- heavy weathering everywhere;
- dense micro-detail;
- complex character rigs;
- bespoke high-poly machinery;
- visually noisy industrial realism.

### 3.2 Material language

Materials should appear manufactured rather than realistic:

- painted metal;
- dark structural metal;
- light industrial panels;
- concrete;
- emissive strips/indicators;
- small glass/screen accents where useful.

Textures should stay simple and coherent with the low-poly asset base.

---

## 4. Palette Direction

Exact production color values remain a later implementation task. The approved color architecture is:

### 4.1 Neutral base

- graphite;
- steel blue-gray;
- concrete gray;
- off-white industrial panels.

### 4.2 Mechanical accent — Amber / Safety Orange

Used for:

- mechanical activity;
- moving components;
- industrial safety details;
- construction feedback;
- Overclock;
- early automation emphasis.

### 4.3 Automation / AI accent — Cyan

Used for:

- automation indicators;
- robot sensors;
- Factory Control;
- Robotics Complex technology;
- AI Cores;
- Reboot scan;
- permanent AI technology.

Cyan is intentionally limited in early gameplay and becomes more prominent as technology advances.

### 4.4 Error / danger — Red

Red should be reserved for actual warnings/errors. It is not a general progress color.

### 4.5 Progression through color

The visual progression is approximately:

**mechanical gray + amber → structured industrial gray + amber/cyan → graphite/off-white + cyan with residual amber mechanics**

Color must never be the only signal of progression. Physical module changes and silhouette changes remain mandatory.

---

## 5. Factory Architecture

### 5.1 One Evolving Factory

**APPROVED: the MVP uses one evolving industrial site, not three unrelated era maps.**

The factory expands through predetermined zones. The player does not freely place machines.

The world is a controlled diorama-like industrial site implemented in full 3D.

### 5.2 Predetermined zones

The site should support five primary production zones corresponding to the five MVP producers:

1. Fabricator area;
2. Assembly Station area;
3. Robot Line area;
4. Automated Cell area;
5. Advanced Robotics Complex area.

Exact geometry belongs to Technical Design, but the player should progressively conquer more of the site.

### 5.3 Future-zone foreshadowing

Future areas should be partially visible before unlock through:

- empty concrete slabs;
- locked doors;
- inactive foundations;
- barriers;
- dark structures;
- disconnected rails/conveyors;
- inaccessible halls.

New facilities should not feel like they appear from nowhere.

### 5.4 Composition density

Approximate artistic density targets:

| Progress state | Approx. visible occupation |
|---|---:|
| Opening Workshop | 15% |
| Auto Feeder | 20% |
| Assembly | 30% |
| First Robot | 35% |
| Robotic Logistics | 45% |
| Robot Line | 55% |
| Factory Control | 65% |
| Automated Cell | 75% |
| Robotics Complex | 85–90% |

These are composition guidelines, not runtime metrics.

Never fill 100% of available space. Mobile readability requires visual breathing room.

---

## 6. Era 1 — Manual Workshop

### 6.1 Fantasy

**Small production operation becoming its first autonomous system.**

### 6.2 Opening scene

The first scene should feel deliberately sparse:

- small concrete floor;
- simple industrial enclosure;
- Fabricator as the primary moving object;
- a few crates/pallets/props;
- warm industrial lighting;
- large amounts of unused space;
- little or no cyan technology language;
- no visible robot population.

The intended feeling is:

> “I have a machine in a workshop.”

### 6.3 Early visual evolution

The opening minutes must create frequent visual changes aligned with Game Design pacing:

- Fabricator upgrades;
- Auto Feeder installation;
- conveyor activation;
- Assembly Station reveal;
- first Worker Bot;
- Robotic Logistics connection.

### 6.4 Auto Feeder

First Automation is an exceptional early event.

Visual sequence:

1. feeder/conveyor module installs;
2. indicator switches on;
3. machine begins running automatically;
4. brief focus reinforces the before/after state.

Target visual duration: roughly 2–3 seconds.

### 6.5 First Robot

First Worker Bot is one of the MVP's highest-priority visual rewards.

Recommended presentation:

1. small robot bay/door opens;
2. robot activates;
3. short camera focus;
4. robot moves to the Assembly Station;
5. first work loop begins.

The robot is not a simulated economic worker. It is a visual representation of the breakthrough.

### 6.6 End-state of Era 1

By the end of Manual Workshop the space should communicate a connected production chain:

**Fabricator → feeder/conveyor → Assembly → Worker Bot → storage/logistics**

It should already look dramatically different from minute zero.

---

## 7. Era Transition I → II

**Trigger:** construction of the Robot Line, as defined by Economy/Game Design.

Do not introduce a separate “Enter Era” action.

Recommended transition:

1. existing workshop briefly settles;
2. lighting activates across an adjacent larger hall;
3. industrial door opens;
4. camera reveals the expanded factory floor;
5. Robot Line activates;
6. brief `AUTOMATED FACTORY` title.

Target visual duration: roughly 3–5 seconds.

---

## 8. Era 2 — Automated Factory

### 8.1 Fantasy

**Automated machines become an automated industrial system.**

### 8.2 Environment evolution

Compared with Era 1:

- factory footprint increases strongly;
- conveyors become longer and more numerous;
- industrial organization becomes cleaner;
- storage and logistics become structured;
- machine density rises;
- activity becomes continuous;
- lighting becomes whiter/more standardized;
- cyan control indicators begin to appear.

### 8.3 Robot Line

Robot Line is the hero facility of Era 2.

It should communicate robot production through a long animated chain containing:

- conveyor segments;
- assembly stations;
- robotic arms;
- inspection/processing points;
- finished robot output.

Actual physical robot assembly may be faked using occlusion and state swaps rather than complex per-part assembly.

### 8.4 Factory Control System

Factory Control System is a site-wide coordination upgrade, not a new giant machine.

Visual representation may include:

- network/control indicators;
- synchronized machine cycles;
- control terminal;
- updated floor routing lines;
- coordinated signal lights.

### 8.5 Automated Cell

Automated Cell should contrast strongly with Robot Line.

Robot Line is long and open. Automated Cell is compact, enclosed and dense.

Its base silhouette is a squared production cell with multiple robotic arms and integrated input/output logistics.

---

## 9. Era Transition II → III

**Trigger:** Advanced Robotics Breakthrough / Advanced Robotics Complex construction.

This transition is more important than the Era I→II reveal and can run approximately 5–7 seconds.

Recommended sequence:

1. factory lighting dims slightly;
2. a previously sealed major structure opens;
3. cyan technology lights activate;
4. new vertical infrastructure becomes visible;
5. camera frames the Advanced Robotics Complex;
6. robots resume/increase activity;
7. brief `ROBOTICS COMPLEX ONLINE` title.

---

## 10. Era 3 — Robotics Complex

### 10.1 Fantasy

**The factory builds its own workers and feels increasingly autonomous.**

### 10.2 Architectural evolution

Era 3 introduces greater verticality:

- gantries;
- overhead conveyors;
- supports;
- elevated technical modules;
- walkways;
- vertical processing structures;
- larger central machinery.

This expands perceived scale without requiring an enormous horizontal map.

### 10.3 Palette evolution

Era 3 shifts toward:

- graphite frames;
- off-white machine shells;
- cyan automation indicators;
- residual orange mechanical components.

### 10.4 Robot population

Robots now read as a population and part of the factory infrastructure rather than a singular novelty.

They may appear:

- working at stations;
- traversing predefined routes;
- entering/exiting production bays;
- leaving Robot Line;
- circulating around Advanced Robotics Complex.

No heavy worker simulation is required.

### 10.5 Historical continuity

The first Fabricator remains present and recognizable. Looking back toward the original Workshop should visually communicate how far the civilization has progressed.

---

## 11. AI Megafactory Teaser

The MVP does not contain a full fourth era.

A low-cost teaser is sufficient:

- large inaccessible door/structure;
- advanced light language;
- partial silhouette of future technology;
- AI Core/holographic motif;
- optional locked label.

Do not build a complete AI Megafactory environment for MVP.

---

## 12. Producer Visual Language

Each producer must remain distinguishable primarily through silhouette.

| Producer | Core silhouette | Visual role |
|---|---|---|
| Fabricator | compact vertical press | primitive production |
| Assembly Station | low, wide, open workstation | assisted assembly |
| Robot Line | long linear production chain | mass robot production |
| Automated Cell | compact enclosed multi-arm cell | purpose-built automation |
| Advanced Robotics Complex | building-scale vertical complex | autonomous frontier industry |

---

## 13. Milestone Visual System

Economy defines shared milestones at:

- Lv10;
- Lv25;
- Lv50;
- Lv100.

Art uses the same thresholds.

### 13.1 Common language

**Lv1 — Function exists**  
Base producer silhouette.

**Lv10 — First serious module**  
Add a feeder, arm, module, storage element or secondary actuator.

**Lv25 — Logistics/automation**  
Add conveyor/storage/robotics and stronger status lighting.

**Lv50 — Industrial scale**  
Duplicate station, expand line, add gantry or clearly increase footprint.

**Lv100 — Ultimate technological state**  
Fully integrated structure, stronger cyan technology language, maximum automation treatment and denser synchronized motion.

### 13.2 Reuse rule

A new unique model is not required for each milestone.

Milestones are compositions of reusable modules plus material/light states.

---

## 14. Producer States

### 14.1 Fabricator

**Lv1**
- compact press;
- simple output tray;
- no sophisticated logistics.

**Lv10**
- secondary module;
- stronger status indicator.

**Auto Feeder Breakthrough**
- hopper/feeder;
- input conveyor;
- autonomous machine cycle.

**Lv25**
- output conveyor;
- storage/buffer;
- connection-ready logistics.

**Lv50**
- dual fabrication module on shared base.

**Lv100**
- dual press;
- integrated feeder;
- automated input/output;
- small robotic arm;
- advanced indicators.

### 14.2 Assembly Station

**Lv1**
- low open workstation;
- trays/tools;
- visibly assisted/manual character.

**Lv10 / Worker Bot frontier**
- first robot becomes the major visual reward.

**Lv25**
- expanded work area;
- input/output belts;
- storage/logistics.

**Lv50**
- double assembly station;
- robotic arm.

**Lv100**
- partially enclosed dual station;
- robot + arms;
- synchronized conveyors;
- cyan state indicators.

### 14.3 Robot Line

**Lv1**
- conveyor;
- one processing station;
- one arm;
- finished robot output.

**Lv10**
- second station;
- second arm;
- more convincing production line.

**Lv25**
- inspection/storage stage;
- third segment;
- gantry/cables.

**Lv50**
- double production line.

**Lv100**
- fully autonomous robot plant;
- multiple arms;
- double belt;
- inspection modules;
- enclosed sections;
- frequent finished robot output.

### 14.4 Automated Cell

**Lv1**
- enclosed cell;
- two arms;
- integrated input/output.

**Lv10**
- third arm;
- stronger enclosure/overhead module.

**Lv25**
- four-arm cell;
- dual output;
- diagnostic cyan lighting.

**Lv50**
- vertical gantry/processing module;
- maintenance/logistics extension.

**Lv100**
- fully integrated self-automating cell;
- four-arm system;
- overhead core;
- dual logistics;
- advanced displays/indicators.

### 14.5 Advanced Robotics Complex

**Lv1**
- building-scale frame;
- central robotics core;
- multiple bays;
- vertical structure;
- robot entry/exit points.

**Lv10**
- second bay;
- bridge/gantry;
- overhead logistics.

**Lv25**
- AI Integration Tower / central vertical module;
- stronger cyan technology language;
- increased robot activity.

This state supports the first viable Reboot frontier.

**Lv50**
- two-wing complex expansion;
- stronger network lighting;
- increased robot traffic.

**Lv100**
- large autonomous complex;
- multiple wings;
- high vertical silhouette;
- strong graphite/off-white/cyan palette;
- dense autonomous robot flows.

---

## 15. Robot Representation

### 15.1 Standard robot

Use one primary robot silhouette for the MVP.

This is intentional: repeated production of the same recognizable worker strengthens the Automata identity and avoids unnecessary model production.

### 15.2 Robots Built vs visible robots

`Robots Built` is a cumulative progression metric, not a requirement to render that number of agents.

Approved representation:

| Robots Built milestone | Approx. real 3D robots visible |
|---|---:|
| 1 | 1 |
| 10 | ~3 |
| 100 | ~6–8 |
| 1,000 | ~10–14 + background fakes |

The exact runtime count may vary with device performance and scene composition.

### 15.3 Scaling rule

Visible population rises quickly at first and then saturates. Technical implementation may use a logarithmic or milestone-based mapping.

### 15.4 Robot behavior

Robots use predefined visual routes and loops rather than expensive worker AI/pathfinding.

Possible loops:

- Assembly ↔ Storage;
- Robot Line → Exit;
- Storage ↔ Automated Cell;
- Robotics Complex patrol/logistics loop.

Randomized start phase, small speed variation and pauses can create life without simulation complexity.

### 15.5 Background population fakes

At high robot totals, use:

- distant simplified robots;
- looped traffic;
- spawn/despawn through doors;
- silhouettes behind barriers/windows;
- fixed route clusters.

Do not attempt to display 1,000 fully simulated robots.

---

## 16. Founder Robot

**APPROVED: feasible as MVP cosmetic in the Founder's Factory Pack.**

The Founder Robot uses the same base robot mesh with low-cost modifications:

- graphite/black shell;
- warm metallic gold accents;
- distinctive small crest/antenna;
- `UNIT 0001` marking.

It has no gameplay effect.

Recommended behavior:

- if owned before First Robot, the first Worker Bot reveal uses the Founder variant;
- later robot populations should keep at least one Founder Robot visible when practical;
- not every robot becomes the Founder variant.

This preserves the fantasy of a unique historical prototype.

If the crest is not readable at normal mobile camera distance, its silhouette should be slightly enlarged rather than adding expensive bespoke animation.

---

## 17. Production Props

Conveyors do not require deep item simulation.

Use a very small visual vocabulary, for example:

- generic components;
- intermediate assembly block;
- inactive robot shell;
- finished robot.

Loops may fake progression through stations via occlusion/state swapping.

---

## 18. Construction and Upgrade Presentation

### 18.1 Generic construction sequence

Use one reusable visual rule for most structures:

1. short holographic/ghost preview or placement cue;
2. modules appear quickly;
3. small sparks/construction particles;
4. lights activate;
5. machine animation starts.

Target duration: approximately 1.5–3 seconds.

Do not create unique construction cinematics per producer.

### 18.2 Milestone feedback tiers

**Minor — producer milestone**
- module change;
- short light pulse;
- small UI feedback;
- ~0.5–1 second.

**Major — Breakthrough/new producer/important robot milestone**
- short camera focus;
- construction effect;
- sparks;
- short title;
- ~2–3 seconds.

**Exceptional**
- First Automation;
- First Robot;
- Era Transition;
- Reboot.

These may use scene-wide changes and stronger audio/visual treatment.

---

## 19. UI Direction

### 19.1 Core identity

**APPROVED: Industrial Control Interface.**

UI uses:

- graphite semi-opaque panels;
- off-white text;
- amber/orange industrial action accents;
- cyan automation/AI accents;
- restrained geometric framing;
- minimal decoration;
- strong numeric readability.

The factory remains the primary visual content.

### 19.2 Screen-space target

Artistic target:

- roughly 65–75% useful main-screen area reserved for the 3D factory;
- roughly 25–35% for persistent/contextual UI.

This is a design target, not a fixed implementation metric.

### 19.3 Core HUD

Main factory screen should expose compactly:

- Industrial Output;
- production per second;
- AI Cores once relevant;
- Next Goal;
- context for selected producer;
- minimal navigation;
- Overclock control/state when unlocked.

### 19.4 Producer interaction

The preferred interaction is to select the producer directly in the 3D world.

Selected producer may use:

- thin outline/highlight;
- subtle base indicator;
- world-space label;
- contextual upgrade card.

Avoid five permanently large producer cards covering the factory.

---

## 20. Next Goal

Next Goal is a major UX feature and should remain easy to see without becoming intrusive.

It must communicate:

1. next objective;
2. current cost/progress;
3. what it unlocks.

Example structure:

```text
NEXT GOAL
AUTOMATED CELL
72.4M / 100M IO
[progress]
Unlocks: Self-Automating Production
```

Recommended interaction:

- tapping Next Goal may recenter the camera on the relevant machine or future construction area;
- when ready, use one restrained pulse and clear `READY` state rather than a modal popup.

---

## 21. Breakthrough UI

Breakthroughs should appear more important than normal producer levels.

Use a technical/blueprint-style card containing:

- breakthrough name;
- requirements;
- cost;
- primary functional unlock;
- strong `INSTALL` / `BUILD` action.

Avoid presenting Breakthroughs as ordinary +percentage upgrades.

---

## 22. Overclock Treatment

Economy baseline:

**Free Overclock: ×2 production for 60 seconds, 240-second cooldown.**

Rewarded Extended Overclock uses the same production multiplier with longer duration.

### 22.1 Visual effects

Use only a small coherent set:

1. machine/conveyor animation speed appears moderately faster (~1.25–1.4× visually);
2. industrial amber lighting intensifies;
3. localized sparks activate;
4. compact ×2 timer/pulse appears in UI.

The mathematical multiplier remains Economy-owned and does not need to match visual animation speed.

### 22.2 Avoid

Do not use continuous:

- heavy screen shake;
- full-screen flashing;
- excessive bloom;
- dense fog;
- trails on every object;
- red emergency lighting.

A very short activation impulse is acceptable.

### 22.3 Rewarded Extended Overclock

Uses the same visual language as Free Overclock. The rewarded value proposition is duration, not a separate premium visual fantasy.

---

## 23. Offline Return — Factory Report

The Offline Return should communicate that automated production continued while the player was away.

Preferred presentation:

- factory remains visible behind a darkened overlay;
- report states time away;
- Industrial Output reward is prominent;
- Robots Built gain may appear when applicable;
- normal `COLLECT` is clear and natural;
- optional rewarded multiplier is secondary.

The popup must not visually imply that watching an ad is mandatory.

On the first relevant offline return, explain which producers worked offline and which stopped due to missing automation. Later reports should be compact.

After collection, Next Goal should immediately reflect what the new resources enable.

---

## 24. AI Core

**MUST CREATE custom visual identity.**

AI Cores are the permanent meta resource and must be visually distinct from run resources.

### 24.1 Approved concept

- hexagonal outer shell;
- floating central diamond/core;
- broken circuit/energy ring element;
- graphite structural frame;
- cyan/white energy.

### 24.2 Required uses

The same identity must work in:

- small HUD icon;
- Reboot screen;
- permanent AI upgrade interface;
- 3D Reboot sequence;
- store/promo messaging if needed.

Recommended production approach:

Create a simple clean 3D Core first, then derive the 2D icon from that design so both remain consistent.

Avoid:

- generic brain icon;
- ordinary computer chip;
- gear;
- RPG gemstone.

---

## 25. Reboot Civilization

Reboot must communicate transformation into permanent knowledge, not simple loss.

### 25.1 Reboot UI

Show clearly:

- civilization number;
- AI Cores gained now;
- progress toward the next Core;
- what resets;
- what persists;
- Reboot action.

Use `REBOOT`, not `RESET`, as the dominant visual language.

### 25.2 Reboot sequence

Recommended 6–8 second sequence:

**1. Shutdown**
- conveyors slow;
- robotic arms stop;
- robots stop;
- lights switch off progressively by zone.

**2. Scan**
- cyan scan passes through the factory;
- data/light cues converge toward the advanced core area.

**3. Archive/compression**
- factory groups fade/deactivate;
- particles/data converge;
- avoid physically destroying hundreds of objects.

**4. AI Core creation**
- one strong AI Core appears;
- reward is shown as `×N` rather than rendering many physical Cores.

**5. New civilization**
- short transition;
- `CIVILIZATION #N`;
- return to Workshop.

### 25.3 Persistent visual inheritance

Post-Reboot Workshop must not look identical to Civilization #1.

Add a subtle persistent AI relay/core socket or similar inherited-tech marker near the starting area.

This communicates permanent progress at very low production cost.

---

## 26. Permanent AI Upgrade UI

Economy defines three branches and a small number of upgrades.

Use a compact three-column structure:

- Production;
- Automation;
- Expansion.

Do not create a giant skill-tree interface.

All branches remain part of the same AI/cyan visual family and are differentiated mainly through iconography rather than unrelated color palettes.

Upgrade activation may use:

- AI Core icon movement toward node;
- short ring pulse;
- node illumination;
- connection line activation.

---

## 27. VFX Guidelines

### 27.1 Color language

**Amber/orange**
- construction;
- mechanical energy;
- Overclock;
- industrial activity.

**Cyan**
- automation;
- control systems;
- AI Core;
- Reboot;
- permanent technology.

**Red**
- errors/warnings only.

### 27.2 Sparks

Use for:

- construction;
- milestone emphasis;
- limited Overclock treatment.

Avoid permanent sparks across many machines.

### 27.3 Smoke

Use lightly in early mechanical spaces and very sparingly later.

A subtle reduction in smoke as technology advances reinforces cleaner controlled automation.

### 27.4 Lighting

Prefer:

- static/baked environment lighting where appropriate;
- emissive materials and indicator meshes;
- a small number of meaningful real-time lights;
- lighting-state changes rather than many dynamic lights.

---

## 28. Animation Guidelines

Prioritize simple reusable loops:

- conveyor movement;
- piston/press;
- robotic arm loop;
- rotating fan;
- blinking indicator;
- robot walk/patrol;
- loading/unloading gesture;
- sparks;
- machine cycle.

No motion capture, large character animation set or bespoke animation for every producer level is required.

---

## 29. Audio/VFX Coordination

Art Direction does not define the complete sound design, but these moments require distinct audiovisual feedback:

| Event | Feedback character |
|---|---|
| Level purchase | light mechanical click |
| Milestone | heavier mechanical lock/pulse |
| Automation | motor/system startup |
| First Robot | robot boot/activation |
| New Era | industrial system power-up |
| Overclock | rising machinery/energy |
| AI Core | clean synthetic tone |
| Reboot | shutdown → brief silence → AI activation |

The Reboot's short silence before AI Core creation is especially valuable.

---

## 30. Performance Constraints

The visual direction must remain realistic for Android/iOS.

### 30.1 Avoid

- thousands of live scene objects;
- hundreds of independently simulated robots;
- pathfinding-heavy robot AI;
- excessive transparency;
- volumetric fog requirement;
- many real-time lights;
- costly shaders as a visual dependency;
- continuous heavy VFX;
- highly detailed off-camera environment.

### 30.2 Prefer

- instancing where practical;
- static batching where practical;
- shared materials;
- modular repeated assets;
- looping animations;
- predefined robot routes;
- distant simplified units;
- spawn/despawn traffic fakes;
- emissive indicator materials;
- group activation/deactivation for era evolution;
- low particle counts;
- selective asset import.

Technical Lead owns exact implementation and profiling decisions.

---

## 31. Store Screenshot Strategy

The factory's visual evolution must generate clearly different store images from the MVP itself.

### Screenshot 1 — Manual Workshop

Visual:
- sparse first factory;
- one/few machines;
- strong empty-space contrast.

Message concept:

**START WITH ONE MACHINE**

### Screenshot 2 — Automated Factory

Visual:
- Robot Line;
- conveyors;
- industrial density;
- active arms.

Message concept:

**AUTOMATE EVERYTHING**

### Screenshot 3 — Robotics Complex

Visual:
- dense advanced factory;
- many visible robot activities;
- cyan advanced technology;
- vertical complex.

Message concept:

**BUILD A ROBOT CIVILIZATION**

This is the strongest candidate for the primary store screenshot.

### Screenshot 4 — Reboot / AI Core

Visual:
- cyan civilization scan/compression;
- prominent AI Core.

Message concept:

**REBOOT. EVOLVE. BUILD FASTER.**

### Screenshot 5 — Overclock

Visual:
- dense factory;
- intensified amber lighting;
- localized sparks;
- ×2 UI state.

Message concept:

**OVERCLOCK THE FACTORY**

Store captions remain marketing copy candidates, not locked localization strings.

---

## 32. App Icon / Title Presentation

### 32.1 App icon direction

Preferred candidate:

**large Automata robot head/face with clear cyan sensor and industrial orange/graphite shell.**

Avoid depicting an entire factory at icon scale.

### 32.2 Splash/title screen

Use an actual polished in-game Robotics Complex composition when possible rather than producing expensive unrelated splash art.

This keeps marketing promise consistent with real gameplay.

---

## 33. Custom Asset Requirements

### MUST CREATE

#### AI Core

- 3D model;
- 2D icon derivative;
- low/medium complexity;
- core identity asset.

#### Automata Decals / Branding

- factory logo decal;
- machine numbering;
- industrial warning patterns;
- `UNIT 0001` marking;
- transparent texture atlas preferred.

#### Core UI Icon Set

Approximately 10–15 high-value icons:

- Industrial Output;
- AI Core;
- production;
- producer/factory;
- robot;
- automation;
- milestone;
- Overclock;
- Breakthrough;
- Reboot;
- Production branch;
- Automation branch;
- Expansion branch.

Simple vector-first production is preferred over inconsistent AI-generated pictograms.

### SHOULD CREATE

#### Founder Robot crest/antenna

Very small mesh modification on the standard robot.

#### Project Automata logo

Simple industrial/technical typography and mark.

#### Advanced Robotics central module — conditional

Create/kitbash only if the approved external assets fail to produce a distinctive enough Producer #5 silhouette.

### NICE TO HAVE

- custom robot sensor/head refinement;
- additional holograms;
- loading artwork;
- animated logo;
- Founder-specific VFX.

---

## 34. AI-Generated Art Usage

AI image generation may be useful for:

- marketing concept exploration;
- optional backgrounds;
- splash/promo ideation;
- decal concepting.

Do not rely on image generation for:

- modular 3D producer assets;
- robot animation frames;
- perspective-critical sprite systems;
- UI icon families requiring exact consistency.

The core game identity should derive from coherent 3D assets, materials, UI and custom symbols rather than a collection of unrelated generated images.

---

## 35. Explicit Art Scope Exclusions

For MVP, do **not** create:

- a unique model for every producer level;
- 20 milestone-specific machine models;
- 1,000 rendered robots;
- multiple full robot families;
- separate environment maps for each era;
- custom background art for every era;
- heavy construction cinematics;
- bespoke VFX for every machine;
- hundreds of UI icons;
- large sci-fi environment libraries without a concrete use;
- full AI Megafactory content;
- Orbital/Planetary/Stellar/Megastructure asset sets;
- large cosmetic catalog.

---

## 36. POST-MVP Visual Opportunities

Only after MVP validation:

- robot skins/chassis variants;
- machine paint themes;
- factory environment themes;
- special robot VFX;
- heavy construction/mech units;
- AI Megafactory expansion;
- Orbital Industry;
- Space Station architecture;
- Planetary Industry;
- Stellar Industry;
- megastructure backgrounds/visual scale systems.

POST-MVP art must continue to reuse the industrial → advanced → cosmic visual progression rather than replacing the identity completely.

---

## 37. Art Validation Tests

### 37.1 Screenshot chronology test

Capture the factory without UI at approximately:

- start;
- ~8 minutes;
- ~20 minutes;
- ~1 hour;
- ~3 hours.

A tester should be able to order the screenshots chronologically with little difficulty.

If not, visual progression is insufficient.

### 37.2 Silhouette test

In low detail / desaturated presentation, the five producers should remain distinguishable by shape.

### 37.3 Mobile robot visibility test

At normal gameplay distance:

- standard robot must be recognizable;
- Founder Robot difference must be visible;
- robot population must read without excessive screen clutter.

### 37.4 Asset-coherence test

Kenney factory assets, Quaternius robot and limited advanced assets must look like one product after material treatment.

If an imported asset visibly breaks the visual family, replace or modify it rather than expanding the number of art styles.

---

## 38. Final Art Direction Decision

Project Automata's MVP visual identity is:

> **A stylized 3D low-poly industrial factory that physically grows from a sparse manual workshop into a dense autonomous robotics complex. Mechanical amber gives way progressively to cyan automation technology, while modular machines, visible robot activity and one continuous evolving site make progression readable without requiring large bespoke art production.**

Primary production strategy:

**reuse modular CC0 assets + consistent materials + restrained custom branding + a small number of high-value original identity assets.**

The project must always prioritize the visual fantasy:

> **“I really transformed this tiny workshop into a robot civilization.”**
