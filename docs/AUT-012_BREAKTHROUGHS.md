# AUT-012 Breakthroughs

## Standard MVP Run Breakthroughs

| ID | Cost | Requirements | Typed Effects |
|---|---:|---|---|
| `auto_feeder` | 1,500 IO | Fabricator Level 15 | Automate Fabricator, mark Fabricator offline eligible, Fabricator production x1.25 |
| `worker_bot` | 75,000 IO | Assembly Station Level 10 | Automate Assembly Station, Assembly Station production x1.50, set `first_robot` run flag |
| `robotic_logistics` | 250,000 IO | Worker Bot owned, Fabricator Level 25, Assembly Station Level 15 | Fabricator production x2, Assembly Station production x2 |
| `factory_control_system` | 3,000,000 IO | Robot Line Level 10, Robots Built 10 | Global production x2 |
| `automated_cell_architecture` | 25,000,000 IO | Robot Line Level 25, Robots Built 100 | Construct Automated Cell directly at Level 1 |
| `advanced_robotics` | 1,000,000,000 IO | Robot Line Level 50, Automated Cell Level 25, Robots Built 1000 | Construct Advanced Robotics Complex directly at Level 1, enter Robotics Complex era |

`data/economy/breakthroughs.json` is the authoritative baseline for these IDs, costs, requirements and effects.

## Requirement Contract

Breakthrough requirements are explicit typed records:

- `producerLevel`
- `breakthroughOwned`
- `robotsBuilt`
- `era`
- `civilization`

Eligibility evaluation returns locked requirement details separately from affordability. A state may be requirement-eligible but still unable to purchase because its IO balance is below the configured cost.

## Effect Contract

Breakthrough effects are explicit typed records:

- `producerProductionMultiplier`
- `globalProductionMultiplier`
- `setProducerAutomation`
- `constructProducer`
- `enterEra`
- `setProgressionFlag`

Production multiplier effects resolve into AUT-011 `ModifierSet`; they are not duplicated in production math. Automation, construction, era and flag effects mutate only the cloned transaction state returned by a successful purchase.

## Purchase Semantics

`purchaseBreakthrough` returns deterministic result statuses:

- `success`
- `locked`
- `insufficient_balance`
- `already_owned`
- `unknown_breakthrough`

Failed purchases leave the supplied state unchanged. Successful purchases clone the input state, deduct the configured IO cost exactly once, record the Breakthrough ID exactly once, update purchase statistics and apply non-derived effects. Duplicate purchases return `already_owned` and do not deduct currency or apply effects again.

Construction effects set the target producer to at least the configured level and never reduce an already higher producer level. They do not charge the producer base cost because Economy defines these Breakthroughs as the construction transition.

## Deferred Behavior

AUT-012 intentionally does not implement the AUT-013 command/event architecture, AUT-014 general era progression, or AUT-015 Robots Built accumulation. Robot Line construction / Era II transition and Reboot Civilization are also not modeled as standard AUT-012 Breakthrough entries.
