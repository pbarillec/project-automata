/**
 * AUT-058: stored keys of the Founder's Factory Pack inside EXISTING GameState records (no schema change).
 *
 * - Durable entitlement      `meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID]`
 * - Founder Robot cosmetic   `meta.cosmeticOwnership[FOUNDER_ROBOT_COSMETIC_ID]`
 * - Surge grant-once flag    `meta.accountFeatureUnlocks[FOUNDER_SURGE_GRANTED_FLAG]`   (SEPARATE from the entitlement)
 * - Surge charge inventory   `meta.accountFeatureUnlocks[FOUNDER_SURGE_CHARGE_FLAGS[i]]` (true = available, false = consumed)
 *
 * They all live in `meta` (not `run`/`boosts`) because Reboot rebuilds `run` and `boosts`; `meta` survives it.
 * Kept in the state layer (engine-free) so StateValidation can check the invariants without depending on monetization/;
 * tests/founder_offer.test.ts pins FOUNDER_ENTITLEMENT_ID to services ENTITLEMENTS.founderPack.
 */
export const FOUNDER_ENTITLEMENT_ID = 'entitlement.founder_pack';
export const FOUNDER_ROBOT_COSMETIC_ID = 'cosmetic.founder_robot';
export const FOUNDER_SURGE_GRANTED_FLAG = 'founder_factory_pack.surges_granted';
export const FOUNDER_SURGE_CHARGE_FLAG_PREFIX = 'founder_factory_pack.surge_charge_';
export const FOUNDER_SURGE_CHARGE_FLAGS: readonly string[] = Object.freeze([
    `${FOUNDER_SURGE_CHARGE_FLAG_PREFIX}1`,
    `${FOUNDER_SURGE_CHARGE_FLAG_PREFIX}2`,
]);

/** docs/MONETIZATION.md section 12/14: 2 charges of x2.0 for 30 minutes (activation is a later task; only the quantity is used here). */
export const FOUNDER_SURGE_QUANTITY = 2;
export const FOUNDER_SURGE_MULTIPLIER = 2.0;
export const FOUNDER_SURGE_DURATION_SECONDS = 30 * 60;
