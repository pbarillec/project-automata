# AUT-014 Automation & Era Progression

## Scope Implemented

AUT-014 adds authoritative headless automation production and deterministic MVP Era progression without adding UI, scenes, platform code, offline processing, boosts, prestige, or robot accumulation.

## Automation Philosophy

Automation follows the approved rule: automate labor, not decisions.

Automated producers can generate Industrial Output through the runtime automation tick. The automation tick never buys producer levels, constructs producers, purchases Breakthroughs, spends resources on strategic unlocks, changes permanent/meta state, or triggers Reboot.

## Producer Automation Semantics

Automation is resolved from authoritative run state and configuration:

- Explicit automation records from configured Breakthrough effects remain authoritative for Manual Workshop producers.
- Auto Feeder automates Fabricator through the existing configured `setProducerAutomation` effect.
- Worker Bot automates Assembly Station through the existing configured `setProducerAutomation` effect.
- Producers whose configured Era is Automated Factory or later are automated when constructed, because they represent self-automating systems.
- Level 0 remains unconstructed and produces no automated output.

Automated production reuses existing production, milestone, and Breakthrough modifier modules.

## Era Transition Ownership

Fresh Civilization #1 starts in `manual_workshop`.

Robot Line construction is the authoritative transition into `automated_factory`. It happens as part of the explicit Robot Line construction purchase, spends the Economy-approved 500,000 IO construction cost, and does not require a second Era purchase.

Advanced Robotics remains owned by the configured AUT-012 Breakthrough effects. Its direct construction effect creates Advanced Robotics Complex at Level 1, and its configured Era effect transitions into `robotics_complex`.

## Idempotency

Era progression is monotonic by Era order. Reapplying the current Era or a lower Era is a no-op and does not emit duplicate transition events through runtime command handling.

## Deferred Systems

The implementation intentionally does not include:

- Robots Built accumulation;
- offline elapsed-time processing;
- temporary boosts;
- permanent upgrades;
- prestige/Reboot;
- AI Megafactory as a playable Era;
- visual factory changes or Cocos scene behavior.
