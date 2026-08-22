# AUT-019 Next Goal Resolver

## Purpose

`resolveNextGoal(repository, state)` returns one pure, deterministic progression guidance object for the current `GameState`.

The result is advisory metadata only. It does not mutate state, execute commands, buy levels, purchase Breakthroughs, change Era, move camera, show UI, or emit player-facing prose.

## Goal Taxonomy

Supported categories:

- `producer_build`: construct a producer that is directly purchased through producer level math.
- `producer_milestone`: reach the next meaningful producer level milestone.
- `breakthrough`: purchase the next unfinished run Breakthrough.
- `era`: reach an Era transition that is currently represented by domain progression, such as Robot Line construction for Era II or Advanced Robotics for Era III.
- `reboot_ai_core`: Reboot/AI Core guidance once Robotics Complex progression has produced an AI Core reward.
- `none`: no unfinished supported MVP goal is available.

Every goal has a stable semantic `id`, `semanticKey`, `category`, completion flag, optional progress, blocking metadata, affordability metadata, and a domain-only `focusTarget`.

## Deterministic Priority

For identical `GameState` and `GameConfigRepository`, the resolver returns the same object.

The selection rule is:

1. Pre-check unfinished Breakthroughs in repository config order. If a Breakthrough has no effective requirements and is currently affordable, surface it before producer construction. If that Breakthrough enters a new Era, surface it as an `era` goal. This preserves post-Reboot permanent-upgrade effects such as immediately available Auto Feeder.
2. Build the first direct producer with no producer prerequisites if none is built yet.
3. Walk unfinished Breakthroughs in repository config order.
4. For the current unfinished Breakthrough, surface missing direct producer construction before the Breakthrough itself.
5. If a producer-level requirement has an unfinished configured milestone at or below the required level, surface that milestone first.
6. Otherwise surface the unfinished Breakthrough. If the Breakthrough enters a new Era, surface it as an `era` goal.
7. If no Breakthrough remains, surface remaining direct producer construction in producer config order.
8. If Robotics Complex progression has an AI Core reward available, surface `reboot_ai_core`.
9. Otherwise surface the frontier producer's next milestone, ordered by highest Era and then latest producer config order.
10. If none exists, return `none`.

Tie-breaks use repository order and stable IDs; no screen, scene, camera, or onboarding script order participates.

## Focus Metadata

Focus targets use only domain identifiers:

- producer ID
- producer milestone ID plus producer ID
- Breakthrough ID
- Era ID with producer or Breakthrough source
- progression target kind, currently `reboot_ai_core`

The resolver never returns Cocos nodes, scene paths, UI route names, camera coordinates, localized prose, or script-specific navigation names.

## Progress, Blocking, And Affordability

Progress is derived at resolution time from state and config:

- producer build and milestone progress use current producer level.
- Breakthrough progress uses effective requirements, including permanent-upgrade overrides.
- Era progress uses Era order.
- Reboot progress uses the authoritative Prestige preview.

Blocking means a requirement is not met. Affordability means the relevant cost exists but the current Industrial Output balance is below that cost. These are separate fields so UI/view models can explain "locked by requirement" differently from "requirements met but unaffordable."

Breakthrough blockers are produced through existing Breakthrough eligibility logic, including AUT-017 permanent-upgrade effects. Producer construction costs and Robot Line construction guidance use the shared producer progression helper also used by runtime purchases. Reboot/AI Core guidance uses AUT-018 Prestige preview math and excludes temporary boosts.

## UI And Camera Boundary

Future UI may localize `semanticKey`, inspect IDs, display progress, and request a camera focus from `focusTarget`.

Future camera code must map focus targets to presentation objects outside the resolver. The resolver remains headless and does not know screen layout, scene nodes, camera paths, tutorial overlays, or localized copy.
