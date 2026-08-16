# Project Automata — Project Brief

## Status

**Project status:** APPROVED FOR GAME-DESIGN PHASE  
**Market gate:** GO  
**Date:** 2026-08-08  
**Working title:** Project Automata

This brief records the decisions currently approved by the Orchestrator after the first market-research phase.

It is not yet the complete Game Design Document.

## High concept

A mobile Idle / Incremental game in which the player grows from manual production into a fully automated industrial civilization and ultimately a galactic-scale industry.

Core fantasy:

**Start by doing the work yourself. End by commanding an autonomous industrial system spanning worlds.**

The game's thematic progression combines:

**Automation + Robotics + AI + Factory + Space**

## Product hypothesis

The project is attractive for the Mobile Game Factory because:

- idle/incremental gameplay has proven mobile demand;
- factory/automation themes map naturally to incremental progression;
- robots/AI provide a contemporary thematic layer;
- space provides evergreen expansion potential;
- the game can be largely local and data-driven;
- backend requirements can remain near zero;
- much of the implementation should be automatable with Codex;
- substantial compatible third-party asset libraries already exist;
- monetization can use optional acceleration rather than forced interruption.

Market research estimated Codex automation suitability at approximately **9/10**.

## Market signals

Initial research reported examples including:

- Idle Factory Tycoon — 10M+ installs / 343k reviews;
- ExoMiner — 5M+ installs / 407k reviews;
- Idle Planet Miner — 1M+ installs / approximately 100k reviews;
- Idle Bee Factory — 10M+ installs / 590k reviews;
- Cell to Singularity — 10M+ installs / approximately 394k reviews.

The incremental-game community remains active in 2026, with automation, unlocks, optimization, and continuous progression remaining important player motivations.

Pure robot-idle competition appeared less dominant than generic factory or space-mining categories, creating a possible differentiation opportunity when combined with strong execution.

These figures are market-research inputs and should be revalidated when used for future commercial decisions.

## Core progression fantasy

The current proposed era progression is:

1. Manual Workshop
2. Automated Factory
3. Robotics Complex
4. AI Megafactory
5. Orbital Industry
6. Planetary Mining
7. Stellar Industry
8. Dyson Swarm / Megastructure era

Exact names, count, pacing, and content remain subject to Game Design.

The key principle is that each major era should feel like a meaningful escalation rather than merely a larger number.

## Core loop

Current high-level loop:

```text
Manual input / Tap
        ↓
Resources
        ↓
Buy production
        ↓
Automatic income
        ↓
Upgrades / multipliers
        ↓
New machines and automation
        ↓
New era / production scale
        ↓
Prestige
        ↓
Permanent acceleration
        ↓
Repeat at dramatically greater scale
```

The tap mechanic is expected to be important early and become progressively less central as automation takes over.

That transition should reinforce the game's theme.

## Visual factory decision

### APPROVED DIRECTION

The factory should be **visually represented and visibly evolve**, but it should **not** be a free-form factory-building simulation.

The player does not manually design conveyor networks or freely place every machine.

Instead:

- layouts are controlled/predetermined;
- purchasing or upgrading production causes machinery to appear or evolve;
- conveyors can activate;
- robotic arms can appear;
- robots can become more numerous;
- environments can become denser and more advanced;
- later eras can replace or expand the visual environment.

This creates a store/marketing hook without introducing the scope of a full construction/simulation game.

### Simulation principle

The economy and visuals should remain decoupled.

Example economic logic:

```text
production =
    base_rate
    × level_multiplier
    × upgrade_multipliers
    × prestige_multipliers
    × temporary_effects
```

Visible resources moving on conveyors do not need to be authoritative economic entities.

They may be visual effects representing the underlying mathematical production.

This is an important scope-control decision.

## Explicitly out of scope for initial design

Unless later approved by the Orchestrator:

- free machine placement;
- player-designed conveyor routing;
- pathfinding-heavy worker systems;
- authoritative physical simulation of production;
- complex worker AI;
- real-time multiplayer;
- mandatory backend;
- complex player-to-player economy.

The project must remain an incremental game with a visual factory, not become a factory simulator.

## Prestige

Current proposed fantasy:

**Reboot Civilization**

Prestige resets substantial run progress in exchange for a permanent progression resource, currently represented conceptually as **AI Cores**.

The Game Designer and Economy Designer must determine:

- first-prestige timing;
- reset scope;
- reward formula;
- permanent bonuses;
- whether AI Cores are exclusively earned or can interact with monetization;
- anti-frustration rules.

The name and exact implementation are not final.

## Offline progression

Offline earnings are expected to be a core retention system.

The player should return to accumulated production after being away.

A monetization candidate is:

- collect normal offline earnings;
- optionally watch a rewarded ad to multiply them.

Exact caps, formulas, multipliers, and durations remain undecided.

## Monetization direction

### Rewarded ads

Current candidates:

- temporary ×2 production;
- multiplied offline earnings;
- temporary Overclock;
- optional bonus chest/reward if justified.

Rewarded ads should be optional.

### Advertising principle

**No forced interstitial advertising is planned for the initial product direction.**

Avoid turning optimal gameplay into continuous ad watching.

### In-app purchases

Current candidates:

- Starter Pack;
- premium currency;
- AI Cores or another premium/progression interaction, subject to economy review;
- boost/resource packs;
- later cosmetics/robot skins if the visual presentation makes them valuable.

The Economy & Monetization phase must validate the actual reasons a player would purchase these items.

## Challenge Mode

### Current direction

A competitive mode tentatively named:

**Factory Rush**

Concept:

- fixed-duration run, currently proposed around 5 minutes;
- identical starting conditions;
- player optimizes production;
- final score is submitted to a leaderboard;
- Google Play Games leaderboard is a candidate implementation.

### Competitive integrity

The challenge should not be determined by purchases.

The current principle is:

- no IAP advantage;
- no purchased boost advantage;
- no prestige/meta advantage unless specifically normalized;
- no rewarded-ad competitive advantage.

### Scope status

**POST-MVP candidate.**

The normal idle progression should be proven before significant development time is spent on Factory Rush.

## Retention candidates

Current retention mechanisms include:

- new machines;
- new production tiers;
- new eras;
- visual factory evolution;
- offline earnings;
- prestige;
- achievements;
- progression milestones;
- optional daily objectives;
- eventually Factory Rush / leaderboard competition.

The Game Designer must prioritize these rather than implementing every candidate automatically.

## Asset direction

Known promising Kenney sources from initial research include:

- Factory Kit — approximately 140 models;
- Space Kit — approximately 150 models;
- Modular Space Kit — approximately 40 models;
- Sci-Fi UI — approximately 130 assets;
- Industrial 2D — approximately 110 assets.

Kenney assets are especially attractive because relevant packs are available under CC0.

Additional robot, animation, VFX, UI, and environment assets may be sourced from marketplaces such as itch.io or GameDev Market after license verification.

The Art Director / Asset Researcher will later create an authoritative asset manifest.

## Technical direction

The project should be predominantly local and data-driven.

Candidate configurable domains include:

```text
producers
upgrades
eras
prestige
shop
challenges
achievements
```

Exact representation—JSON, Godot Resources, or another format—will be decided during Technical Design.

### Engine

Godot is the current preferred engine candidate.

**Status: PROPOSED, not permanently locked.**

Before production architecture is frozen, technical validation is required for the intended mobile stack, especially:

- Android;
- iOS;
- AdMob rewarded ads;
- Google Play Games;
- Google Play Billing/IAP;
- iOS monetization/platform equivalents.

## Initial scope assessment

Current estimate:

- backend: none required;
- core logic: low complexity;
- platform integrations: low-to-medium complexity;
- UI: moderate;
- bespoke asset requirements: limited;
- content/balancing workload: medium;
- maintenance: expected low-to-medium;
- Codex suitability: very high.

The primary production risk is expected to be **content/pacing/economy quality rather than raw programming difficulty**.

## Principal risks

### Generic factory positioning

A generic factory idle game enters a crowded category.

Mitigation:

- automation/robot/AI identity;
- strong visible evolution;
- clear era escalation;
- eventual galactic scale.

### Generic space-mining positioning

Space mining is already competitive.

Space should initially function as the escalation of the automation fantasy rather than reducing the concept to another generic miner.

### Weak pacing

Theme alone will not retain players.

Unlock cadence, prestige timing, production acceleration, milestones, and offline progression must be carefully designed.

### Ad dependency

If watching ads becomes the dominant optimal action, the game risks feeling like an ad simulator.

Rewarded placements must remain valuable but bounded.

### Content walls

An incremental game can be technically complete while still becoming boring because too little happens between milestones.

The Game Design and Economy phases must explicitly design the cadence of meaningful unlocks.

## MVP philosophy

The MVP must validate:

1. Is the core incremental loop satisfying?
2. Does visible automation make progression more rewarding?
3. Does the transition from manual work to automation feel powerful?
4. Is there enough anticipation between major unlocks?
5. Does prestige create a compelling restart?
6. Do players want to return for offline production?

Features that do not materially help answer these questions should be considered for deferral.

## Current feature classification

### APPROVED

- idle/incremental core;
- automation/factory theme;
- robots/AI → space escalation;
- visible evolving factory;
- mathematical rather than physically authoritative economy;
- offline progression direction;
- prestige direction;
- optional rewarded-ad monetization direction;
- IAP exploration;
- data-driven architecture preference.

### POST-MVP / NOT YET REQUIRED

- Factory Rush;
- global leaderboard;
- extensive cosmetics;
- daily goals;
- live events;
- large offer system.

### REJECTED FOR CURRENT SCOPE

- free-form factory construction;
- real conveyor-network simulation;
- complex pathfinding/worker AI;
- real-time multiplayer;
- mandatory backend.

## Next phase

The next specialist is the **Game Designer**.

The Game Designer should use this brief together with the shared Studio Context and Factory Workflow.

Primary questions for Game Design include:

- exact core interaction;
- role and decline of tapping;
- number/types of producers;
- producer leveling behavior;
- upgrade categories;
- milestone structure;
- era structure;
- progression pacing;
- first-session pacing;
- offline progression rules;
- prestige rules;
- expected first-prestige timing;
- meaningful visual changes;
- minimum content required for MVP;
- what should explicitly remain post-MVP.

Economy formulas and monetization pricing should not be finalized before the core progression structure is sufficiently defined.
