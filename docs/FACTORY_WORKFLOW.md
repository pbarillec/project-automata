# Mobile Game Factory — Workflow

## Purpose

This document defines how the Mobile Game Factory is organized, how specialist chats collaborate, and how decisions are transferred between them.

The objective is to prevent context drift while allowing specialists to work deeply within their domain.

## Core principle

**Chats are workers. Project files are memory.**

Important decisions must eventually be written into shared project documents.

A specialist should not silently redefine decisions owned by another specialist.

When a meaningful decision changes, the relevant source document should be updated.

## Roles

### 1. Orchestrator / Producer

The Orchestrator owns the global production process.

Responsibilities:

- maintain the global project state;
- control scope;
- decide which specialist works next;
- resolve conflicting recommendations;
- approve major changes;
- determine MVP boundaries;
- maintain the source-of-truth documents;
- coordinate handoffs;
- decide GO / CONDITIONAL GO / NO-GO gates.

The Orchestrator does not need to personally perform every specialist analysis.

### 2. Market Researcher

Purpose:

**Determine what is worth building and why.**

Responsibilities:

- current market research;
- competitor analysis;
- trend research;
- review analysis;
- theme validation;
- opportunity identification;
- rough commercial assessment;
- asset-driven opportunity research;
- evaluation of development cost versus market potential.

Typical output:

`MARKET_RESEARCH.md`

Gate:

**Market GO / CONDITIONAL GO / NO-GO**

### 3. Game Designer

Purpose:

**Transform the validated concept into a precise playable system.**

Responsibilities:

- core loop;
- player actions;
- progression;
- unlock structure;
- game states;
- prestige/meta systems;
- session structure;
- offline progression behavior;
- challenge modes;
- content structure;
- MVP boundaries;
- feature prioritization.

The design should be precise enough to implement, not merely inspirational.

Typical output:

`GAME_DESIGN.md`

### 4. Economy & Monetization Designer

Purpose:

**Make progression sustainable and monetization desirable without destroying the game.**

Responsibilities:

- currencies;
- sources and sinks;
- formulas;
- progression curves;
- upgrade pricing;
- prestige economy;
- rewarded-ad placement;
- IAP structure;
- starter packs;
- premium currency;
- offers;
- balancing hypotheses;
- monetization safeguards for competitive systems.

Typical outputs:

`ECONOMY.md`
`MONETIZATION.md`

### 5. Art Director / Asset Researcher

Purpose:

**Create a coherent visual identity while minimizing bespoke asset production.**

Responsibilities:

- visual direction;
- asset sourcing;
- license verification;
- Kenney/marketplace pack selection;
- UI direction;
- environment evolution;
- asset gap identification;
- recommendations for modification or generation;
- visual consistency rules;
- store-facing visual hook.

Typical outputs:

`ART_DIRECTION.md`
`ASSET_MANIFEST.md`

### 6. Technical Lead / Codex Prompt Engineer

Purpose:

**Turn approved design into a maintainable, highly automatable implementation plan.**

Responsibilities:

- engine/stack validation;
- project architecture;
- reusable module boundaries;
- data schemas;
- platform integrations;
- repository conventions;
- technical risk reduction;
- implementation sequencing;
- Codex task/prompts;
- acceptance criteria;
- test requirements;
- code-review guidance.

Typical outputs:

`TECHNICAL_DESIGN.md`
`CODEX_PLAN.md`

### 7. QA / Release Manager

Purpose:

**Make the game shippable and keep releases controlled.**

Responsibilities:

- test plans;
- regression testing;
- device/build verification;
- Android/iOS release readiness;
- versioning;
- store requirements;
- privacy/compliance checks;
- AdMob/IAP/leaderboard validation;
- release notes;
- production checklists.

Typical outputs:

`QA_PLAN.md`
`RELEASE_CHECKLIST.md`

## Standard project flow

The default pipeline is:

```text
IDEA
  ↓
MARKET RESEARCH
  ↓
MARKET GATE
  ↓
GAME DESIGN
  ↓
DESIGN GATE
  ↓
ECONOMY / MONETIZATION
  ↓
ART DIRECTION / ASSET RESEARCH
  ↓
TECHNICAL DESIGN
  ↓
IMPLEMENTATION WITH CODEX
  ↓
QA
  ↓
RELEASE
  ↓
METRICS / PLAYER FEEDBACK
  ↓
ITERATE, SCALE, OR MOVE ON
```

This is a default sequence, not a rigid waterfall.

Once the concept is sufficiently stable, economy, art research, and technical exploration may partially overlap.

Implementation should not begin simply because a concept sounds interesting.

## Handoff protocol

When a specialist completes a substantial phase, it should provide a concise:

`HANDOFF TO ORCHESTRATOR`

The handoff should contain only information required for decisions and the next phase.

Depending on the specialist, this can include:

- decision requested;
- recommendation;
- evidence;
- assumptions;
- risks;
- unresolved questions;
- proposed MVP impact;
- dependencies;
- files that should be updated.

The Orchestrator decides whether the recommendation becomes an approved project decision.

## Source-of-truth hierarchy

Shared factory-level documents describe principles used across projects.

Example:

```text
/STUDIO_CONTEXT.md
/FACTORY_WORKFLOW.md
```

Each game receives its own directory or document set.

Example:

```text
/projects/project-automata/
    PROJECT_BRIEF.md
    MARKET_RESEARCH.md
    GAME_DESIGN.md
    ECONOMY.md
    MONETIZATION.md
    ART_DIRECTION.md
    ASSET_MANIFEST.md
    TECHNICAL_DESIGN.md
    CODEX_PLAN.md
    QA_PLAN.md
    RELEASE_CHECKLIST.md
```

Not every document needs to exist on day one.

Documents are created when their phase becomes relevant.

## Decision states

Features and ideas should be distinguishable as:

- **PROPOSED** — under discussion;
- **APPROVED** — accepted for the current plan;
- **MVP** — required for first releasable scope;
- **POST-MVP** — intentionally deferred;
- **REJECTED** — explicitly out of scope unless reconsidered.

This avoids a brainstorming idea silently becoming a development requirement.

## MVP discipline

Every project should identify the smallest version that can test its central hypothesis.

MVP does not mean unfinished or low quality.

It means:

- limited systems;
- controlled content;
- coherent presentation;
- complete core loop;
- enough progression to evaluate player interest;
- required platform integrations only;
- no speculative feature explosion.

Features should earn their place through player value, business value, validation value, or meaningful production leverage.

## Codex workflow

Codex should receive bounded tasks rather than vague requests to “build the game.”

A good implementation task should specify:

1. objective;
2. current architecture/context;
3. files or systems concerned;
4. functional behavior;
5. data contracts;
6. edge cases;
7. constraints;
8. acceptance criteria;
9. tests/build checks;
10. expected report/diff.

Codex should inspect existing code before modifying it.

Large implementation phases should be divided into independently testable increments.

## Reuse policy

Whenever a system could reasonably be reused by future games, the Technical Lead should evaluate whether it belongs in the shared factory architecture.

However, premature abstraction must be avoided.

Rule of thumb:

**Build for the current game; extract for the factory once the abstraction is proven useful.**

## Post-release loop

After release, decisions should be driven by actual evidence where available.

Potential signals include:

- installs;
- store conversion;
- crashes/ANRs;
- session behavior;
- retention;
- ad engagement;
- IAP conversion;
- reviews;
- player feedback;
- challenge/leaderboard participation.

The Orchestrator then chooses among:

- fix;
- rebalance;
- add content;
- improve monetization;
- improve acquisition/store presentation;
- expand the game;
- maintain with minimal effort;
- stop investing and reuse the lessons in the next project.

## Current factory status

As of 2026-08-08:

- Orchestrator established;
- Market Researcher established;
- first market research completed for Project Automata;
- first concept received a market GO;
- next major phase: Game Design;
- reusable technical stack is not yet permanently locked.
