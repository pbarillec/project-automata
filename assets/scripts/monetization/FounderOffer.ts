/**
 * AUT-058 Founder's Factory Pack domain (pure, engine-free; no store SDK, no price strings, no UI).
 *
 * Ownership model (docs/MONETIZATION.md sections 12/14, TECHNICAL_DESIGN 23.7/23.8), all in existing `meta` records:
 * - ENTITLEMENT (durable, restorable): `durableEntitlements[founder]` + the Founder Robot cosmetic.
 * - CONSUMABLE GRANT (grant-once, never restorable): `accountFeatureUnlocks[surges_granted]` + two charge slots.
 *   The two are independent flags: restore/reconcile can bring the entitlement back but never grants Surges.
 *
 * Decisions (documented in docs/AUT-058_FOUNDER_OFFER_DOMAIN.md):
 * - A purchase delivery (`applyFounderPackPurchase`) is the ONLY path that grants the two Surges, and only while the grant flag is unset.
 * - A store report (`applyFounderStoreReport`) restores entitlement + cosmetic when owned, marks the grant flag (zero charges), and
 *   never revokes: not-owned / unknown / failed reports change nothing (a previously valid entitlement stays valid offline).
 * - Charges are only STORED here; activation (and consuming a slot) is a later task.
 */
import type { DurableEntitlementState, GameState, MetaState } from '../state/GameState.ts';
import {
    FOUNDER_ENTITLEMENT_ID,
    FOUNDER_ROBOT_COSMETIC_ID,
    FOUNDER_SURGE_CHARGE_FLAGS,
    FOUNDER_SURGE_GRANTED_FLAG,
} from '../state/FounderOfferKeys.ts';
import { FIRST_ROBOT_PROGRESSION_FLAG_ID, WORKER_BOT_BREAKTHROUGH_ID } from '../progression/TemporaryBoosts.ts';

export type FounderOfferStatus = 'locked' | 'available' | 'owned' | 'unavailable_store';
export type FounderEntitlementSource = 'store' | 'mock';

export interface FounderOfferAvailabilityInput {
    /** The store/billing service cannot sell right now (a plain input; this module has no store logic). Pending purchase is a view concern. */
    readonly storeUnavailable?: boolean;
}

/** The First Worker Bot exists: this run's `first_robot` flag / Worker Bot breakthrough, or a later Civilization (a Reboot already happened). */
export function hasFirstWorkerBot(state: GameState): boolean {
    return state.meta.civilizationNumber >= 2 ||
        state.run.progressionFlags[FIRST_ROBOT_PROGRESSION_FLAG_ID] === true ||
        state.run.purchasedBreakthroughIds.includes(WORKER_BOT_BREAKTHROUGH_ID);
}

export function isFounderPackOwned(state: GameState): boolean {
    return state.meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID]?.owned === true;
}

export function isFounderRobotCosmeticOwned(state: GameState): boolean {
    return state.meta.cosmeticOwnership[FOUNDER_ROBOT_COSMETIC_ID] === true;
}

/** True once the two Surges were granted (or, after a restore, marked as granted). Independent of the entitlement. */
export function hasFounderSurgeGrantBeenRecorded(state: GameState): boolean {
    return state.meta.accountFeatureUnlocks[FOUNDER_SURGE_GRANTED_FLAG] === true;
}

/** Unconsumed Factory Surge charges (0..2). */
export function getFounderSurgeChargesRemaining(state: GameState): number {
    return FOUNDER_SURGE_CHARGE_FLAGS.filter((flag) => state.meta.accountFeatureUnlocks[flag] === true).length;
}

/**
 * Offer availability. Owned wins over everything (an owner never sees a lock or a store error); locked wins over a store outage
 * (nothing to sell yet); otherwise a store outage reports `unavailable_store`.
 */
export function resolveFounderOfferStatus(state: GameState, input: FounderOfferAvailabilityInput = {}): FounderOfferStatus {
    if (isFounderPackOwned(state)) {
        return 'owned';
    }
    if (!hasFirstWorkerBot(state)) {
        return 'locked';
    }
    return input.storeUnavailable === true ? 'unavailable_store' : 'available';
}

export interface FounderGrantOutcome {
    /** Entitlement flipped to owned by this call (false when it was already owned). */
    readonly entitlementGranted: boolean;
    readonly cosmeticGranted: boolean;
    /** Surge charges added by this call: 2 on the first purchase delivery, otherwise 0. */
    readonly surgesGranted: number;
    /** Anything in `meta` differs from the input (including a refreshed lastKnownValidUtcMs). */
    readonly changed: boolean;
}

export interface FounderGrantResult {
    readonly meta: MetaState;
    readonly outcome: FounderGrantOutcome;
}

export interface FounderPurchaseInput {
    readonly source: FounderEntitlementSource;
    readonly grantedAtUtcMs: number;
}

/**
 * A completed purchase delivery. Idempotent: replays (duplicate callback, pending-purchase recovery) keep the entitlement/cosmetic and
 * never add Surges once the grant flag is set, even if the charges were consumed. Never mutates `state`.
 */
export function applyFounderPackPurchase(state: GameState, input: FounderPurchaseInput): FounderGrantResult {
    assertTimestamp(input.grantedAtUtcMs, 'grantedAtUtcMs');
    return grant(state, input.source, input.grantedAtUtcMs, true);
}

/** `owned: null` means unknown/failed (offline, billing error, service not ready). */
export interface FounderStoreReport {
    readonly owned: boolean | null;
    readonly source: FounderEntitlementSource;
    readonly reportedAtUtcMs: number;
}

/**
 * Restore / reconcile. Owned: restore the entitlement and cosmetic if missing, refresh lastKnownValidUtcMs, record the grant flag
 * WITHOUT charges (a restore must never grant Surges, TECHNICAL_DESIGN 23.7). Not owned / unknown: no change (no revoke). Never mutates `state`.
 */
export function applyFounderStoreReport(state: GameState, report: FounderStoreReport): FounderGrantResult {
    if (report.owned !== true) {
        return { meta: cloneMeta(state.meta), outcome: { entitlementGranted: false, cosmeticGranted: false, surgesGranted: 0, changed: false } };
    }
    assertTimestamp(report.reportedAtUtcMs, 'reportedAtUtcMs');
    return grant(state, report.source, report.reportedAtUtcMs, false);
}

function grant(state: GameState, source: FounderEntitlementSource, atUtcMs: number, grantSurges: boolean): FounderGrantResult {
    const meta = cloneMeta(state.meta);
    const existing = meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID];
    const entitlementGranted = existing?.owned !== true;
    const entitlement: DurableEntitlementState = existing?.owned === true
        ? { ...existing, lastKnownValidUtcMs: Math.max(existing.lastKnownValidUtcMs ?? 0, atUtcMs) }
        : { owned: true, source, lastKnownValidUtcMs: atUtcMs };
    meta.durableEntitlements[FOUNDER_ENTITLEMENT_ID] = entitlement;

    const cosmeticGranted = meta.cosmeticOwnership[FOUNDER_ROBOT_COSMETIC_ID] !== true;
    meta.cosmeticOwnership[FOUNDER_ROBOT_COSMETIC_ID] = true;

    let surgesGranted = 0;
    if (meta.accountFeatureUnlocks[FOUNDER_SURGE_GRANTED_FLAG] !== true) {
        meta.accountFeatureUnlocks[FOUNDER_SURGE_GRANTED_FLAG] = true;
        if (grantSurges) {
            for (const flag of FOUNDER_SURGE_CHARGE_FLAGS) {
                meta.accountFeatureUnlocks[flag] = true;
            }
            surgesGranted = FOUNDER_SURGE_CHARGE_FLAGS.length;
        }
    }

    const changed = JSON.stringify(meta) !== JSON.stringify(state.meta);
    return { meta, outcome: { entitlementGranted, cosmeticGranted, surgesGranted, changed } };
}

function cloneMeta(meta: MetaState): MetaState {
    return JSON.parse(JSON.stringify(meta)) as MetaState;
}

function assertTimestamp(value: number, label: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a finite non-negative number.`);
    }
}
