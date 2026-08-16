# Mobile Game Factory — Studio Context

## Purpose

This document is a shared source of truth for the Mobile Game Factory.

The studio's objective is not to build one highly ambitious game over several years. The objective is to industrialize the creation, validation, development, release, and iteration of small commercial mobile games.

The optimization target is:

**Probability of success / production time and cost**

A slightly less promising game that can be validated and shipped quickly can be preferable to a more ambitious concept requiring months of production.

## Developer profile

The studio currently has one experienced software engineer.

Existing experience includes:

- Git
- Android Studio
- Cocos Creator
- JavaScript / TypeScript
- web and mobile development
- Google Play Console
- Google Play Games
- Google AdMob
- shipping mobile applications to Google Play

The developer already has a Google Play developer account and multiple deployed applications.

The workflow must therefore be optimized for an experienced developer rather than designed as a beginner tutorial.

## Factory strategy

The studio intends to create multiple relatively small games and progressively build a reusable production framework.

The desired loop is:

1. identify a market opportunity;
2. validate the concept before significant development;
3. aggressively control scope;
4. reuse existing assets where possible;
5. automate implementation with Codex where appropriate;
6. reuse technical systems between games;
7. ship;
8. measure results;
9. iterate or move to the next game.

The studio favors experimentation and portfolio learning over betting everything on a single title.

## Product principles

Games should ideally:

- be simple to understand;
- have a strong core loop;
- be technically manageable by a very small team;
- be fast to prototype;
- support Android first and potentially iOS;
- avoid unnecessary backend infrastructure;
- require limited bespoke content;
- be compatible with extensive code-generation/automation;
- use data-driven systems where possible;
- reuse shared technical modules;
- provide credible retention mechanisms;
- provide credible monetization opportunities;
- have a visual or thematic hook that can be communicated in store screenshots and short videos.

A typical desirable scope is:

**1 core mechanic + progression + light meta + monetization + polish**

## Technology strategy

Godot is currently the preferred candidate for the new factory because of its lightweight workflow, cross-platform capabilities, suitability for small games, and potential compatibility with Codex-driven development.

This choice is **not yet permanently locked**.

Before the reusable technical stack is finalized, the studio must validate the current production path for:

- Android export;
- iOS export;
- Google Play Games;
- Google AdMob rewarded ads;
- Google Play Billing / in-app purchases;
- equivalent iOS services where required;
- analytics/crash reporting if adopted;
- CI/build automation.

The engine should be selected for the needs of several future games, not merely the easiest implementation of the first prototype.

## Asset strategy

The studio favors existing commercially usable assets over creating large quantities of original art.

Kenney is a preferred source because many packs are CC0 and production-friendly:

https://kenney.nl/assets

The factory is not restricted to Kenney. Other sources may include, after license verification:

- itch.io asset packs;
- OpenGameArt;
- GameDev Market;
- CraftPix;
- engine marketplaces;
- independent asset creators;
- other reputable commercial asset libraries.

For every third-party asset, its license and commercial-use conditions must be verified before release.

The studio may adapt, recolor, combine, animate, or otherwise transform licensed assets when permitted in order to establish a coherent identity.

Assets from competing games must never be copied.

## Automation strategy

Codex should perform as much implementation work as is practical, while the developer remains responsible for architecture, review, testing, credentials, store configuration, and final decisions.

The factory should progressively standardize reusable modules such as:

- save system;
- settings;
- audio;
- localization;
- scene/navigation management;
- currencies;
- progression;
- inventory;
- rewards;
- achievements;
- offline progression;
- shop;
- rewarded ads;
- in-app purchases;
- leaderboards;
- analytics;
- platform abstraction;
- common UI components.

The long-term objective is that later games primarily require implementation of their game-specific mechanics and content.

## Data-driven preference

Game content should be represented as data whenever practical.

Examples:

- producers;
- upgrades;
- eras;
- prestige bonuses;
- items;
- shop offers;
- challenges;
- achievements.

Game-specific content should not require hundreds of bespoke scripts or scenes when the same result can be produced through reusable systems and configuration data.

## Monetization philosophy

Possible monetization mechanisms include:

- rewarded advertising;
- starter packs;
- premium currency;
- resource packs;
- temporary boosts;
- cosmetics/skins;
- convenience purchases;
- carefully designed offers.

Monetization must not be assumed to work simply because an IAP exists.

Every purchase must answer:

**Why would a player genuinely want this?**

Rewarded advertising is preferred over aggressive forced advertising when appropriate.

Competitive modes should ideally not be determined by real-money spending.

## Retention philosophy

Every project must answer:

**Why does the player return tomorrow?**

Possible mechanisms include:

- progression;
- unlocks;
- offline earnings;
- prestige;
- collections;
- achievements;
- daily objectives;
- challenges;
- visual evolution;
- leaderboards;
- events.

These systems should serve the game rather than be added mechanically as a checklist.

## Scope control

The factory should be particularly suspicious of concepts that require, without a strong business justification:

- real-time multiplayer;
- complex servers;
- large amounts of handcrafted levels;
- complex AI;
- large animation requirements;
- large quantities of bespoke art;
- expensive infrastructure;
- complicated physics or simulation;
- long pre-release production cycles.

A concept may be rejected even if attractive when its expected return does not justify its production cost.

## Decision standard

Specialist agents may recommend actions, but the Orchestrator / Producer centralizes project decisions.

Important decisions should be reflected in project source files rather than left only in chat history.

When documents disagree, the most recently approved project source-of-truth document takes precedence over informal earlier discussion.
