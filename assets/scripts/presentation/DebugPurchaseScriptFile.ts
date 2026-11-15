/**
 * AUT-059 DEBUG / capture-only purchase script file (pure, engine-free). The Cocos side (FactoryWorldBootstrap) reads `debug_purchase.json`
 * from the app files dir ONCE at session start, only when `DEBUG === true` AND device diagnostics are enabled, deletes it, and feeds the
 * parsed script to the DEBUG mock purchase provider (BuildPlatformServices). Release builds never read the file; without the file even a DEBUG
 * build uses the NoOp purchase service (the Founder entry stays hidden, like a release build).
 *
 *   { "price": "TEST PRICE 9.99", "outcomes": ["cancelled", "completed"], "duplicateCallback": true, "metadata": "missing" }
 *
 * `price` is the mock STORE product metadata (`ProductDetails.localizedPrice`): test data only, the UI shows it verbatim and never owns a
 * price. `metadata: "missing"` makes the mock product query report the product as missing (neutral state, BUY disabled); omitting `price`
 * with the product present gives metadata without a usable price. `outcomes` are the scripted results of the next purchases (at most 4,
 * allow-listed); `duplicateCallback` redelivers each completed purchase once more. Anything else yields null (ignored, never executed).
 *
 * AUT-060: optional `"provider": "play_billing"` selects the REAL Google Play Billing provider (license-tester device runs) for that launch only.
 * Without the key a DEBUG build keeps the mock (script present) or the no-op (no script). A mock field (price / outcomes / metadata) next to it
 * wins: the mock takes precedence. Any other provider value yields null.
 *
 * AUT-061: optional `"restore": "owned" | "not_owned" | "error"` scripts what the MOCK store's ownership query (start and foreground re-query) reports:
 * `owned` delivers the Founder pack as an already acknowledged owned purchase (restore semantics, reinstall-style), `not_owned` delivers nothing,
 * `error` fails the query. Anything else yields null. A mock field, so the mock takes precedence over `provider`.
 */
export const DEBUG_PURCHASE_FILE = 'debug_purchase.json';
export const DEBUG_PURCHASE_MAX_STEPS = 4;
export const DEBUG_PURCHASE_MAX_PRICE_LENGTH = 32;
export const DEBUG_PURCHASE_PROVIDER_PLAY_BILLING = 'play_billing';
export const DEBUG_PURCHASE_OUTCOMES = ['completed', 'pending', 'cancelled', 'failed', 'unavailable', 'timeout', 'already_owned'] as const;
export type DebugPurchaseOutcome = typeof DEBUG_PURCHASE_OUTCOMES[number];
export const DEBUG_PURCHASE_RESTORE_MODES = ['owned', 'not_owned', 'error'] as const;
export type DebugPurchaseRestoreMode = typeof DEBUG_PURCHASE_RESTORE_MODES[number];

export interface DebugPurchaseScript {
    /** The mock store's localized price text, or null (product without a usable price). */
    readonly price: string | null;
    readonly metadataMissing: boolean;
    readonly outcomes: readonly DebugPurchaseOutcome[];
    readonly duplicateCallback: boolean;
    /** AUT-061: what the mock store's ownership query reports; absent = the query just answers ok. */
    readonly restore?: DebugPurchaseRestoreMode;
    /** Present only for `play_billing` (real provider); absent = the mock. */
    readonly provider?: typeof DEBUG_PURCHASE_PROVIDER_PLAY_BILLING;
}

export function parseDebugPurchaseScriptFile(text: string | undefined): DebugPurchaseScript | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { price, outcomes, duplicateCallback, metadata, provider, restore } = raw as { price?: unknown; outcomes?: unknown; duplicateCallback?: unknown; metadata?: unknown; provider?: unknown; restore?: unknown };
    if (restore !== undefined && (typeof restore !== 'string' || !(DEBUG_PURCHASE_RESTORE_MODES as readonly string[]).includes(restore))) return null;
    if (provider !== undefined && provider !== DEBUG_PURCHASE_PROVIDER_PLAY_BILLING) return null;
    if (price !== undefined && (typeof price !== 'string' || price.trim().length === 0 || price.length > DEBUG_PURCHASE_MAX_PRICE_LENGTH)) return null;
    if (metadata !== undefined && metadata !== 'missing') return null;
    if (duplicateCallback !== undefined && typeof duplicateCallback !== 'boolean') return null;
    const parsed: DebugPurchaseOutcome[] = [];
    if (outcomes !== undefined) {
        if (!Array.isArray(outcomes) || outcomes.length > DEBUG_PURCHASE_MAX_STEPS) return null;
        for (const item of outcomes) {
            if (typeof item !== 'string' || !(DEBUG_PURCHASE_OUTCOMES as readonly string[]).includes(item)) return null;
            parsed.push(item as DebugPurchaseOutcome);
        }
    }
    return Object.freeze({
        price: typeof price === 'string' ? price.trim() : null,
        metadataMissing: metadata === 'missing',
        outcomes: Object.freeze(parsed),
        duplicateCallback: duplicateCallback === true,
        ...(restore !== undefined ? { restore: restore as DebugPurchaseRestoreMode } : {}),
        ...(provider === DEBUG_PURCHASE_PROVIDER_PLAY_BILLING ? { provider: DEBUG_PURCHASE_PROVIDER_PLAY_BILLING } : {}),
    });
}
