import type { PlatformOperationResult } from '../services/PlatformServiceTypes';
import type { PurchaseService } from '../services/PurchaseService';

/**
 * AUT-061 store ownership query scheduler (pure, engine-free, no `cc`). Runs `PurchaseService.restorePurchases()` (the store query: owned purchases are
 * delivered through `onPurchaseDelivery` to the shop flow, which applies the reconciliation policy) at start and again on app foreground, so a purchase
 * completed outside the app, or a pending purchase that resolved later, is picked up without a restart.
 *
 * Rules: foreground queries are THROTTLED (at least `minIntervalMs` after the previous query started, failures included) and SUPPRESSED while the
 * caller says it is blocked (purchase in flight / a platform overlay (ad or purchase sheet) is active / the shop modal is open); only one query runs
 * at a time; nothing runs unless the provider is `ready` and can deliver purchases. The startup query ignores the throttle but starts the window.
 * A failed or unavailable query changes nothing (it is only reported): a previously valid entitlement is never removed because the store was unreachable.
 */

export const FOUNDER_STORE_QUERY_MIN_INTERVAL_MS = 60_000;

export type FounderStoreQueryReason = 'startup' | 'foreground';
export type FounderStoreQueryOutcome = 'ran' | 'throttled' | 'blocked' | 'in_progress' | 'not_ready' | 'unsupported';

export interface FounderStoreQueryOptions {
    readonly purchases: PurchaseService;
    /** Epoch (or monotonic) milliseconds. */
    readonly now: () => number;
    /** True while a purchase flow / platform overlay / the shop modal is active: the query is skipped (and NOT counted against the throttle). */
    readonly isBlocked: () => boolean;
    /** Receives the query result (the flow turns a failed query into a keep-local report; deliveries arrive separately). */
    readonly onResult?: (reason: FounderStoreQueryReason, result: PlatformOperationResult) => void;
    readonly onDiagnostic?: (phase: string, payload: Record<string, unknown>) => void;
    readonly minIntervalMs?: number;
}

export class FounderStoreQuery {
    private readonly purchases: PurchaseService;
    private readonly now: () => number;
    private readonly isBlocked: () => boolean;
    private readonly onResult: FounderStoreQueryOptions['onResult'];
    private readonly onDiagnostic: FounderStoreQueryOptions['onDiagnostic'];
    private readonly minIntervalMs: number;
    private lastStartedAtMs: number | null = null;
    private running = false;

    public constructor(options: FounderStoreQueryOptions) {
        this.purchases = options.purchases;
        this.now = options.now;
        this.isBlocked = options.isBlocked;
        this.onResult = options.onResult;
        this.onDiagnostic = options.onDiagnostic;
        this.minIntervalMs = options.minIntervalMs ?? FOUNDER_STORE_QUERY_MIN_INTERVAL_MS;
    }

    public isRunning(): boolean {
        return this.running;
    }

    public async run(reason: FounderStoreQueryReason): Promise<FounderStoreQueryOutcome> {
        const outcome = this.gate(reason);
        if (outcome !== 'ran') {
            this.emit('store_query_skipped', { trigger: reason, outcome });
            return outcome;
        }
        this.running = true;
        this.lastStartedAtMs = this.now();
        let result: PlatformOperationResult;
        try {
            result = await this.purchases.restorePurchases();
        }
        catch {
            result = { ok: false, status: 'failed', reason: 'store_query_threw' };
        }
        finally {
            this.running = false;
        }
        this.emit('store_query', { trigger: reason, ok: result.ok, status: result.status, reason: result.reason ?? null });
        try {
            this.onResult?.(reason, result);
        }
        catch {
            // a consumer error never breaks the query
        }
        return 'ran';
    }

    private gate(reason: FounderStoreQueryReason): FounderStoreQueryOutcome {
        if (typeof this.purchases.onPurchaseDelivery !== 'function') return 'unsupported';
        if (this.running) return 'in_progress';
        let status = 'failed';
        try {
            status = this.purchases.getStatus().status;
        }
        catch {
            status = 'failed';
        }
        if (status !== 'ready') return 'not_ready';
        let blocked = true;
        try {
            blocked = this.isBlocked();
        }
        catch {
            blocked = true;
        }
        if (blocked) return 'blocked';
        if (reason === 'foreground' && this.lastStartedAtMs !== null) {
            const elapsed = this.now() - this.lastStartedAtMs;
            if (!(elapsed >= this.minIntervalMs)) return 'throttled';
        }
        return 'ran';
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        try {
            this.onDiagnostic?.(phase, payload);
        }
        catch {
            // diagnostics never affect the query
        }
    }
}
