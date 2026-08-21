# AUT-007 Producer Configuration

## Producer IDs and Baselines

`data/economy/producers.json` is the authoritative source for MVP producer economic baselines.

| Order | ID | Name | Era ID | Base Cost | Cost Growth | Base Production Per Level |
|---:|---|---|---|---:|---:|---:|
| 1 | `fabricator` | Fabricator | `manual_workshop` | 10 | 1.14 | 1 |
| 2 | `assembly_station` | Assembly Station | `manual_workshop` | 1500 | 1.15 | 12 |
| 3 | `robot_line` | Robot Line | `automated_factory` | 50000 | 1.16 | 150 |
| 4 | `automated_cell` | Automated Cell | `automated_factory` | 5000000 | 1.17 | 2500 |
| 5 | `advanced_robotics_complex` | Advanced Robotics Complex | `robotics_complex` | 500000000 | 1.18 | 500000 |

The IDs are stable `snake_case` config IDs and the JSON item order is the approved MVP progression order.

## ProducerConfig Contract

The TypeScript `ProducerConfig` contract currently exposes:

- `id`
- `name`
- `displayNameKey`
- `eraId`
- `baseCost`
- `costGrowth`
- `baseProductionPerLevel`
- `prerequisiteProducerIds`

Validation rejects duplicate producer IDs, unknown resolvable references, non-finite numeric values, non-positive `baseCost`, non-positive `baseProductionPerLevel`, and `costGrowth <= 1`.

## Reference Strategy

Producer `eraId` values point to real era records in `data/economy/eras.json`.

`prerequisiteProducerIds` points only to existing producer IDs and is used as config metadata for deterministic progression ordering. It does not implement purchase, construction, unlock, or production behavior.

Milestone and visual profile references are intentionally absent because those config categories are not implemented yet. Placeholder milestone or visual IDs were not added.

## Deferred Behavior

AUT-007 does not implement:

- producer level cost formulas, owned by AUT-008;
- producer output formulas, owned by AUT-009;
- milestone configuration, effects, or resolution, owned by AUT-010;
- Breakthrough configuration and resolution, owned by AUT-012;
- runtime commands, progression transitions, UI, scenes, or Cocos/native behavior.

`data/economy/breakthroughs.json` remains an empty valid config envelope until its owner task defines the real MVP Breakthrough data.
