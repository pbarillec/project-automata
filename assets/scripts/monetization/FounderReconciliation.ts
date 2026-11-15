/**
 * AUT-061 Founder entitlement reconciliation POLICY (pure, engine-free; no store SDK, no state mutation, no persistence).
 *
 * One entry decides what a store report / store delivery means for the local Founder ownership, so the shop flow, the startup store query and the
 * foreground re-query all share the same rules (TECHNICAL_DESIGN 23.7 / 23.8):
 *
 * - local not owned + store owned (restore: an already acknowledged purchase, a reinstall, another device): restore the entitlement + cosmetic and RECORD the
 *   Surge grant flag with zero charges. Surges are never granted by a restore, and the recorded flag means a later purchase redelivery cannot regrant.
 * - store owned and the store hands over an UNACKNOWLEDGED purchase (live delivery): the normal grant path (the domain grants the two Surges only while the
 *   grant flag is unset), then the acknowledge (once, only after the grant is durable: the caller's job).
 * - local owned + store not_owned / unknown / unavailable / error: KEEP. Nothing is ever revoked (a previously valid entitlement stays valid offline).
 * - a transaction id that was already handled: no-op.
 *
 * The plan is a decision only; `FounderShopFlow` executes it through the session (`applyFounderPackPurchase` / `reconcileFounderEntitlement`).
 */

/** What the store said. `unknown` / `unavailable` / `error` all mean "no answer": they never change ownership. */
export type FounderStoreReportKind = 'owned' | 'not_owned' | 'unknown' | 'unavailable' | 'error';

/**
 * `purchase`: the store hands over an UNACKNOWLEDGED purchase (a completed purchase or its redelivery): grant path then acknowledge.
 * `owned_report`: the store reports an already acknowledged owned purchase (restore semantics): never a grant.
 */
export type FounderStoreDeliveryKind = 'purchase' | 'owned_report';

export type FounderReconciliationAction = 'grant_purchase' | 'restore_entitlement' | 'acknowledge';

export type FounderReconciliationReason =
    | 'duplicate_transaction'
    | 'purchase_delivery'
    | 'restored_from_store'
    | 'already_owned_locally'
    | 'store_not_owned_keep_local'
    | 'store_no_answer_keep_local'
    | 'no_change';

export interface FounderReconciliationInput {
    /** The durable local entitlement (`isFounderPackOwned`). */
    readonly localOwned: boolean;
    readonly store: FounderStoreReportKind;
    /** How the store reported ownership; ignored unless `store === 'owned'`. Defaults to `owned_report` (restore semantics, never a grant). */
    readonly delivery?: FounderStoreDeliveryKind;
    /** The purchase transaction (order) id, or the delivery key when the store gave none. */
    readonly transactionId?: string | null;
    /** Transaction ids already handled durably. */
    readonly seenTransactionIds?: ReadonlySet<string> | readonly string[];
}

export interface FounderReconciliationPlan {
    readonly actions: readonly FounderReconciliationAction[];
    readonly reason: FounderReconciliationReason;
    /** Always false: no input ever revokes a Founder entitlement (TECHNICAL_DESIGN 23.8). */
    readonly revokes: false;
    /**
     * `grant_if_unrecorded`: only a purchase delivery; the domain still grants the two Surges only while the grant flag is unset.
     * `record_flag_only`: a restore records the grant flag with ZERO charges (a later redelivery cannot regrant).
     */
    readonly surgeGrant: 'none' | 'grant_if_unrecorded' | 'record_flag_only';
    /** The transaction should be remembered as handled once the actions are durably applied. */
    readonly recordTransaction: boolean;
}

function plan(actions: readonly FounderReconciliationAction[], reason: FounderReconciliationReason, surgeGrant: FounderReconciliationPlan['surgeGrant'], recordTransaction: boolean): FounderReconciliationPlan {
    return Object.freeze({ actions: Object.freeze([...actions]), reason, revokes: false as const, surgeGrant, recordTransaction });
}

function hasSeen(seen: FounderReconciliationInput['seenTransactionIds'], id: string): boolean {
    if (seen === undefined) return false;
    return Array.isArray(seen) ? seen.includes(id) : (seen as ReadonlySet<string>).has(id);
}

export function decideFounderReconciliation(input: FounderReconciliationInput): FounderReconciliationPlan {
    const transactionId = typeof input.transactionId === 'string' && input.transactionId.length > 0 ? input.transactionId : null;
    if (transactionId !== null && hasSeen(input.seenTransactionIds, transactionId)) {
        return plan([], 'duplicate_transaction', 'none', false);
    }
    if (input.store !== 'owned') {
        if (input.store === 'not_owned') return plan([], input.localOwned ? 'store_not_owned_keep_local' : 'no_change', 'none', false);
        return plan([], input.localOwned ? 'store_no_answer_keep_local' : 'no_change', 'none', false);
    }
    if ((input.delivery ?? 'owned_report') === 'purchase') {
        return plan(['grant_purchase', 'acknowledge'], 'purchase_delivery', 'grant_if_unrecorded', true);
    }
    if (input.localOwned) {
        return plan([], 'already_owned_locally', 'none', true);
    }
    return plan(['restore_entitlement'], 'restored_from_store', 'record_flag_only', true);
}

/** Maps the result of a store query that delivered nothing to a report kind: a failed query is `error` / `unavailable`, never `not_owned`. */
export function classifyFounderStoreQuery(result: { readonly ok: boolean; readonly status?: string }): FounderStoreReportKind {
    if (result.ok) return 'unknown';
    return result.status === 'unavailable' || result.status === 'uninitialized' || result.status === 'initializing' ? 'unavailable' : 'error';
}
