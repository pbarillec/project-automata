# AUT-058 Founder Offer Domain & Entitlement Model

Engine-free core only: no UI, no Billing SDK, no price strings, no Surge activation. No economy/monetization value changed.

## What was built

- `assets/scripts/state/FounderOfferKeys.ts`: the stored keys and the Surge contents (2 x 2.0 x 30 min, MONETIZATION section 12/14).
- `assets/scripts/monetization/FounderOffer.ts`: pure functions.
  - `resolveFounderOfferStatus(state, { storeUnavailable? })` -> `locked | available | owned | unavailable_store`. Owned wins; locked wins over a store outage. Pending purchase is a view concern (AUT-059).
  - `hasFirstWorkerBot(state)`: `meta.civilizationNumber >= 2` OR `run.progressionFlags.first_robot` OR `worker_bot` breakthrough owned (the same facts as `isFreeOverclockUnlocked`, without coupling the offer to Overclock). Civilization >= 2 keeps the offer available through/after the first Reboot (MONETIZATION 12 "through the first Reboot"). The "72 real hours" is a minimum, not an expiry; no expiry is implemented.
  - `applyFounderPackPurchase(state, {source, grantedAtUtcMs})`: the only path that grants Surges.
  - `applyFounderStoreReport(state, {owned, source, reportedAtUtcMs})`: restore/reconcile.
  - readers: `isFounderPackOwned`, `isFounderRobotCosmeticOwned`, `hasFounderSurgeGrantBeenRecorded`, `getFounderSurgeChargesRemaining`.
- Commands `grantFounderPack` (`requestId`, `source`, `grantedAtUtcMs`) and `reconcileFounderEntitlement` (`owned: boolean | null`, `source`, `reportedAtUtcMs`); event `founderPackApplied` (tier `none` in `MILESTONE_EVENT_TIERS`).
- `LifecycleSessionCoordinator`: generic `execute` rejects both commands (like Extended Overclock); dedicated `applyFounderPackPurchase`, `reconcileFounderEntitlement` run the command and a critical save (reason `founder_entitlement`, only when something changed); `getFounderSurgeChargesRemaining`.
- `StateValidation`: two semantic checks (no schema change): `STATE_FOUNDER_CHARGE_WITHOUT_GRANT`, `STATE_FOUNDER_UNKNOWN_CHARGE_SLOT`.

## Storage (NO schema change, save version stays 3, no migration)

All in `meta` (Reboot rebuilds `run` and `boosts`, `meta` survives):

| What | Where |
| --- | --- |
| Durable entitlement | `meta.durableEntitlements['entitlement.founder_pack']` (= `ENTITLEMENTS.founderPack`, `{owned, source, lastKnownValidUtcMs}`) |
| Founder Robot cosmetic | `meta.cosmeticOwnership['cosmetic.founder_robot']` |
| Surge grant-once flag (distinct) | `meta.accountFeatureUnlocks['founder_factory_pack.surges_granted']` |
| Surge charges | `meta.accountFeatureUnlocks['founder_factory_pack.surge_charge_1' / '_2']`: true = available, false = consumed |

Decision to flag: the charge inventory reuses `accountFeatureUnlocks` (boolean record) as two slots rather than adding a numeric field, to avoid a save-version bump. `boosts.consumedCharges` was not usable because Reboot resets `boosts`. If Technical Lead prefers a numeric `meta` consumables record, that is an additive v3 -> v4 migration (MIG-001 pattern).

## Decisions

- The entitlement id is the existing `ENTITLEMENTS.founderPack` (`entitlement.founder_pack`), not a new `founder_factory_pack` string, so `EntitlementService.getEntitlementStatus` uses the same key (test pins equality).
- Restore never grants Surges: it records the grant flag with zero charges. A reinstall/clear-data cannot farm Surges; consumed Surges never return.
- No revoke: a not-owned / unknown / failed report changes nothing (TECHNICAL_DESIGN 23.8). Revoking on a definitive refund is not designed; left to a later decision.
- `grantFounderPack` does not check the offer lock: a paid purchase is never refused. It is idempotent through the stored flags, not through the `requestId` (echoed in the event only).
- Replays refresh `lastKnownValidUtcMs` forward only (a regressed clock never moves it back).

## Open items

- AUT-059 (UI): map `FounderOfferStatus` + pending/localized price to the view; never hardcode a price.
- AUT-060 (Billing): call `applyFounderPackPurchase` and require `applied_saved` / `already_applied` BEFORE acknowledging/consuming the purchase, so a crash between payment and grant is redelivered as a purchase (a restore would grant zero Surges). Feed `reconcileEntitlements` results to `reconcileFounderEntitlement`. Also decide how `pendingPurchaseRequests` is cleared (not touched here).
- AUT-061/062: Founder Robot visual (reads `isFounderRobotCosmeticOwned`) and Factory Surge activation/consumption (sets a charge slot to false; must be a runtime command; Surge must not count toward Prestige Power, MONETIZATION 14).
- Pre-existing, unrelated: `tests/android_admob_provider.test.ts` "native config ..." fails on `main` (AUT-057 Java regex, CRLF working copy), so `npm run check` stops at it.
