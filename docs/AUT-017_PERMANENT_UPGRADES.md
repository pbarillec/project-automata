# AUT-017 Permanent Upgrade Data & Core

AUT-017 implements the permanent AI Core upgrade definitions and pure resolution layer only. It does not spend AI Cores, persist purchases, respec ranks, calculate AI Core rewards, or implement the `BuyPermanentUpgrade` transaction. AUT-030 owns atomic AI Core spending and persistence.

## Authoritative Nodes

The MVP permanent upgrade config is `data/economy/permanent_upgrades.json`.

| ID | Branch | Max Rank | Costs | Prerequisites |
|---|---|---:|---|---|
| `optimized_fabrication` | Production | 3 | `[1,2,4]` | none |
| `industrial_scaling` | Production | 3 | `[2,4,7]` | `optimized_fabrication` rank 1 |
| `autonomous_optimization` | Production | 2 | `[5,10]` | `optimized_fabrication` rank 2 |
| `cached_procedures` | Automation | 2 | `[2,5]` | none |
| `worker_templates` | Automation | 2 | `[3,7]` | `cached_procedures` rank 1 |
| `inherited_automation` | Automation | 1 | `[12]` | `worker_templates` rank 2 |
| `compact_blueprints` | Expansion | 3 | `[2,4,8]` | none |
| `era_compression` | Expansion | 3 | `[4,8,15]` | `compact_blueprints` rank 2 |

Total: 8 upgrades, 19 ranks.

## Typed Effects

Permanent upgrade effects are deliberately narrow:

- `globalProductionMultiplierPerRank`
- `milestonePowerBonusPerRank`
- `automatedProducerMultiplierPerRank`
- `breakthroughRequirementOverrideByRank`
- `producerStartsAutomatedOnceConstructed`
- `newProducerConstructionCostMultiplierPerRank`
- `majorRequirementReductionPerRank`

There is no generic skill-tree engine, expression evaluator, or formula DSL.

## Resolution

Permanent ranks live in `MetaState.permanentUpgradeRanks`.

Pure APIs in `assets/scripts/progression/PermanentUpgrades.ts` provide:

- current rank and next-rank cost lookup;
- rank eligibility with `available`, `prerequisite_locked`, `max_rank`, and `unknown_upgrade`;
- deterministic rank validation for unknown IDs, non-integer ranks, negative ranks, and ranks above max;
- permanent production `ModifierSet` creation;
- effective Breakthrough requirement/cost resolution for A1 and A2;
- construction-cost multiplier resolution for E1;
- major requirement reduction for E2;
- A3 start-automated metadata for future constructed Assembly Stations.

## Composition Points

P1 and P3 production effects compose through AUT-011 `ModifierSet`.

P2 milestone power is resolved at the milestone composition boundary. The implemented rule strengthens each milestone gain above identity:

```text
effectiveMilestoneMultiplier = 1 + (baseMultiplier - 1) * (1 + milestonePowerBonus)
```

P2 rank 1/2/3 resolves milestone power bonus `0.2`, `0.4`, `0.6`.

A1/A2 effective Breakthrough definitions are resolved without mutating `breakthroughs.json`.

E2 uses deterministic `floor(base * (1 - reduction))` rounding. Examples:

```text
50 -> 45 -> 40 -> 35
1000 -> 900 -> 800 -> 700
```

E1 applies only to level-0 producer construction cost portions, not normal producer level purchases after construction.

## Transaction Deferral

AUT-017 intentionally exposes lookup and resolution APIs for future UI, simulator, and AUT-030. It does not deduct AI Cores or mutate `MetaState` to buy permanent ranks.
