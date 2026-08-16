# Project Automata --- MONETIZATION

**Status:** Monetization Design candidate for Economy/Monetization Gate\
**Date:** 2026-08-15\
**Phase owner:** Economy & Monetization Designer\
**Related source of truth:** `ECONOMY.md`

> Project Automata is a commercial mobile game. Monetization is expected
> to generate meaningful revenue if the game earns retention, but it
> must accelerate an already satisfying game rather than repair
> intentionally frustrating pacing.

------------------------------------------------------------------------

## 1. Commercial Objective

The studio is building commercial mobile games. Project Automata must
therefore have credible monetization, not merely "non-annoying
monetization."

The target principle is:

> **First make progression worth accelerating; then sell acceleration.**

The MVP monetization architecture is intentionally small because:

-   the studio is small;
-   the core game must first prove retention;
-   large offer systems are POST-MVP;
-   every commercial system creates implementation, QA, store,
    analytics, and balancing cost.

A small MVP monetization surface is not a commitment to weak lifetime
monetization. It is the first stage of a commercial architecture that
can expand if retention and player demand justify it.

------------------------------------------------------------------------

## 2. Monetization Principles

### 2.1 The free game must work

The baseline economy remains:

``` text
Online production: ×1
Offline: 75% automated production, 8h cap
Free Overclock: ×2 / 60s / 240s cooldown
AI Cores: fully earnable
All MVP eras: fully accessible
```

Do not reduce these values merely to increase monetization conversion.

### 2.2 Sell acceleration, not repaired frustration

Acceptable:

-   temporarily accelerate a run;
-   multiply an already-valid offline reward;
-   provide optional convenience;
-   provide visual identity.

Avoid:

-   intentionally bad offline rewards that ads "fix";
-   artificial waiting walls;
-   direct sale of the central permanent prestige achievement;
-   making optimal play a continuous ad loop.

### 2.3 Revenue still matters

Monetization metrics must be evaluated seriously:

-   rewarded impressions / DAU;
-   ad ARPDAU;
-   payer conversion;
-   ARPPU;
-   total ARPDAU;
-   LTV;
-   retention impact;
-   revenue by placement.

If retention is healthy but monetization is weak, the correct response
is to test additional value propositions and commercial surfaces---not
to assume that one Starter Pack is sufficient forever.

------------------------------------------------------------------------

## 3. MVP Monetization Architecture

Recommended launch candidate:

### Rewarded ads

1.  **Double Offline Earnings**
2.  **Extended Overclock**

### IAP

1.  **Founder's Factory Pack** --- single non-repeatable starter offer

### Explicitly not in initial MVP

-   forced interstitials;
-   premium currency;
-   direct AI Core sales;
-   permanent paid production multiplier;
-   generic resource packs;
-   consumable boost store;
-   Remove Ads;
-   Battle Pass;
-   subscription;
-   large daily offer system.

These exclusions can be reconsidered after metrics where they are not
constrained by Game Design scope.

------------------------------------------------------------------------

## 4. Rewarded Placement #1 --- Double Offline Earnings

### Placement

Factory Report after a qualifying absence.

Example:

``` text
Away: 4h 12m

Offline Production:
+38.4B IO

[COLLECT 38.4B]

[COLLECT ×2 — 76.8B]
Rewarded Ad
```

### Baseline

The free reward is the full normal offline reward:

``` text
automatedProduction
× effectiveOfflineDuration
× 0.75
```

The ad does not restore a withheld portion.

### Reward

``` yaml
offlineRewardMultiplier: 2.0
```

### Eligibility baseline

``` yaml
minimumOfflineMinutes: 30
maxRewardedClaimsPerRolling24h: 3
```

### Value proposition

The player has already generated a meaningful return and can voluntarily
amplify a high-salience reward.

This is expected to be the strongest rewarded placement because its
value is obvious without interrupting active play.

### Main risk

A ×2 option can become psychologically difficult to refuse.

If players report that collecting the free reward feels irrational,
first test:

``` text
×2 → ×1.5
```

or lower frequency.

Do **not** reduce the free 75% baseline to make the ad more attractive.

------------------------------------------------------------------------

## 5. Rewarded Placement #2 --- Extended Overclock

### Reward

``` yaml
productionMultiplier: 2.0
durationMinutes: 10
maxUsesPer24h: 3
minimumIntervalMinutes: 60
```

### Relationship with Free Overclock

Free Overclock:

``` text
×2 for 60 s
240 s cooldown
```

Rewarded Extended Overclock:

``` text
×2 continuously for 10 min
```

They do not multiply.

Conceptual rule:

``` text
effectiveTemporaryProductionMultiplier =
max(activeTemporaryProductionMultipliers)
```

While Extended Overclock is active, Free Overclock is suspended and
resumes afterward.

### Player motivation

Use when:

-   approaching a Breakthrough;
-   starting a new Era;
-   rapidly replaying after Reboot;
-   pushing a producer milestone;
-   executing a Push Run.

The placement sells a focused "power session," not an obligatory
repeated tap.

------------------------------------------------------------------------

## 6. Rewarded Ad Pressure Target

Hard baseline ceiling from the two placements:

``` text
3 offline doubles/day
+
3 extended overclocks/day
=
6 rewarded ads/day maximum
```

A Normal player should naturally consume fewer.

Initial behavioral target:

``` text
~0–3 rewarded ads/day for a Normal engaged player
```

The game must support meaningful sessions with zero ads.

Monitor:

``` text
% engaged DAU with zero rewarded views
```

If virtually all progressing players require ads, the
monetization/economy relationship is too aggressive.

------------------------------------------------------------------------

## 7. Forced Advertising

### MVP decision

**REJECTED.**

No forced interstitial:

-   after milestones;
-   after Era transitions;
-   after Reboot;
-   at launch;
-   at arbitrary timers;
-   on closing menus.

Reason:

Project Automata depends on high-satisfaction payoff moments. Forced ads
directly after these moments would damage the automation/progression
fantasy.

This is also consistent with the project direction and market research
signals warning against ad dependency.

------------------------------------------------------------------------

## 8. Remove Ads

### MVP decision

**NOT OFFERED.**

There are no forced ads to remove.

Rewarded ads are voluntary exchanges. A generic Remove Ads purchase
would either:

1.  remove opportunities/rewards; or
2.  require permanent free access to rewarded benefits.

Neither is necessary for the initial commercial architecture.

A future "Ad-Free Supporter" model could only be reconsidered if the
entire rewarded economy is redesigned.

------------------------------------------------------------------------

## 9. Premium Currency

### MVP decision

**NO PREMIUM CURRENCY.**

Do not add Gems / Crystals / Quantum Tokens solely because mobile games
often have them.

A premium currency is useful when multiple durable sinks justify a
common wallet:

-   cosmetics;
-   event shops;
-   many consumables;
-   rotating offers;
-   collections;
-   large live-ops economy.

Those systems are not part of the MVP.

Benefits of avoiding premium currency:

-   transparent prices;
-   simpler UX;
-   simpler economy;
-   lower implementation scope;
-   lower store/billing QA;
-   less currency obfuscation;
-   easier commercial testing.

Premium currency may be reconsidered POST-MVP if the game earns enough
retention to justify a broader shop/live-ops layer.

------------------------------------------------------------------------

## 10. AI Cores and Real Money

### Direct AI Core sales

**REJECTED.**

Do not sell:

``` text
10 AI Cores
50 AI Cores
AI Core Bundle
```

Do not include AI Cores in the Starter Pack.

Reason:

AI Cores are the proof and reward of Reboot Civilization. Direct sale
would weaken the meaning of the game's central permanent progression
loop.

### Commercial boundary

Real money may accelerate the current run temporarily.

Real money must not directly grant the permanent prestige resource in
the MVP.

This produces a clean rule:

> **Money can buy temporary time acceleration. Gameplay/Reboots create
> permanent power.**

------------------------------------------------------------------------

## 11. Temporary Boosts and Prestige Integrity

Prestige Power excludes temporary boosts.

Excluded:

-   Free Overclock;
-   rewarded Extended Overclock;
-   purchased Factory Surge.

Therefore:

``` text
temporary boost
→ more IO during the run
→ faster purchases
→ indirectly faster progression
```

but never:

``` text
activate boost immediately before Reboot
→ artificially multiply AI Core reward
```

This is an important anti-pay-to-win and anti-exploit boundary.

------------------------------------------------------------------------

## 12. Founder's Factory Pack

### Purpose

The Starter Pack must answer:

> Why would a player genuinely buy this?

Recommended reasons:

1.  support a game they already enjoy;
2.  obtain a distinctive Founder identity;
3.  receive a meaningful but temporary acceleration they control.

### Unlock timing

``` text
after First Worker Bot
```

Expected Civilization #1 timing:

``` text
~6.5–9 min
```

Do not present the offer in the first minutes before the player
experiences the core automation payoff.

### Contents --- baseline

``` yaml
FoundersFactoryPack:
  founderRobotVisualVariant: true
  factorySurges:
    quantity: 2
    multiplier: 2.0
    durationMinutes: 30
  permanentProductionBonus: none
  aiCores: none
  premiumCurrency: none
```

### Price hypothesis

Initial test:

``` text
€2.99 equivalent local price tier
```

Reasonable test range:

``` text
€2.99–€3.99
```

This is a hypothesis, not a permanent pricing decision.

### Availability

Recommended:

``` text
unlock after First Worker Bot
available for at least 72 real hours
and through the first Reboot
```

Avoid a short countdown that creates unnecessary early FOMO.

### Repeatability

``` text
one purchase per account
```

------------------------------------------------------------------------

## 13. Why the Permanent +10% Starter Bonus Was Removed

An earlier proposal included:

``` text
+10% permanent production
```

It is removed from the current recommendation.

Reasons:

-   permanent progression is more coherent when tied to AI Cores;
-   it keeps Prestige Power cleaner;
-   it protects future competitive normalization;
-   it creates a strong commercial promise: purchases do not directly
    buy permanent industrial power.

To preserve perceived Starter value, the current pack uses **2 ×
30-minute Factory Surges** rather than one.

------------------------------------------------------------------------

## 14. Factory Surge

Starter Pack consumable:

``` yaml
multiplier: 2.0
durationMinutes: 30
quantity: 2
stacking: false
```

The player chooses when to activate it.

It should not auto-activate on purchase.

Potential uses:

-   fast Civilization replay;
-   Breakthrough push;
-   new Era;
-   Push Run.

Temporary Surge does not directly count toward Prestige Power.

------------------------------------------------------------------------

## 15. Resource Packs

### MVP decision

**DEFERRED / NOT LAUNCH BASELINE.**

Avoid static offers such as:

``` text
50M IO
5B IO
500B IO
```

because an incremental economy rapidly invalidates fixed resource
amounts.

Dynamic resource offers are possible later but require careful scaling
and may interact too strongly with Reboot pacing.

------------------------------------------------------------------------

## 16. Time Skip / Offline Packs

### MVP decision

**POST-MVP TEST CANDIDATE.**

A time-based product scales better than a fixed IO bundle:

``` text
e.g. X hours of current automated production
```

However, it can bypass too much progression if introduced before real
player data exists.

Do not include in initial MVP.

Potential future test only if:

-   retention is healthy;
-   players clearly value faster Growth Runs;
-   rewarded inventory alone cannot support revenue goals;
-   the offer can be designed without making unpaid progression feel
    artificially slow.

------------------------------------------------------------------------

## 17. Paid Boost Packs

### MVP decision

**DEFERRED.**

Do not initially create a full consumable shop such as:

``` text
3 Surges
10 Surges
30 Surges
```

The game already has:

-   Free Overclock;
-   rewarded Extended Overclock;
-   two Starter Surges.

First measure whether players demonstrate demand for more boost
inventory.

If retention and Starter conversion are strong but payer depth is weak,
repeatable temporary boost packs are one of the first commercial systems
to test POST-MVP because they respect the temporary-power boundary.

------------------------------------------------------------------------

## 18. Cosmetics

### MVP

Only the Founder Robot variant, if cheap enough to produce.

If even this requires disproportionate art/technical scope, the Art
Director may recommend replacing it with another low-cost Founder
identity treatment.

### POST-MVP opportunity

If robots and machinery are visually salient enough:

-   robot skins;
-   chassis variants;
-   factory themes;
-   machine paint jobs;
-   VFX variants.

Cosmetics are commercially attractive because they can add payer depth
without affecting the economy or Factory Rush integrity.

Do not build the MVP economy around cosmetics before visual desirability
is validated.

------------------------------------------------------------------------

## 19. Battle Pass / Season Pass

### MVP decision

**REJECTED / POST-MVP ONLY IF LIVE-OPS JUSTIFIES IT.**

A pass requires:

-   missions;
-   season structure;
-   reward track;
-   recurring content;
-   UI;
-   calendar;
-   ongoing operations.

That scope is inconsistent with the current factory strategy.

------------------------------------------------------------------------

## 20. Subscription

### MVP decision

**REJECTED.**

There is no sufficiently strong recurring monthly value proposition yet.

Do not invent a subscription merely to add another monetization SKU.

------------------------------------------------------------------------

## 21. Daily / Rotating Offers

### MVP decision

**DEFERRED.**

Daily rewards, live events, and large offer systems are POST-MVP.

If the game proves retention, a small data-driven offer system can later
be tested without changing the core economy.

------------------------------------------------------------------------

## 22. Revenue Expansion Plan

The launch architecture is intentionally small, but Project Automata
must remain commercially expandable.

### Stage 1 --- MVP / validation

``` text
Rewarded Offline
Rewarded Extended Overclock
Founder's Factory Pack
```

Primary questions:

-   Do players retain?
-   Do they reach Reboot?
-   Do they opt into rewarded ads?
-   Will a small percentage pay after experiencing the First Robot?

### Stage 2 --- if retention is healthy but revenue is weak

Prioritized tests:

1.  improve Starter Pack presentation/value;
2.  test Starter price €2.99 vs €3.99;
3.  test rewarded offline ×1.5 vs ×2 for satisfaction/revenue balance;
4.  test a limited repeatable temporary Surge pack;
5.  test a time-skip/convenience offer;
6.  test low-scope cosmetics if visual demand exists.

### Stage 3 --- if the game demonstrates durable retention

Potential systems:

-   broader cosmetic shop;
-   carefully designed rotating offers;
-   premium currency only if multiple sinks justify it;
-   event monetization only if events themselves are justified;
-   additional IAP tiers based on actual payer behavior.

Do not jump directly from weak revenue to aggressive ad pressure.

------------------------------------------------------------------------

## 23. Factory Rush Competitive Integrity

Factory Rush is POST-MVP, but current monetization must not create an
architectural dead end.

Factory Rush must normalize/disable:

``` text
AI Core effects
permanent progression
paid temporary boosts
Starter Surges
rewarded boosts
any future paid production modifiers
```

All players start with the same:

-   factory;
-   economy configuration;
-   resources;
-   timer;
-   progression state.

Money must not determine leaderboard score.

------------------------------------------------------------------------

## 24. Monetization Analytics

### Rewarded Offline

Measure:

``` text
offline_reward_opportunity
offline_reward_opt_in
offline_reward_multiplier_used
offline_duration
base_offline_reward
bonus_offline_reward
claims_per_player_day
post_reward_session_length
post_reward_retention
```

### Extended Overclock

Measure:

``` text
extended_overclock_opportunity
extended_overclock_opt_in
uses_per_player_day
run_age_at_activation
era_at_activation
next_goal_at_activation
production_gained
```

### Starter Pack

Measure:

``` text
starter_offer_impression
starter_offer_purchase
time_from_unlock_to_purchase
purchase_before_first_reboot
price_tier
payer_first_reboot_time
payer_retention
```

### Business metrics

Track:

``` text
rewarded impressions / DAU
rewarded ad ARPDAU
payer conversion
Starter conversion
ARPPU
IAP ARPDAU
total ARPDAU
D1 / D7 / D30 retention
LTV by cohort
revenue split ads vs IAP
```

Revenue metrics must always be read together with retention and pacing.

------------------------------------------------------------------------

## 25. Monetization Guardrails

Investigate if any of the following occur:

### Ad dependency warning

-   high-performing players feel compelled to watch every opportunity;
-   rewarded views dominate active session time;
-   players describe the game as an "ad simulator";
-   no-ad users progress dramatically outside intended pacing.

### Payer integrity warning

-   paying players skip multiple hours of meaningful first-time content;
-   purchases trivialize First Reboot;
-   paid temporary boosts materially inflate AI Core reward directly;
-   future Factory Rush scores depend on spend.

### Frustration monetization warning

-   a free reward is intentionally nerfed immediately before a paid/ad
    alternative is introduced;
-   progression walls correlate primarily with monetization prompts;
-   players buy mainly to remove a deliberately introduced annoyance.

------------------------------------------------------------------------

## 26. Commercial Open Questions

1.  Is rewarded offline ×2 too difficult to refuse psychologically?
2.  Does ×1.5 produce better long-term satisfaction with acceptable ad
    revenue?
3.  Is Extended Overclock used enough to justify its implementation?
4.  Does the Founder visual variant create real perceived value?
5.  Is €2.99 or €3.99 the better Starter price for conversion × revenue?
6.  Is the Starter Pack valuable enough without permanent power?
7.  If retention is healthy, which repeatable temporary product produces
    payer depth without damaging prestige?
8.  Are cosmetics sufficiently visible/desirable to support a POST-MVP
    cosmetic shop?
9.  What is the actual ads/IAP revenue split by player segment?
10. At what retention level is further monetization investment justified
    for the studio?

------------------------------------------------------------------------

## 27. Explicit MVP Decisions

  Monetization System               MVP Decision
  --------------------------------- --------------------
  Rewarded Offline                  YES
  Rewarded Extended Overclock       YES
  Forced interstitials              NO
  Bonus ad chest                    NO / deferred
  Founder's Factory Pack            YES
  Permanent paid production bonus   NO
  Premium currency                  NO
  Direct AI Core sales              NO
  AI Cores in Starter               NO
  Resource packs                    NO initial MVP
  Repeatable paid boost store       NO initial MVP
  Time skip packs                   POST-MVP candidate
  Remove Ads                        NO
  Cosmetic shop                     POST-MVP
  Battle Pass                       NO MVP
  Subscription                      NO
  Daily offer system                NO MVP

------------------------------------------------------------------------

## 28. Monetization Verdict

**GO with a deliberately small but commercially expandable launch
architecture.**

The MVP monetization model is:

``` text
Rewarded Offline ×2
+
Rewarded Extended Overclock ×2 / 10 min
+
Founder's Factory Pack (~€2.99 initial hypothesis)
```

The game is still intended to make money. The reason not to add many
launch SKUs is not ideological; it is economic and production-focused:

-   first prove retention and Reboot engagement;
-   monetize two naturally valuable moments;
-   obtain first-purchase data;
-   then expand payer depth based on evidence.

The current architecture protects the strongest long-term commercial
asset Project Automata can have: **players who genuinely enjoy
progressing and therefore want to accelerate or personalize that
progression.**
